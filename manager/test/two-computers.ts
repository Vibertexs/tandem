// REAL (about 4 haiku runs): the "teammate on another computer" path, on one machine.
//   origin   a bare repo standing in for GitHub
//   clone A  the host: the manager runs here, with --push
//   clone B  the teammate: the only worker runs here, with --push
// Every task branch is made on B, so the host can only merge it by fetching it from origin.
// Publishes a FRESH database (bilal-two). Needs the local brain on 3001, `spacetime` and `claude` on PATH.
import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-two';
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  two computers: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn: () => boolean, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(500); } return fn(); };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

// the repos
const root = mkdtempSync(join(tmpdir(), 'tandem-two-'));
const origin = join(root, 'origin.git'), a = join(root, 'a'), b = join(root, 'b');
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
execFileSync('git', ['clone', '-q', origin, a], { stdio: 'pipe' });
writeFileSync(join(a, 'README.md'), '# shop\n'); writeFileSync(join(a, '.gitignore'), '.worktrees/\n');
git(a, 'checkout', '-q', '-b', 'main'); git(a, 'add', '-A'); git(a, 'commit', '-q', '-m', 'start'); git(a, 'push', '-q', 'origin', 'main');
execFileSync('git', ['clone', '-q', origin, b], { stdio: 'pipe' });

execSync(`spacetime publish ${DB} --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes`, { stdio: 'pipe' });
const owner = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.goals, tables.tasks, tables.operatorRequests, tables.workers]); })
    .onConnectError((_c, e) => rej(e)).build();
});
await owner.reducers.claimOperator({});

const here = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: 'live', LAUNCHER_MODEL: 'haiku', LAUNCHER_BUDGET_USD: '0.50' };
const procs: ChildProcess[] = [];
let log = '';
const run = (args: string[], token: string) => {
  const p = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: here, env: { ...env, TANDEM_TOKEN_FILE: join(root, token) } });
  p.stdout!.on('data', d => { log += d; }); p.stderr!.on('data', d => { log += d; });
  procs.push(p);
};
try {
  run([join(here, 'watch.ts'), '--repo', a, '--push', '--poll', '2'], 'manager-token');
  check('the manager asks to manage the team', await until(() => [...owner.db.operatorRequests.iter()].length === 1, 20_000));
  await owner.reducers.approveOperator({ identity: [...owner.db.operatorRequests.iter()][0].identity });
  run([join(here, '..', 'launcher', 'launcher.ts'), '--name', 'Guest', '--repo', b, '--push', '--poll', '2'], 'guest-token');
  check('the teammate\'s worker joins', await until(() => [...owner.db.workers.iter()].some(w => w.id === 'w-guest'), 20_000));

  await owner.reducers.postGoal({ sessionId: 'live', id: 'g-shop', text: 'Create a tiny Python calculator: calc.py with add(a, b) and sub(a, b), test_calc.py with unittest tests, and a README.md section on usage.' });
  const goal = () => [...owner.db.goals.iter()].find(g => g.id === 'g-shop');
  const done = await until(() => ['done', 'failed'].includes(goal()?.status ?? ''), 900_000);
  const tasks = [...owner.db.tasks.iter()].filter(t => t.goalId === 'g-shop');
  check('the goal is done', done && goal()?.status === 'done', [goal()?.status, goal()?.note, log.slice(-600)]);
  check('every task was done on the teammate\'s computer', tasks.length >= 2 && tasks.every(t => t.status === 'done' && t.assignee === 'w-guest'), tasks.map(t => `${t.id}:${t.status}:${t.assignee}`));
  let files: string[] = [];
  try { git(a, 'fetch', '-q', 'origin'); files = git(a, 'ls-tree', '-r', '--name-only', `origin/tandem/g-shop`).split('\n'); } catch { /* not pushed */ }
  check('the host merged the teammate\'s branches (fetched from origin) and pushed the goal branch', ['calc.py', 'test_calc.py'].every(f => files.includes(f)), files);
  check('the note says the tests pass and the branch was pushed', /Tests pass/.test(goal()?.note ?? '') && /Pushed to origin/.test(goal()?.note ?? ''), goal()?.note);
} finally {
  for (const p of procs) p.kill();
  owner.disconnect();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 500);
