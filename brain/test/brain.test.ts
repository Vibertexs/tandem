// Run against a local dev database (any contents; each run uses fresh session ids):
//   spacetime publish bilal-dev --server dev3001 --no-config --module-path ./spacetimedb --yes
//   npm test
// Env: STDB_URI (default ws://127.0.0.1:3001), STDB_DB (default bilal-dev)
import { DbConnection, tables } from '../bindings/index.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function connect(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB)
      .onConnect(c => {
        c.subscriptionBuilder()
          .onApplied(() => resolve(c))
          .subscribe([tables.workers, tables.tasks, tables.locks, tables.events, tables.context, tables.goals, tables.presence]);
      })
      .onConnectError((_c, e) => reject(e))
      .build();
  });
}

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const rejects = (p: Promise<unknown>) => p.then(() => false, () => true);

const run = Date.now().toString(36);
const S = `t-${run}`; // main session
const S2 = `u-${run}`; // second session, for isolation

const admin = await connect();
const view = (s: string) => ({
  tasks: () => new Map([...admin.db.tasks.iter()].filter(x => x.sessionId === s).map(x => [x.id, x])),
  locks: () => [...admin.db.locks.iter()].filter(x => x.sessionId === s),
  workers: () => new Map([...admin.db.workers.iter()].filter(x => x.sessionId === s).map(x => [x.id, x])),
  events: () => [...admin.db.events.iter()].filter(x => x.sessionId === s),
});
const main = view(S);
const lockPaths = () => main.locks().map(l => l.path).sort().join(',');

const input = (id: string, files: string[], dependsOn: string[] = []) => ({
  id, title: id, description: '', files, difficulty: 'normal', model: 'sonnet', effort: 'default', dependsOn,
});
const newTask = (s: string, id: string, files: string[], extra: { kind?: string; jobId?: string; assignee?: string; dependsOn?: string[] } = {}) =>
  admin.reducers.createTask({
    sessionId: s, task: input(id, files, extra.dependsOn), kind: extra.kind ?? 'normal',
    jobId: extra.jobId, assignee: extra.assignee,
  });
const done = (c: DbConnection, s: string, workerId: string, taskId: string, result?: string) =>
  c.reducers.completeTask({ sessionId: s, workerId, taskId, branch: 'b', summary: 's', result });

const N = 10;
const clients = await Promise.all(Array.from({ length: N }, connect));
const ids = clients.map((_, i) => `w${i}`);
await Promise.all(clients.map((c, i) => c.reducers.registerWorker({ sessionId: S, id: ids[i], name: `Worker ${i}`, plan: 'pro' })));

// 1. Ten workers race for one task: exactly one winner.
await newTask(S, 't-race', ['race.txt']);
await Promise.allSettled(clients.map((c, i) => c.reducers.claimTask({ sessionId: S, workerId: ids[i] })));
await sleep(500);
const raced = main.tasks().get('t-race')!;
const busy = [...main.workers().values()].filter(w => w.status === 'busy');
check('race: task is claimed', raced.status === 'claimed', raced.status);
check('race: exactly one lock row', main.locks().filter(l => l.taskId === 't-race').length === 1);
check('race: exactly one busy worker', busy.length === 1, busy.length);
check('race: winner matches assignee', busy[0]?.id === raced.assignee, `${busy[0]?.id} vs ${raced.assignee}`);
const winner = clients[ids.indexOf(raced.assignee!)];

// 2. Overlapping files: a second task on the same file stays open until the first finishes.
await newTask(S, 't-overlap', ['race.txt']);
const otherId = ids.find(id => id !== raced.assignee)!;
const other = clients[ids.indexOf(otherId)];
await other.reducers.claimTask({ sessionId: S, workerId: otherId });
await sleep(300);
check('lock: overlapping task is not claimed while file is held', main.tasks().get('t-overlap')!.status === 'open');
await done(winner, S, raced.assignee!, 't-race');
await sleep(300);
check('lock: locks released on complete', main.locks().length === 0);
await other.reducers.claimTask({ sessionId: S, workerId: otherId });
await sleep(300);
const ov = main.tasks().get('t-overlap')!;
check('lock: overlapping task claimable after release', ov.status === 'claimed' && ov.assignee === otherId, `${ov.status}/${ov.assignee}`);
await done(other, S, otherId, 't-overlap');

