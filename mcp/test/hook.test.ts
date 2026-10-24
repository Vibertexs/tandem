// The lock-check hook, fed the same JSON Claude Code sends on stdin.
// Needs the local server on dev3001 with bilal-dev published. Uses a fresh session each run.
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { DbConnection } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-dev';
const S = `h-${Date.now().toString(36)}`;
const ROOT = resolve('C:/Code/scratch/hook-repo');
const HOOK = resolve('hook/check-lock.mjs');

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB).onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build();
});
await conn.reducers.registerWorker({ sessionId: S, id: 'w-alice', name: 'Alice', plan: 'pro' });
await conn.reducers.createTask({
  sessionId: S, kind: 'normal',
  task: { id: 't1', title: 't1', description: '', files: ['src/locked.py'], difficulty: 'normal', model: '', effort: 'default', dependsOn: [] },
});
await conn.reducers.claimTask({ sessionId: S, workerId: 'w-alice' }); // Alice now holds src/locked.py

function hook(toolInput: Record<string, unknown>, env: Record<string, string>, toolName = 'Edit') {
  const started = Date.now();
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: ROOT }),
    env: { ...(process.env as Record<string, string>), STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: S, CLAUDE_PROJECT_DIR: ROOT, ...env },
    encoding: 'utf8',
  });
  return { code: r.status, err: r.stderr, ms: Date.now() - started };
}

const locked = join(ROOT, 'src', 'locked.py'); // absolute, with Windows backslashes, as Claude Code sends it
const bob = hook({ file_path: locked, old_string: 'a', new_string: 'b' }, { TANDEM_WORKER_ID: 'w-bob' });
check('another worker editing a locked file is blocked (exit 2)', bob.code === 2, bob);
check('the block message names the file and the task, and says what to do', /src\/locked\.py/.test(bob.err) && /t1/.test(bob.err) && /report_progress/.test(bob.err), bob.err);
check('the check is fast (under 2 seconds)', bob.ms < 2000, bob.ms);
check('Write is blocked too', hook({ file_path: locked, content: 'x' }, { TANDEM_WORKER_ID: 'w-bob' }, 'Write').code === 2);
check('a relative path is resolved against the repo root', hook({ file_path: 'src/locked.py' }, { TANDEM_WORKER_ID: 'w-bob' }).code === 2);
check('a worker with no id is blocked too (it never claimed the file)', hook({ file_path: locked }, { TANDEM_WORKER_ID: '' }).code === 2);
const alice = hook({ file_path: locked }, { TANDEM_WORKER_ID: 'w-alice' });
check('the lock holder may edit its own file (exit 0)', alice.code === 0, alice);
check('an unlocked file is allowed', hook({ file_path: join(ROOT, 'src', 'free.py') }, { TANDEM_WORKER_ID: 'w-bob' }).code === 0);
check('a file outside the repo is not our business', hook({ file_path: resolve('C:/Windows/temp/x.txt') }, { TANDEM_WORKER_ID: 'w-bob' }).code === 0);
check('a tool call without a file (Bash) is allowed', hook({ command: 'ls' }, { TANDEM_WORKER_ID: 'w-bob' }, 'Bash').code === 0);
const down = hook({ file_path: locked }, { TANDEM_WORKER_ID: 'w-bob', STDB_URI: 'ws://127.0.0.1:9' });
check('brain unreachable: the edit is allowed with a warning (fail open)', down.code === 0 && /unreachable/.test(down.err), down);
const other = hook({ file_path: locked }, { TANDEM_WORKER_ID: 'w-bob', TANDEM_SESSION: S + 'x' });
check('a lock in another session does not block', other.code === 0, other);

await conn.reducers.completeTask({ sessionId: S, workerId: 'w-alice', taskId: 't1', branch: 'b', summary: 's' });
await new Promise(r => setTimeout(r, 300));
check('after the task is done, the file is free again', hook({ file_path: locked }, { TANDEM_WORKER_ID: 'w-bob' }).code === 0);

conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
