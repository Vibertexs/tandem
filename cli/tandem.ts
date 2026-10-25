#!/usr/bin/env node
// tandem: run Tandem from the project you want built. Node 22.18+ runs this TypeScript file as is.
//
//   tandem init <folder>      make a new project, then host a team for it
//   tandem start              in your project's folder: host a team for it, print the invite address
//   tandem join <address>     copy the conductor's project and add this computer's workers to the team
//   tandem stop [--all]       stop what this computer started (--all also stops the brain)
//   tandem status | open | logs
//
// Run `tandem help` for the options. Every person's Claude Code runs under their own login.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { freePort, gitUrl } from './gitshare.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.env.TANDEM_STATE ?? join(ROOT, '.tandem'); // (tests use their own)
const LOGS = join(STATE, 'logs');
const PIDS = join(STATE, 'pids.json');
const WIN = process.platform === 'win32';
const BRAIN_PORT = 3001;
const PAGE_PORT = 5173;
// Workers that fake the coding exist ONLY for Tandem's own automated tests. There is no option for
// it: it takes this environment variable, which nothing in the product or the docs sets.
const SIMULATE = process.env.TANDEM_SIMULATE === '1';
const SIM_LIMIT = Number(process.env.TANDEM_SIM_LIMIT ?? 0);

const HELP = `tandem: your team's Claude Codes, working as one.

  Quick: "tandem init <new-folder>" starts a new project; "tandem --start" starts an existing one.
  Every command works as a word or a flag: tandem start = tandem --start, tandem stop = tandem --stop.

  tandem init <folder>        Make a brand-new Git project in <folder>, give it its first commit,
                              then start Tandem there. It refuses to touch an existing folder.
  tandem start              Start a team for the git repo you are in. You are its conductor: you send
                            the goals, and your computer plans them and merges the work. Prints the invite.
    --workers N             workers on this computer (default 1, one Claude per person; 0 = none)
    --local                 only this computer can join (default: your network can)
    --team NAME             the team's name (default: this folder's name)
    --fresh                 start the team over: wipes its board (goals, tasks, shared memory, activity).
                            Your project and its branches are not touched. Joined teammates run join again.
    --push                  push task and goal branches to origin (a PR per goal with the GitHub CLI)
    --review                a worker reviews each goal before it is done
    --model NAME            force one model for every task. Default: each goal's effort (picked on the
                            page: low, medium, high) and each task's difficulty choose it
    --conductor-model NAME  force the model the conductor plans with (default: by the goal's effort,
                            low haiku, medium sonnet, high opus)
    --notify URL            post "goal done" to a Slack or Discord webhook
    --accounts all|a,b      one worker per saved account (see tandem account), instead of --workers
    --conductor-account A   the Claude account the conductor plans with
    --no-browser            do not open the page

  tandem join <address>     Join as a teammate: copy the conductor's project and add this computer's workers.
                            <address> is the invite the conductor's page shows, like http://192.168.1.20:5173/?db=shop
    --workers N, --accounts as above; --repo <path> uses your own clone instead

  tandem account add <label> [--agent codex]   A login for workers (opens that CLI to sign in).
  tandem account list | remove <label>          Each account gets its own login folder in the
                                                Tandem folder; your own login is not touched.

  tandem stop               Stop what this computer started (the brain keeps running).
    --all                   also stop the brain

  tandem install            Put tandem on your PATH, so it works in any new terminal (once).
  tandem uninstall          Take it off again.
  tandem doctor             Check this computer has what Tandem needs (Node, Git, Claude Code,
                            SpacetimeDB, Tailscale) and say what to install. Changes nothing.

  tandem                    On its own: opens the dashboard. It shows what is running, or how to get started.
  tandem -d                 Open the dashboard (also: tandem dashboard, tandem open, tandem --dashboard).
  tandem status             What is running, with each team's links.
  tandem logs [part]        The latest log lines: all, or one part (conductor, a worker's name, brain, page).
  tandem --version          Which version this is.
  tandem --help             This list (also: tandem help, tandem -h).
`;

// ---------- small helpers ----------
const say = (m = '') => console.log(m);
// a little colour when it goes to a terminal, plain text when it goes to a file or a pipe
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1'), dim = paint('2'), cyan = paint('36'), green = paint('32');
const done = (what: string, detail: string) => say(`  ${green('✓')} ${what.padEnd(8)} ${dim(detail)}`);
const fail = (m: string): never => { console.error(`\n${m}`); process.exit(1); };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';

// The SpacetimeDB installer puts its CLI here on Windows, not always on PATH.
if (WIN && process.env.LOCALAPPDATA && existsSync(join(process.env.LOCALAPPDATA, 'SpacetimeDB'))) {
  process.env.PATH = `${process.env.PATH}${delimiter}${join(process.env.LOCALAPPDATA, 'SpacetimeDB')}`;
}

// The full path of a program on PATH, or null.
function which(cmd: string): string | null {
  const exts = WIN ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext.toLowerCase());
      if (dir && existsSync(p)) return p;
    }
  }
  return null;
}

