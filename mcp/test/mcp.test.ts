// Calls every tool through the real MCP protocol (stdio), with separate server
// processes standing in for separate Claude sessions. Uses a fresh session id each run.
// Needs the local server on dev3001 with bilal-dev published:
//   spacetime publish bilal-dev --server dev3001 --no-config --module-path ./brain/spacetimedb --yes
// Env: STDB_URI (default ws://127.0.0.1:3001), STDB_DB (default bilal-dev)
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const S = `m-${Date.now().toString(36)}`;

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function session(name: string) {
  const client = new Client({ name, version: '1.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server.ts'],
    env: { ...(process.env as Record<string, string>), STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: S, HEARTBEAT_MS: '300' },
  }));
  const call = async (tool: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: r.isError === true, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, call };
}

// Test-only seeding of tasks with known ids and files.
const seed = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => {
      c.subscriptionBuilder().onApplied(() => resolve(c)).subscribe([tables.workers, tables.tasks, tables.locks]);
    })
    .onConnectError((_c, e) => reject(e)).build();
});
const newTask = (id: string, files: string[]) => seed.reducers.createTask({
  sessionId: S, kind: 'normal',
  task: { id, title: id, description: '', files, difficulty: 'normal', model: 'sonnet', effort: 'default', dependsOn: [] },
});
for (const [id, files] of [['t1', ['a.txt']], ['t2', ['a.txt']], ['t3', ['c.txt']]] as const) await newTask(id, [...files]);

const A = await session('alice');
const B = await session('bob');
const C = await session('manager'); // never registers: uses manager tools only

const tools = (await A.client.listTools()).tools.map(t => t.name).sort();
const all = ['assign_task', 'claim_task', 'complete_task', 'create_job', 'get_capacity', 'get_context', 'get_goals', 'get_job_results',
  'get_status', 'give_back_task', 'lock_files', 'mark_goal', 'register_worker', 'release_files', 'report_capacity', 'report_progress', 'set_context'];
check('tools: all 17 tools from contract/tools.json are listed', tools.join() === all.join(), tools);

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

// ---- the other 8 tools ----
const prog = await A.call('report_progress', { task_id: 't2', message: 'halfway there' });
check('report_progress', prog.data?.ok === true, prog.text);

await C.call('set_context', { key: 'decisions', value: 'use tabs' });
await C.call('set_context', { key: 'interfaces', value: 'POST /login' });
await sleep(300);
const ctx = await A.call('get_context');
check('set_context + get_context', ctx.data?.context?.decisions === 'use tabs' && ctx.data.context.interfaces === 'POST /login', ctx.text);

const cap = await B.call('report_capacity', { usage_5h: 55, usage_week: 20, reset_at: '2030-01-01T00:00:00.000Z' });
await sleep(300);
const gc = await C.call('get_capacity');
const bob = gc.data?.workers.find((w: { id: string }) => w.id === 'w-bob');
check('report_capacity + get_capacity', cap.data?.ok === true && bob?.usage_5h_pct === 55 && bob.usage_week_pct === 20 &&
  bob.reset_at === '2030-01-01T00:00:00.000Z' && gc.data.workers.length === 2, gc.text);

const job = await C.call('create_job', {
  goal: 'review', map_tasks: [{ title: 'review x', files: ['x.py'] }, { title: 'review y', files: ['y.py'] }],
  merge_task: { title: 'merge reviews', files: ['report.md'], difficulty: 'hard' },
});
await sleep(300);
st = await C.call('get_status');
const jobTasks = st.data.tasks.filter((t: { job_id: string | null }) => t.job_id === job.data?.job_id);
const merge = jobTasks.find((t: { kind: string }) => t.kind === 'reduce');
check('create_job: 2 open map tasks and a merge task blocked on both',
  jobTasks.length === 3 && jobTasks.filter((t: { kind: string; status: string }) => t.kind === 'map' && t.status === 'open').length === 2 &&
  merge?.status === 'blocked' && merge.depends_on.length === 2, st.text);

// Bob works through t3, then the job: each claim takes the next open task.
await B.call('complete_task', { task_id: 't3', branch: 'b', summary: 'c' });
for (let i = 0; i < 2; i++) {
  const c = await B.call('claim_task');
  const id = c.data?.task?.id;
  if (c.data?.task?.kind === 'map') {
    await B.call('complete_task', { task_id: id, branch: 'b', summary: 's', result: { status: 'ok', files_touched: [c.data.task.files[0]], findings: [], notes: id } });
  } else {
    await B.call('complete_task', { task_id: id, branch: 'b', summary: 's' });
  }
}
await sleep(400);
const jr = await A.call('get_job_results', { job_id: job.data?.job_id });
st = await A.call('get_status');
const mergeNow = st.data.tasks.find((t: { id: string }) => t.id === merge?.id);
check('get_job_results: returns both map results, parsed', jr.data?.results?.length === 2 && jr.data.results.every((r: { status: string }) => r.status === 'ok'), jr.text);
check('create_job: merge task opened after the last map task', mergeNow?.status === 'open', mergeNow);

