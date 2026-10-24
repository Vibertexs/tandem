// Drives every judge-mode scenario against the real brain from node, with the same simulator
// the browser uses (just faster). Needs the local server and bilal-dev published.
// Env: STDB_URI (default ws://127.0.0.1:3001), STDB_DB (default bilal-dev)
import { connect, makeApi, readSnapshot, type Snapshot } from '../src/brain';
import { newSimState, simStep } from '../src/sim';
import { runScenario } from '../src/scenarios';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

// A fresh session for each scenario, so they cannot affect each other.
async function open(label: string) {
  const session = `dash-${label}-${Date.now().toString(36)}`;
  const conn = await new Promise<ReturnType<typeof connect>>((resolve, reject) => {
    const c = connect(URI, DB, session, { change: () => {}, connected: () => resolve(c), error: reject });
  });
  const api = makeApi(conn, session);
  const snap = () => readSnapshot(conn, session);
  await api.reset();
  await sleep(400);
  const state = newSimState();
  // Runs the simulator until `until` is true. `watch` sees every snapshot.
  const drive = async (until: (s: Snapshot) => boolean, watch: (s: Snapshot) => void = () => {}, ms = 40_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = snap();
      watch(s);
      if (until(s)) return true;
      await simStep(api, s, state, Date.now(), () => 50, 10);
      await sleep(120);
    }
    return false;
  };
  return { conn, api, snap, drive, session };
}
const byId = (s: Snapshot) => new Map(s.tasks.map(t => [t.id, t]));

// 1. Run the demo
{
  const { conn, api, snap, drive } = await open('demo');
  check('reset: 3 seed teammates, no tasks yet', snap().workers.length === 3 && snap().tasks.length === 0);
  await runScenario('demo', api, snap());
  await sleep(400);
  check('demo: 4 login tasks, 3 of them blocked', snap().tasks.length === 4 && snap().tasks.filter(t => t.status === 'blocked').length === 3);
  const order: string[] = [];
  const seen = new Set<string>();
  const finished = await drive(s => s.tasks.length === 4 && s.tasks.every(t => t.status === 'done'), s => {
    for (const t of s.tasks) if (t.status === 'claimed' && !seen.has(t.id)) { seen.add(t.id); order.push(t.id); }
  });
  check('demo: all 4 tasks finish', finished, snap().tasks.map(t => `${t.id}:${t.status}`));
  check('demo: tasks start in dependency order (1, then 2 and 3, then 4)',
    order[0] === 't-login-1' && order[3] === 't-login-4' && new Set(order.slice(1, 3)).size === 2, order);
  check('demo: more than one teammate did work', new Set(snap().tasks.map(t => t.assignee)).size >= 2);
  conn.disconnect();
}

// 2. Run map-reduce
{
  const { conn, api, snap, drive } = await open('mr');
  await runScenario('mapreduce', api, snap());
  await sleep(400);
  check('mapreduce: 12 open pieces and a blocked merge task',
    snap().tasks.filter(t => t.kind === 'map' && t.status === 'open').length === 12 && byId(snap()).get('t-review-merge')?.status === 'blocked');
  let mergeStartedEarly = false;
  const finished = await drive(s => byId(s).get('t-review-merge')?.status === 'done', s => {
    const m = byId(s).get('t-review-merge');
    if (m && m.status === 'claimed' && s.tasks.filter(t => t.kind === 'map' && t.status !== 'done').length > 0) mergeStartedEarly = true;
  });
  check('mapreduce: the merge task finishes', finished);
  check('mapreduce: the merge task never started before all 12 pieces were done', !mergeStartedEarly);
  check('mapreduce: job progress reached 12/12', snap().events.some(e => e.type === 'job_progress' && e.message.endsWith('12/12')));
  check('mapreduce: the merge task opened exactly once', snap().events.filter(e => e.type === 'merge_unblocked').length === 1);
  check('mapreduce: pieces were spread over all three teammates', new Set(snap().tasks.filter(t => t.kind === 'map').map(t => t.assignee)).size === 3);
  conn.disconnect();
}

// 3. Make Sam hit a limit
{
  const { conn, api, snap, drive } = await open('limit');
  await runScenario('mapreduce', api, snap());
  const sam = snap().workers.find(w => w.name === 'Sam')!;
  await drive(s => s.tasks.some(t => t.status === 'claimed' && t.assignee === sam.id));
  const samTask = snap().tasks.find(t => t.status === 'claimed' && t.assignee === sam.id)!;
  check('limit: setup, Sam is running a task', !!samTask);
  await runScenario('limit', api, snap());
  await sleep(500);
  const after = snap();
  check('limit: Sam is capped at 100%', after.workers.find(w => w.id === sam.id)!.status === 'capped' && after.workers.find(w => w.id === sam.id)!.usage5h === 100);
  check('limit: his task is no longer his', byId(after).get(samTask.id)!.assignee !== sam.id);
  check('limit: a log line says so', after.events.some(e => e.type === 'worker_capped'));
  let samWorkedWhileCapped = false;
  const finished = await drive(s => byId(s).get(samTask.id)?.status === 'done', s => {
    if (s.tasks.some(t => t.status === 'claimed' && t.assignee === sam.id)) samWorkedWhileCapped = true;
  });
  check('limit: someone else finished the moved task', finished && byId(snap()).get(samTask.id)!.assignee !== sam.id);
  check('limit: Sam took no new work while capped', !samWorkedWhileCapped);
  conn.disconnect();
}

// 4. Two agents edit the same file
{
  const { conn, api, snap, drive } = await open('same');
  await runScenario('samefile', api, snap());
  let bothRunning = false;
  let sawWaiting = false;
  const finished = await drive(s => s.tasks.length === 2 && s.tasks.every(t => t.status === 'done'), s => {
    if (s.tasks.filter(t => t.status === 'claimed').length > 1) bothRunning = true;
    if (s.tasks.some(t => t.status === 'open') && s.tasks.some(t => t.status === 'claimed') && s.locks.length > 0) sawWaiting = true;
  });
  check('samefile: both tasks eventually finish', finished);
  check('samefile: they never ran at the same time', !bothRunning);
  check('samefile: one waited (open) while the other held the lock', sawWaiting);
  conn.disconnect();
}

// 5. Teammate goes idle
{
  const { conn, api, snap, drive } = await open('idle');
  await runScenario('idle', api, snap());
  await sleep(400);
  const urgent = snap().tasks.find(t => t.title === 'Urgent hotfix')!;
  const alex = snap().workers.find(w => w.name === 'Alex')!;
  check('idle: the busiest teammate (Alex, 62%) is set idle at low usage', alex.status === 'idle' && alex.usage5h === 5, alex);
  check('idle: an urgent task is reserved for them', urgent?.assignee === alex.id && urgent.status === 'open', urgent);
  const finished = await drive(s => byId(s).get(urgent.id)?.status === 'done');
  check('idle: they pick it up and finish it', finished && byId(snap()).get(urgent.id)!.assignee === alex.id);
  conn.disconnect();
}

// 6. Reset
{
  const { conn, api, snap } = await open('reset');
  await runScenario('mapreduce', api, snap());
  await sleep(300);
  await runScenario('reset', api, snap());
  await sleep(500);
  const s = snap();
  check('reset: tasks, locks and old events are gone, seed teammates are back',
    s.tasks.length === 0 && s.locks.length === 0 && s.workers.length === 3 && s.events.length === 1, [s.tasks.length, s.locks.length, s.workers.length, s.events.length]);
  conn.disconnect();
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