// Runs a program and waits. Windows .cmd shims (npm) need a shell; everything else runs directly.
function run(cmd: string, args: string[], cwd = ROOT) {
  const shell = WIN && /\.(cmd|bat)$/i.test(cmd);
  const quoted = shell ? args.map(a => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
  // through a shell, the whole command is one string (Node warns about passing arguments with a shell)
  const r = shell
    ? spawnSync([`"${cmd}"`, ...quoted].join(' '), { cwd, encoding: 'utf8', shell: true, windowsHide: true })
    : spawnSync(cmd, quoted, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}
const git = (cwd: string, ...args: string[]) => run('git', args, cwd);

// Is something listening at host:port? (fast, never throws)
function reachable(host: string, port: number, ms = 1500): Promise<boolean> {
  return new Promise(done => {
    const s = connect({ host, port });
    const end = (ok: boolean) => { s.destroy(); done(ok); };
    s.setTimeout(ms, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}
async function waitFor(host: string, port: number, seconds: number) {
  for (let i = 0; i < seconds * 2; i++) { if (await reachable(host, port, 400)) return true; await sleep(500); }
  return false;
}

// This computer's Tailscale address (100.x.y.z), or null if Tailscale is not installed or not
// connected. It works from any wifi, and only people you shared it with can reach it, so it is the
// better invite on public wifi (which often stops devices talking to each other).
function tailscaleAddress(): string | null {
  const exe = which('tailscale')
    ?? [process.env.ProgramFiles && join(process.env.ProgramFiles, 'Tailscale', 'tailscale.exe'), '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
      .find(p => p && existsSync(p)) ?? null;
  if (!exe) return null;
  const r = run(exe, ['ip', '-4']);
  const ip = r.out.split('\n').map(l => l.trim()).find(l => /^100\.\d+\.\d+\.\d+$/.test(l));
  return r.ok && ip ? ip : null;
}

// This computer's address on the network others would use: the one the default route goes out
// of (a UDP "connect" sends nothing). Falls back to the first ordinary network card.
function lanAddress(): Promise<string | null> {
  return new Promise(done => {
    const s = createSocket('udp4');
    const fallback = () => {
      const all = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).map(a => ({ name, ...a })));
      const ok = all.find(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.') && !/virtual|vmware|vbox|vethernet|wsl|docker|hyper-v/i.test(a.name));
      done(ok?.address ?? null);
    };
    s.once('error', () => { s.close(); fallback(); });
    s.connect(53, '8.8.8.8', () => {
      const a = s.address().address;
      s.close();
      if (a && a !== '0.0.0.0' && !a.startsWith('127.')) done(a); else fallback();
    });
  });
}

// ---------- what this computer started ----------
type Proc = { name: string; team: string; pid: number };
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function loadProcs(): Proc[] {
  try { return (JSON.parse(readFileSync(PIDS, 'utf8')) as Proc[]).filter(p => alive(p.pid)); } catch { return []; }
}
function saveProcs(list: Proc[]) { mkdirSync(STATE, { recursive: true }); writeFileSync(PIDS, JSON.stringify(list, null, 2)); }
const running = (name: string, team: string) => loadProcs().some(p => p.name === name && p.team === team);

// Starts a background process that logs to .tandem/logs and does not hold this terminal: its own
// process group, no console window, output to files (not pipes, which would keep a caller waiting).
// On Windows a detached process has no console, so EVERY program it starts (git, claude, node) must
// itself be started with windowsHide: true, or each one opens its own visible window.
function background(name: string, team: string, cmd: string, args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  mkdirSync(LOGS, { recursive: true });
  const base = join(LOGS, `${team ? `${team}-` : ''}${name.replace(/\s+/g, '-')}`);
  const child = spawn(cmd, args, {
    // task folders go in Tandem's own state, not in your project
    cwd, env: { ...process.env, TANDEM_WORKTREES: join(STATE, 'worktrees'), ...env }, detached: true, windowsHide: true,
    stdio: ['ignore', openSync(`${base}.log`, 'a'), openSync(`${base}.err`, 'a')],
  });
  child.unref();
  saveProcs([...loadProcs(), { name, team, pid: child.pid! }]);
}
function kill(pid: number) {
  if (WIN) run('taskkill', ['/PID', String(pid), '/T', '/F']);
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } } }
}

const tsx = (pkg: string) => pathToFileURL(join(ROOT, pkg, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;

function installPackages(dirs: string[]) {
  const npm = which('npm') ?? fail('npm is not installed. Install Node.js 22.18 or newer from https://nodejs.org');
  for (const d of dirs) {
    if (existsSync(join(ROOT, d, 'node_modules'))) continue;
    say(dim(`  installing packages in ${d} (first run only)…`));
    const r = run(npm, ['install', '--silent', '--no-fund', '--no-audit'], join(ROOT, d));
    if (!r.ok) fail(`npm install failed in ${d}:\n${r.out}`);
  }
}

function openBrowser(url: string) {
  if (process.env.TANDEM_NO_BROWSER === '1') return; // (the automated tests never open a window)
  if (WIN) spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// The git repo the command runs in (its top folder), or null.
function repoAt(dir: string): string | null {
  const r = git(dir, 'rev-parse', '--show-toplevel');
  return r.ok ? resolve(r.out) : null;
}

// ---------- accounts: one login folder per agent account, kept in the Tandem folder ----------
// Claude Code keeps its login in CLAUDE_CONFIG_DIR, Codex in CODEX_HOME. Pointing a worker at its
// own folder makes it use that account; nothing in your home folder changes.
type Agent = 'claude' | 'codex';
type Account = { label: string; agent: Agent; dir: string };
const ACCOUNTS = join(STATE, 'accounts.json');
function accounts(): Account[] { try { return JSON.parse(readFileSync(ACCOUNTS, 'utf8')); } catch { return []; } }
function saveAccounts(list: Account[]) { mkdirSync(STATE, { recursive: true }); writeFileSync(ACCOUNTS, JSON.stringify(list, null, 2)); }
const loginEnv = (a: Account) => (a.agent === 'codex' ? { CODEX_HOME: a.dir } : { CLAUDE_CONFIG_DIR: a.dir });
const loggedIn = (a: Account) => existsSync(join(a.dir, a.agent === 'codex' ? 'auth.json' : '.credentials.json'));

// "work1,school" or "all" -> the saved accounts, in that order
function pickAccounts(spec: string | undefined): Account[] {
  if (!spec) return [];
  const all = accounts();
  if (spec === 'all') { if (!all.length) fail('No accounts yet. Add one: tandem account add <label>'); return all; }
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(l =>
    all.find(a => a.label === l) ?? fail(`No account "${l}". Add it: tandem account add ${l}   (tandem account list shows them)`));
}

// Runs a CLI in this terminal (its login screen), with the account's folder.
function interactive(cmd: string, args: string[], env: Record<string, string>) {
  const exe = which(cmd) ?? fail(cmd === 'codex' ? 'The Codex CLI (codex) is not installed. See https://github.com/openai/codex' : 'Claude Code (claude) is not installed or not on PATH.');
  const shell = /\.(cmd|bat)$/i.test(exe);
  spawnSync(shell ? `"${exe}"` : exe, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell });
}

async function accountCmd(argv: string[]) {
  const [sub, ...more] = argv;
  const { values: o, positionals } = parseArgs({ args: more, allowPositionals: true, options: {
    agent: { type: 'string', default: 'claude' }, 'no-login': { type: 'boolean', default: false },
  } });
  const label = positionals[0]?.trim();
  if (sub === 'add') {
    if (!label) fail('Name it: tandem account add <label>   (for example: tandem account add work1, or tandem account add school --agent codex)');
    if (o.agent !== 'claude' && o.agent !== 'codex') fail('--agent is claude or codex');
    const agent = o.agent as Agent;
    const acct: Account = { label: label!, agent, dir: join(STATE, 'accounts', slug(label!)) };
    mkdirSync(acct.dir, { recursive: true });
    saveAccounts([...accounts().filter(a => a.label !== label), acct]);
    say(`  ${green('✓')} account ${bold(label!)} ${dim(`(${agent}, ${acct.dir})`)}`);
    if (o['no-login']) return;
    if (agent === 'codex') {
      say(dim(`  Sign in with the account you want as "${label}".`));
      interactive('codex', ['login'], loginEnv(acct));
    } else {
      say(dim(`  Claude Code opens. Type /login, sign in with the account you want as "${label}", then /exit.`));
      interactive('claude', [], loginEnv(acct));
    }
    say(loggedIn(acct) ? `  ${green('✓')} signed in` : dim(`  Not signed in yet? Run tandem account add ${label}${agent === 'codex' ? ' --agent codex' : ''} again.`));
  } else if (sub === 'list' || !sub) {
    const all = accounts();
    if (!all.length) { say(dim('  No accounts yet. Workers use your default Claude Code login. Add one: tandem account add <label>')); return; }
    for (const a of all) say(`  ${loggedIn(a) ? green('●') : dim('○')} ${bold(a.label.padEnd(12))} ${a.agent.padEnd(7)} ${loggedIn(a) ? 'signed in' : dim('not signed in')}`);
    say(dim('\n  Use them: tandem start --accounts all   (or --accounts work1,school)'));
  } else if (sub === 'remove') {
    const a = accounts().find(x => x.label === label) ?? fail(`No account "${label}".`);
    saveAccounts(accounts().filter(x => x.label !== label));
    rmSync(a.dir, { recursive: true, force: true });
    say(`  ${green('✓')} removed ${label} and its login folder`);
  } else fail('tandem account add <label> [--agent codex] | tandem account list | tandem account remove <label>');
}

const modelNote = (model: string) => model === 'auto' ? 'models by each goal\'s effort' : `${model} for every task`;
type WorkerOpts = { simulate: boolean; push: boolean; model: string; budget: string; simLimit?: number; accounts?: Account[] };
// Starts the workers that are not running yet: `count` on the default login, or one per account.
// Workers are named after the computer they run on ("bilal-pc", "bilal-pc-2"), or after the computer
// and login when each account gets one ("bilal-pc-work1"). Returns how each is described.
function startWorkers(team: string, uri: string, repo: string, count: number, opts: WorkerOpts): string[] {
  const names: string[] = [];
  const accts = opts.accounts?.length ? opts.accounts : null;
  for (let i = 0; i < (accts ? accts.length : count); i++) {
    const acct = accts?.[i];
    const computer = slug(hostname());
    const name = acct ? `${computer}-${slug(acct.label)}` : i === 0 ? computer : `${computer}-${i + 1}`;
    names.push(acct ? `${name} (${acct.label}, ${acct.agent})` : name);
    if (running(`worker ${name}`, team)) continue;
    const args = ['--import', tsx('launcher'), join(ROOT, 'launcher', 'launcher.ts'), '--name', name, '--repo', repo];
    if (acct) args.push('--agent', acct.agent, '--account', acct.label);
    if (opts.simulate) args.push('--simulate', '--sim-ms', '3000');
    // for demos: the first worker hits a usage limit on its first task, then comes back
    if (opts.simulate && opts.simLimit && i === 0) args.push('--sim-limit', String(opts.simLimit));
    if (opts.push) args.push('--push');
    background(`worker ${name}`, team, process.execPath, args, ROOT, {
      STDB_URI: uri, STDB_DB: team, TANDEM_SESSION: 'live',
      TANDEM_TOKEN_FILE: join(ROOT, 'mcp', '.tandem', `worker-${name}-${team}`),
      LAUNCHER_MODEL: opts.model === 'auto' ? undefined : opts.model, LAUNCHER_BUDGET_USD: opts.budget,
      ...(acct ? loginEnv(acct) : {}),
    });
  }
  return names;
}

// Starts the dashboard page if it is not running. Returns true if it had to start it.
async function ensurePage(): Promise<boolean> {
  if (await reachable('127.0.0.1', PAGE_PORT)) return false;
  installPackages(['dashboard']);
  background('page', '', process.execPath, [join(ROOT, 'dashboard', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PAGE_PORT), '--strictPort'], join(ROOT, 'dashboard'));
  if (!(await waitFor('127.0.0.1', PAGE_PORT, 20))) fail(`The page did not start. See ${join(LOGS, 'page.err')}`);
  return true;
}

// ---------- tandem init ----------
// The friendly first-project command. It is deliberately strict: never put a Git repo or files
// into a folder the person already has, because they may have meant to use `tandem --start` there.
async function initProject(argv: string[]) {
  const folder = argv[0];
  if (!folder || folder.startsWith('-')) fail('Choose a new folder: tandem init <new-folder>\nFor a Git project you already have, open its folder and run: tandem --start');
  const project = resolve(process.cwd(), folder);
  if (existsSync(project)) fail(`${project} already exists. Tandem init only creates a brand-new project.\nFor an existing Git project, open its folder and run: tandem --start`);

  mkdirSync(project, { recursive: true });
  const made = git(project, 'init');
  if (!made.ok) fail(`Could not create a Git project in ${project}:\n${made.out}`);
  const committed = git(project, '-c', 'user.name=Tandem', '-c', 'user.email=tandem@localhost', 'commit', '--allow-empty', '-m', 'Start');
  if (!committed.ok) fail(`Tandem made ${project}, but could not make its first Git commit:\n${committed.out}`);

  say(`\n  ${green('✓')} Created a new Git project: ${project}`);
  say(dim('  Starting Tandem there…'));
  process.chdir(project);
  await start(argv.slice(1));
}

// ---------- tandem start ----------
async function start(argv: string[]) {
  if (argv.some(arg => arg === '--demo' || arg.startsWith('--demo='))) {
    fail('There is no demo project. Run tandem start in a Git project you want built.');
  }
  const { values: o } = parseArgs({ args: argv, options: {
    workers: { type: 'string', default: '1' },
    local: { type: 'boolean', default: false }, team: { type: 'string' }, fresh: { type: 'boolean', default: false },
    push: { type: 'boolean', default: false }, review: { type: 'boolean', default: false },
    model: { type: 'string', default: 'auto' }, 'conductor-model': { type: 'string', default: 'auto' },
    budget: { type: 'string', default: '0.50' }, notify: { type: 'string' },
    'no-browser': { type: 'boolean', default: false }, 'no-conductor': { type: 'boolean', default: false },
    accounts: { type: 'string' }, 'conductor-account': { type: 'string' },
    // the names from before "manager" became "conductor" still work
    'manager-model': { type: 'string' }, 'no-manager': { type: 'boolean', default: false }, 'manager-account': { type: 'string' },
  } });
  const accts = pickAccounts(o.accounts);
  const workers = accts.length || Number(o.workers);
  const conductorModel = o['manager-model'] ?? o['conductor-model']!;
  const noConductor = o['no-conductor'] || o['no-manager'];
  const condAccountLabel = o['conductor-account'] ?? o['manager-account'];
  const mgrAcct = condAccountLabel ? pickAccounts(condAccountLabel)[0] : undefined;
  if (mgrAcct && mgrAcct.agent !== 'claude') fail('The conductor plans with Claude Code: --conductor-account must be a Claude account.');

  // The project is the Git repo where the command runs.
  const repo = repoAt(process.cwd());
  if (!repo) fail(`${process.cwd()} is not a git repository.\nRun tandem start in the project you want built.`);
  if (resolve(repo) === ROOT) fail('This is the Tandem source folder, not the project it should work on. Run tandem start in your project instead.');
  if (!git(repo, 'rev-parse', '--verify', '--quiet', 'HEAD').ok) fail(`${repo} has no commits yet. Make a first commit, then run tandem start again.`);
  const team = slug(o.team ?? basename(repo));

  // which agent CLIs the real (not simulated) workers and the conductor need
  const realAgents = SIMULATE ? [] : accts.length ? accts.map(a => a.agent) : workers > 0 ? ['claude'] : [];
  const needClaude = realAgents.includes('claude') || !noConductor;
  for (const t of ['git', 'spacetime', ...(needClaude ? ['claude'] : []), ...(realAgents.includes('codex') ? ['codex'] : [])]) {
    if (!which(t)) fail((t === 'spacetime' ? 'The SpacetimeDB CLI is not installed. See https://spacetimedb.com/install'
      : t === 'claude' ? 'Claude Code (claude) is not installed or not on PATH. Install it from https://claude.com/claude-code and sign in.'
      : t === 'codex' ? 'The Codex CLI (codex) is not installed. See https://github.com/openai/codex' : `${t} is not installed.`)
      + '\nRun "tandem doctor" to see everything this computer needs.');
  }
  say();
  say(`  ${bold('Tandem')} ${dim(`· team "${team}" · ${repo}`)}`);
  say();
  installPackages(['brain/spacetimedb', 'brain', 'mcp', 'dashboard', 'launcher', 'manager']);

  const spacetime = which('spacetime')!;
  if (!(await reachable('127.0.0.1', BRAIN_PORT))) {
    background('brain', '', spacetime, ['start', '--listen-addr', `${o.local ? '127.0.0.1' : '0.0.0.0'}:${BRAIN_PORT}`], ROOT);
    if (!(await waitFor('127.0.0.1', BRAIN_PORT, 20))) fail(`The brain did not start. See ${join(LOGS, 'brain.err')}`);
    done('brain', `started${o.local ? ' (this computer only)' : ''}`);
  } else done('brain', 'running');
  // published by address, so nothing is added to your SpacetimeDB CLI's server list
  const pub = run(spacetime, ['publish', team, '--server', `http://127.0.0.1:${BRAIN_PORT}`, '--no-config', '--module-path', join(ROOT, 'brain', 'spacetimedb'), '--yes', ...(o.fresh ? ['--delete-data=always'] : [])]);
  if (!pub.ok) fail(`${pub.out}\nCould not set up the team "${team}". If Tandem was updated and this team is old, tandem start --fresh starts it over (this wipes its board).`);
  done('team', o.fresh ? `"${team}", fresh` : `"${team}"`);
  if (!o.fresh) {
    const goals = await countRows('127.0.0.1', team, 'goals');
    if (goals > 0) say(dim(`            kept the board from last time (${goals} goal${goals === 1 ? '' : 's'}). To start over: tandem start --fresh`));
  }

  done('page', (await ensurePage()) ? 'started' : 'running');

  // the invite: only if the brain is really open to the network
  // (a VPN address such as Tailscale's is preferred; the venue wifi's address is shown as the other way)
  const vpn = o.local ? null : tailscaleAddress();
  const wifi = o.local ? null : await lanAddress();
  const ip = vpn ?? wifi;
  const shared = !!ip && await reachable(ip, BRAIN_PORT);
  const uri = `ws://127.0.0.1:${BRAIN_PORT}`;

  // The project, served from this computer, so a teammate's computer can clone it and push its
  // task branches back with no GitHub (cli/gitshare.ts). Only when others can reach this computer.
  let shareUrl: string | null = null;
  let sharePort = teams()[team]?.gitPort;
  if (shared && ip) {
    if (!(running('git share', team) && sharePort)) sharePort = await freePort(9418, ip);
    if (!running('git share', team)) background('git share', team, process.execPath, [join(ROOT, 'cli', 'gitserver.ts'), repo, ip, String(sharePort)], ROOT);
    if (await waitFor(ip, sharePort!, 10)) { shareUrl = gitUrl(ip, sharePort!, repo); done('project', `shared from this computer: no GitHub needed`); }
    else say(dim(`  ! could not share the project (see ${join(LOGS, `${team}-git-share.err`)}). Teammates can watch but not add workers.`));
  }

  // The conductor's key: only the conductor's own page link carries it, and with it that page can
  // always take control back. Kept per team, so old links keep working.
  const hostKey = teams()[team]?.hostKey ?? randomBytes(16).toString('hex');
  if (!noConductor) {
    // (a conductor started by an older Tandem is still called "manager")
    if (running('conductor', team) || running('manager', team)) done('conductor', 'running');
    else {
      const args = ['--import', tsx('manager'), join(ROOT, 'manager', 'watch.ts'), '--repo', repo, '--model', conductorModel, '--budget', o.budget!];
      if (shareUrl) args.push('--git-url', shareUrl);
      if (o.push) args.push('--push');
      if (o.review) args.push('--review');
      if (o.notify) args.push('--notify', o.notify);
      // (its saved login keeps its old file name, so a conductor approved before stays approved)
      background('conductor', team, process.execPath, args, ROOT, {
        STDB_URI: uri, STDB_DB: team, TANDEM_SESSION: 'live', TANDEM_TOKEN_FILE: join(ROOT, 'mcp', '.tandem', `manager-token-${team}`),
        TANDEM_HOST_KEY: hostKey,
        ...(mgrAcct ? loginEnv(mgrAcct) : {}),
      });
      done('conductor', `started: it plans every goal you send${conductorModel === 'auto' ? ', with the models its effort picks' : ` (${conductorModel})`}${mgrAcct ? ` (${mgrAcct.label})` : ''}`);
    }
  }
  if (workers > 0) {
    const names = startWorkers(team, uri, repo, workers, { simulate: SIMULATE, push: o.push, model: o.model!, budget: o.budget!, simLimit: SIM_LIMIT, accounts: accts });
    done('workers', `${names.join(', ')}${SIMULATE ? ' (test mode: fake coding)' : accts.length ? '' : ` (Claude, ${modelNote(o.model!)})`}`);
  }

  // host=1 and the key make this the conductor's page; the invite link never carries them
  const page = `http://localhost:${PAGE_PORT}/?db=${team}${shared ? `&lan=${ip}` : ''}&host=1&key=${hostKey}`;
  const invite = shared ? `http://${ip}:${PAGE_PORT}/?db=${team}` : null;
  remember(team, { page, repo, invite, gitPort: sharePort, hostKey });
  say();
  say(`  Tandem is running for ${repo}`);
  say();
  say(`  ${bold('Open')}     ${cyan(page)}`);
  if (invite) {
    say(`  ${bold('Invite')}   ${cyan(invite)}${vpn ? dim('  (your Tailscale address)') : ''}`);
    say(dim('           Others open it in a browser to watch. The Invite menu gives them one copyable block to add workers.'));
    if (vpn && wifi && wifi !== vpn) say(dim(`           Same wifi and no isolation? http://${wifi}:${PAGE_PORT}/?db=${team} works too.`));
    if (vpn) say(dim('           Tailscale: share this computer with them first (Tailscale admin, Machines, ... , Share).'));
    else if (wifi) say(dim('           On public wifi, devices often cannot reach each other. If they cannot, use Tailscale and run tandem start again.'));
  } else if (!o.local) {
    say(`  ${bold('Invite')}   ${dim('only this computer can join: the brain was started for this computer only.')}`);
    say(dim('           To invite others: tandem stop --all, then tandem start'));
  } else say(`  ${bold('Invite')}   ${dim('only this computer can join (--local)')}`);
  say(`  ${bold('Stop')}     tandem stop`);
  say();
  say(dim('  You are the conductor: you run the team from that page. Open it any time with: tandem'));
  if (!which('tandem')) say(dim(`  Tip: run ${ownCommand()} install once, then "tandem" works in any new terminal.`));
  if (invite && WIN) say(dim('  If Windows asks whether node and spacetime may use the network, allow private networks.'));
  if (!o['no-browser']) openBrowser(page);
}

// ---------- tandem join ----------
// Accepts the invite (http://host:5173/?db=team), or host[:port]/team, or ws://host:3001 with --team.
function parseAddress(address: string, team?: string): { host: string; team: string } {
  const a = address.trim();
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(a) ? a : `http://${a}`);
    // also accepts a link typed without the "?" (…:5173/db=shop), and ignores a stray "." or quote
    const t = team ?? u.searchParams.get('db') ?? /(?:^|\/)db=([^&/#]+)/.exec(u.pathname)?.[1] ?? u.pathname.replace(/^\/+|\/+$/g, '');
    if (u.hostname && t) return { host: u.hostname, team: slug(t) };
  } catch { /* not a URL */ }
  return fail(`Could not read the address "${address}". Use the invite the conductor's page shows, like http://192.168.1.20:5173/?db=shop`);
}

// Does the host's brain have a team with this name? false only when it says there is none;
// null when it could not tell (the join then carries on and fails with a more specific message).
async function teamExists(host: string, team: string): Promise<boolean | null> {
  try {
    const r = await fetch(`http://${host}:${BRAIN_PORT}/v1/database/${team}/sql`, { method: 'POST', body: 'SELECT key FROM context', signal: AbortSignal.timeout(3000) });
    return r.ok ? true : r.status === 404 ? false : null;
  } catch { return null; }
}

// How many rows a table of the team's board has (0 if it cannot tell).
async function countRows(host: string, team: string, table: string): Promise<number> {
  try {
    const r = await fetch(`http://${host}:${BRAIN_PORT}/v1/database/${team}/sql`, { method: 'POST', body: `SELECT * FROM ${table}`, signal: AbortSignal.timeout(3000) });
    return ((await r.json()) as { rows: unknown[][] }[])[0]?.rows.length ?? 0;
  } catch { return 0; }
}

// One value the host published about the team (git_url, repo_url, ...). Read-only SQL over HTTP.
async function teamContext(host: string, team: string, key: string): Promise<string> {
  try {
    const r = await fetch(`http://${host}:${BRAIN_PORT}/v1/database/${team}/sql`, {
      method: 'POST', body: `SELECT value FROM context WHERE session_id = 'live' AND key = '${key}'`, signal: AbortSignal.timeout(3000),
    });
    const rows = (await r.json() as { rows: unknown[][] }[])[0]?.rows ?? [];
    return String(rows[0]?.[0] ?? '').replace(/^"|"$/g, '');
  } catch { return ''; }
}

// This computer's copy of the host's project: cloned once from the host (no GitHub), then brought
// up to date each time. Lives inside the Tandem folder's .tandem, so nothing else is touched.
function workClone(url: string, team: string): string {
  const dir = join(STATE, 'work', team);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true });
    const r = git(ROOT, 'clone', '-q', url, dir);
    if (!r.ok) fail(`Could not get the project from the conductor's computer (${url}):\n${r.out}\nCheck the conductor is still running Tandem, and that you can reach it.`);
  } else {
    git(dir, 'remote', 'set-url', 'origin', url); // the host's address may have changed
    git(dir, 'fetch', '-q', 'origin');
    git(dir, 'merge', '--ff-only', '-q', 'origin/HEAD'); // best effort: stays as it is if it cannot move forward
  }
  return dir;
}

async function joinTeam(argv: string[]) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    workers: { type: 'string', default: '1' },
    team: { type: 'string' }, model: { type: 'string', default: 'auto' }, budget: { type: 'string', default: '0.50' },
    'no-browser': { type: 'boolean', default: false }, accounts: { type: 'string' },
    repo: { type: 'string' }, // use your own clone of the project instead of the one Tandem makes
  } });
  const accts = pickAccounts(o.accounts);
  if (!positionals[0]) fail('Which team? tandem join <invite>, using the link the conductor\'s page shows (Invite, top right).');
  const { host, team } = parseAddress(positionals[0], o.team);
  say();
  say(`  ${bold('Tandem')} ${dim(`· joining team "${team}" at ${host}`)}`);
  say();
  if (!(await reachable(host, BRAIN_PORT, 2500))) {
    fail(`Cannot reach ${host}:${BRAIN_PORT}. Check the invite on the conductor's page, that both computers are on the same network, and that the conductor did not use --local.`);
  }
  done('host', 'reachable');
  if ((await teamExists(host, team)) === false) {
    fail(`There is no team "${team}" on ${host}. Check the invite link. It looks like http://${host}:${PAGE_PORT}/?db=your-team (note the "?db=").`);
  }

  const workers = accts.length || Number(o.workers);
  let repo: string | null = null;
  if (!SIMULATE && workers > 0) {
    for (const agent of new Set(accts.length ? accts.map(a => a.agent) : ['claude'])) {
      if (!which(agent)) fail(agent === 'codex' ? 'The Codex CLI (codex) is not installed. See https://github.com/openai/codex' : 'Claude Code (claude) is not installed or not on PATH.');
    }
    const from = await teamContext(host, team, 'git_url');
    if (o.repo) {
      repo = repoAt(resolve(o.repo)) ?? fail(`${o.repo} is not a git repository.`);
      if (!git(repo, 'remote', 'get-url', 'origin').ok) fail(`${repo} has no origin remote. The workers push their branches there for the conductor to merge.`);
      done('project', repo);
    } else if (from) {
      repo = workClone(from, team);
      done('project', `copied from the conductor to ${repo}`);
    } else {
      fail('The conductor is not sharing the project yet. On the conductor\'s computer, run: tandem stop, then tandem start\n(it has to be on a network others can reach, not --local).');
    }
  }
  repo ??= process.cwd();
  installPackages(['brain', 'mcp', 'launcher', 'manager']);

  if (workers > 0) {
    const names = startWorkers(team, `ws://${host}:${BRAIN_PORT}`, repo, workers, {
      simulate: SIMULATE, push: !SIMULATE, model: o.model!, budget: o.budget!, accounts: accts,
    });
    done('workers', `${names.join(', ')}${SIMULATE ? ' (test mode: fake coding)' : accts.length ? ' (they push their branches)' : ` (Claude, ${modelNote(o.model!)}; they push their branches)`}`);
  }
  const page = `http://${host}:${PAGE_PORT}/?db=${team}`;
  remember(team, { page, repo, host });
  say();
  say(`  Joined team "${team}" as a teammate`);
  say();
  say(`  ${bold('Board')}    ${cyan(page)}`);
  say(`  ${bold('Stop')}     tandem stop`);
  say();
  say(dim('  Your computer\'s workers now take tasks from the conductor. The conductor sends the goals; you can watch on the page.'));
  if (!o['no-browser']) openBrowser(page);
}

