// Run against an EMPTY dev database:
//   spacetime publish bilal-dev --server dev3001 --no-config --module-path ./spacetimedb --delete-data=always --yes
//   npm test
// Env: STDB_URI (default ws://127.0.0.1:3001), STDB_DB (default bilal-dev)
import { DbConnection, tables } from '../bindings/index.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect(c => {
        c.subscriptionBuilder()
          .onApplied(() => resolve(c))
          .subscribe([tables.workers, tables.tasks, tables.locks, tables.events]);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
}

const task = (id: string, files: string[], extra: Record<string, unknown> = {}) => ({
  id, jobId: undefined, kind: 'normal', title: id, description: '', files,
  difficulty: 'normal', model: 'sonnet', effort: 'default', dependsOn: [], ...extra,
});

const admin = await connect();
const N = 10;
const clients = await Promise.all(Array.from({ length: N }, connect));
const ids = clients.map((_, i) => `w${i}`);
await Promise.all(clients.map((c, i) => c.reducers.registerWorker({ id: ids[i], name: `Worker ${i}`, plan: 'pro' })));

// 1. Ten workers race for one task: exactly one winner.
await admin.reducers.createTask(task('t-race', ['race.txt']));
await Promise.allSettled(clients.map((c, i) => c.reducers.claimTask({ workerId: ids[i] })));
await sleep(500);
const raced = [...admin.db.tasks.iter()].find(t => t.id === 't-race')!;
const raceLocks = [...admin.db.locks.iter()].filter(l => l.taskId === 't-race');
const busy = [...admin.db.workers.iter()].filter(w => w.status === 'busy');
check('race: task is claimed', raced.status === 'claimed', raced.status);
check('race: exactly one lock row', raceLocks.length === 1, String(raceLocks.length));
check('race: exactly one busy worker', busy.length === 1, String(busy.length));
check('race: winner matches assignee', busy[0]?.id === raced.assignee, `${busy[0]?.id} vs ${raced.assignee}`);
const winner = clients[ids.indexOf(raced.assignee!)];

// 2. Overlapping files: a second task on the same file stays open until the first finishes.
await admin.reducers.createTask(task('t-overlap', ['race.txt']));
const other = clients[ids.findIndex(id => id !== raced.assignee)];
const otherId = ids.find(id => id !== raced.assignee)!;
await other.reducers.claimTask({ workerId: otherId });
await sleep(300);
const ov = [...admin.db.tasks.iter()].find(t => t.id === 't-overlap')!;
check('lock: overlapping task is not claimed while file is held', ov.status === 'open', ov.status);
await winner.reducers.completeTask({ workerId: raced.assignee!, taskId: 't-race', branch: 'b', summary: 's', result: undefined });
await sleep(300);
check('lock: locks released on complete', [...admin.db.locks.iter()].length === 0);
await other.reducers.claimTask({ workerId: otherId });
await sleep(300);
const ov2 = [...admin.db.tasks.iter()].find(t => t.id === 't-overlap')!;
check('lock: overlapping task claimable after release', ov2.status === 'claimed' && ov2.assignee === otherId, `${ov2.status}/${ov2.assignee}`);
await other.reducers.completeTask({ workerId: otherId, taskId: 't-overlap', branch: 'b', summary: 's', result: undefined });

// 3. Map-reduce: finish both map tasks at the same moment; the merge task opens exactly once.
for (const m of ['m1', 'm2']) await admin.reducers.createTask(task(m, [`${m}.txt`], { jobId: 'job', kind: 'map' }));
await admin.reducers.createTask(task('merge', ['report.md'], { jobId: 'job', kind: 'reduce', dependsOn: ['m1', 'm2'] }));
await sleep(300);
check('mapreduce: merge starts blocked', [...admin.db.tasks.iter()].find(t => t.id === 'merge')!.status === 'blocked');
await clients[0].reducers.claimTask({ workerId: ids[0] });
await clients[1].reducers.claimTask({ workerId: ids[1] });
await sleep(300);
const [a, b] = ['m1', 'm2'].map(id => [...admin.db.tasks.iter()].find(t => t.id === id)!);
await Promise.allSettled([
  clients[ids.indexOf(a.assignee!)].reducers.completeTask({ workerId: a.assignee!, taskId: 'm1', branch: 'b', summary: 's', result: '{"status":"ok"}' }),
  clients[ids.indexOf(b.assignee!)].reducers.completeTask({ workerId: b.assignee!, taskId: 'm2', branch: 'b', summary: 's', result: '{"status":"ok"}' }),
]);
await sleep(500);
const merge = [...admin.db.tasks.iter()].find(t => t.id === 'merge')!;
const unblocks = [...admin.db.events.iter()].filter(e => e.type === 'merge_unblocked');
check('mapreduce: merge is open', merge.status === 'open', merge.status);
check('mapreduce: merge_unblocked logged exactly once', unblocks.length === 1, String(unblocks.length));

