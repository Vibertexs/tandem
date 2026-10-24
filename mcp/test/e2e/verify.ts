// Reads the brain after the e2e run and checks nothing collided.
// Usage: tsx verify.ts <path to e2e repo>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection, tables } from '../../../brain/bindings/index.js';

const repo = process.argv[2];
const session = process.env.TANDEM_SESSION;
if (!session) throw new Error('set TANDEM_SESSION');
const conn = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder()
    .withUri(process.env.STDB_URI ?? 'ws://127.0.0.1:3001')
    .withDatabaseName(process.env.STDB_DB ?? 'bilal-dev')
    .onConnect(c => {
      c.subscriptionBuilder().onApplied(() => resolve(c))
        .subscribe([tables.tasks, tables.locks, tables.events, tables.workers]);
    })
    .onConnectError((_c, e) => reject(e))
    .build();
});

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const micros = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch);

const events = [...conn.db.events.iter()].filter(e => e.sessionId === session).sort((a, b) => micros(a.timestamp) - micros(b.timestamp));
const t0 = events.length ? micros(events[0].timestamp) : 0;
console.log('\nTimeline:');
for (const e of events) {
  console.log(`  +${((micros(e.timestamp) - t0) / 1e6).toFixed(1).padStart(5)}s  ${e.type.padEnd(14)} ${e.message}`);
}
console.log('');

const tasks = new Map([...conn.db.tasks.iter()].filter(t => t.sessionId === session).map(t => [t.id, t]));
check('all 3 tasks are done', ['t1', 't2', 't3'].every(id => tasks.get(id)?.status === 'done'),
  [...tasks.values()].map(t => `${t.id}:${t.status}`));
check('no locks left behind', [...conn.db.locks.iter()].filter(l => l.sessionId === session).length === 0);
const workersUsed = new Set([...tasks.values()].map(t => t.assignee));
check('both workers did work', workersUsed.size === 2, [...workersUsed]);

// t1 and t2 share notes.txt: one must be finished before the other is claimed.
const claim = (id: string) => events.find(e => e.type === 'task_claimed' && e.message.endsWith(`: ${id}`));
const done = (id: string) => events.find(e => e.type === 'task_done' && e.message.endsWith(`: ${id}`));
const [c1, c2, d1, d2] = [claim('t1'), claim('t2'), done('t1'), done('t2')];
const noOverlap = !!(c1 && c2 && d1 && d2) &&
  (micros(d1.timestamp) <= micros(c2.timestamp) || micros(d2.timestamp) <= micros(c1.timestamp));
check('t1 and t2 (same file) did not overlap in time', noOverlap);

const notes = readFileSync(join(repo, 'notes.txt'), 'utf8').trim().split(/\r?\n/);
check('notes.txt has both lines, no lost write',
  notes.length === 2 && notes.includes('t1 was here') && notes.includes('t2 was here'), notes);
const other = readFileSync(join(repo, 'other.txt'), 'utf8').trim();
check('other.txt is correct', other === 't3 was here', other);

conn.disconnect();
console.log(failures === 0 ? '\nE2E PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
