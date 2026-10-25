// The tandem command with accounts, simulated workers (no Claude or Codex calls), in its own state
// folder so your real accounts and running workers are not touched. Needs the local brain on 3001.
//   node cli/cli.test.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./tandem.ts', import.meta.url));
const TEAM = 'bilal-cli';
const state = mkdtempSync(join(tmpdir(), 'tandem-state-'));
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  cli: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const tandem = (args: string[], cwd: string, extraEnv: Record<string, string> = {}) => {
  try { return execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TANDEM_STATE: state, TANDEM_SIMULATE: '1', TANDEM_NO_BROWSER: '1', NO_COLOR: '1', ...extraEnv } }); }
  catch (e) { const x = e as { stdout?: string; stderr?: string }; return `${x.stdout ?? ''}${x.stderr ?? ''}`; }
};
const sql = async (q: string) => {
  const r = await fetch(`http://127.0.0.1:3001/v1/database/${TEAM}/sql`, { method: 'POST', body: q });
  return ((await r.json()) as { rows: unknown[][] }[])[0]?.rows ?? [];
};

const repo = mkdtempSync(join(tmpdir(), 'tandem-cli-repo-'));
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, stdio: 'pipe' });
git('init', '-q'); writeFileSync(join(repo, 'README.md'), '# x\n'); git('add', '-A'); git('commit', '-q', '-m', 'start');

const { tooOld, oldNodeMessage } = await import('./node-check.mjs');
check('Node versions: 18, 20, 22.6 and 22.17 are too old; 22.18, 22.20, 24 and 26 are fine',
  ['18.20.4', '20.11.0', '22.6.0', '22.17.9'].every(v => tooOld(v)) && ['22.18.0', '22.20.1', '24.11.0', '26.0.0'].every(v => !tooOld(v)));
check('an old Node gets a message that says which version it has and where to get a new one',
  /needs Node\.js 22\.18/.test(oldNodeMessage('20.11.0')) && oldNodeMessage('20.11.0').includes('20.11.0') && oldNodeMessage().includes('nodejs.org'));
check('outside a git repo, tandem start says what to do', /is not a git repository/.test(tandem(['start'], tmpdir())));
check('the retired --demo flag says there is no demo project', /There is no demo project/.test(tandem(['start', '--demo'], repo)));
check('no accounts yet: account list says how to add one', /No accounts yet/.test(tandem(['account', 'list'], repo)));
tandem(['account', 'add', 'work1', '--no-login'], repo);
tandem(['account', 'add', 'school', '--agent', 'codex', '--no-login'], repo);
const list = tandem(['account', 'list'], repo);
check('two accounts are listed, with their agent, not signed in yet', /work1\s+claude\s+not signed in/.test(list) && /school\s+codex\s+not signed in/.test(list), list);
const here = fileURLToPath(new URL('..', import.meta.url));
check('a join to a team that does not exist says so and how an invite looks (not "host is not sharing")',
  (() => { const o = tandem(['join', 'http://127.0.0.1:5173/?db=no-such-team-x'], here, { TANDEM_SIMULATE: '' }); return /There is no team "no-such-team-x" on 127\.0\.0\.1/.test(o) && /\?db=/.test(o) && !/not sharing/.test(o); })());
