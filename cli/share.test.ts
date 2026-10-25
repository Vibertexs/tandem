// The no-GitHub join path. The host serves a temporary project with git http-backend; a second
// Tandem state joins it, then pushes a task branch back. No goal is sent, so Claude never runs.
// Needs the local brain on 3001. All database data uses a fresh bilal-* name.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../brain/bindings/index.js';

const CLI = fileURLToPath(new URL('./tandem.ts', import.meta.url));
const TEAM = `bilal-share-${process.pid}`;
const hostState = mkdtempSync(join(tmpdir(), 'tandem-share-host-'));
const joinerState = mkdtempSync(join(tmpdir(), 'tandem-share-joiner-'));
// A teammate only has Tandem and an invite; they do not need to start in a project clone.
const joinerCwd = mkdtempSync(join(tmpdir(), 'tandem-share-join-cwd-'));
const repo = mkdtempSync(join(tmpdir(), 'tandem-share-repo-'));
let failures = 0;
let owner: DbConnection | null = null;

function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  share: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
function run(cmd: string, args: string[], cwd: string, state?: string) {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(state ? { TANDEM_STATE: state } : {}), NO_COLOR: '1' },
      }),
    };
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string };
    return { ok: false, out: `${x.stdout ?? ''}${x.stderr ?? ''}` };
  }
}
const git = (cwd: string, ...args: string[]) => run('git', args, cwd);
const tandem = (args: string[], cwd: string, state: string) => run(process.execPath, [CLI, ...args], cwd, state);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function context(key: string) {
  const r = await fetch(`http://127.0.0.1:3001/v1/database/${TEAM}/sql`, {
    method: 'POST', body: `SELECT value FROM context WHERE session_id = 'live' AND key = '${key}'`,
  });
  const rows = (await r.json() as { rows: unknown[][] }[])[0]?.rows ?? [];
  return String(rows[0]?.[0] ?? '').replace(/^"|"$/g, '');
}
async function waitForContext(key: string, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const value = await context(key); if (value) return value; } catch { /* manager is still connecting */ }
    await sleep(250);
  }
  return '';
}
async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(200);
  }
  return fn();
}

try {
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), '# Share test\n');
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'start');

  const started = tandem(['start', '--workers', '0', '--no-browser', '--team', TEAM, '--fresh'], repo, hostState);
  check('host starts and shares the project', started.ok && /project\s+shared from this computer/.test(started.out), started.out.slice(-800));

  owner = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(TEAM)
      .onConnect(c => {
        c.subscriptionBuilder().onApplied(() => resolve(c))
          .subscribe([tables.operatorRequests, tables.operators, tables.context]);
      })
      .onConnectError((_c, error) => reject(error)).build();
  });
  await owner.reducers.claimOperator({});
  const requested = await until(() => [...owner!.db.operatorRequests.iter()].length === 1);
  check('the host manager asks the owner for permission', requested);
  if (requested) await owner.reducers.approveOperator({ identity: [...owner.db.operatorRequests.iter()][0].identity });

  const gitUrl = await waitForContext('git_url');
  check('manager publishes the host Git address', /^http:\/\//.test(gitUrl), gitUrl);
  const listed = gitUrl ? git(repo, 'ls-remote', gitUrl, 'HEAD') : { ok: false, out: '' };
  check('the host Git address answers ls-remote', listed.ok && /HEAD/.test(listed.out), listed.out);

  const joined = gitUrl ? tandem(['join', `http://127.0.0.1:5173/?db=${TEAM}`, '--workers', '1', '--no-browser'], joinerCwd, joinerState) : { ok: false, out: '' };
  const clone = join(joinerState, 'work', TEAM);
  check('a teammate joins from a non-Git folder and copies the host project', !existsSync(join(joinerCwd, '.git')) && joined.ok && existsSync(join(clone, '.git')), joined.out.slice(-800));
  const origin = existsSync(join(clone, '.git')) ? git(clone, 'remote', 'get-url', 'origin') : { ok: false, out: '' };
  check('the work copy points at the host Git address', origin.ok && origin.out.trim() === gitUrl, origin.out);

  if (existsSync(join(clone, '.git'))) {
    writeFileSync(join(clone, 'proof.txt'), 'pushed through Tandem\n');
    git(clone, 'add', 'proof.txt');
    const committed = git(clone, '-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', 'share proof');
    const pushed = committed.ok && git(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/task/share-probe');
    const returned = pushed && git(repo, 'show-ref', '--verify', '--quiet', 'refs/heads/task/share-probe');
    check('a task branch pushed by the joiner appears in the host repo', Boolean(returned?.ok), pushed ? returned?.out : committed.out);
  } else check('a task branch pushed by the joiner appears in the host repo', false, 'work copy was not created');

  // starting again keeps the board and says so; --fresh wipes it. (Its own team, with no manager, so no Claude runs.)
  const KEPT = `${TEAM}-kept`;
  const base = ['start', '--workers', '0', '--no-manager', '--no-browser', '--team', KEPT];
  tandem([...base, '--fresh'], repo, hostState);
  const boardOwner = await new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(KEPT)
      .onConnect(c => { c.subscriptionBuilder().onApplied(() => resolve(c)).subscribe([tables.goals, tables.operators]); })
      .onConnectError((_c, error) => reject(error)).build();
  });
  await boardOwner.reducers.claimOperator({});
  await boardOwner.reducers.postGoal({ sessionId: 'live', id: 'g-keep', text: 'A goal that should survive a restart', effort: 'medium' });
  await sleep(500);
  const again = tandem(base, repo, hostState);
  check('starting again keeps the board and says how to start over', /kept the board from last time \(1 goal\)/.test(again.out) && /tandem start --fresh/.test(again.out), again.out.slice(-400));
  const wiped = tandem([...base, '--fresh'], repo, hostState);
  check('start --fresh wipes the board: nothing is "kept"', wiped.ok && /fresh/.test(wiped.out) && !/kept the board/.test(wiped.out), wiped.out.slice(-400));
  boardOwner.disconnect();
  await sleep(300);
  tandem(['stop', '--team', KEPT], repo, hostState);
} finally {
  owner?.disconnect();
  tandem(['stop', '--team', TEAM], repo, joinerState);
  tandem(['stop', '--team', TEAM], repo, hostState);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
