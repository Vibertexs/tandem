// The manager, always on:
//  1. waits for goals and plans each batch with one headless Claude run (plan.ts);
//  2. when every task of a goal is done, merges the goal's task branches into one branch,
//     tandem/<goal id>, runs the project's tests on it, and either calls the goal done or adds one
//     task to fix the failing tests (finish.ts).
//
//   npx tsx watch.ts [--repo <path>] [--budget 0.50] [--model haiku] [--push]
// --push: push each finished goal branch to origin (and open a PR if the GitHub CLI is set up).
// --notify <url>: post "goal done" to a Slack or Discord incoming webhook (or set TANDEM_WEBHOOK).
//
// The first time, it asks to become an operator. Click Approve on "Manager Claude" on the page.
// Its login is saved, so this happens once.
// Env: STDB_URI, STDB_DB, TANDEM_SESSION (default live), TANDEM_TOKEN_FILE
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient } from '../mcp/src/brain-client.js';
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

// ---------- planning ----------
const tries = new Map<string, number>();
const tsx = pathToFileURL(join(here, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;
const plan = () => new Promise<number>(done => {
  const child = spawn(process.execPath, ['--import', tsx, join(here, 'plan.ts'),
    '--uri', URI, '--db', DB, '--session', SESSION, '--token-file', process.env.TANDEM_TOKEN_FILE!,
    '--workdir', REPO, '--model', opt.model!, '--budget', opt.budget!], { stdio: 'inherit' });
  child.on('close', code => done(code ?? 1));
});

// ---------- loop ----------
for (;;) {
  // A goal that failed to plan twice is skipped, so one bad goal cannot burn quota forever.
  const waiting = brain.getGoals().filter(g => (tries.get(g.id) ?? 0) < 2);
  if (waiting.length > 0) {
    for (const g of waiting) tries.set(g.id, (tries.get(g.id) ?? 0) + 1);
    log(`planning ${waiting.length} goal(s): ${waiting.map(g => `"${g.text.slice(0, 50)}"`).join(', ')}`);
    const code = await plan();
    log(code === 0 ? 'planning run finished' : `planning run exited with ${code}`);
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
        const outcome = await finishGoal(finisher, REPO, g, mine, undefined, opt.push);
        log(outcome === 'done' ? `goal ${g.id} done` : `goal ${g.id}: added a task to resolve a merge conflict or fix the tests`);
        if (outcome === 'done' && opt.notify) {
          const sent = await notify(opt.notify, goalDoneMessage(g, mine, finished.branch, finished.note));
          log(sent ? 'posted to the webhook' : 'could not post to the webhook');
        }
      } catch (e) { log(`could not finish goal ${g.id}: ${(e as Error).message}`); }
    }
  }
  await sleep(Number(opt.poll) * 1000);
}
