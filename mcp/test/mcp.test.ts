// Calls every tool through the real MCP protocol (stdio), with two server
// processes standing in for two Claude sessions.
// Needs the local server on dev3001 and an EMPTY bilal-dev database:
//   spacetime publish bilal-dev --server dev3001 --no-config --module-path ./brain/spacetimedb --delete-data=always --yes
// Env: STDB_URI (default ws://127.0.0.1:3001), STDB_DB (default bilal-dev)
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { DbConnection } from '../../brain/bindings/index.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

async function session(name: string) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server.ts'],
    env: { ...(process.env as Record<string, string>), STDB_URI: URI, STDB_DB: DB },
  }));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: r.isError === true, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, call };
}

// Test-only seeding. The 6 POC tools cannot create tasks (assign_task is a manager tool).
const seed = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => resolve(c)).onConnectError((_c, e) => reject(e)).build();
});
for (const [id, files] of [['t1', ['a.txt']], ['t2', ['a.txt']], ['t3', ['c.txt']]] as const) {
  await seed.reducers.createTask({
    id, jobId: undefined, kind: 'normal', title: id, description: '', files: [...files],
    difficulty: 'normal', model: 'sonnet', effort: 'default', dependsOn: [],
  });
}

const A = await session('alice');
const B = await session('bob');
const C = await session('nobody');

const tools = (await A.client.listTools()).tools.map(t => t.name).sort();
check('tools: exactly the 6 POC tools are listed',
  tools.join(',') === 'claim_task,complete_task,get_status,lock_files,register_worker,release_files', tools);

const noReg = await C.call('claim_task');
check('claim_task: error before register_worker', noReg.isError && /register_worker/.test(noReg.text), noReg.text);

const ra = await A.call('register_worker', { name: 'Alice', plan: 'pro' });
const rb = await B.call('register_worker', { name: 'Bob', plan: 'max' });
check('register_worker', ra.data?.worker_id === 'w-alice' && rb.data?.worker_id === 'w-bob', [ra.text, rb.text]);

const ca = await A.call('claim_task');
check('claim_task: Alice gets t1', ca.data?.task?.id === 't1' && ca.data.task.status === 'claimed', ca.text);
const cb = await B.call('claim_task');
check('claim_task: Bob skips t2 (a.txt is locked) and gets t3', cb.data?.task?.id === 't3', cb.text);

const l1 = await B.call('lock_files', { task_id: 't3', paths: ['a.txt', 'd.txt'] });
check('lock_files: conflict returns ok=false and held_by', l1.data?.ok === false && l1.data.held_by === 't1', l1.text);
const afterConflict = await A.call('get_status');
const heldAfterConflict = afterConflict.data.locks.map((l: { path: string }) => l.path).sort().join(',');
check('lock_files: the conflict left no partial lock (d.txt not taken)', heldAfterConflict === 'a.txt,c.txt', heldAfterConflict);
const l2 = await B.call('lock_files', { task_id: 't3', paths: ['d.txt'] });
check('lock_files: free path is locked', l2.data?.ok === true && l2.data.held_by === null, l2.text);

let st = await A.call('get_status');
const held = (st.data?.locks ?? []).map((l: { path: string }) => l.path).sort().join(',');
check('get_status: shows tasks and locks', st.data?.tasks.length === 3 && held === 'a.txt,c.txt,d.txt', st.text);

const rel = await B.call('release_files', { task_id: 't3' });
st = await A.call('get_status');
const heldAfter = st.data.locks.map((l: { path: string }) => l.path).join(',');
check('release_files: frees the task locks', rel.data?.ok === true && heldAfter === 'a.txt', [rel.text, heldAfter]);

const again = await B.call('claim_task');
check('claim_task: a worker with a task cannot claim another', again.isError, again.text);

const done = await A.call('complete_task', { task_id: 't1', branch: 'bilal/x', summary: 'did it', result: { status: 'ok' } });
st = await A.call('get_status');
const t1 = st.data.tasks.find((t: { id: string }) => t.id === 't1');
check('complete_task: marks done, stores result, frees locks',
  done.data?.ok === true && t1.status === 'done' && t1.result?.status === 'ok' && st.data.locks.length === 0, st.text);

const wrong = await A.call('complete_task', { task_id: 't3', branch: 'b', summary: 's' });
check('complete_task: cannot complete another worker\'s task', wrong.isError, wrong.text);

const c2 = await A.call('claim_task');
check('claim_task: t2 is claimable once a.txt is free', c2.data?.task?.id === 't2', c2.text);

for (const s of [A, B, C]) await s.client.close();
seed.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
