#!/usr/bin/env node
// tandem: run Tandem from the project you want built. Node 22.18+ runs this TypeScript file as is.
//
//   tandem start              in your project's folder: host a team for it, print the invite address
//   tandem join <address>     in your clone of that project: add this computer's workers to the team
//   tandem stop [--all]       stop what this computer started (--all also stops the brain)
//   tandem status             what is running
//
// Run `tandem help` for the options. Every person's Claude Code runs under their own login.
import { spawn, spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { hostname, networkInterfaces } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE = join(ROOT, '.tandem');
const LOGS = join(STATE, 'logs');
const PIDS = join(STATE, 'pids.json');
const WIN = process.platform === 'win32';
const BRAIN_PORT = 3001;
const PAGE_PORT = 5173;
const NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Riley', 'Casey'];

const HELP = `tandem: your team's Claude Codes, working as one.

  tandem start              Host a team for the git repo you are in. Prints the invite address.
    --simulate              workers fake the coding (no Claude usage for the work)
    --workers N             workers on this computer (default 2; 0 = none)
    --local                 only this computer can join (default: your network can)
    --team NAME             the team's name (default: this folder's name)
    --fresh                 wipe the team's board first
    --push                  push task and goal branches to origin (a PR per goal with the GitHub CLI)
    --review                a worker reviews each goal before it is done
    --model auto            pick the model by task difficulty (default: haiku for everything)
    --notify URL            post "goal done" to a Slack or Discord webhook
    --demo                  use a sample project instead of this folder (good for a first try)
    --no-browser            do not open the page

  tandem join <address>     In your clone of the team's repo: add this computer's workers.
                            <address> is the invite the host's page shows, like http://192.168.1.20:5173/?db=shop
    --simulate, --workers N as above

  tandem stop               Stop what this computer started (the brain keeps running).
    --all                   also stop the brain

  tandem status             What is running.
`;

// ---------- small helpers ----------
const say = (m = '') => console.log(m);
const step = (m: string) => say(`\n== ${m}`);
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
  const r = spawnSync(shell ? `"${cmd}"` : cmd, quoted, { cwd, encoding: 'utf8', shell });
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
function background(name: string, team: string, cmd: string, args: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  mkdirSync(LOGS, { recursive: true });
  const base = join(LOGS, `${team ? `${team}-` : ''}${name.replace(/\s+/g, '-')}`);
  const child = spawn(cmd, args, {
    cwd, env: { ...process.env, ...env }, detached: true, windowsHide: true,
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
    say(`  installing packages in ${d} (first run only)`);
    const r = run(npm, ['install', '--silent', '--no-fund', '--no-audit'], join(ROOT, d));
    if (!r.ok) fail(`npm install failed in ${d}:\n${r.out}`);
  }
}

function openBrowser(url: string) {
  if (WIN) spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// The git repo the command runs in (its top folder), or null.
function repoAt(dir: string): string | null {
  const r = git(dir, 'rev-parse', '--show-toplevel');
  return r.ok ? resolve(r.out) : null;
}

// A sample project next to the Tandem folder, for a first try.
function demoRepo(): string {
  const repo = join(dirname(ROOT), 'tandem-playground');
  if (!existsSync(join(repo, '.git'))) {
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'README.md'), '# Tandem playground\n\nA sample project for trying Tandem.\n');
    writeFileSync(join(repo, '.gitignore'), '.worktrees/\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=tandem', '-c', 'user.email=tandem@localhost', 'commit', '-q', '-m', 'Start');
  }
  return repo;
}

type WorkerOpts = { simulate: boolean; push: boolean; model: string; budget: string; suffix: string; offset: number; simLimit?: number };
function startWorkers(team: string, uri: string, repo: string, count: number, opts: WorkerOpts) {
  for (let i = 0; i < count; i++) {
    const name = NAMES[(i + opts.offset) % NAMES.length] + opts.suffix;
    if (running(`worker ${name}`, team)) { say(`  ${name} (already running)`); continue; }
    const args = ['--import', tsx('launcher'), join(ROOT, 'launcher', 'launcher.ts'), '--name', name, '--repo', repo];
    if (opts.simulate) args.push('--simulate', '--sim-ms', '3000');
    // for demos: the first worker hits a usage limit on its first task, then comes back
    if (opts.simulate && opts.simLimit && i === 0) args.push('--sim-limit', String(opts.simLimit));
    if (opts.push) args.push('--push');
    background(`worker ${name}`, team, process.execPath, args, ROOT, {
      STDB_URI: uri, STDB_DB: team, TANDEM_SESSION: 'live',
      TANDEM_TOKEN_FILE: join(ROOT, 'mcp', '.tandem', `worker-${name}-${team}`),
      LAUNCHER_MODEL: opts.model === 'auto' ? undefined : opts.model, LAUNCHER_BUDGET_USD: opts.budget,
    });
    say(`  ${name}`);
  }
}

// ---------- tandem start ----------
async function start(argv: string[]) {
  const { values: o } = parseArgs({ args: argv, options: {
    simulate: { type: 'boolean', default: false }, workers: { type: 'string', default: '2' },
    local: { type: 'boolean', default: false }, team: { type: 'string' }, fresh: { type: 'boolean', default: false },
    push: { type: 'boolean', default: false }, review: { type: 'boolean', default: false },
    model: { type: 'string', default: 'haiku' }, 'manager-model': { type: 'string', default: 'haiku' },
    budget: { type: 'string', default: '0.50' }, notify: { type: 'string' }, demo: { type: 'boolean', default: false },
    'no-browser': { type: 'boolean', default: false }, 'no-manager': { type: 'boolean', default: false },
    'sim-limit': { type: 'string', default: '0' }, // demos: the first simulated worker hits a usage limit
  } });
  const workers = Number(o.workers);

  // the project: this folder's git repo
  let repo = o.demo ? demoRepo() : repoAt(process.cwd());
  if (!repo) fail(`${process.cwd()} is not a git repository.\nRun tandem start inside the project you want built (new project: git init, then make a first commit).\nJust trying it out? tandem start --demo --simulate`);
  repo = repo!;
  if (resolve(repo) === ROOT) fail('This is the Tandem folder itself. Run tandem start inside the project you want built.\nJust trying it out? tandem start --demo --simulate');
  if (!git(repo, 'rev-parse', '--verify', '--quiet', 'HEAD').ok) fail(`${repo} has no commits yet. Make a first commit, then run tandem start again.`);
  const team = slug(o.team ?? basename(repo));

  const needClaude = (!o.simulate && workers > 0) || !o['no-manager'];
  for (const t of ['git', 'spacetime', ...(needClaude ? ['claude'] : [])]) {
    if (!which(t)) fail(t === 'spacetime' ? 'The SpacetimeDB CLI is not installed. See https://spacetimedb.com/install'
      : t === 'claude' ? 'Claude Code (claude) is not installed or not on PATH. Or try: tandem start --simulate --no-manager' : `${t} is not installed.`);
  }
  step('Getting ready');
  installPackages(['brain/spacetimedb', 'brain', 'mcp', 'dashboard', 'launcher', 'manager']);

  step('The brain (SpacetimeDB)');
  const spacetime = which('spacetime')!;
  if (!(await reachable('127.0.0.1', BRAIN_PORT))) {
    background('brain', '', spacetime, ['start', '--listen-addr', `${o.local ? '127.0.0.1' : '0.0.0.0'}:${BRAIN_PORT}`], ROOT);
    if (!(await waitFor('127.0.0.1', BRAIN_PORT, 20))) fail(`The brain did not start. See ${join(LOGS, 'brain.err')}`);
    say(`  started${o.local ? ' (this computer only)' : ''}`);
  } else say('  already running');
  run(spacetime, ['server', 'add', 'dev3001', '--url', `http://127.0.0.1:${BRAIN_PORT}`, '--no-fingerprint']);
  const pub = run(spacetime, ['publish', team, '--server', 'dev3001', '--no-config', '--module-path', join(ROOT, 'brain', 'spacetimedb'), '--yes', ...(o.fresh ? ['--delete-data=always'] : [])]);
  if (!pub.ok) fail(`${pub.out}\nCould not set up the team "${team}". If Tandem was updated and this team is old, tandem start --fresh starts it over (this wipes its board).`);
  say(`  team "${team}" is ready`);

  step('The page');
  if (!(await reachable('127.0.0.1', PAGE_PORT))) {
    background('page', '', process.execPath, [join(ROOT, 'dashboard', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PAGE_PORT), '--strictPort'], join(ROOT, 'dashboard'));
    if (!(await waitFor('127.0.0.1', PAGE_PORT, 20))) fail(`The page did not start. See ${join(LOGS, 'page.err')}`);
    say('  started');
  } else say('  already running');

  // the invite: only if the brain is really open to the network
  const ip = o.local ? null : await lanAddress();
  const shared = !!ip && await reachable(ip, BRAIN_PORT);
  const uri = `ws://127.0.0.1:${BRAIN_PORT}`;

  if (!o['no-manager']) {
    step('The manager (plans every goal you type)');
    if (running('manager', team)) say('  already running');
    else {
      const args = ['--import', tsx('manager'), join(ROOT, 'manager', 'watch.ts'), '--repo', repo, '--model', o['manager-model']!, '--budget', o.budget!];
      if (o.push) args.push('--push');
      if (o.review) args.push('--review');
      if (o.notify) args.push('--notify', o.notify);
      background('manager', team, process.execPath, args, ROOT, {
        STDB_URI: uri, STDB_DB: team, TANDEM_SESSION: 'live', TANDEM_TOKEN_FILE: join(ROOT, 'mcp', '.tandem', `manager-token-${team}`),
      });
      say('  started');
    }
  }
  if (workers > 0) {
    step(`${workers} worker${workers === 1 ? '' : 's'}${o.simulate ? ' (simulated: no Claude usage)' : o.model === 'auto' ? ' (Claude, model by difficulty)' : ` (Claude, ${o.model})`}`);
    startWorkers(team, uri, repo, workers, { simulate: o.simulate, push: o.push, model: o.model!, budget: o.budget!, suffix: '', offset: 0, simLimit: Number(o['sim-limit']) });
  }

  const page = `http://localhost:${PAGE_PORT}/?db=${team}${shared ? `&lan=${ip}` : ''}`;
  const invite = shared ? `http://${ip}:${PAGE_PORT}/?db=${team}` : null;
  step(`Tandem is running for ${repo}`);
  say(`  Open:    ${page}`);
  if (invite) {
    say(`  Invite:  ${invite}`);
    say('           Others open it in a browser to watch, or add their workers from their clone of this repo:');
    say(`           tandem join ${invite}`);
    if (WIN) say('           (If Windows asks whether node and spacetime may use the network, allow private networks.)');
  } else if (!o.local) {
    say('  Only this computer can join: the brain was started for this computer only.');
    say('  To invite others: tandem stop --all, then tandem start');
  } else say('  Only this computer can join (--local).');
  say('  First time: click "Make me the owner" on the page (it also approves the manager).');
  say('  Stop:    tandem stop');
  if (!o['no-browser']) openBrowser(page);
}

// ---------- tandem join ----------
// Accepts the invite (http://host:5173/?db=team), or host[:port]/team, or ws://host:3001 with --team.
function parseAddress(address: string, team?: string): { host: string; team: string } {
  const a = address.trim();
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(a) ? a : `http://${a}`);
    const t = team ?? u.searchParams.get('db') ?? u.pathname.replace(/^\/+|\/+$/g, '');
    if (u.hostname && t) return { host: u.hostname, team: slug(t) };
  } catch { /* not a URL */ }
  return fail(`Could not read the address "${address}". Use the invite the host's page shows, like http://192.168.1.20:5173/?db=shop`);
}