// 3. Map-reduce by hand: finish both map tasks at the same moment; the merge task opens exactly once.
for (const m of ['m1', 'm2']) await newTask(S, m, [`${m}.txt`], { jobId: 'job', kind: 'map' });
await newTask(S, 'merge', ['report.md'], { jobId: 'job', kind: 'reduce', dependsOn: ['m1', 'm2'] });
await sleep(300);
check('mapreduce: merge starts blocked', main.tasks().get('merge')!.status === 'blocked');
await clients[0].reducers.claimTask({ sessionId: S, workerId: ids[0] });
await clients[1].reducers.claimTask({ sessionId: S, workerId: ids[1] });
await sleep(300);
const [a, b] = ['m1', 'm2'].map(id => main.tasks().get(id)!);
await Promise.allSettled([
  done(clients[ids.indexOf(a.assignee!)], S, a.assignee!, 'm1', '{"status":"ok"}'),
  done(clients[ids.indexOf(b.assignee!)], S, b.assignee!, 'm2', '{"status":"ok"}'),
]);
await sleep(500);
check('mapreduce: merge is open', main.tasks().get('merge')!.status === 'open', main.tasks().get('merge')!.status);
check('mapreduce: merge_unblocked logged exactly once', main.events().filter(e => e.type === 'merge_unblocked').length === 1);
check('mapreduce: job_progress logged', main.events().some(e => e.type === 'job_progress' && e.message.endsWith('2/2')));

// 4. take_locks is all-or-none; release_locks frees only that task's locks.
await clients[0].reducers.claimTask({ sessionId: S, workerId: ids[0] }); // takes the open merge task
await sleep(300);
await done(clients[0], S, ids[0], 'merge');
await newTask(S, 't-lk1', ['a.txt']);
await newTask(S, 't-lk2', ['b.txt']);
await sleep(300);
await clients[0].reducers.claimTask({ sessionId: S, workerId: ids[0] });
await sleep(300);
await clients[1].reducers.claimTask({ sessionId: S, workerId: ids[1] });
await sleep(300);
check('take_locks: setup holds a.txt and b.txt', lockPaths() === 'a.txt,b.txt', lockPaths());
const conflict = await rejects(clients[1].reducers.takeLocks({ sessionId: S, workerId: ids[1], taskId: 't-lk2', paths: ['x.txt', 'a.txt'] }));
await sleep(300);
check('take_locks: conflict is rejected', conflict);
check('take_locks: no partial locks after conflict', lockPaths() === 'a.txt,b.txt', lockPaths());
await clients[1].reducers.takeLocks({ sessionId: S, workerId: ids[1], taskId: 't-lk2', paths: ['x.txt', 'y.txt'] });
await sleep(300);
check('take_locks: free paths are taken', lockPaths() === 'a.txt,b.txt,x.txt,y.txt', lockPaths());
await clients[1].reducers.releaseLocks({ sessionId: S, workerId: ids[1], taskId: 't-lk2' });
await sleep(300);
check('release_locks: frees only that task', lockPaths() === 'a.txt', lockPaths());

// 5. A silent worker's locks are freed and its task reopened; live workers are untouched.
await newTask(S, 't-stale', ['s.txt']);
await sleep(300);
await clients[2].reducers.claimTask({ sessionId: S, workerId: ids[2] });
await sleep(300);
check('stale: setup, w2 holds s.txt', lockPaths() === 'a.txt,s.txt', lockPaths());
await sleep(2500); // w2 stays silent; w0 and w1 prove they are alive
await clients[0].reducers.heartbeat({ sessionId: S, workerId: ids[0] });
await clients[1].reducers.heartbeat({ sessionId: S, workerId: ids[1] });
await admin.reducers.reapStale({ sessionId: S, ttlSeconds: 2 });
await sleep(400);
const stale = main.tasks().get('t-stale')!;
check('stale: silent worker\'s task is open again', stale.status === 'open' && stale.assignee === undefined, `${stale.status}/${stale.assignee}`);
check('stale: its lock is freed, live worker\'s lock stays', lockPaths() === 'a.txt', lockPaths());
check('stale: live worker keeps its task', main.tasks().get('t-lk1')!.assignee === ids[0]);
check('stale: silent worker is idle', main.workers().get(ids[2])!.status === 'idle');
check('stale: the silent worker cannot complete the reopened task', await rejects(done(clients[2], S, ids[2], 't-stale')));
await clients[3].reducers.claimTask({ sessionId: S, workerId: ids[3] });
await sleep(400);
check('stale: another worker can claim it', main.tasks().get('t-stale')!.assignee === ids[3]);

