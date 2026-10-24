// The manager, always on:
//  1. waits for goals and plans each batch with one headless Claude run (manager/run.ps1);
//  2. when every task of a goal is done, merges the goal's task branches into one branch,
//     tandem/<goal id>, runs the project's tests on it, and either calls the goal done or adds one
//     task to fix the failing tests (finish.ts).
//
//   npx tsx watch.ts [--repo <path>] [--budget 0.50] [--model haiku] [--push]
// --push: push each finished goal branch to origin (and open a PR if the GitHub CLI is set up).
//
// The first time, it asks to become an operator. Click Approve on "Manager Claude" on the page.
// Its login is saved, so this happens once.
// Env: STDB_URI, STDB_DB, TANDEM_SESSION (default live), TANDEM_TOKEN_FILE
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient } from '../mcp/src/brain-client.js';
import { finishGoal } from './finish.js';

const { values: opt } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    budget: { type: 'string', default: '0.50' },
    model: { type: 'string', default: 'haiku' },
    poll: { type: 'string', default: '3' },
    push: { type: 'boolean', default: false },
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
const plan = () => new Promise<number>(done => {
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'run.ps1'),
    '-Uri', URI, '-Db', DB, '-Session', SESSION, '-TokenFile', process.env.TANDEM_TOKEN_FILE!,
    '-WorkDir', REPO, '-Model', opt.model!, '-MaxBudgetUsd', opt.budget!], { stdio: 'inherit' });
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
        const outcome = await finishGoal(brain, REPO, g, mine, undefined, opt.push);
        log(outcome === 'done' ? `goal ${g.id} done` : `goal ${g.id}: tests fail after merging; added a task to fix them`);
      } catch (e) { log(`could not finish goal ${g.id}: ${(e as Error).message}`); }
    }
  }
  await sleep(Number(opt.poll) * 1000);
}