// The repo the team works on, if the host published it (manager with --push). Read-only SQL over HTTP.
async function teamRepo(host: string, team: string): Promise<string> {
  try {
    const r = await fetch(`http://${host}:${BRAIN_PORT}/v1/database/${team}/sql`, {
      method: 'POST', body: "SELECT value FROM context WHERE session_id = 'live' AND key = 'repo_url'", signal: AbortSignal.timeout(3000),
    });
    const rows = (await r.json() as { rows: unknown[][] }[])[0]?.rows ?? [];
    return String(rows[0]?.[0] ?? '').replace(/^"|"$/g, '');
  } catch { return ''; }
}

async function joinTeam(argv: string[]) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    simulate: { type: 'boolean', default: false }, workers: { type: 'string', default: '2' },
    team: { type: 'string' }, model: { type: 'string', default: 'haiku' }, budget: { type: 'string', default: '0.50' },
    'no-browser': { type: 'boolean', default: false },
  } });
  if (!positionals[0]) fail('Which team? tandem join <address>, using the invite the host\'s page shows.');
  const { host, team } = parseAddress(positionals[0], o.team);
  step(`Joining team "${team}" at ${host}`);
  if (!(await reachable(host, BRAIN_PORT, 2500))) {
    fail(`Cannot reach ${host}:${BRAIN_PORT}. Check the invite on the host's page, that both computers are on the same network, and that the host did not use --local.`);
  }
  say('  the host is reachable');

  const workers = Number(o.workers);
  let repo = repoAt(process.cwd());
  const repoUrl = await teamRepo(host, team);
  if (!o.simulate && workers > 0) {
    if (!repo) {
      fail(repoUrl
        ? `Run tandem join inside your clone of the team's repo:\n  git clone ${repoUrl}\n  cd ${basename(repoUrl).replace(/\.git$/, '')}\n  tandem join ${positionals[0]}`
        : 'Run tandem join inside your clone of the team\'s repo (ask the host for it).\nOr add --simulate for workers that fake the coding.');
    }
    if (!git(repo!, 'remote', 'get-url', 'origin').ok) fail(`${repo} has no origin remote. The workers push their branches there for the host to merge.`);
    if (!which('claude')) fail('Claude Code (claude) is not installed or not on PATH. Or add --simulate.');
    if (!repoUrl) say('  note: the host did not start with --push, so it cannot fetch the branches your workers push. Ask them to.');
  }
  repo ??= process.cwd();
  installPackages(['brain', 'mcp', 'launcher', 'manager']);

  if (workers > 0) {
    step(`${workers} worker${workers === 1 ? '' : 's'}${o.simulate ? ' (simulated: no Claude usage)' : ` (Claude, ${o.model})`}`);
    startWorkers(team, `ws://${host}:${BRAIN_PORT}`, repo, workers, {
      simulate: o.simulate, push: !o.simulate, model: o.model!, budget: o.budget!, suffix: `-${slug(hostname())}`, offset: 3,
    });
  }
  const page = `http://${host}:${PAGE_PORT}/?db=${team}`;
  step('Joined');
  say(`  Board:  ${page}`);
  say('  Stop:   tandem stop');
  if (!o['no-browser']) openBrowser(page);
}