// 6. Sessions are isolated: same ids and same file paths in another session do not clash.
await admin.reducers.registerWorker({ sessionId: S2, id: 'w0', name: 'Other', plan: 'max' });
await newTask(S2, 't-lk1', ['a.txt']);
await admin.reducers.claimTask({ sessionId: S2, workerId: 'w0' });
await sleep(400);
const s2 = view(S2);
check('sessions: same task id and file in another session is claimable', s2.tasks().get('t-lk1')?.status === 'claimed');
check('sessions: first session unchanged', main.tasks().get('t-lk1')!.assignee === ids[0] && main.locks().some(l => l.path === 'a.txt'));
check('sessions: no rows leak between sessions', [...s2.tasks().values()].length === 1 && s2.locks().length === 1);

// 7. create_job: map tasks open, merge task blocked on all of them.
await admin.reducers.createJob({
  sessionId: S, jobId: 'job2', goal: 'review',
  mapTasks: [input('j-a', ['ja.py']), input('j-b', ['jb.py']), input('j-c', ['jc.py'])],
  mergeTask: input('j-merge', ['report2.md']),
});
await sleep(400);
const jm = main.tasks().get('j-merge')!;
check('create_job: 3 open map tasks', ['j-a', 'j-b', 'j-c'].every(id => main.tasks().get(id)!.status === 'open' && main.tasks().get(id)!.kind === 'map'));
check('create_job: merge is blocked on all 3', jm.status === 'blocked' && jm.kind === 'reduce' && jm.dependsOn.join() === 'j-a,j-b,j-c', jm);

// 8. assign_task with an assignee reserves the task for that worker.
await newTask(S, 't-reserved', ['r.txt'], { assignee: ids[5] });
await sleep(300);
await clients[4].reducers.claimTask({ sessionId: S, workerId: ids[4] });
await sleep(300);
check('assign: other workers skip a reserved task', main.tasks().get('t-reserved')!.status === 'open');
await clients[5].reducers.claimTask({ sessionId: S, workerId: ids[5] });
await sleep(300);
check('assign: the reserved worker gets it first', main.tasks().get('t-reserved')!.assignee === ids[5]);

// 9. report_capacity: hitting 100% caps the worker and requeues their running task.
await clients[6].reducers.claimTask({ sessionId: S, workerId: ids[6] });
await sleep(300);
const w6task = [...main.tasks().values()].find(x => x.assignee === ids[6] && x.status === 'claimed')!;
check('capacity: setup, w6 is running a task', !!w6task);
await clients[6].reducers.updateCapacity({ sessionId: S, workerId: ids[6], usage5H: 100, usageWeek: 55, resetAt: undefined, status: undefined });
await sleep(400);
check('capacity: worker is capped with usage stored', main.workers().get(ids[6])!.status === 'capped' && main.workers().get(ids[6])!.usage5HPct === 100);
check('capacity: its task is back in the queue, locks freed', main.tasks().get(w6task.id)!.status === 'open' && !main.locks().some(l => l.taskId === w6task.id));
check('capacity: a capped worker cannot claim', await rejects(clients[6].reducers.claimTask({ sessionId: S, workerId: ids[6] })));
check('capacity: bad usage is rejected', await rejects(clients[6].reducers.updateCapacity({ sessionId: S, workerId: ids[6], usage5H: 150, usageWeek: undefined, resetAt: undefined, status: undefined })));
await clients[6].reducers.updateCapacity({ sessionId: S, workerId: ids[6], usage5H: 10, usageWeek: undefined, resetAt: undefined, status: 'idle' });
await sleep(300);
check('capacity: status idle with low usage un-caps the worker', main.workers().get(ids[6])!.status === 'idle');
await clients[6].reducers.updateCapacity({ sessionId: S, workerId: ids[6], usage5H: 100, usageWeek: undefined, resetAt: undefined, status: undefined });
await clients[6].reducers.updateCapacity({ sessionId: S, workerId: ids[6], usage5H: 0, usageWeek: undefined, resetAt: undefined, status: undefined });
await sleep(300);
check('capacity: reporting usage under 100 again un-caps it too (the limit reset)', main.workers().get(ids[6])!.status === 'idle');

