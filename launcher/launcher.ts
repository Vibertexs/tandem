// The launcher: one per teammate, on their own machine, logged in as themselves.
// It pulls tasks from the brain and runs each as a fresh headless Claude Code run in its own git
// worktree. The Python placeholder launcher.py is left untouched.
//
//   tsx launcher.ts --name Sam [--plan pro] [--repo <path>] [--simulate] [--exit-when-idle] [--max-tasks N] [--push]
// --push: push each task branch to origin, so a host on another computer can merge it.
//
// Env: STDB_URI, STDB_DB, TANDEM_SESSION (default live), TANDEM_TOKEN_FILE,
//      LAUNCHER_BUDGET_USD  per-run cap for claude -p (default 0.50)
//      LAUNCHER_MODEL       force one model for every run (for cheap tests), else routing.json decides
// --simulate makes no Claude calls: timed progress and canned results, so the demo works anywhere.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient, type Task } from '../mcp/src/brain-client.js';
import { loadRouting, route } from './routing.js';
import { pushIfRemote } from '../manager/merge.js';

const { values: opt } = parseArgs({
  options: {
    name: { type: 'string' },
    plan: { type: 'string', default: 'pro' },
    repo: { type: 'string', default: process.cwd() },
    simulate: { type: 'boolean', default: false },
    'exit-when-idle': { type: 'boolean', default: false },
    'max-tasks': { type: 'string', default: '0' },
    poll: { type: 'string', default: '3' },
    'sim-ms': { type: 'string', default: '1500' },
    push: { type: 'boolean', default: false },
  },
});
if (!opt.name) { console.error('usage: tsx launcher.ts --name <name> [--simulate] ...'); process.exit(2); }

const here = fileURLToPath(new URL('.', import.meta.url));
const mcpDir = resolve(here, '..', 'mcp');
const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const SESSION = process.env.TANDEM_SESSION ?? 'live';
const BUDGET = process.env.LAUNCHER_BUDGET_USD ?? '0.50';
const workerId = 'w-' + opt.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (m: string) => console.log(`[${opt.name}] ${m}`);

const brain = await BrainClient.connect(URI, DB, SESSION);
await brain.registerWorker(workerId, opt.name, opt.plan!);
const beat = setInterval(() => { brain.heartbeat(workerId).catch(() => {}); }, 30_000);
log(`registered as ${workerId} in ${DB}/${SESSION}${opt.simulate ? ' (simulate)' : ''}`);

const cannedResult = (t: Task) => ({
  status: 'ok', files_touched: t.files,
  findings: [{ file: t.files[0] ?? '', severity: 'low', note: `Looks fine: ${t.title}` }], notes: 'simulated',
});

// ---------- one task ----------

async function simulate(t: Task) {
  const ms = Number(opt['sim-ms']);
  await brain.reportProgress(workerId, t.id, 'started');
  await sleep(ms);
  await brain.reportProgress(workerId, t.id, 'halfway');
  await sleep(ms);
  await brain.completeTask(workerId, t.id, `sim/${t.id}`, `Simulated: ${t.title}`, t.kind === 'map' ? cannedResult(t) : undefined);
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

function runClaude(cwd: string, prompt: string, model: string, effort: string, extraEnv: Record<string, string>) {
  const tsxEsm = 'file:///' + join(mcpDir, 'node_modules/tsx/dist/esm/index.mjs').split('\\').join('/');
  const mcpConfig = join(cwd, '..', `.tandem-mcp-${workerId}.json`);
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { tandem: {
    command: process.execPath, args: ['--import', tsxEsm, join(mcpDir, 'src', 'server.ts')],
    env: { STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: SESSION, TANDEM_WORKER_ID: workerId, ...(process.env.TANDEM_TOKEN_FILE ? { TANDEM_TOKEN_FILE: process.env.TANDEM_TOKEN_FILE } : {}) },
  } } }));
  // the lock-check hook, for this run only
  const settings = join(cwd, '..', `.tandem-settings-${workerId}.json`);
  writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit',
    hooks: [{ type: 'command', command: `"${process.execPath}" "${join(mcpDir, 'hook', 'check-lock.mjs')}"` }] }] } }));
  const args = ['-p', '--model', model, '--mcp-config', mcpConfig, '--strict-mcp-config', '--settings', settings,
    '--allowedTools', 'mcp__tandem', 'Read', 'Write', 'Edit', 'Glob', 'Grep', '--permission-mode', 'acceptEdits',
    '--max-budget-usd', BUDGET, '--output-format', 'json'];
  if (effort && effort !== 'default') args.push('--effort', effort);
  return new Promise<{ code: number; out: string; result: string; cost: number; isError: boolean }>(done => {
    const child = spawn('claude', args, { cwd, env: { ...process.env, TANDEM_WORKER_ID: workerId, TANDEM_SESSION: SESSION, STDB_URI: URI, STDB_DB: DB, ...extraEnv } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { stderr += String(e); });
    child.on('close', code => {
      // --output-format json: one JSON object with the final text, the cost and whether it failed
      let json: { result?: string; total_cost_usd?: number; is_error?: boolean } = {};
      try { json = JSON.parse(stdout.trim().split('\n').pop() ?? '{}'); } catch { /* plain text */ }
      done({ code: code ?? 1, out: stdout + stderr, result: json.result ?? stdout, cost: json.total_cost_usd ?? 0, isError: json.is_error === true });
    });
    child.stdin.end(prompt);
  });
}

