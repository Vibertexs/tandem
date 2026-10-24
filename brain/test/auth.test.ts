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
          .subscribe([tables.operators, tables.tasks, tables.context]);
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

await a.conn.reducers.claimOperator({});
await sleep(300);
check('claim_operator: the first caller becomes the operator', [...a.conn.db.operators.iter()].length === 1);
check('claim_operator: nobody else can claim afterwards', await rejects(b.conn.reducers.claimOperator({})));

check('operator: can create a task in live', !(await rejects(create(a.conn, 'live', 'x2'))));
check('operator: can write notes in live', !(await rejects(a.conn.reducers.setContext({ sessionId: 'live', key: 'k', value: 'v' }))));
check('non-operator: still cannot create a task in live', await rejects(create(b.conn, 'live', 'x3')));
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

a.conn.disconnect();
b.conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
