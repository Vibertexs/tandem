// Creates the 3 e2e tasks. t1 and t2 touch the same file, so they must not overlap in time.
// Env: TANDEM_SESSION (required), STDB_URI, STDB_DB
import { DbConnection } from '../../../brain/bindings/index.js';

const session = process.env.TANDEM_SESSION;
if (!session) throw new Error('set TANDEM_SESSION');

const conn = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder()
    .withUri(process.env.STDB_URI ?? 'ws://127.0.0.1:3001')
    .withDatabaseName(process.env.STDB_DB ?? 'bilal-dev')
    .onConnect(c => resolve(c))
    .onConnectError((_c, e) => reject(e))
    .build();
});

const tasks = [
  { id: 't1', files: ['notes.txt'], description: 'Create notes.txt containing exactly one line: "t1 was here".' },
  { id: 't2', files: ['notes.txt'], description: 'Append one line to notes.txt: "t2 was here". Keep the existing lines.' },
  { id: 't3', files: ['other.txt'], description: 'Create other.txt containing exactly one line: "t3 was here".' },
];
for (const t of tasks) {
  await conn.reducers.createTask({
    sessionId: session, kind: 'normal',
    task: { ...t, title: t.id, difficulty: 'easy', model: 'haiku', effort: 'default', dependsOn: [] },
  });
}
conn.disconnect();
console.log('seeded', tasks.map(t => t.id).join(','), 'in session', session);
process.exit(0);