const as = await C.call('assign_task', { task: { title: 'reserved', files: ['r.txt'], difficulty: 'easy' }, assignee: 'w-bob' });
await sleep(300);
st = await C.call('get_status');
const reserved = st.data.tasks.find((t: { id: string }) => t.id === as.data?.task_id);
check('assign_task: creates an open task reserved for the assignee', reserved?.status === 'open' && reserved.assignee === 'w-bob' && reserved.model === '', reserved);

// ---- goals ----
await seed.reducers.postGoal({ sessionId: S, id: 'g-old', text: 'First goal' });
await sleep(50);
await seed.reducers.postGoal({ sessionId: S, id: 'g-new', text: 'Second goal' });
await sleep(400);
const gg = await C.call('get_goals');
check('get_goals: returns the waiting goals, oldest first', gg.data?.goals?.map((g: { id: string }) => g.id).join() === 'g-old,g-new' && gg.data.goals[0].text === 'First goal', gg.text);
const mg = await C.call('mark_goal', { goal_id: 'g-old', status: 'planning' });
await sleep(300);
const gg2 = await C.call('get_goals');
check('mark_goal: a goal being planned is no longer returned as waiting', mg.data?.ok === true && gg2.data?.goals?.map((g: { id: string }) => g.id).join() === 'g-new', gg2.text);
const bad = await C.call('mark_goal', { goal_id: 'g-new', status: 'done' });
check('mark_goal: only planning or planned are accepted', bad.isError, bad.text);
const missing = await C.call('mark_goal', { goal_id: 'nope', status: 'planned' });
check('mark_goal: an unknown goal is an error', missing.isError, missing.text);

// ---- heartbeat and crash ----
const seen = (id: string) => [...seed.db.workers.iter()].find(w => w.sessionId === S && w.id === id)!.lastSeen.microsSinceUnixEpoch;
const before = seen('w-bob');
await sleep(1000);
check('heartbeat: last_seen advances while the session is idle', seen('w-bob') > before, [before, seen('w-bob')]);

const D = await session('dan');
await D.call('register_worker', { name: 'Dan', plan: 'pro' });
await newTask('t4', ['d.txt']);
await seed.reducers.createTask({
  sessionId: S, kind: 'normal', assignee: 'w-dan',
  task: { id: 't5', title: 't5', description: '', files: ['e.txt'], difficulty: 'normal', model: '', effort: 'default', dependsOn: [] },
});
await sleep(300);
const cd = await D.call('claim_task');
check('crash: setup, Dan holds t5 (reserved for him) and e.txt', cd.data?.task?.id === 't5', cd.text);
await D.client.close();
await sleep(2500); // Dan is gone and silent; Alice and Bob keep heartbeating
await seed.reducers.reapStale({ sessionId: S, ttlSeconds: 2 });
await sleep(500);
st = await A.call('get_status');
const t5 = st.data.tasks.find((t: { id: string }) => t.id === 't5');
const t2now = st.data.tasks.find((t: { id: string }) => t.id === 't2');
check('crash: Dan\'s task is open again and e.txt is free',
  t5.status === 'open' && !st.data.locks.some((l: { path: string }) => l.path === 'e.txt'), t5);
check('crash: Alice (alive) keeps her task', t2now.status === 'claimed' && t2now.assignee === 'w-alice', t2now);

// ---- giving a task back ----
const gb = await A.call('give_back_task', { task_id: 't2', reason: 'the spec is unclear' });
await sleep(300);
st = await A.call('get_status');
const t2back = st.data.tasks.find((t: { id: string }) => t.id === 't2');
check('give_back_task: the task is open again with its locks freed', gb.data?.ok === true && t2back.status === 'open' && t2back.assignee === null &&
  !st.data.locks.some((l: { task_id: string }) => l.task_id === 't2'), [gb.text, t2back]);
const next = await A.call('claim_task');
check('give_back_task: the worker that gave it back gets something else', next.data?.task?.id !== 't2', next.text);
const notMine = await B.call('give_back_task', { task_id: 't2', reason: 'x' });
check('give_back_task: only for a task you have', notMine.isError, notMine.text);

for (const s of [A, B, C]) await s.client.close();
seed.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