check('a mistyped invite (no "?", a stray ".") is read as the same team',
  /There is no team "no-such-team-x" on/.test(tandem(['join', 'http://127.0.0.1:5173/db=no-such-team-x.'], here, { TANDEM_SIMULATE: '' })));
{
  // tandem install / uninstall, against a file instead of the real PATH
  const pf = join(state, 'path.txt');
  const env = { TANDEM_TEST_PATH_FILE: pf };
  const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
  writeFileSync(pf, 'C:\\a;C:\\b');
  const one = tandem(['install'], repo, env);
  const after = readFileSync(pf, 'utf8');
  check('tandem install adds the Tandem folder to the PATH, keeps what was there, and says to open a new terminal', /Added/.test(one) && /new/.test(one) && after === `C:\\a;C:\\b;${root}`, [one, after]);
  const two = tandem(['install'], repo, env);
  check('installing again changes nothing and says so', /Already on your PATH/.test(two) && readFileSync(pf, 'utf8') === after, two);
  check('tandem uninstall removes only the Tandem folder', /Removed/.test(tandem(['uninstall'], repo, env)) && readFileSync(pf, 'utf8') === 'C:\\a;C:\\b');
  check('uninstalling when it is not there says there is nothing to remove', /nothing to remove/.test(tandem(['uninstall'], repo, env)));
}
{
  const d = tandem(['doctor'], repo);
  check('tandem doctor checks Node, Git, npm, Claude Code, SpacetimeDB, Tailscale and Python, and says if this computer can join and be the conductor',
    ['Node.js', 'Git', 'npm', 'Claude Code', 'SpacetimeDB', 'Tailscale', 'Python', 'Ready to join a team', 'Ready to be the conductor'].every(s => d.includes(s)), d);
  check('tandem --doctor is the same', tandem(['--doctor'], repo) === d);
  check('tandem doctor changes nothing: it says what to do for what is missing, and nothing is added to the PATH', !/Added/.test(d));
}
check('--simulate is not an option any more', /Unknown option '--simulate'/.test(tandem(['start', '--simulate'], repo)));
check('an unknown account is refused with how to add it', /No account "nope"/.test(tandem(['start', '--accounts', 'nope', '--local', '--no-manager', '--no-browser', '--team', TEAM], repo)));

const out = tandem(['start', '--accounts', 'all', '--local', '--no-manager', '--no-browser', '--team', TEAM, '--fresh'], repo);
const computer = hostname().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
check('start --accounts all: one worker per account, named after this computer and the account',
  out.includes(`${computer}-work1 (work1, claude), ${computer}-school (school, codex)`), out.slice(-500));
let rows: unknown[][] = [];
const describe = () => rows.map(r => r.join(' ')).sort().join(' | ');
// wait until both workers have registered AND said which agent and login they run
const expected = [`${computer}-school codex school`, `${computer}-work1 claude work1`].join(' | ');
for (let i = 0; i < 40 && describe() !== expected; i++) { await new Promise(r => setTimeout(r, 500)); rows = await sql("SELECT name, agent, account FROM workers WHERE session_id = 'live'"); }
const seen = describe();
check('the brain knows which agent and account each worker runs', seen === expected, seen);
check('a real join to a team whose host is not sharing a project says to restart the host',
  /not sharing the project/.test(tandem(['join', `http://127.0.0.1:5173/?db=${TEAM}`], here, { TANDEM_SIMULATE: '' })));
const status = tandem([], repo);
check('plain "tandem" shows the team and its workers, and opens the dashboard', status.includes(TEAM) && /2 workers/.test(status) && /http:\/\/localhost:5173\/\?db=/.test(status), status);
check('tandem -d (and dashboard, open, --dashboard) gives the dashboard address', ['-d', 'dashboard', 'open', '--dashboard'].every(c => /http:\/\/localhost:5173\/\?db=/.test(tandem([c], repo))));
const unknown = tandem(['--nope'], repo);
check('an unknown flag says it is not a command and points to --help, without dumping the whole help', /"--nope" is not a tandem command/.test(unknown) && /tandem --help/.test(unknown) && !/--workers N/.test(unknown), unknown);
check('an unknown word is the same', /"banana" is not a tandem command/.test(tandem(['banana'], repo)));
check('every command also works as a flag: --start, --join, --status',
  /is not a git repository/.test(tandem(['--start'], tmpdir())) && /Which team/.test(tandem(['--join'], repo)) && tandem(['--status'], repo).includes(TEAM));
const help = tandem(['--help'], repo);
check('tandem --help lists the commands, including -d', ['tandem start', 'tandem join', 'tandem -d', 'tandem stop', 'tandem status', 'tandem logs', 'tandem account'].every(c => help.includes(c)) && /Quick:/.test(help) && tandem(['-h'], repo) === help && tandem(['help'], repo) === help, help.slice(0, 200));
check('tandem --version prints the version', /^\d+\.\d+\.\d+\s*$/.test(tandem(['--version'], repo)));
const stopped = tandem(['stop'], repo);
check('tandem stop stops both', (stopped.match(/stopped worker/g) ?? []).length === 2, stopped);
check('tandem account remove takes an account out', /removed school/.test(tandem(['account', 'remove', 'school'], repo)) && !/school\s+codex/.test(tandem(['account', 'list'], repo)));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
