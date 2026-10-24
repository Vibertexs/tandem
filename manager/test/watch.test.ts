// The manager watcher when planning fails (a fake claude that is not logged in): after two
// tries the goal is failed with the reason; Try again (status new) makes it plan again.
// Publishes a FRESH database (bilal-watch). Needs the local brain on 3001 and `spacetime` on PATH.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
await owner.reducers.postGoal({ sessionId: 'live', id: 'g1', text: 'Build the calculator' });

// the team's repo, with a GitHub remote (never contacted: nothing is pushed in this test)
const repo = mkdtempSync(join(tmpdir(), 'tandem-watch-repo-'));
execSync('git init -q && git remote add origin https://github.com/acme/shop.git', { cwd: repo, stdio: 'pipe' });
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
} finally {
  watcher.kill();
  owner.disconnect();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
