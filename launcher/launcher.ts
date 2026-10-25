// The launcher: one per worker, logged in as whoever runs it.
// It pulls tasks from the brain and runs each as a fresh headless agent run in its own git
// worktree: Claude Code (claude -p) or Codex (codex exec). The Python placeholder launcher.py is
// left untouched.
//
//   tsx launcher.ts --name Sam [--agent claude|codex] [--account <label>] [--plan pro] [--repo <path>]
//                   [--simulate] [--exit-when-idle] [--max-tasks N] [--push]
// --push: push each task branch to origin, so a host on another computer can merge it.
// --account: only a label for the page; the login itself is CLAUDE_CONFIG_DIR or CODEX_HOME.
//
// Env: STDB_URI, STDB_DB, TANDEM_SESSION (default live), TANDEM_TOKEN_FILE,
//      LAUNCHER_BUDGET_USD  per-run cap for claude -p (default 0.50)
//      LAUNCHER_MODEL       force one model for every run (for cheap tests), else routing.json decides
//      CLAUDE_CONFIG_DIR    (claude) which login to use; CODEX_HOME (codex) which login, required
//      TANDEM_CODEX         a node script standing in for codex (tests only)
// --simulate makes no Claude calls: timed progress and canned results, so the demo works anywhere.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient, type Task } from '../mcp/src/brain-client.js';
import { loadRouting, route } from './routing.js';
import { isRateLimit, resetTime } from './limits.js';
import { filesWithMarkers, ignoreWorktrees, mergeInProgress, pushIfRemote, startConflictMerge, startFromBranches, worktreesDir } from '../manager/merge.js';
import { REVIEW_TITLE, conflictBranch } from '../manager/finish.js';

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
    'sim-limit': { type: 'string', default: '0' }, // simulate: hit a usage limit on the first task, lasting N seconds
    agent: { type: 'string' }, // claude (default) or codex
    account: { type: 'string', default: '' },
  },
});
const AGENT = opt.agent ?? 'claude';
// what the page shows: a worker that fakes the coding says so, instead of passing as Claude
const SHOWN_AS = opt.agent ?? (opt.simulate ? 'simulated' : 'claude');
if (!opt.name) { console.error('usage: tsx launcher.ts --name <name> [--simulate] ...'); process.exit(2); }
if (AGENT !== 'claude' && AGENT !== 'codex') { console.error('--agent is claude or codex'); process.exit(2); }
if (AGENT === 'codex' && !opt.simulate && !process.env.CODEX_HOME) {
  console.error('A Codex worker needs its own login folder (CODEX_HOME). Add one with: tandem account add <label> --agent codex');
  process.exit(2);
}

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
await brain.describeWorker(workerId, SHOWN_AS, opt.account!);
const beat = setInterval(() => { brain.heartbeat(workerId).catch(() => {}); }, 30_000);
log(`registered as ${workerId} in ${DB}/${SESSION}, ${SHOWN_AS}${opt.account ? ` (${opt.account})` : ''}${opt.simulate ? ' (simulate)' : ''}`);

const cannedResult = (t: Task) => ({
  status: 'ok', files_touched: t.files,
  findings: [{ file: t.files[0] ?? '', severity: 'low', note: `Looks fine: ${t.title}` }], notes: 'simulated',
});

// ---------- one task ----------

// After a usage limit: when it resets.
let cappedUntil = 0;
async function hitLimit(until: Date) {
  log(`hit a usage limit; waiting until ${until.toLocaleTimeString()}`);
  // usage 100 caps this worker: the brain puts the task back in the queue for someone with headroom
  await brain.reportCapacity(workerId, 100, null, until.toISOString());
  cappedUntil = until.getTime();
  return 'capped' as const;
}

