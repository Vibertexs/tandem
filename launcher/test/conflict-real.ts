// One REAL conflict fix: 1 haiku claude -p call. Two task branches added different functions at
// the same spot in calc.py, so the second one conflicts with the goal branch. The launcher takes
// the "Resolve the merge conflict" task, starts the merge, Claude edits out the markers, and the
// launcher commits the merge. Needs the local server on dev3001 with bilal-dev published.
// Run: npx tsx test/conflict-real.ts
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';
import { conflictTitle } from '../../manager/finish.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-dev';
const S = `cr-${Date.now().toString(36)}`;
const REPO = 'C:/Code/scratch/conflict-repo';
const launcher = fileURLToPath(new URL('../launcher.ts', import.meta.url));
const git = (...args: string[]) => execFileSync('git', ['-C', REPO, '-c', 'user.name=t', '-c', 'user.email=t@localhost', ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  conflict: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

if (existsSync(REPO)) { try { execFileSync('git', ['-C', REPO, 'worktree', 'prune'], { stdio: 'pipe' }); } catch { /* not a repo */ } rmSync(REPO, { recursive: true, force: true }); }
mkdirSync(REPO, { recursive: true });
git('init', '-q', '-b', 'main');
writeFileSync(`${REPO}/.gitignore`, '.worktrees/\n');
writeFileSync(`${REPO}/calc.py`, 'def add(a, b):\n    return a + b\n');
git('add', '-A'); git('commit', '-q', '-m', 'init');
git('checkout', '-q', '-b', 'task/a');
writeFileSync(`${REPO}/calc.py`, 'def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n');
git('commit', '-q', '-am', 'mul');
git('checkout', '-q', '-b', 'task/b', 'main');
writeFileSync(`${REPO}/calc.py`, 'def add(a, b):\n    return a + b\n\n\ndef div(a, b):\n    return a / b\n');
git('commit', '-q', '-am', 'div');
// the goal branch already has task/a merged (what the manager did before it hit the conflict)
git('checkout', '-q', '-b', 'tandem/g1', 'main');
git('merge', '-q', '--no-ff', '--no-edit', 'task/a');
git('checkout', '-q', 'main');

const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.tasks, tables.events]); })
    .onConnectError((_c, e) => rej(e)).build();
});
await conn.reducers.postGoal({ sessionId: S, id: 'g1', text: 'Add mul and div' });
await conn.reducers.setGoalStatus({ sessionId: S, id: 'g1', status: 'planning' });
await conn.reducers.createTask({
  sessionId: S, kind: 'normal',
  task: { id: 't-fix', title: conflictTitle('task/b'), description: 'task/b conflicts with the goal branch in calc.py. Keep both functions; remove every conflict marker. Change nothing else.', files: ['calc.py'], difficulty: 'normal', model: '', effort: 'default', dependsOn: [] },
});
await conn.reducers.setGoalStatus({ sessionId: S, id: 'g1', status: 'planned' });

const result = await new Promise<{ code: number; out: string }>(done => {
  const child = spawn(process.execPath, ['--import', 'tsx', launcher, '--name', 'Fixer', '--repo', REPO, '--exit-when-idle', '--max-tasks', '1', '--poll', '1'], {
    env: { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: S, LAUNCHER_MODEL: 'haiku', LAUNCHER_BUDGET_USD: '0.50' },
  });
  let out = '';
  child.stdout.on('data', d => { out += d; process.stdout.write(d); });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => done({ code: code ?? 1, out }));
});
await new Promise(r => setTimeout(r, 500));

const t = [...conn.db.tasks.iter()].find(x => x.sessionId === S && x.id === 't-fix');
check('the launcher exits cleanly', result.code === 0, result.out.slice(-300));
check('the conflict task is done, on branch task/t-fix', t?.status === 'done' && t.branch === 'task/t-fix', t && `${t.status} ${t.branch} ${t.resultSummary}`);
let file = '';
try { file = git('show', 'task/t-fix:calc.py'); } catch { /* missing */ }
check('calc.py has both functions and no conflict markers', /def mul/.test(file) && /def div/.test(file) && !/^(<{7}|={7}|>{7})/m.test(file), file);
let ancestor = false;
try { git('merge-base', '--is-ancestor', 'task/b', 'task/t-fix'); ancestor = true; } catch { /* not merged */ }
check('the fix branch really merged task/b (so the goal can merge cleanly now)', ancestor);
let runs = '';
try {
  git('worktree', 'add', '-q', '--detach', `${REPO}/.worktrees/check`, 'task/t-fix'); // the launcher's worktree still has the branch
  runs = execFileSync('python', ['-I', '-c', 'import sys; sys.path.insert(0, "."); import calc; print(calc.mul(2, 3), calc.div(6, 3))'], { cwd: `${REPO}/.worktrees/check`, encoding: 'utf8', stdio: 'pipe' }).trim();
} catch (e) { runs = String(e); } finally { try { git('worktree', 'remove', '--force', `${REPO}/.worktrees/check`); } catch { /* gone */ } }
check('the merged calc.py runs: mul(2, 3) and div(6, 3)', runs === '6 2.0', runs);

conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
