// The manager, always on:
//  1. waits for goals and plans each batch with one headless Claude run (plan.ts);
//  2. when every task of a goal is done, merges the goal's task branches into one branch,
//     tandem/<goal id>, runs the project's tests on it, and either calls the goal done or adds one
//     task to fix the failing tests (finish.ts).
//
//   npx tsx watch.ts [--repo <path>] [--budget 0.50] [--model haiku] [--push]
// --push: push each finished goal branch to origin (and open a PR if the GitHub CLI is set up).
// --notify <url>: post "goal done" to a Slack or Discord incoming webhook (or set TANDEM_WEBHOOK).
// --review: before a goal is done, one worker reviews its merged branch; the findings go in the note.
//
// The first time, it asks to become an operator. Click Approve on "Manager Claude" on the page.
// Its login is saved, so this happens once.
// Env: STDB_URI, STDB_DB, TANDEM_SESSION (default live), TANDEM_TOKEN_FILE
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient } from '../mcp/src/brain-client.js';
import { applyBranch } from './apply.js';
import { finishGoal, type FinishBrain } from './finish.js';
import { goalDoneMessage, notify } from './notify.js';

const { values: opt } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    budget: { type: 'string', default: '0.50' },
    model: { type: 'string', default: 'haiku' },
    poll: { type: 'string', default: '3' },
    push: { type: 'boolean', default: false },
    notify: { type: 'string', default: process.env.TANDEM_WEBHOOK },
    'git-url': { type: 'string' }, // where teammates' computers clone the project from (tandem start serves it)
    review: { type: 'boolean', default: false },
  },
});
const here = fileURLToPath(new URL('.', import.meta.url));
const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const SESSION = process.env.TANDEM_SESSION ?? 'live';
const REPO = resolve(opt.repo!);
// Same saved login as run.ps1, so the identity approved here is the one that plans.
process.env.TANDEM_TOKEN_FILE ??= join(here, '..', 'mcp', '.tandem', `manager-token-${DB}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (m: string) => console.log(`[manager] ${m}`);

const brain = await BrainClient.connect(URI, DB, SESSION);
log(`connected to ${DB}/${SESSION} as ${brain.identity.slice(0, 8)}…`);
const ping = () => brain.ping('Manager Claude', 'manager').catch(() => {});
await ping();
setInterval(ping, 15_000);
if (!brain.isOperator()) {
  await brain.requestOperator('Manager Claude');
  log('asked to become an operator. On the page, click Approve on "Manager Claude".');
  while (!brain.isOperator()) await sleep(1000);
  log('approved.');
}

// Tell the page which repo the team works on (its origin), so it can show a teammate what to
// clone. Workers elsewhere push their task branches there, and merging fetches them.
{
  let url = '';
  try { url = execFileSync('git', ['-C', REPO, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim(); } catch { /* no origin */ }
  await brain.setContext('repo_url', url).catch(() => {});
  await brain.setContext('git_url', opt['git-url'] ?? '').catch(() => {});
  // where Tandem and the project are on this computer, so the Setup page can show real commands
  await brain.setContext('tandem_dir', resolve(here, '..')).catch(() => {});
  await brain.setContext('project_dir', REPO).catch(() => {});
}

// ---------- planning ----------
const tries = new Map<string, number>();
const failed = new Set<string>(); // goals this watcher marked failed
const tsx = pathToFileURL(join(here, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;
// One planning run. `why` is plan.ts's "Could not plan: ..." line, if it failed.
const plan = () => new Promise<{ code: number; why: string }>(done => {
  const child = spawn(process.execPath, ['--import', tsx, join(here, 'plan.ts'),
    '--uri', URI, '--db', DB, '--session', SESSION, '--token-file', process.env.TANDEM_TOKEN_FILE!,
    '--workdir', REPO, '--model', opt.model!, '--budget', opt.budget!], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  let why = '';
  child.stdout.on('data', d => {
    process.stdout.write(d);
    for (const m of String(d).matchAll(/^Could not plan: (.*)$/gm)) why = m[1].trim();
  });
  child.on('close', code => done({ code: code ?? 1, why }));
});
const TRIES = 2;

// ---------- loop ----------
for (;;) {
  // A goal that failed to plan twice is marked failed with the reason, so one bad goal cannot
  // burn quota forever and the page can say what is wrong. Try again on the page makes it new.
  for (const g of brain.getGoals()) if (failed.delete(g.id)) tries.delete(g.id);
  const waiting = brain.getGoals().filter(g => (tries.get(g.id) ?? 0) < TRIES);
  if (waiting.length > 0) {
    for (const g of waiting) tries.set(g.id, (tries.get(g.id) ?? 0) + 1);
    log(`planning ${waiting.length} goal(s): ${waiting.map(g => `"${g.text.slice(0, 50)}"`).join(', ')}`);
    const { code, why } = await plan();
    log(code === 0 ? 'planning run finished' : `planning run exited with ${code}${why ? `: ${why}` : ''}`);
    await sleep(500); // let the last updates arrive
    const planned = brain.getStatus().tasks;
    for (const g of waiting) {
      const now = brain.listGoals().find(x => x.id === g.id);
      if (!now || now.status === 'planned' || now.status === 'done') continue;
      try {
        if (planned.some(t => t.goal_id === g.id)) {
          // the run stopped after creating tasks: let that work go ahead
          await brain.markGoal(g.id, 'planned');
        } else if ((tries.get(g.id) ?? 0) >= TRIES) {
          await brain.failGoal(g.id, `The manager could not plan this${why ? `: ${why}` : '.'} Check that \`claude -p "hi"\` works in a terminal on the host, then press Try again.`);
          failed.add(g.id);
          log(`goal ${g.id}: could not plan it, marked failed`);
        } else if (now.status === 'planning') {
          await brain.markGoal(g.id, 'new'); // try once more
        }
      } catch (e) { log(`could not update goal ${g.id}: ${(e as Error).message}`); }
    }
  }
  const tasks = brain.getStatus().tasks;
  for (const g of brain.listGoals().filter(x => x.status === 'planned')) {
    const mine = tasks.filter(t => t.goal_id === g.id);
    if (mine.length > 0 && mine.every(t => t.status === 'done')) {
      try {
        let finished = { branch: '', note: '' };
        const finisher: FinishBrain = {
          finishGoal: async (id, branch, note) => { finished = { branch, note }; await brain.finishGoal(id, branch, note); },
          markGoal: (id, status) => brain.markGoal(id, status),
          assignTask: t => brain.assignTask(t),
        };
        const outcome = await finishGoal(finisher, REPO, g, mine, { push: opt.push, review: opt.review });
        log(outcome === 'done' ? `goal ${g.id} done` : `goal ${g.id}: added a task (a merge conflict, failing tests or the review)`);
        if (outcome === 'done' && opt.notify) {
          const sent = await notify(opt.notify, goalDoneMessage(g, mine, finished.branch, finished.note));
          log(sent ? 'posted to the webhook' : 'could not post to the webhook');
        }
      } catch (e) { log(`could not finish goal ${g.id}: ${(e as Error).message}`); }
    }
  }
  // "Merge into my project" pressed on the page: apply_<goal id> = requested. Answer with done: or failed:.
  for (const [key, value] of Object.entries(brain.getContext())) {
    if (!key.startsWith('apply_') || value !== 'requested') continue;
    const goal = brain.listGoals().find(g => g.id === key.slice('apply_'.length));
    await brain.setContext(key, 'working').catch(() => {}); // so it is not done twice
    const result = goal?.branch ? applyBranch(REPO, goal.branch) : { ok: false, message: 'That goal has no branch to merge.' };
    await brain.setContext(key, `${result.ok ? 'done' : 'failed'}: ${result.message}`).catch(() => {});
    log(`merge into the project, goal ${goal?.id ?? key}: ${result.ok ? 'done' : 'failed'}: ${result.message}`);
  }
  await sleep(Number(opt.poll) * 1000);
}