// ---------- tandem stop / status ----------
async function stop(argv: string[]) {
  const all = argv.includes('--all');
  const keep: Proc[] = [];
  for (const p of loadProcs()) {
    if (p.name === 'brain' && !all) { keep.push(p); continue; }
    kill(p.pid);
    say(`stopped ${p.name}${p.team ? ` (${p.team})` : ''}`);
  }
  if (all && (await reachable('127.0.0.1', BRAIN_PORT))) {
    // a brain this command did not start (for example, from an older version)
    if (WIN) run('taskkill', ['/IM', 'spacetime*', '/T', '/F']);
    else run('pkill', ['-f', 'spacetime']);
    say('stopped the brain');
  }
  saveProcs(keep);
}

async function status() {
  const procs = loadProcs();
  say(`brain   ${(await reachable('127.0.0.1', BRAIN_PORT)) ? 'running' : 'stopped'} (port ${BRAIN_PORT})`);
  say(`page    ${(await reachable('127.0.0.1', PAGE_PORT)) ? `running: http://localhost:${PAGE_PORT}` : 'stopped'}`);
  for (const p of procs.filter(x => x.team)) say(`${p.name.padEnd(7)} team ${p.team}`);
  if (!procs.some(x => x.team)) say('no manager or workers running');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'start') await start(rest);
else if (cmd === 'join') await joinTeam(rest);
else if (cmd === 'stop') await stop(rest);
else if (cmd === 'status') await status();
else { say(HELP); if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exit(2); }