// 4. take_locks is all-or-none; release_locks frees only that task's locks.
await clients[0].reducers.claimTask({ workerId: ids[0] }); // takes the open merge task
await sleep(300);
await clients[0].reducers.completeTask({ workerId: ids[0], taskId: 'merge', branch: 'b', summary: 's', result: undefined });
await admin.reducers.createTask(task('t-lk1', ['a.txt']));
await admin.reducers.createTask(task('t-lk2', ['b.txt']));
await sleep(300);
await clients[0].reducers.claimTask({ workerId: ids[0] });
await sleep(300);
await clients[1].reducers.claimTask({ workerId: ids[1] });
await sleep(300);
const lockPaths = () => [...admin.db.locks.iter()].map(l => l.path).sort().join(',');
check('take_locks: setup holds a.txt and b.txt', lockPaths() === 'a.txt,b.txt', lockPaths());
const rejected = await clients[1].reducers.takeLocks({ workerId: ids[1], taskId: 't-lk2', paths: ['x.txt', 'a.txt'] }).then(() => false, () => true);
await sleep(300);
check('take_locks: conflict is rejected', rejected);
check('take_locks: no partial locks after conflict', lockPaths() === 'a.txt,b.txt', lockPaths());
await clients[1].reducers.takeLocks({ workerId: ids[1], taskId: 't-lk2', paths: ['x.txt', 'y.txt'] });
await sleep(300);
check('take_locks: free paths are taken', lockPaths() === 'a.txt,b.txt,x.txt,y.txt', lockPaths());
await clients[1].reducers.releaseLocks({ workerId: ids[1], taskId: 't-lk2' });
await sleep(300);
check('release_locks: frees only that task', lockPaths() === 'a.txt', lockPaths());

// 5. A silent worker's locks are freed and its task reopened; live workers are untouched.
await admin.reducers.createTask(task('t-stale', ['s.txt']));
await sleep(300);
await clients[2].reducers.claimTask({ workerId: ids[2] });
await sleep(300);
check('stale: setup, w2 holds s.txt', lockPaths() === 'a.txt,s.txt', lockPaths());
await sleep(2500); // w2 stays silent; w0 and w1 prove they are alive
await clients[0].reducers.heartbeat({ workerId: ids[0] });
await clients[1].reducers.heartbeat({ workerId: ids[1] });
await admin.reducers.reapStale({ ttlSeconds: 2 });
await sleep(400);
const tasksNow = () => new Map([...admin.db.tasks.iter()].map(x => [x.id, x]));
const stale = tasksNow().get('t-stale')!;
check('stale: silent worker\'s task is open again', stale.status === 'open' && stale.assignee === undefined, `${stale.status}/${stale.assignee}`);
check('stale: its lock is freed, live worker\'s lock stays', lockPaths() === 'a.txt', lockPaths());
check('stale: live worker keeps its task', tasksNow().get('t-lk1')!.status === 'claimed' && tasksNow().get('t-lk1')!.assignee === ids[0]);
check('stale: silent worker is idle', [...admin.db.workers.iter()].find(w => w.id === ids[2])!.status === 'idle');
check('stale: event logged', [...admin.db.events.iter()].some(e => e.message.includes('went silent')));
const late = await clients[2].reducers.completeTask({ workerId: ids[2], taskId: 't-stale', branch: 'b', summary: 's', result: undefined }).then(() => false, () => true);
check('stale: the silent worker cannot complete the reopened task', late);
await clients[3].reducers.claimTask({ workerId: ids[3] });
await sleep(400);
check('stale: another worker can claim it', tasksNow().get('t-stale')!.assignee === ids[3], tasksNow().get('t-stale')!.assignee);

for (const c of [admin, ...clients]) c.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