// ---------- the teams this computer started or joined (for status and open) ----------
// hostKey: the conductor's key (only in the conductor's own page link), so that page can always take control back
type TeamInfo = { page: string; repo: string; invite?: string | null; host?: string; gitPort?: number; hostKey?: string };
const TEAMS = join(STATE, 'teams.json');
function teams(): Record<string, TeamInfo> { try { return JSON.parse(readFileSync(TEAMS, 'utf8')); } catch { return {}; } }
function remember(team: string, info: TeamInfo) { mkdirSync(STATE, { recursive: true }); writeFileSync(TEAMS, JSON.stringify({ ...teams(), [team]: info }, null, 2)); }

// The team this folder's project runs as, else the only team running here.
function currentTeam(argv: string[]): string | null {
  const { values } = parseArgs({ args: argv, strict: false, options: { team: { type: 'string' } } });
  if (typeof values.team === 'string') return slug(values.team);
  const repo = repoAt(process.cwd());
  const known = teams();
  const here = Object.entries(known).find(([, t]) => repo && resolve(t.repo) === repo)?.[0];
  if (here) return here;
  const active = [...new Set(loadProcs().map(p => p.team).filter(Boolean))];
  return active.length === 1 ? active[0] : null;
}

// ---------- tandem stop / status / open / logs ----------
async function stop(argv: string[]) {
  const all = argv.includes('--all');
  const keep: Proc[] = [];
  let stopped = 0;
  for (const p of loadProcs()) {
    if (p.name === 'brain' && !all) { keep.push(p); continue; }
    kill(p.pid);
    stopped++;
    say(`  ${green('✓')} stopped ${p.name}${p.team ? dim(` (${p.team})`) : ''}`);
  }
  if (all && (await reachable('127.0.0.1', BRAIN_PORT))) {
    // a brain this command did not start (for example, from an older version)
    if (WIN) run('taskkill', ['/IM', 'spacetime*', '/T', '/F']);
    else run('pkill', ['-f', 'spacetime']);
    stopped++;
    say(`  ${green('✓')} stopped the brain`);
  }
  if (!stopped) say(dim(`  Nothing to stop${keep.length ? ' (the brain keeps running; tandem stop --all stops it too)' : ''}.`));
  saveProcs(keep);
}

