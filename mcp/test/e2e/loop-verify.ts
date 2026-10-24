// Checks the full loop. Usage: tsx loop-verify.ts plan|done <repo path>
//   plan: the manager turned the goal into sensible tasks
//   done: two workers finished them without colliding, and the files exist
// Env: STDB_URI, STDB_DB (session is always "live")
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DbConnection, tables } from '../../../brain/bindings/index.js';

const [phase, repo] = process.argv.slice(2);
const S = 'live';
const conn = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder()
    .withUri(process.env.STDB_URI ?? 'ws://127.0.0.1:3001')
    .withDatabaseName(process.env.STDB_DB!)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => resolve(c)).subscribe([tables.tasks, tables.locks, tables.events, tables.goals]); })
    .onConnectError((_c, e) => reject(e))
    .build();
});

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${phase}: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const micros = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch);

const tasks = [...conn.db.tasks.iter()].filter(t => t.sessionId === S);
const goals = [...conn.db.goals.iter()].filter(g => g.sessionId === S);
const byId = new Map(tasks.map(t => [t.id, t]));

// Does a depend on b, directly or through other tasks?
const dependsOn = (a: string, b: string, seen = new Set<string>()): boolean => {
  if (seen.has(a)) return false;
  seen.add(a);
  return (byId.get(a)?.dependsOn ?? []).some(d => d === b || dependsOn(d, b, seen));
};
const sharing: [string, string, string][] = [];
for (const x of tasks) for (const y of tasks) {
  if (x.id >= y.id) continue;
  const f = x.files.find(p => y.files.includes(p));
  if (f) sharing.push([x.id, y.id, f]);
}

console.log(`\nTasks (${tasks.length}):`);
for (const t of tasks) console.log(`  ${t.id}  [${t.status}]  ${t.title}  files=${t.files.join(',')}  after=${t.dependsOn.join(',') || '-'}  by=${t.assignee ?? '-'}`);

if (phase === 'plan') {
  check('the goal is marked planned', goals.length === 1 && goals[0].status === 'planned', goals.map(g => g.status));
  check('it became at least 2 tasks', tasks.length >= 2, tasks.length);
  check('every task lists the files it will touch', tasks.every(t => t.files.length > 0));
  check('tasks that share a file are ordered by a dependency', sharing.every(([a, b]) => dependsOn(a, b) || dependsOn(b, a)), sharing);
  check('some tasks can run in parallel (not one long chain)', tasks.some(t => t.dependsOn.length === 0) && tasks.filter(t => t.dependsOn.length === 0).length >= 2,
    tasks.map(t => `${t.id}<-${t.dependsOn.join('|')}`));
} else {
  const events = [...conn.db.events.iter()].filter(e => e.sessionId === S).sort((a, b) => micros(a.timestamp) - micros(b.timestamp));
  const t0 = events.length ? micros(events[0].timestamp) : 0;
  console.log('\nTimeline:');
  for (const e of events) console.log(`  +${((micros(e.timestamp) - t0) / 1e6).toFixed(1).padStart(6)}s  ${e.type.padEnd(15)} ${e.message}`);
  console.log('');

  check('every task is done', tasks.length > 0 && tasks.every(t => t.status === 'done'), tasks.map(t => `${t.id}:${t.status}`));
  check('no locks are left behind', [...conn.db.locks.iter()].filter(l => l.sessionId === S).length === 0);
  check('both workers did work', new Set(tasks.map(t => t.assignee)).size >= 2, [...new Set(tasks.map(t => t.assignee))]);
  const window = (title: string) => {
    const c = events.find(e => e.type === 'task_claimed' && e.message.endsWith(`: ${title}`));
    const d = events.find(e => e.type === 'task_done' && e.message === `Done: ${title}`);
    return c && d ? [micros(c.timestamp), micros(d.timestamp)] as const : null;
  };
  const overlaps = sharing.filter(([a, b]) => {
    const wa = window(byId.get(a)!.title), wb = window(byId.get(b)!.title);
    return !wa || !wb || (wa[0] < wb[1] && wb[0] < wa[1]);
  });
  check('tasks sharing a file never ran at the same time', overlaps.length === 0, overlaps);
  const missing = tasks.flatMap(t => t.files).filter(p => !existsSync(join(repo, p)));
  check('every planned file exists in the repo', missing.length === 0, missing);

  // The produced code: if there are Python tests, run them (in the throwaway repo).
  const pyTests = readdirSync(repo).filter(f => /^test.*\.py$/.test(f));
  if (pyTests.length > 0) {
    let ok = true; let out = '';
    try { out = execFileSync('python', ['-I', '-m', 'unittest', 'discover', '-s', repo, '-t', repo], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { ok = false; out = String((e as { stderr?: string }).stderr ?? e); }
    check("the workers' own tests pass (python -m unittest)", ok, out.slice(-400));
  }
}

conn.disconnect();
console.log(failures === 0 ? `\n${phase.toUpperCase()} PASSED` : `\n${phase.toUpperCase()}: ${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
