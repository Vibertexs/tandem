// Who may control the real team session ("live"). Publishes a FRESH dev database each run,
// because "the first caller becomes the operator" needs an empty one. Needs `spacetime` on PATH
// and the local server on dev3001. Run from brain/: npm run test:auth
import { execSync } from 'node:child_process';
import { DbConnection, tables } from '../bindings/index.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_AUTH_DB ?? 'bilal-auth';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

execSync(`spacetime publish ${DB} --server dev3001 --no-config --module-path ./spacetimedb --delete-data=always --yes`, { stdio: 'pipe' });

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const rejects = (p: Promise<unknown>) => p.then(() => false, () => true);

function client() {
  return new Promise<{ conn: DbConnection; identity: import('spacetimedb').Identity }>((resolve, reject) => {
    DbConnection.builder().withUri(URI).withDatabaseName(DB)
      .onConnect((c, identity) => {
        c.subscriptionBuilder().onApplied(() => resolve({ conn: c, identity }))
          .subscribe([tables.operators, tables.tasks, tables.context, tables.goals, tables.operatorRequests, tables.workers]);
      })
      .onConnectError((_c, e) => reject(e)).build();
  });
}

const a = await client();
const b = await client();
const task = (id: string) => ({ id, title: id, description: '', files: [`${id}.txt`], difficulty: 'normal', model: '', effort: 'default', dependsOn: [] });
const create = (c: DbConnection, session: string, id: string) =>
  c.reducers.createTask({ sessionId: session, task: task(id), kind: 'normal' });

check('before any operator: a stranger cannot create a task in the live session', await rejects(create(a.conn, 'live', 'x1')));
check('before any operator: judge sandboxes are open to everyone', !(await rejects(create(a.conn, 'judge-1', 'x1'))));
check('before any operator: a stranger cannot write notes or reset live',
  await rejects(a.conn.reducers.setContext({ sessionId: 'live', key: 'k', value: 'v' })) &&
  await rejects(a.conn.reducers.resetSession({ sessionId: 'live' })) &&
  await rejects(a.conn.reducers.seedTasks({ sessionId: 'live', group: 'demo' })));

check('before any operator: a stranger cannot post a goal in live', await rejects(a.conn.reducers.postGoal({ sessionId: 'live', id: 'g0', text: 'hi' })));
check('before any operator: goals are open in judge sandboxes', !(await rejects(a.conn.reducers.postGoal({ sessionId: 'judge-1', id: 'g0', text: 'hi' }))));

await a.conn.reducers.claimOperator({});
await sleep(300);
check('claim_operator: the first caller becomes the operator', [...a.conn.db.operators.iter()].length === 1);
check('claim_operator: nobody else can claim afterwards', await rejects(b.conn.reducers.claimOperator({})));

check('operator: can create a task in live', !(await rejects(create(a.conn, 'live', 'x2'))));
check('operator: can write notes in live', !(await rejects(a.conn.reducers.setContext({ sessionId: 'live', key: 'k', value: 'v' }))));
check('non-operator: still cannot create a task in live', await rejects(create(b.conn, 'live', 'x3')));
check('operator can post a goal in live, a non-operator cannot',
  !(await rejects(a.conn.reducers.postGoal({ sessionId: 'live', id: 'g1', text: 'Build it' }))) &&
  await rejects(b.conn.reducers.postGoal({ sessionId: 'live', id: 'g2', text: 'Build it' })) &&
  await rejects(b.conn.reducers.setGoalStatus({ sessionId: 'live', id: 'g1', status: 'planned' })));
check('non-operator: cannot add themselves as operator', await rejects(b.conn.reducers.addOperator({ identity: b.identity })));
check('non-operator: worker actions stay open in live (register_worker)', !(await rejects(b.conn.reducers.registerWorker({ sessionId: 'live', id: 'w-b', name: 'B', plan: 'pro' }))));

await a.conn.reducers.addOperator({ identity: b.identity });
await sleep(300);
check('add_operator: the operator can authorize another identity', [...a.conn.db.operators.iter()].length === 2);
check('add_operator: the new operator can now create a task in live', !(await rejects(create(b.conn, 'live', 'x4'))));
await sleep(300);
await a.conn.reducers.removeOperator({ identity: b.identity });
await sleep(300);
check('remove_operator: access is withdrawn', await rejects(create(b.conn, 'live', 'x5')));
check('remove_operator: the last operator cannot be removed', await rejects(a.conn.reducers.removeOperator({ identity: a.identity })));

// Ask to operate, approve, dismiss: no identities to copy around.
const c = await client();
const requests = () => [...a.conn.db.operatorRequests.iter()];
await b.conn.reducers.requestOperator({ name: 'Bob laptop' });
await b.conn.reducers.requestOperator({ name: '  Bob laptop (2)  ' });
await sleep(300);
check('request: asking twice keeps one request with the latest name', requests().length === 1 && requests()[0].name === 'Bob laptop (2)', requests().map(r => r.name));
check('request: a non-operator cannot approve itself', await rejects(b.conn.reducers.approveOperator({ identity: b.identity })));
await a.conn.reducers.approveOperator({ identity: b.identity });
await sleep(300);
const bRow = [...a.conn.db.operators.iter()].find(o => o.identity.isEqual(b.identity));
check('approve: the requester becomes an operator with its name, and the request is gone', bRow?.name === 'Bob laptop (2)' && requests().length === 0, bRow?.name);
check('approve: a missing request is an error', await rejects(a.conn.reducers.approveOperator({ identity: c.identity })));
await c.conn.reducers.requestOperator({ name: 'Stranger' });
await sleep(300);
check('dismiss: a non-operator cannot dismiss', await rejects(c.conn.reducers.dismissRequest({ identity: c.identity })));
await a.conn.reducers.dismissRequest({ identity: c.identity });
await sleep(300);
check('dismiss: the request is gone and they are not an operator', requests().length === 0 && ![...a.conn.db.operators.iter()].some(o => o.identity.isEqual(c.identity)));
await a.conn.reducers.requestOperator({ name: 'already' });
await sleep(200);
check('request: an operator asking is a no-op', requests().length === 0);
const owner = [...a.conn.db.operators.iter()].find(o => o.identity.isEqual(a.identity));
check('claim: the first operator is named Owner', owner?.name === 'Owner', owner?.name);

// Start over
await create(a.conn, 'live', 'x9');
await a.conn.reducers.postGoal({ sessionId: 'live', id: 'g9', text: 'again' });
await sleep(300);
const liveWorkers = () => [...a.conn.db.workers.iter()].filter(w => w.sessionId === 'live').length;
const workersBefore = liveWorkers();
check('clear: a non-operator cannot clear the board', await rejects(c.conn.reducers.clearBoard({ sessionId: 'live' })));
await a.conn.reducers.clearBoard({ sessionId: 'live' });
await sleep(400);
check('clear: tasks and goals are gone, the team stays',
  [...a.conn.db.tasks.iter()].filter(t => t.sessionId === 'live').length === 0 &&
  [...a.conn.db.goals.iter()].filter(g => g.sessionId === 'live').length === 0 && liveWorkers() === workersBefore && workersBefore > 0, workersBefore);

c.conn.disconnect();
a.conn.disconnect();
b.conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