// 10. progress and context.
await clients[0].reducers.reportProgress({ sessionId: S, workerId: ids[0], taskId: 't-lk1', message: 'halfway' });
await admin.reducers.setContext({ sessionId: S, key: 'decisions', value: 'use tabs' });
await admin.reducers.setContext({ sessionId: S, key: 'decisions', value: 'use spaces' });
await sleep(400);
check('progress: event logged', main.events().some(e => e.type === 'progress' && e.message.includes('halfway')));
const ctxRows = [...admin.db.context.iter()].filter(c => c.sessionId === S && c.key === 'decisions');
check('context: set twice keeps one row with the latest value', ctxRows.length === 1 && ctxRows[0].value === 'use spaces', ctxRows);

// 11. reset_session loads the seed workers and context; seed_tasks adds the scenario tasks.
const R = `r-${run}`;
await admin.reducers.resetSession({ sessionId: R });
await sleep(400);
const r = view(R);
check('reset: seed workers loaded (Alex, Sam, Jordan)', [...r.workers().values()].map(w => w.name).sort().join() === 'Alex,Jordan,Sam');
check('reset: seed context loaded', [...admin.db.context.iter()].some(c => c.sessionId === R && c.key === 'project_summary'));
await admin.reducers.seedTasks({ sessionId: R, group: 'demo' });
await admin.reducers.seedTasks({ sessionId: R, group: 'review' });
await admin.reducers.seedTasks({ sessionId: R, group: 'demo' }); // twice: nothing duplicated
await sleep(500);
const rt = [...r.tasks().values()];
check('seed_tasks: 4 login tasks + 12 review + 1 merge', rt.length === 17, rt.length);
check('seed_tasks: login-2 blocked on login-1, merge blocked on 12', r.tasks().get('t-login-2')!.status === 'blocked' && r.tasks().get('t-review-merge')!.dependsOn.length === 12);
await admin.reducers.claimTask({ sessionId: R, workerId: 'w-alex' });
await sleep(300);
await admin.reducers.resetSession({ sessionId: R });
await sleep(500);
check('reset: wipes tasks, locks and events of that session', r.tasks().size === 0 && r.locks().length === 0 && r.events().length === 1);
check('reset: other sessions are untouched', main.tasks().size > 5 && s2.tasks().size === 1);

// 12. Goals: the operator's plain-words request, waiting for the manager.
const G = `g-${run}`;
const goals = () => [...admin.db.goals.iter()].filter(g => g.sessionId === G);
await admin.reducers.postGoal({ sessionId: G, id: 'g1', text: '  Build a login page  ' });
await sleep(400);
check('goals: a posted goal is saved trimmed with status new', goals().length === 1 && goals()[0].text === 'Build a login page' && goals()[0].status === 'new', goals());
check('goals: an empty goal is rejected', await rejects(admin.reducers.postGoal({ sessionId: G, id: 'g2', text: '   ' })));
check('goals: the same id twice is rejected', await rejects(admin.reducers.postGoal({ sessionId: G, id: 'g1', text: 'again' })));
await admin.reducers.setGoalStatus({ sessionId: G, id: 'g1', status: 'planned' });
await sleep(300);
check('goals: the manager can mark it planned', goals()[0].status === 'planned');
check('goals: a bad status is rejected', await rejects(admin.reducers.setGoalStatus({ sessionId: G, id: 'g1', status: 'done' })));
check('goals: a log line tells the team', [...admin.db.events.iter()].some(e => e.sessionId === G && e.message.startsWith('Goal sent to the manager')));
await admin.reducers.resetSession({ sessionId: G });
await sleep(400);
check('goals: reset wipes them', goals().length === 0);

