// One REAL launcher run: 1 haiku claude -p call. A throwaway repo, one task; the launcher claims
// it, runs Claude in a git worktree on branch task/<id>, commits, and completes the task.
// Needs the local server on dev3001 with bilal-dev published. Run: npx tsx test/real.ts
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-dev';
const S = `lr-${Date.now().toString(36)}`;
const REPO = 'C:/Code/scratch/launcher-repo';
const launcher = fileURLToPath(new URL('../launcher.ts', import.meta.url));
const git = (...args: string[]) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  launcher: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

if (existsSync(REPO)) { execFileSync('git', ['-C', REPO, 'worktree', 'prune'], { stdio: 'pipe' }); rmSync(REPO, { recursive: true, force: true }); }
mkdirSync(REPO, { recursive: true });
git('init', '-q');
writeFileSync(`${REPO}/README.md`, '# launcher test repo\n');
writeFileSync(`${REPO}/.gitignore`, '.worktrees/\n');
git('add', '-A');
git('-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'init');

const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.tasks, tables.events]); })
    .onConnectError((_c, e) => rej(e)).build();
});
await conn.reducers.createTask({
  sessionId: S, kind: 'normal',
  task: { id: 't-hello', title: 'Write hello.py', description: 'Create hello.py that prints exactly: hello from tandem', files: ['hello.py'], difficulty: 'easy', model: '', effort: 'default', dependsOn: [] },
});

const result = await new Promise<{ code: number; out: string }>(done => {
  const child = spawn(process.execPath, ['--import', 'tsx', launcher, '--name', 'Real', '--repo', REPO, '--exit-when-idle', '--max-tasks', '1', '--poll', '1'], {
    env: { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: S, LAUNCHER_MODEL: 'haiku', LAUNCHER_BUDGET_USD: '0.50' },
  });
  let out = '';
  child.stdout.on('data', d => { out += d; process.stdout.write(d); });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => done({ code: code ?? 1, out }));
});
await new Promise(r => setTimeout(r, 500));

const t = [...conn.db.tasks.iter()].find(x => x.sessionId === S && x.id === 't-hello');
check('the launcher exits cleanly', result.code === 0, result.out.slice(-300));
check('the task is done, on branch task/t-hello', t?.status === 'done' && t.branch === 'task/t-hello', t && `${t.status} ${t.branch}`);
let file = '';
try { file = git('show', 'task/t-hello:hello.py'); } catch { /* missing */ }
check('the branch has a commit with hello.py', /hello from tandem/.test(file), file);
check('main is untouched (the work stayed on the task branch)', !git('ls-tree', '--name-only', 'HEAD').split('\n').includes('hello.py'));
check('the real cost of the run is recorded on the task', (t?.costUsd ?? 0) > 0, t?.costUsd);
check('progress shows the model it ran with', [...conn.db.events.iter()].some(e => e.sessionId === S && e.type === 'progress' && /haiku/.test(e.message)));

conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
