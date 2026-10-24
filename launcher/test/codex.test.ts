// A Codex worker, with a stand-in for codex (no OpenAI call): the launcher writes the tandem MCP
// server into the worker's own login folder (CODEX_HOME), runs codex exec in the task's worktree,
// commits what it wrote and completes the task. The page sees "codex" and the account label.
// Needs the local server on 3001 with bilal-dev published.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-dev';
const S = `cx-${Date.now().toString(36)}`;
const launcher = fileURLToPath(new URL('../launcher.ts', import.meta.url));
const fake = fileURLToPath(new URL('./fake-codex.mjs', import.meta.url));
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  codex: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const repo = mkdtempSync(join(tmpdir(), 'tandem-codex-'));
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
git('init', '-q'); writeFileSync(join(repo, 'README.md'), '# x\n'); writeFileSync(join(repo, '.gitignore'), '.worktrees/\n'); git('add', '-A'); git('commit', '-q', '-m', 'start');
// the worker's own Codex login folder, with a setting of the user's that must be kept
const home = mkdtempSync(join(tmpdir(), 'tandem-codex-home-'));
mkdirSync(home, { recursive: true });
writeFileSync(join(home, 'config.toml'), 'model = "gpt-5-codex"\n');

const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.tasks, tables.workers]); })
    .onConnectError((_c, e) => rej(e)).build();
});
await conn.reducers.createTask({ sessionId: S, kind: 'normal', task: { id: 't-cx', title: 'Write hello_codex.py', description: 'Print hello', files: ['hello_codex.py'], difficulty: 'easy', model: '', effort: 'default', dependsOn: [] } });

const out = await new Promise<{ code: number; out: string }>(done => {
  const child = spawn(process.execPath, ['--import', 'tsx', launcher, '--name', 'Cody', '--agent', 'codex', '--account', 'school', '--repo', repo, '--exit-when-idle', '--max-tasks', '1', '--poll', '1'], {
    env: { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: S, CODEX_HOME: home, TANDEM_CODEX: fake },
  });
  let o = '';
  child.stdout.on('data', d => { o += d; }); child.stderr.on('data', d => { o += d; });
  child.on('close', code => done({ code: code ?? 1, out: o }));
});
await new Promise(r => setTimeout(r, 400));

const task = [...conn.db.tasks.iter()].find(t => t.sessionId === S && t.id === 't-cx');
const worker = [...conn.db.workers.iter()].find(w => w.sessionId === S && w.id === 'w-cody');
check('the launcher exits cleanly', out.code === 0, out.out.slice(-400));
check('the task is done on its branch, summed up by Codex\'s last message', task?.status === 'done' && task.branch === 'task/t-cx' && task.resultSummary === 'Wrote hello_codex.py', task && [task.status, task.branch, task.resultSummary]);
let file = '';
try { file = git('show', 'task/t-cx:hello_codex.py'); } catch { /* missing */ }
check('the branch has the file Codex wrote', file.includes('hello from codex'), file);
check('the page sees a Codex worker on the "school" login', worker?.agent === 'codex' && worker.account === 'school', worker && [worker.agent, worker.account]);
const seenFile = readdirSync(join(repo, '.worktrees')).find(f => f.endsWith('.seen.json'));
const seen = seenFile ? JSON.parse(readFileSync(join(repo, '.worktrees', seenFile), 'utf8')) as { args: string[]; prompt: string; config: string } : null;
check('codex exec runs in the task\'s worktree, with full auto and the prompt on stdin',
  !!seen && seen.args[0] === 'exec' && seen.args.includes('--full-auto') && seen.args[seen.args.indexOf('--cd') + 1].endsWith(join('.worktrees', 't-cx')) && seen.prompt.includes('task_id: t-cx'), seen?.args);
check('its config has the tandem MCP server for this worker, and keeps the user\'s own setting',
  !!seen && seen.config.includes('[mcp_servers.tandem]') && seen.config.includes('TANDEM_WORKER_ID = "w-cody"') && seen.config.includes('model = "gpt-5-codex"'), seen?.config);

conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