// 12b. Costs: a worker adds what its runs cost to its task; planning cost goes on the goal.
const K = `ct-${run}`;
const kv = view(K);
await admin.reducers.registerWorker({ sessionId: K, id: 'w-x', name: 'X', plan: 'pro' });
await admin.reducers.postGoal({ sessionId: K, id: 'g', text: 'costly' });
await admin.reducers.setGoalStatus({ sessionId: K, id: 'g', status: 'planning' });
await newTask(K, 'paid', ['p.txt']);
await admin.reducers.claimTask({ sessionId: K, workerId: 'w-x' });
await admin.reducers.recordCost({ sessionId: K, workerId: 'w-x', taskId: 'paid', usd: 0.03 });
await admin.reducers.recordCost({ sessionId: K, workerId: 'w-x', taskId: 'paid', usd: 0.02 });
await admin.reducers.addGoalCost({ sessionId: K, id: 'g', usd: 0.01 });
await sleep(400);
check('cost: a task adds up the cost of its runs', Math.abs(kv.tasks().get('paid')!.costUsd - 0.05) < 1e-9, kv.tasks().get('paid')!.costUsd);
check('cost: only the task\'s worker can add to it', await rejects(admin.reducers.recordCost({ sessionId: K, workerId: 'w-other', taskId: 'paid', usd: 1 })));
check('cost: nonsense amounts are ignored', !(await rejects(admin.reducers.recordCost({ sessionId: K, workerId: 'w-x', taskId: 'paid', usd: -5 }))) && Math.abs(kv.tasks().get('paid')!.costUsd - 0.05) < 1e-9);
check('cost: planning cost is kept on the goal', Math.abs([...admin.db.goals.iter()].find(g => g.sessionId === K)!.costUsd - 0.01) < 1e-9);

// 13. Tasks remember their goal; a goal can be finished with its branch; presence.
const H = `gl-${run}`;
const hv = view(H);
const goalRow = (id: string) => [...admin.db.goals.iter()].find(g => g.sessionId === H && g.id === id)!;
await admin.reducers.postGoal({ sessionId: H, id: 'g1', text: 'Build the calculator' });
await admin.reducers.postGoal({ sessionId: H, id: 'g2', text: 'Write the docs' });
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g1', status: 'planning' });
await newTask(H, 'c1', ['calc.py']);
await newTask(H, 'c2', ['test_calc.py'], { dependsOn: ['c1'] });
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g1', status: 'planned' });
await newTask(H, 'free', ['notes.md']);
await sleep(400);
check('goal link: tasks created while a goal is being planned belong to it', hv.tasks().get('c1')!.goalId === 'g1' && hv.tasks().get('c2')!.goalId === 'g1');
check('goal link: tasks created at other times belong to no goal', hv.tasks().get('free')!.goalId === '');
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g1', status: 'planning' });
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g2', status: 'planning' });
await sleep(300);
check('goal link: only one goal is planned at a time (starting g2 finishes planning g1)', goalRow('g1').status === 'planned' && goalRow('g2').status === 'planning');
await admin.reducers.finishGoal({ sessionId: H, id: 'g1', branch: 'tandem/g1', note: 'Tests pass (python -m unittest).' });
await sleep(300);
check('finish: the goal is done and remembers its branch and how it went', goalRow('g1').status === 'done' && goalRow('g1').branch === 'tandem/g1' && goalRow('g1').note === 'Tests pass (python -m unittest).');
check('finish: the log says where the work is', hv.events().some(e => e.message.includes('Goal done: Build the calculator') && e.message.includes('tandem/g1')));
await admin.reducers.failGoal({ sessionId: H, id: 'g2', note: 'Claude is not logged in' });
await sleep(300);
check('fail goal: a goal the manager could not plan is failed, with the reason', goalRow('g2').status === 'failed' && goalRow('g2').note === 'Claude is not logged in');
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g2', status: 'new' });
await sleep(300);
check('fail goal: sending it again makes it new and forgets the reason', goalRow('g2').status === 'new' && goalRow('g2').note === '');
// cancel: g3 has a running task and a waiting one
await admin.reducers.postGoal({ sessionId: H, id: 'g3', text: 'Something else' });
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g3', status: 'planning' });
await newTask(H, 'x1', ['x1.py']);
await newTask(H, 'x2', ['x2.py'], { dependsOn: ['x1'] });
await admin.reducers.setGoalStatus({ sessionId: H, id: 'g3', status: 'planned' });
await admin.reducers.registerWorker({ sessionId: H, id: 'w-h', name: 'H', plan: 'pro' });
await admin.reducers.claimTask({ sessionId: H, workerId: 'w-h' }); // takes c1 (first open)
await admin.reducers.cancelGoal({ sessionId: H, id: 'g3' });
await sleep(300);
check('cancel: the goal is cancelled and its tasks that had not started are removed', goalRow('g3').status === 'cancelled' && !hv.tasks().has('x1') && !hv.tasks().has('x2'), [goalRow('g3').status, [...hv.tasks().keys()]]);
check('cancel: other goals keep their tasks', hv.tasks().has('c1') && hv.tasks().has('c2'));
check('cancel: a goal that is done cannot be cancelled', await rejects(admin.reducers.cancelGoal({ sessionId: H, id: 'g1' })));
await clients[0].reducers.ping({ sessionId: H, name: 'Manager Claude', kind: 'manager' });
await sleep(200);
const first = [...admin.db.presence.iter()].filter(p => p.sessionId === H);
await clients[0].reducers.ping({ sessionId: H, name: 'Manager Claude', kind: 'manager' });
await sleep(300);
const again = [...admin.db.presence.iter()].filter(p => p.sessionId === H);
check('presence: a ping shows who is here, and pinging again updates the same row',
  first.length === 1 && again.length === 1 && again[0].kind === 'manager' && again[0].lastSeen.microsSinceUnixEpoch > first[0].lastSeen.microsSinceUnixEpoch);

