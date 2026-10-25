// The manager watcher when planning fails (a fake claude that is not logged in): after two
// tries the goal is failed with the reason; Try again (status new) makes it plan again.
// Publishes a FRESH database (bilal-watch). Needs the local brain on 3001 and `spacetime` on PATH.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-watch';
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  watch: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn: () => boolean, ms: number) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(200); } return fn(); };

execSync(`spacetime publish ${DB} --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes`, { stdio: 'pipe' });
const owner = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.goals, tables.operatorRequests, tables.operators, tables.context]); })
    .onConnectError((_c, e) => rej(e)).build();
});
await owner.reducers.claimOperator({});
await owner.reducers.postGoal({ sessionId: 'live', id: 'g1', text: 'Build the calculator', effort: 'medium' });

// the team's repo, with a GitHub remote (never contacted: nothing is pushed in this test)
const repo = mkdtempSync(join(tmpdir(), 'tandem-watch-repo-'));
execSync('git init -q -b main && git remote add origin https://github.com/acme/shop.git', { cwd: repo, stdio: 'pipe' });
// a project with one commit, and a finished goal's branch that adds cli.py
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
writeFileSync(join(repo, 'calc.py'), 'x = 1\n'); git('add', '-A'); git('commit', '-q', '-m', 'start');
git('checkout', '-q', '-b', 'tandem/x'); writeFileSync(join(repo, 'cli.py'), 'import calc\n'); git('add', '-A'); git('commit', '-q', '-m', 'Add the CLI'); git('checkout', '-q', 'main');
const here = fileURLToPath(new URL('..', import.meta.url));
const watcher = spawn(process.execPath, ['--import', 'tsx', join(here, 'watch.ts'), '--poll', '1', '--repo', repo], {
  cwd: here,
  env: { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: 'live', TANDEM_TOKEN_FILE: join(tmpdir(), `tandem-watch-${Date.now()}`), TANDEM_CLAUDE: join(here, 'test', 'fake-claude.mjs') },
});
let out = '';
watcher.stdout.on('data', d => { out += d; });
watcher.stderr.on('data', d => { out += d; });
try {
  check('the watcher asks to manage the team', await until(() => [...owner.db.operatorRequests.iter()].length === 1, 15_000));
  await owner.reducers.approveOperator({ identity: [...owner.db.operatorRequests.iter()][0].identity });
  check('it tells the page which repo a teammate should clone (its origin)', await until(() =>
    [...owner.db.context.iter()].some(c => c.sessionId === 'live' && c.key === 'repo_url' && c.value === 'https://github.com/acme/shop.git'), 10_000));
  check('it also tells the page where Tandem and the project are, for the Setup page\'s commands', await until(() => {
    const c = Object.fromEntries([...owner.db.context.iter()].filter(r => r.sessionId === 'live').map(r => [r.key, r.value]));
    return c.tandem_dir === fileURLToPath(new URL('../..', import.meta.url)).replace(/[\\/]$/, '') && c.project_dir === repo;
  }, 10_000));
  const goal = () => [...owner.db.goals.iter()].find(g => g.id === 'g1')!;
  check('after two failed planning runs the goal is failed, with the reason', await until(() => goal().status === 'failed', 30_000) &&
    goal().note.includes('Invalid API key') && goal().note.includes('Try again'), [goal().status, goal().note, out.slice(-400)]);
  const runs = (out.match(/planning 1 goal/g) ?? []).length;
  check('it tried exactly twice, then stopped spending quota on it', runs === 2 && await sleep(3000).then(() => (out.match(/planning 1 goal/g) ?? []).length === 2), runs);
  await owner.reducers.setGoalStatus({ sessionId: 'live', id: 'g1', status: 'new' });
  check('Try again: it plans the goal again', await until(() => (out.match(/planning 1 goal/g) ?? []).length === 3, 15_000), out.slice(-300));

  // "Merge into my project": the page sets apply_<goal> = requested; the manager merges and answers
  await owner.reducers.postGoal({ sessionId: 'live', id: 'g2', text: 'Add a CLI', effort: 'medium' });
  await owner.reducers.finishGoal({ sessionId: 'live', id: 'g2', branch: 'tandem/x', note: 'Tests pass.' });
  const answer = () => [...owner.db.context.iter()].find(c => c.sessionId === 'live' && c.key === 'apply_g2')?.value ?? '';
  check('before the request, the project folder does not have the goal\'s work', !existsSync(join(repo, 'cli.py')));
  await owner.reducers.setContext({ sessionId: 'live', key: 'apply_g2', value: 'requested' });
  check('Merge into my project: the manager merges the goal branch into the project and answers "done: Merged …"',
    await until(() => answer().startsWith('done:'), 20_000) && /Merged tandem\/x into main: 1 file \(cli\.py\)/.test(answer()) && existsSync(join(repo, 'cli.py')), [answer(), out.slice(-300)]);
  check('the project is left clean, on main', git('status', '--porcelain') === '' && git('branch', '--show-current') === 'main');
} finally {
  watcher.kill();
  owner.disconnect();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
