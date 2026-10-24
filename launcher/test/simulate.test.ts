// Two launchers in --simulate mode work through a small job: no Claude calls.
// Needs the local server on dev3001 with bilal-dev published. Uses a fresh session.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-dev';
const S = `ls-${Date.now().toString(36)}`;
const launcher = fileURLToPath(new URL('../launcher.ts', import.meta.url));

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  simulate: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

const conn = await new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.tasks, tables.events, tables.workers, tables.locks]); })
    .onConnectError((_c, e) => rej(e)).build();
});
const input = (id: string, files: string[], dependsOn: string[] = []) =>
  ({ id, title: id, description: '', files, difficulty: 'easy', model: '', effort: 'default', dependsOn });
await conn.reducers.createTask({ sessionId: S, kind: 'normal', task: input('a', ['a.py']) });
await conn.reducers.createTask({ sessionId: S, kind: 'normal', task: input('b', ['b.py']) });
await conn.reducers.createTask({ sessionId: S, kind: 'normal', task: input('c', ['a.py'], ['a']) });
await conn.reducers.createJob({ sessionId: S, jobId: 'j', goal: 'review', mapTasks: [input('m1', ['m1.py']), input('m2', ['m2.py'])], mergeTask: input('mm', ['report.md']) });

const run = (name: string) => new Promise<{ code: number; out: string }>(done => {
  const child = spawn(process.execPath, ['--import', 'tsx', launcher, '--name', name, '--simulate', '--exit-when-idle', '--poll', '1', '--sim-ms', '400'], {
    env: { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: S },
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  child.on('close', code => done({ code: code ?? 1, out }));
});
const started = Date.now();
const [x, y] = await Promise.all([run('Sam'), run('Omar')]);
await new Promise(r => setTimeout(r, 500));
console.log(x.out.trim() + '\n' + y.out.trim());

const tasks = [...conn.db.tasks.iter()].filter(t => t.sessionId === S);
check('both launchers exit by themselves when the work is done', x.code === 0 && y.code === 0 && Date.now() - started < 60_000, [x.code, y.code]);
check('every task is done (6, including the merge)', tasks.length === 6 && tasks.every(t => t.status === 'done'), tasks.map(t => `${t.id}:${t.status}`));
check('both launchers did work', new Set(tasks.map(t => t.assignee)).size === 2, [...new Set(tasks.map(t => t.assignee))]);
check('each task has a sim/<id> branch', tasks.every(t => t.branch === `sim/${t.id}`));
check('map pieces carry a structured result', tasks.filter(t => t.kind === 'map').every(t => t.result && JSON.parse(t.result).status === 'ok'));
check('progress was reported (started and halfway)', [...conn.db.events.iter()].filter(e => e.sessionId === S && e.type === 'progress').length === 12);
check('no locks left', [...conn.db.locks.iter()].filter(l => l.sessionId === S).length === 0);
check('a.py was never worked on twice at once (c waited for a)', (() => {
  const ev = [...conn.db.events.iter()].filter(e => e.sessionId === S).sort((p, q) => Number(p.id - q.id));
  const doneA = ev.findIndex(e => e.type === 'task_done' && e.message === 'Done: a');
  const claimC = ev.findIndex(e => e.type === 'task_claimed' && e.message.endsWith(': c'));
  return doneA >= 0 && claimC > doneA;
})());

// A usage limit: the worker is capped, its task goes back to the queue, it waits, then resumes.
{
  const L = `ll-${Date.now().toString(36)}`;
  await conn.reducers.createTask({ sessionId: L, kind: 'normal', task: input('z', ['z.py']) });
  const child = spawn(process.execPath, ['--import', 'tsx', launcher, '--name', 'Lim', '--simulate', '--exit-when-idle', '--poll', '1', '--sim-ms', '300', '--sim-limit', '4'], {
    env: { ...process.env, STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: L },
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  const exited = new Promise<number>(res => child.on('close', c => res(c ?? 1)));
  const lim = () => [...conn.db.workers.iter()].find(w => w.sessionId === L && w.id === 'w-lim');
  const z = () => [...conn.db.tasks.iter()].find(t => t.sessionId === L && t.id === 'z');
  let sawCapped = false;
  for (let i = 0; i < 40 && !sawCapped; i++) {
    await new Promise(r => setTimeout(r, 200));
    sawCapped = lim()?.status === 'capped' && z()?.status === 'open';
  }
  check('limit: the worker is capped and its task goes back to To do', sawCapped, [lim()?.status, z()?.status]);
  check('limit: it says when the limit resets', !!lim()?.resetAt && lim()!.resetAt!.toDate().getTime() > Date.now());
  const code = await exited;
  check('limit: after the reset it takes the task again and finishes it', code === 0 && z()?.status === 'done' && z()?.assignee === 'w-lim' && /back to work/.test(out), [code, z()?.status, out.slice(-200)]);
  check('limit: it ends uncapped', lim()?.status === 'idle', lim()?.status);
}

conn.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
