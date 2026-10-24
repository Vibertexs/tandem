// Full-loop setup on a FRESH database: become the operator, authorize the manager's identity,
// and post the goal, exactly what a person does on the dashboard.
// Env: STDB_URI, STDB_DB, MANAGER_IDENTITY, GOAL_TEXT
import { Identity } from 'spacetimedb';
import { DbConnection } from '../../../brain/bindings/index.js';

const db = process.env.STDB_DB!;
const conn = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder()
    .withUri(process.env.STDB_URI ?? 'ws://127.0.0.1:3001')
    .withDatabaseName(db)
    .onConnect(c => resolve(c))
    .onConnectError((_c, e) => reject(e))
    .build();
});
await conn.reducers.claimOperator({});
await conn.reducers.addOperator({ identity: Identity.fromString(process.env.MANAGER_IDENTITY!) });
await conn.reducers.postGoal({ sessionId: 'live', id: 'g-loop', text: process.env.GOAL_TEXT! });
console.log(`setup: operator claimed, manager authorized, goal posted in ${db}/live`);
conn.disconnect();
setTimeout(() => process.exit(0), 300);