async function status() {
  const procs = loadProcs();
  const brain = await reachable('127.0.0.1', BRAIN_PORT);
  const page = await reachable('127.0.0.1', PAGE_PORT);
  say();
  say(`  ${brain ? green('●') : dim('○')} brain    ${brain ? `running ${dim(`(port ${BRAIN_PORT})`)}` : dim('stopped')}`);
  say(`  ${page ? green('●') : dim('○')} page     ${page ? `running ${dim(`(port ${PAGE_PORT})`)}` : dim('stopped')}`);
  const known = teams();
  const active = [...new Set(procs.map(p => p.team).filter(Boolean))];
  for (const t of active) {
    const mine = procs.filter(p => p.team === t);
    const workers = mine.filter(p => p.name.startsWith('worker ')).map(p => p.name.slice(7));
    say();
    say(`  ${bold(t)}${known[t]?.repo ? dim(`  ${known[t].repo}`) : ''}`);
    say(`    ${mine.some(p => p.name === 'conductor' || p.name === 'manager') ? 'conductor, ' : ''}${workers.length} worker${workers.length === 1 ? '' : 's'}${workers.length ? dim(` (${workers.join(', ')})`) : ''}`);
    if (known[t]?.page) say(`    ${bold('Open')}    ${cyan(known[t].page)}`);
    if (known[t]?.invite) say(`    ${bold('Invite')}  ${cyan(known[t].invite!)}`);
  }
  if (!active.length) say(dim('\n  No team is running here. In your project\'s folder: tandem start'));
  say();
}

