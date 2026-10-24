// Runs the manager once, headless: one `claude -p` run with PROMPT.md and the tandem MCP. It plans
// every waiting goal into tasks, then stops. Works on Windows, macOS and Linux.
//
//   npx tsx plan.ts [--uri ws://127.0.0.1:3001] [--db tandem-local] [--session live]
//                   [--token-file <path>] [--workdir <repo>] [--model haiku] [--budget 0.50] [--log <file>]
//
// The manager's identity (printed first) must be allowed to manage the team; watch.ts asks for
// that by itself. Uses your Claude quota. Nothing is added to your Claude Code settings.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BrainClient } from '../mcp/src/brain-client.js';

const { values: opt } = parseArgs({
  options: {
    uri: { type: 'string', default: process.env.STDB_URI ?? 'ws://127.0.0.1:3001' },
    db: { type: 'string', default: process.env.STDB_DB ?? 'bilal-dev' },
    session: { type: 'string', default: process.env.TANDEM_SESSION ?? 'live' },
    'token-file': { type: 'string' },
    workdir: { type: 'string', default: process.cwd() },
    model: { type: 'string', default: 'haiku' },
    budget: { type: 'string', default: '0.50' },
    log: { type: 'string' },
  },
});
const here = fileURLToPath(new URL('.', import.meta.url));
const mcp = resolve(here, '..', 'mcp');
const tokenFile = opt['token-file'] ?? join(mcp, '.tandem', `manager-token-${opt.db}`);

// who the manager is (also creates its saved login on the first run)
process.env.TANDEM_TOKEN_FILE = tokenFile;
const brain = await BrainClient.connect(opt.uri!, opt.db!, opt.session!);
console.log(`Manager identity: ${brain.identity}`);
brain.disconnect();

const work = join(tmpdir(), 'tandem-manager');
mkdirSync(work, { recursive: true });
const config = join(work, `mcp-${opt.db}.json`);
writeFileSync(config, JSON.stringify({ mcpServers: { tandem: {
  command: process.execPath,
  args: ['--import', pathToFileURL(join(mcp, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href, join(mcp, 'src', 'server.ts')],
  env: { STDB_URI: opt.uri, STDB_DB: opt.db, TANDEM_SESSION: opt.session, TANDEM_TOKEN_FILE: tokenFile },
} } }));

const prompt = readFileSync(join(here, 'PROMPT.md'), 'utf8') + '\n\nBegin now: call get_goals.';
const code = await new Promise<number>(done => {
  const child = spawn('claude', ['-p', '--model', opt.model!, '--mcp-config', config, '--strict-mcp-config',
    '--allowedTools', 'mcp__tandem', 'Read', 'Glob', 'Grep', '--max-budget-usd', opt.budget!], { cwd: resolve(opt.workdir!) });
  let out = '';
  child.stdout.on('data', d => { out += d; process.stdout.write(d); });
  child.stderr.on('data', d => { out += d; process.stderr.write(d); });
  child.on('error', e => { out += String(e); done(1); });
  child.on('close', c => { if (opt.log) writeFileSync(opt.log, out); done(c ?? 1); });
  child.stdin.end(prompt);
});
setTimeout(() => process.exit(code), 300);
