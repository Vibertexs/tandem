// For hook-real.ps1: Alice claims a task that locks notes.txt, so nobody else may edit it.
// Env: STDB_URI, STDB_DB, TANDEM_SESSION
import { DbConnection } from '../../../brain/bindings/index.js';

const session = process.env.TANDEM_SESSION!;
const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(process.env.STDB_URI ?? 'ws://127.0.0.1:3001').withDatabaseName(process.env.STDB_DB ?? 'bilal-dev')
    .onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build();
});
await conn.reducers.registerWorker({ sessionId: session, id: 'w-alice', name: 'Alice', plan: 'pro' });
await conn.reducers.createTask({
  sessionId: session, kind: 'normal',
  task: { id: 't-notes', title: 'Rewrite the notes', description: '', files: ['notes.txt'], difficulty: 'easy', model: '', effort: 'default', dependsOn: [] },
});
await conn.reducers.claimTask({ sessionId: session, workerId: 'w-alice' });
console.log(`hook setup: Alice holds notes.txt in session ${session}`);
conn.disconnect();
setTimeout(() => process.exit(0), 300);