// Opens the dashboard: this project's board if there is one, else the page's start screen, which
// lists nothing but lets you open a team. Fails only when nothing is running at all.
async function openPage(argv: string[]) {
  const team = currentTeam(argv);
  const info = team ? teams()[team] : undefined;
  if (info) { say(`  ${cyan(info.page)}`); openBrowser(info.page); return; }
  if (await reachable('127.0.0.1', PAGE_PORT)) {
    const url = `http://localhost:${PAGE_PORT}/`;
    say(`  ${cyan(url)}`);
    openBrowser(url);
    return;
  }
  fail('The dashboard is not running. In your project\'s folder, start it with: tandem start');
}

function logs(argv: string[]) {
  const team = currentTeam(argv);
  const part = argv.find(a => !a.startsWith('--')) ?? ''; // conductor, bilal-pc, brain, page...
  const files = existsSync(LOGS) ? readdirSync(LOGS).filter(f => f.endsWith('.log')) : [];
  const picked = files.filter(f => (team ? f.startsWith(`${team}-`) || /^(brain|page)\./.test(f) : true) && f.toLowerCase().includes(part.toLowerCase()));
  if (!picked.length) fail(`No logs${part ? ` for "${part}"` : ''} yet. They are in ${LOGS}`);
  for (const f of picked) {
    const lines = readFileSync(join(LOGS, f), 'utf8').trimEnd().split('\n').slice(-15);
    say(`\n  ${bold(f.replace(/\.log$/, ''))} ${dim(join(LOGS, f))}`);
    for (const l of lines) say(`    ${l}`);
  }
}