// 14. Giving a task back: a different worker gets it; after two give-backs it needs a person.
const F = `gb-${run}`;
const fv = view(F);
const [fa, fb] = [clients[1], clients[2]];
await fa.reducers.registerWorker({ sessionId: F, id: 'w-a', name: 'Ann', plan: 'pro' });
await fb.reducers.registerWorker({ sessionId: F, id: 'w-b', name: 'Bo', plan: 'pro' });
await newTask(F, 'hard', ['hard.py']);
await fa.reducers.claimTask({ sessionId: F, workerId: 'w-a' });
check('give back: only the worker that has the task can give it back', await rejects(fb.reducers.giveBackTask({ sessionId: F, workerId: 'w-b', taskId: 'hard', reason: 'x' })));
await fa.reducers.giveBackTask({ sessionId: F, workerId: 'w-a', taskId: 'hard', reason: 'tests would not run' });
await sleep(300);
let hard = fv.tasks().get('hard')!;
check('give back: the task is open again, its locks are free, and the worker is idle',
  hard.status === 'open' && hard.assignee === undefined && fv.locks().length === 0 && fv.workers().get('w-a')!.status === 'idle', hard);
check('give back: the log says who gave it back and why', fv.events().some(e => e.type === 'task_failed' && e.message.includes('Ann gave back hard: tests would not run')));
await fa.reducers.claimTask({ sessionId: F, workerId: 'w-a' });
await sleep(300);
check('give back: the same worker does not get it again', fv.tasks().get('hard')!.status === 'open');
await fb.reducers.claimTask({ sessionId: F, workerId: 'w-b' });
await sleep(300);
check('give back: a different worker does', fv.tasks().get('hard')!.assignee === 'w-b');
await fb.reducers.giveBackTask({ sessionId: F, workerId: 'w-b', taskId: 'hard', reason: 'same problem' });
await sleep(300);
hard = fv.tasks().get('hard')!;
check('give back: after two workers gave it back, it is failed with the reason', hard.status === 'failed' && hard.resultSummary === 'same problem' && hard.triedBy === 'w-a,w-b', hard);
await admin.reducers.retryTask({ sessionId: F, taskId: 'hard' });
await sleep(300);
hard = fv.tasks().get('hard')!;
check('retry: an operator puts it back for anyone', hard.status === 'open' && hard.triedBy === '' && hard.resultSummary === undefined, hard);
check('retry: a task that did not fail cannot be retried', await rejects(admin.reducers.retryTask({ sessionId: F, taskId: 'hard' })));

for (const c of [admin, ...clients]) c.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