let simLimitUsed = false;
async function simulate(t: Task) {
  const ms = Number(opt['sim-ms']);
  await brain.reportProgress(workerId, t.id, 'started');
  await sleep(ms);
  if (Number(opt['sim-limit']) > 0 && !simLimitUsed) {
    simLimitUsed = true;
    return hitLimit(new Date(Date.now() + Number(opt['sim-limit']) * 1000));
  }
  await brain.reportProgress(workerId, t.id, 'halfway');
  await sleep(ms);
  await brain.completeTask(workerId, t.id, `sim/${t.id}`, `Simulated: ${t.title}`, t.kind === 'map' ? cannedResult(t) : undefined);
  return 'done' as const;
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();

// A worker's own config files live in a .tandem/ folder beside the task folders, so the task folders
// folder holds only tasks.
function scratchFile(cwd: string, name: string) {
  const dir = join(cwd, '..', '.tandem');
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

const EDIT_TOOLS =['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const READ_TOOLS = ['Read', 'Glob', 'Grep']; // for the review task: it must not change anything

function runClaude(cwd: string, prompt: string, model: string, effort: string, extraEnv: Record<string, string>, tools = EDIT_TOOLS) {
  const tsxEsm = 'file:///' + join(mcpDir, 'node_modules/tsx/dist/esm/index.mjs').split('\\').join('/');
  const mcpConfig = scratchFile(cwd, `mcp-${workerId}.json`);
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { tandem: {
    command: process.execPath, args: ['--import', tsxEsm, join(mcpDir, 'src', 'server.ts')],
    env: { STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: SESSION, TANDEM_WORKER_ID: workerId, ...(process.env.TANDEM_TOKEN_FILE ? { TANDEM_TOKEN_FILE: process.env.TANDEM_TOKEN_FILE } : {}) },
  } } }));
  // the lock-check hook, for this run only
  const settings = scratchFile(cwd, `settings-${workerId}.json`);
  writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Edit|Write|MultiEdit|NotebookEdit',
    hooks: [{ type: 'command', command: `"${process.execPath}" "${join(mcpDir, 'hook', 'check-lock.mjs')}"` }] }] } }));
  const args = ['-p', '--model', model, '--mcp-config', mcpConfig, '--strict-mcp-config', '--settings', settings,
    '--allowedTools', 'mcp__tandem', ...tools, '--permission-mode', 'acceptEdits',
    '--max-budget-usd', BUDGET, '--output-format', 'json'];
  if (effort && effort !== 'default') args.push('--effort', effort);
  return new Promise<{ code: number; out: string; result: string; cost: number; isError: boolean }>(done => {
    const child = spawn('claude', args, { cwd, windowsHide: true, env: { ...process.env, TANDEM_WORKER_ID: workerId, TANDEM_SESSION: SESSION, STDB_URI: URI, STDB_DB: DB, ...extraEnv } });
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

// Codex reads its MCP servers from config.toml in its login folder (CODEX_HOME). The tandem
// server goes between two marker lines, so anything else you set there is kept.
function writeCodexConfig(home: string) {
  const tsxEsm = 'file:///' + join(mcpDir, 'node_modules/tsx/dist/esm/index.mjs').split('\\').join('/');
  const s = (v: string) => JSON.stringify(v); // a JSON string is a valid TOML string
  const env: Record<string, string> = { STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: SESSION, TANDEM_WORKER_ID: workerId };
  if (process.env.TANDEM_TOKEN_FILE) env.TANDEM_TOKEN_FILE = process.env.TANDEM_TOKEN_FILE;
  const block = ['# tandem begin (written by the Tandem launcher)', '[mcp_servers.tandem]',
    `command = ${s(process.execPath)}`,
    `args = [${[ '--import', tsxEsm, join(mcpDir, 'src', 'server.ts') ].map(s).join(', ')}]`,
    `env = { ${Object.entries(env).map(([k, v]) => `${k} = ${s(v)}`).join(', ')} }`, '# tandem end'].join('\n');
  const file = join(home, 'config.toml');
  mkdirSync(home, { recursive: true });
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const kept = old.replace(/# tandem begin[\s\S]*?# tandem end\n?/, '').trimEnd();
  writeFileSync(file, `${kept ? `${kept}\n\n` : ''}${block}\n`);
}

// One codex exec run in the worktree, the prompt on stdin. Reviews run read-only.
function runCodex(cwd: string, prompt: string, readOnly: boolean) {
  writeCodexConfig(process.env.CODEX_HOME!);
  const last = scratchFile(cwd, `codex-${workerId}.txt`);
  const args = ['exec', '--skip-git-repo-check', '--cd', cwd, '--output-last-message', last,
    ...(readOnly ? ['--sandbox', 'read-only'] : ['--full-auto']), '-'];
  // npm installs codex as a .cmd shim on Windows, which needs a shell
  const fake = process.env.TANDEM_CODEX;
  const shell = !fake && process.platform === 'win32';
  const cmd = fake ? process.execPath : 'codex';
  const argv = fake ? [fake, ...args] : shell ? args.map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  return new Promise<{ code: number; out: string; result: string; cost: number; isError: boolean }>(done => {
    const child = spawn(cmd, argv, { cwd, shell, windowsHide: true, env: { ...process.env, TANDEM_WORKER_ID: workerId } });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', e => { out += String(e); });
    child.on('close', code => {
      let result = '';
      try { result = readFileSync(last, 'utf8').trim(); } catch { /* no final message */ }
      // a ChatGPT plan has no per-run price to report
      done({ code: code ?? 1, out, result: result || out, cost: 0, isError: code !== 0 });
    });
    child.stdin.end(prompt);
  });
}

async function realRun(t: Task) {
  const repo = resolve(opt.repo!);
  // the folder says what the task is: write-calc-py-t-bu3yoo (the branch stays task/<id>)
  const words = t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  const trees = worktreesDir(repo);
  const tree = join(trees, words ? `${words}-${t.id}` : t.id);
  const branch = `task/${t.id}`;
  let startedFrom: string[] = [];
  if (!existsSync(tree)) {
    ignoreWorktrees(repo);
    mkdirSync(trees, { recursive: true });
    // A task added to a goal after its work was merged (like a test fix) starts from the goal branch.
    let base = 'HEAD';
    if (t.goal_id) { try { git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/tandem/${t.goal_id}`); base = `tandem/${t.goal_id}`; } catch { /* no goal branch yet */ } }
    git(repo, 'worktree', 'add', '-q', '-b', branch, tree, base);
    // A task that waited for others starts with their work in it.
    const deps = t.depends_on.map(d => brain.getStatus().tasks.find(x => x.id === d)?.branch ?? '').filter(b => b.startsWith('task/'));
    startedFrom = startFromBranches(tree, deps);
    if (startedFrom.length) log(`${t.id} starts from ${startedFrom.join(', ')}`);
  }
  // A "resolve the merge conflict" task: start the merge here, so Claude only edits out the markers.
  const resolving = conflictBranch(t.title);
  const reviewing = t.title === REVIEW_TITLE;
  let conflicted = t.files;
  if (resolving && !mergeInProgress(tree)) {
    try { conflicted = startConflictMerge(tree, resolving); } catch (e) {
      await brain.giveBackTask(workerId, t.id, (e as Error).message);
      return 'given back';
    }
    if (conflicted.length === 0) {
      await brain.completeTask(workerId, t.id, branch, `${resolving} merged cleanly`);
      return 'done';
    }
  }
  const me = brain.getCapacity().find(w => w.id === workerId);
  const routing = loadRouting();
  let { model, effort } = route(t, me?.usage_5h_pct ?? null, routing);
  if (process.env.LAUNCHER_MODEL) model = process.env.LAUNCHER_MODEL;
  const skill = readFileSync(join(mcpDir, 'skill', 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  const prompt = `${skill}\n\n## Your task (already claimed for you)\nThe launcher claimed this task for you and will complete it when you finish. ` +
    `Do NOT call register_worker, claim_task or complete_task. Do use report_progress and lock_files.\n` +
    `task_id: ${t.id}\ntitle: ${t.title}\ndescription: ${t.description || '(none)'}\nfiles: ${t.files.join(', ')}\n` +
    (resolving ? `The merge of ${resolving} is already in progress in this worktree. Do not run git. Conflict markers are in: ${conflicted.join(', ')}.\n` : '') +
    (startedFrom.length ? `This worktree already has the work of the tasks this one waited for (${startedFrom.join(', ')}): read their files before you start.\n` : '') +
    `You are in a git worktree of the repo; paths are relative to it. ` +
    (reviewing ? 'You can only read files. When finished, reply with the findings as the description says.' : 'When finished, reply with one line saying what you did.');

  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const runs = AGENT === 'codex' ? 'codex' : `${model}${effort !== 'default' ? `/${effort}` : ''}`;
    log(`running ${t.id} with ${runs} (attempt ${attempt})`);
    await brain.reportProgress(workerId, t.id, `started (${AGENT === 'codex' ? 'codex' : model})`);
    const { code, out, result, cost, isError } = AGENT === 'codex'
      ? await runCodex(tree, prompt, reviewing)
      : await runClaude(tree, prompt, model, effort, {}, reviewing ? READ_TOOLS : EDIT_TOOLS);
    // Claude may have given the task back itself (give_back_task): then it is no longer ours.
    if (brain.getStatus().tasks.find(x => x.id === t.id)?.assignee !== workerId) return 'given back';
    if (cost > 0) await brain.recordCost(workerId, t.id, cost).catch(() => {});
    if (isRateLimit(out) && (code !== 0 || isError)) return hitLimit(resetTime(out));
    const leftover = resolving && code === 0 && !isError ? filesWithMarkers(tree, conflicted) : [];
    if (leftover.length > 0) {
      lastError = `conflict markers are still in ${leftover.join(', ')}`;
      effort = routing.retry_effort;
      continue;
    }
    if (code === 0 && !isError) {
      // (for a conflict task this commit also concludes the merge)
      git(tree, 'add', '-A');
      const dirty = git(tree, 'status', '--porcelain');
      if (dirty) git(tree, '-c', 'user.name=tandem', '-c', 'user.email=tandem@localhost', 'commit', '-q', '-m', `${t.title} (${t.id})`);
      // With --push the branch reaches the host's manager even from another computer.
      if (opt.push) {
        const pushed = pushIfRemote(tree, branch);
        if (pushed !== 'pushed') await brain.reportProgress(workerId, t.id, pushed === 'no-remote' ? 'no origin remote: branch not pushed' : 'could not push the branch');
      }
      // a review's whole reply is its result; any other task is summed up by its last line
      const lines = result.trim().split('\n').map(l => l.trim()).filter(Boolean);
      const summary = (reviewing ? lines.join(' · ').slice(0, 300) : lines.pop()?.slice(0, 200)) || 'done';
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

// Stays online (the heartbeat keeps going) until the limit resets, then takes work again.
async function waitForReset() {
  while (Date.now() < cappedUntil) await sleep(Math.min(60_000, cappedUntil - Date.now()));
  await brain.reportCapacity(workerId, 0, null, null);
  log('the limit has reset; back to work');
}

let done = 0;
const max = Number(opt['max-tasks']);
for (;;) {
  let task: Task | null = null;
  try { task = await brain.claimTask(workerId); } catch (e) {
    const msg = (e as Error).message;
    if (/capped/.test(msg)) {
      // still capped from before this launcher started: wait for the reset the brain has
      cappedUntil = Date.parse(brain.getCapacity().find(w => w.id === workerId)?.reset_at ?? '') || 0;
      if (cappedUntil > Date.now()) log(`out of quota until ${new Date(cappedUntil).toLocaleTimeString()}`);
      await waitForReset();
      continue;
    }
    log(`claim refused: ${msg}`);
  }
  if (!task) {
    const left = brain.getStatus().tasks.filter(t => t.status !== 'done' && t.status !== 'failed');
    if (opt['exit-when-idle'] && left.length === 0) break;
    await sleep(Number(opt.poll) * 1000);
    continue;
  }
  log(`claimed ${task.id}: ${task.title}`);
  const outcome = opt.simulate ? await simulate(task) : await realRun(task);
  log(`${task.id}: ${outcome}`);
  if (outcome === 'done') done++;
  if (outcome === 'capped') { await waitForReset(); continue; }
  if (max > 0 && done >= max) break;
}
clearInterval(beat);
log(`finished ${done} task(s)`);
brain.disconnect();
setTimeout(() => process.exit(0), 300);
