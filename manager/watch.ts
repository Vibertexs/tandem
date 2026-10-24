// The manager, always on: waits for goals and plans each batch with one headless Claude run
// (manager/run.ps1). Type a goal on the dashboard and it gets planned within a few seconds.
//
//   npx tsx watch.ts [--repo <path>] [--budget 0.50] [--model haiku]
//
// The first time, it asks to become an operator. Click Approve on "Manager Claude" on the
// dashboard (it shows up at the top for operators). Its login is saved, so this happens once.
// Env: STDB_URI, STDB_DB, TANDEM_SESSION (default live), TANDEM_TOKEN_FILE
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient } from '../mcp/src/brain-client.js';

const { values: opt } = parseArgs({
  options: {
    repo: { type: 'string', default: process.cwd() },
    budget: { type: 'string', default: '0.50' },
    model: { type: 'string', default: 'haiku' },
    poll: { type: 'string', default: '3' },
  },
});
const here = fileURLToPath(new URL('.', import.meta.url));
const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const SESSION = process.env.TANDEM_SESSION ?? 'live';
// Same saved login as run.ps1, so the identity approved here is the one that plans.
process.env.TANDEM_TOKEN_FILE ??= join(here, '..', 'mcp', '.tandem', `manager-token-${DB}`);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const log = (m: string) => console.log(`[manager] ${m}`);

const brain = await BrainClient.connect(URI, DB, SESSION);
log(`connected to ${DB}/${SESSION} as ${brain.identity.slice(0, 8)}…`);
if (!brain.isOperator()) {
  await brain.requestOperator('Manager Claude');
  log('asked to become an operator. On the dashboard, click Approve on "Manager Claude".');
  while (!brain.isOperator()) await sleep(1000);
  log('approved.');
}

const tries = new Map<string, number>();
const plan = () => new Promise<number>(done => {
  const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'run.ps1'),
    '-Uri', URI, '-Db', DB, '-Session', SESSION, '-TokenFile', process.env.TANDEM_TOKEN_FILE!,
    '-WorkDir', resolve(opt.repo!), '-Model', opt.model!, '-MaxBudgetUsd', opt.budget!], { stdio: 'inherit' });
  child.on('close', code => done(code ?? 1));
});

for (;;) {
  // A goal that failed to plan twice is skipped, so one bad goal cannot burn quota forever.
  const waiting = brain.getGoals().filter(g => (tries.get(g.id) ?? 0) < 2);
  if (waiting.length > 0) {
    for (const g of waiting) tries.set(g.id, (tries.get(g.id) ?? 0) + 1);
    log(`planning ${waiting.length} goal(s): ${waiting.map(g => `"${g.text.slice(0, 50)}"`).join(', ')}`);
    const code = await plan();
    log(code === 0 ? 'planning run finished' : `planning run exited with ${code}`);
  }
  await sleep(Number(opt.poll) * 1000);
}