async function realRun(t: Task) {
  const repo = resolve(opt.repo!);
  const tree = join(repo, '.worktrees', t.id);
  const branch = `task/${t.id}`;
  if (!existsSync(tree)) {
    mkdirSync(join(repo, '.worktrees'), { recursive: true });
    // A task added to a goal after its work was merged (like a test fix) starts from the goal branch.
    let base = 'HEAD';
    if (t.goal_id) { try { git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/tandem/${t.goal_id}`); base = `tandem/${t.goal_id}`; } catch { /* no goal branch yet */ } }
    git(repo, 'worktree', 'add', '-q', '-b', branch, tree, base);
  }
  const me = brain.getCapacity().find(w => w.id === workerId);
  const routing = loadRouting();
  let { model, effort } = route(t, me?.usage_5h_pct ?? null, routing);
  if (process.env.LAUNCHER_MODEL) model = process.env.LAUNCHER_MODEL;
  const skill = readFileSync(join(mcpDir, 'skill', 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  const prompt = `${skill}\n\n## Your task (already claimed for you)\nThe launcher claimed this task for you and will complete it when you finish. ` +
    `Do NOT call register_worker, claim_task or complete_task. Do use report_progress and lock_files.\n` +
    `task_id: ${t.id}\ntitle: ${t.title}\ndescription: ${t.description || '(none)'}\nfiles: ${t.files.join(', ')}\n` +
    `You are in a git worktree of the repo; paths are relative to it. When finished, reply with one line saying what you did.`;

  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`running ${t.id} with ${model}${effort !== 'default' ? `/${effort}` : ''} (attempt ${attempt})`);
    await brain.reportProgress(workerId, t.id, `started (${model})`);
    const { code, out, result, cost, isError } = await runClaude(tree, prompt, model, effort, {});
    // Claude may have given the task back itself (give_back_task): then it is no longer ours.
    if (brain.getStatus().tasks.find(x => x.id === t.id)?.assignee !== workerId) return 'given back';
    if (cost > 0) await brain.recordCost(workerId, t.id, cost).catch(() => {});
    if (/rate.?limit|usage limit|limit reached|try again later/i.test(out) && (code !== 0 || isError)) {
      // cap this worker: the brain puts the task back in the queue for someone with headroom
      log('hit a rate limit; reporting capped');
      await brain.reportCapacity(workerId, 100, null, null);
      return 'capped';
    }
    if (code === 0 && !isError) {
      git(tree, 'add', '-A');
      const dirty = git(tree, 'status', '--porcelain');
      if (dirty) git(tree, '-c', 'user.name=tandem', '-c', 'user.email=tandem@localhost', 'commit', '-q', '-m', `${t.title} (${t.id})`);
      // With --push the branch reaches the host's manager even from another computer.
      if (opt.push) {
        const pushed = pushIfRemote(tree, branch);
        if (pushed !== 'pushed') await brain.reportProgress(workerId, t.id, pushed === 'no-remote' ? 'no origin remote: branch not pushed' : 'could not push the branch');
      }
      const summary = result.trim().split('\n').filter(Boolean).pop()?.slice(0, 200) ?? 'done';
      await brain.completeTask(workerId, t.id, branch, summary, t.kind === 'map' ? { status: 'ok', files_touched: t.files, findings: [], notes: summary } : undefined);
      return 'done';
    }
    lastError = (result || out).trim().split('\n').filter(Boolean).pop()?.slice(0, 200) ?? '';
    effort = routing.retry_effort; // retry once at higher effort
  }
  // Hand it back: a different worker gets it, and after two workers it waits for a person.
  await brain.giveBackTask(workerId, t.id, `failed twice${lastError ? `: ${lastError}` : ''}`);
  return 'given back';
}

// ---------- main loop ----------

let done = 0;
const max = Number(opt['max-tasks']);
for (;;) {
  let task: Task | null = null;
  try { task = await brain.claimTask(workerId); } catch (e) { log(`claim refused: ${(e as Error).message}`); }
  if (!task) {
    const left = brain.getStatus().tasks.filter(t => t.status !== 'done' && t.status !== 'failed');
    if (opt['exit-when-idle'] && left.length === 0) break;
    await sleep(Number(opt.poll) * 1000);
    continue;
  }
  log(`claimed ${task.id}: ${task.title}`);
  const outcome = opt.simulate ? (await simulate(task), 'done') : await realRun(task);
  log(`${task.id}: ${outcome}`);
  if (outcome === 'done') done++;
  if (outcome === 'capped') break;
  if (max > 0 && done >= max) break;
}
clearInterval(beat);
log(`finished ${done} task(s)`);
brain.disconnect();
setTimeout(() => process.exit(0), 300);