// ---------- tandem install: so "tandem" works in any terminal ----------
// Windows: adds the Tandem folder to your user PATH (this user only, no administrator needed).
// macOS and Linux: links `tandem` into ~/.local/bin. Nothing else is changed. `tandem uninstall`
// undoes it. (The tests keep the PATH in a file, TANDEM_TEST_PATH_FILE, instead of the registry.)
const samePath = (a: string, b: string) => a.trim().replace(/[\\/]+$/, '').toLowerCase() === b.trim().replace(/[\\/]+$/, '').toLowerCase();
function readUserPath(): string {
  const file = process.env.TANDEM_TEST_PATH_FILE;
  if (file) return existsSync(file) ? readFileSync(file, 'utf8') : '';
  return run('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"]).out.trim();
}
function writeUserPath(value: string) {
  const file = process.env.TANDEM_TEST_PATH_FILE;
  if (file) { writeFileSync(file, value); return; }
  const r = run('powershell', ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('Path', '${value.replace(/'/g, "''")}', 'User')`]);
  if (!r.ok) fail(`Could not change your PATH:\n${r.out}`);
}
const localBin = () => join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.local', 'bin');
function installCmd() {
  if (WIN || process.env.TANDEM_TEST_PATH_FILE) {
    const entries = readUserPath().split(';').filter(Boolean);
    if (entries.some(e => samePath(e, ROOT))) { say(`\n  ${green('✓')} Already on your PATH: ${ROOT}\n  ${dim('If "tandem" is not found, open a new terminal: an open one does not see the change.')}`); return; }
    writeUserPath([...entries, ROOT].join(';'));
    say(`\n  ${green('✓')} Added ${ROOT} to your PATH (your user only).\n  Open a ${bold('new')} terminal, then ${bold('tandem --help')} works anywhere. An open terminal does not see the change.\n  ${dim('To undo it: tandem uninstall')}`);
    return;
  }
  const link = join(localBin(), 'tandem');
  mkdirSync(localBin(), { recursive: true });
  rmSync(link, { force: true });
  symlinkSync(join(ROOT, 'tandem'), link);
  say(`\n  ${green('✓')} Linked ${link} to ${join(ROOT, 'tandem')}.`);
  if (!(process.env.PATH ?? '').split(delimiter).some(p => samePath(p, localBin()))) say(`  ${localBin()} is not on your PATH yet. Add this line to your shell's startup file, then open a new terminal:\n    export PATH="$HOME/.local/bin:$PATH"`);
  else say(`  Open a ${bold('new')} terminal, then ${bold('tandem --help')} works anywhere.`);
  say(`  ${dim('To undo it: tandem uninstall')}`);
}
function uninstallCmd() {
  if (WIN || process.env.TANDEM_TEST_PATH_FILE) {
    const entries = readUserPath().split(';').filter(Boolean);
    if (!entries.some(e => samePath(e, ROOT))) { say(`\n  Tandem is not on your PATH, so there is nothing to remove.`); return; }
    writeUserPath(entries.filter(e => !samePath(e, ROOT)).join(';'));
    say(`\n  ${green('✓')} Removed ${ROOT} from your PATH. Open a new terminal for it to take effect.`);
    return;
  }
  const link = join(localBin(), 'tandem');
  try { if (resolve(dirname(link), readlinkSync(link)) === join(ROOT, 'tandem')) { rmSync(link); say(`\n  ${green('✓')} Removed ${link}.`); return; } } catch { /* not a link */ }
  say(`\n  ${link} is not a link to this Tandem, so it was left alone.`);
}
// ---------- tandem doctor: is this computer ready? ----------
// Checks what Tandem needs and says what to install for anything missing. Nothing is changed.
function doctorCmd() {
  // "git version 2.51.1", "v11.6.1": the version number from a program's --version, else its first line
  const first = (r: { ok: boolean; out: string }) => (r.ok ? (/\d+\.\d+(?:\.\d+)?/.exec(r.out)?.[0] ?? r.out.split('\n')[0].trim()) : '');
  const has = (cmd: string, args: string[] = ['--version']) => { const p = which(cmd); return p ? { path: p, version: first(run(p, args)) } : null; };
  const git_ = has('git');
  const npm_ = has('npm');
  const claude_ = has('claude');
  const spacetime_ = has('spacetime');
  const python_ = has('python') ?? has('python3');
  const tailscale = tailscaleAddress();
  const tsInstalled = !!tailscale || !!which('tailscale') || (!!process.env.ProgramFiles && existsSync(join(process.env.ProgramFiles, 'Tailscale', 'tailscale.exe')));

  say(`\n  ${bold('Tandem · is this computer ready?')}\n`);
  const row = (mark: string, what: string, detail: string, fix = '') =>
    say(`  ${mark} ${what.padEnd(13)} ${detail}${fix ? `\n    ${' '.repeat(13)} ${dim(fix)}` : ''}`);
  const ok = green('✓'), bad = '✗', opt = dim('–');
  row(ok, 'Node.js', `${process.versions.node}`);
  row(git_ ? ok : bad, 'Git', git_ ? git_.version : 'not found', git_ ? '' : 'Install it: https://git-scm.com/downloads');
  row(npm_ ? ok : bad, 'npm', npm_ ? npm_.version : 'not found', npm_ ? '' : 'It comes with Node.js: https://nodejs.org');
  row(claude_ ? ok : bad, 'Claude Code', claude_ ? claude_.version : 'not found', claude_ ? 'Make sure you are signed in: run "claude" once and follow the login.' : 'Install it: https://claude.com/claude-code, then run "claude" once and sign in.');
  row(spacetime_ ? ok : opt, 'SpacetimeDB', spacetime_ ? spacetime_.version : 'not found (only the conductor needs it)', spacetime_ ? '' : 'To be a conductor: https://spacetimedb.com/install');
  row(tailscale ? ok : opt, 'Tailscale', tailscale ? `connected, ${tailscale}` : tsInstalled ? 'installed, not connected' : 'not found (only needed across different networks)', tailscale ? '' : 'Public wifi or different networks: https://tailscale.com/download');
  row(python_ ? ok : opt, 'Python', python_ ? python_.version : 'not found (only for Python projects)');
  const onPath = !!which('tandem');
  row(onPath ? ok : opt, '"tandem" cmd', onPath ? 'works in any terminal' : 'not on your PATH yet', onPath ? '' : `Run once: ${ownCommand()} install, then open a new terminal.`);

  const canJoin = !!(git_ && npm_ && claude_);
  const canHost = canJoin && !!spacetime_;
  say(`\n  ${canJoin ? green('✓') : bad} Ready to join a team   ${canHost ? green('✓') : bad} Ready to be the conductor\n`);
  if (!canJoin) process.exitCode = 1;
}

// how to run this Tandem by its own path, for the tip printed when "tandem" is not on the PATH
const ownCommand = () => (WIN ? `& '${join(ROOT, 'tandem.cmd')}'` : `'${join(ROOT, 'tandem')}'`);

const [first, ...rest] = process.argv.slice(2);
// Every command also works as a flag: "tandem --start" is "tandem start".
const WORDS = ['init', 'start', 'join', 'stop', 'status', 'open', 'dashboard', 'logs', 'account', 'accounts', 'install', 'uninstall', 'doctor', 'version', 'help'];
const cmd = first && first.startsWith('--') && WORDS.includes(first.slice(2)) ? first.slice(2) : first;
try {
  if (cmd === 'init') await initProject(rest);
  else if (cmd === 'start') await start(rest);
  else if (cmd === 'join') await joinTeam(rest);
  else if (cmd === 'stop') await stop(rest);
  else if (cmd === 'status') await status();
  else if (cmd === 'open' || cmd === 'dashboard' || cmd === '-d') await openPage(rest);
  else if (cmd === 'version' || cmd === '-v') say(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  else if (cmd === 'logs') logs(rest);
  else if (cmd === 'account' || cmd === 'accounts') await accountCmd(rest);
  else if (cmd === 'install') installCmd();
  else if (cmd === 'uninstall') uninstallCmd();
  else if (cmd === 'doctor') doctorCmd();
  else if (cmd === 'help' || cmd === '-h') say(HELP);
  else if (!cmd) {
    // just `tandem`: open the page. A running team's board (with what is running); otherwise the
    // page's start screen, which says how to start or join a team.
    if (loadProcs().some(p => p.team)) { await status(); await openPage([]); }
    else {
      await ensurePage();
      say(`\n  Opening the dashboard. It shows how to start a team.\n  ${dim('All the commands: tandem --help')}`);
      await openPage([]);
    }
  } else {
    console.error(`\n  "${cmd}" is not a tandem command. Run ${bold('tandem --help')} to see what you can do.`);
    process.exit(2);
  }
} catch (e) {
  // a mistyped option: say so in one line, not a stack trace
  const code = (e as { code?: string }).code ?? '';
  if (code.startsWith('ERR_PARSE_ARGS')) fail(`${(e as Error).message.split('.')[0]}. Run "tandem --help" for the options.`);
  throw e;
}
