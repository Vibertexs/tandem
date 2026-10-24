import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';
import seed from '../../../contract/seed.json';

// Tables follow contract/tables.md.
// Every row carries session_id. `pk` is "<session_id>/<id>" so ids only have to be
// unique inside one session (each judge gets their own session).
// Enum-like fields (plan, status, kind) are plain strings, checked in reducers.

const workers = table(
  { name: 'workers', public: true },
  {
    pk: t.string().primaryKey(),
    session_id: t.string().index('btree'),
    id: t.string(),
    name: t.string(),
    plan: t.string(), // pro | max
    status: t.string(), // idle | busy | capped
    usage_5h_pct: t.option(t.f64()),
    usage_week_pct: t.option(t.f64()),
    reset_at: t.option(t.timestamp()),
    last_seen: t.timestamp(),
  }
);

const tasks = table(
  { name: 'tasks', public: true },
  {
    pk: t.string().primaryKey(),
    session_id: t.string().index('btree'),
    id: t.string(),
    job_id: t.option(t.string()),
    kind: t.string(), // normal | map | reduce
    title: t.string(),
    description: t.string(),
    files: t.array(t.string()),
    difficulty: t.string(), // easy | normal | hard
    model: t.string(),
    effort: t.string(),
    status: t.string(), // open | blocked | claimed | done | failed
    assignee: t.option(t.string()), // when open: reserved for this worker
    branch: t.option(t.string()),
    depends_on: t.array(t.string()),
    result: t.option(t.string()), // JSON text; see contract/result-format.json
    result_summary: t.option(t.string()),
  }
);

// pk is "<session_id>/<path>", so the database itself refuses two holders of one file.
const locks = table(
  { name: 'locks', public: true },
  {
    pk: t.string().primaryKey(),
    session_id: t.string().index('btree'),
    path: t.string(),
    task_id: t.string().index('btree'),
    worker_id: t.string(),
    created_at: t.timestamp(),
  }
);

const events = table(
  { name: 'events', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    session_id: t.string().index('btree'),
    timestamp: t.timestamp(),
    worker_id: t.option(t.string()),
    type: t.string(),
    message: t.string(),
  }
);

const context = table(
  { name: 'context', public: true },
  {
    pk: t.string().primaryKey(),
    session_id: t.string().index('btree'),
    key: t.string(),
    value: t.string(),
  }
);

// What the operator asked for, in plain words. The manager Claude reads new goals, splits each
// into tasks, then marks it planned. status: new | planning | planned
const goals = table(
  { name: 'goals', public: true },
  {
    pk: t.string().primaryKey(),
    session_id: t.string().index('btree'),
    id: t.string(),
    text: t.string(),
    status: t.string(),
    created_at: t.timestamp(),
  }
);

// Who may control the real team session. Public so the dashboard can tell whether you are one.
const operators = table(
  { name: 'operators', public: true },
  {
    identity: t.identity().primaryKey(),
    added_at: t.timestamp(),
  }
);

const spacetimedb = schema({ workers, tasks, locks, events, context, goals, operators });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

const TaskInput = t.object('TaskInput', {
  id: t.string(),
  title: t.string(),
  description: t.string(),
  files: t.array(t.string()),
  difficulty: t.string(),
  model: t.string(),
  effort: t.string(),
  depends_on: t.array(t.string()),
});

const pk = (session: string, id: string) => `${session}/${id}`;

function checkSession(session: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(session)) throw new SenderError('bad session_id');
}

// In the real team session ("live") only operators may create tasks, write notes, seed or reset.
// Judge sandboxes (any other session) stay open to everyone. Worker actions (register, claim,
// lock, complete, heartbeat, report) are open in every session for now: there is no per-worker auth.
function requireOperator(ctx: Ctx, session: string) {
  if (session === 'live' && !ctx.db.operators.identity.find(ctx.sender)) {
    throw new SenderError('operator only');
  }
}

function addEvent(ctx: Ctx, session: string, workerId: string | undefined, type: string, message: string) {
  ctx.db.events.insert({ id: 0n, session_id: session, timestamp: ctx.timestamp, worker_id: workerId, type, message });
}

function freeLocksOf(ctx: Ctx, session: string, taskId: string) {
  for (const lock of [...ctx.db.locks.task_id.filter(taskId)]) {
    if (lock.session_id === session) ctx.db.locks.pk.delete(lock.pk);
  }
}

// Puts every task the worker is running back to `open` and frees its locks.
function requeueTasksOf(ctx: Ctx, session: string, workerId: string, type: string, message: string) {
  for (const task of [...ctx.db.tasks.session_id.filter(session)]) {
    if (task.status !== 'claimed' || task.assignee !== workerId) continue;
    freeLocksOf(ctx, session, task.id);
    ctx.db.tasks.pk.update({ ...task, status: 'open', assignee: undefined });
    addEvent(ctx, session, workerId, type, `${message}: ${task.title}`);
  }
}

// A worker that has not sent a heartbeat for this long is treated as dead.
// The MCP server sends one every 30 seconds while its session is alive.
const STALE_AFTER_SECONDS = 120n;

function reapStaleWorkers(ctx: Ctx, session: string, ttlSeconds: bigint) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const task of [...ctx.db.tasks.session_id.filter(session)]) {
    if (task.status !== 'claimed' || task.assignee === undefined) continue;
    const owner = ctx.db.workers.pk.find(pk(session, task.assignee));
    if (owner && now - owner.last_seen.microsSinceUnixEpoch <= ttlSeconds * 1_000_000n) continue;
    requeueTasksOf(ctx, session, task.assignee, 'lock_released',
      `${owner?.name ?? task.assignee} went silent. Released locks and reopened`);
    if (owner) {
      ctx.db.workers.pk.update({ ...owner, status: owner.status === 'busy' ? 'idle' : owner.status });
    }
  }
}

// Marks the caller as alive first (so it is never reaped by its own call), then reaps.
function touchAndReap(ctx: Ctx, session: string, workerId: string) {
  const worker = ctx.db.workers.pk.find(pk(session, workerId));
  if (!worker) return undefined;
  ctx.db.workers.pk.update({ ...worker, last_seen: ctx.timestamp });
  reapStaleWorkers(ctx, session, STALE_AFTER_SECONDS);
  return ctx.db.workers.pk.find(pk(session, workerId));
}

export const heartbeat = spacetimedb.reducer(
  { session_id: t.string(), worker_id: t.string() },
  (ctx, { session_id, worker_id }) => {
    if (!touchAndReap(ctx, session_id, worker_id)) throw new SenderError('unknown worker');
  }
);

// Test hook and manual cleanup. Anyone can call it, so the minimum is 1 second.
// TODO: restrict who may call this before the database is shared.
export const reapStale = spacetimedb.reducer(
  { session_id: t.string(), ttl_seconds: t.u32() },
  (ctx, { session_id, ttl_seconds }) => {
    requireOperator(ctx, session_id);
    reapStaleWorkers(ctx, session_id, BigInt(Math.max(1, ttl_seconds)));
  }
);

export const registerWorker = spacetimedb.reducer(
  { session_id: t.string(), id: t.string(), name: t.string(), plan: t.string() },
  (ctx, { session_id, id, name, plan }) => {
    checkSession(session_id);
    if (plan !== 'pro' && plan !== 'max') throw new SenderError('plan must be pro or max');
    const existing = ctx.db.workers.pk.find(pk(session_id, id));
    if (existing) {
      ctx.db.workers.pk.update({ ...existing, name, plan, last_seen: ctx.timestamp });
    } else {
      ctx.db.workers.insert({
        pk: pk(session_id, id), session_id, id, name, plan, status: 'idle',
        usage_5h_pct: undefined, usage_week_pct: undefined, reset_at: undefined, last_seen: ctx.timestamp,
      });
      addEvent(ctx, session_id, id, 'worker_idle', `${name} joined the team`);
    }
  }
);

function insertTask(
  ctx: Ctx, session: string,
  a: { id: string; title: string; description: string; files: string[]; difficulty: string;
       model: string; effort: string; depends_on: string[] },
  kind: string, jobId: string | undefined, assignee: string | undefined, status: string
) {
  if (ctx.db.tasks.pk.find(pk(session, a.id))) throw new SenderError(`task ${a.id} already exists`);
  ctx.db.tasks.insert({
    pk: pk(session, a.id), session_id: session, id: a.id, job_id: jobId, kind, title: a.title,
    description: a.description, files: a.files, difficulty: a.difficulty, model: a.model, effort: a.effort,
    status, assignee, branch: undefined, depends_on: a.depends_on, result: undefined, result_summary: undefined,
  });
}

// assign_task: creates a task. With an assignee, only that worker can claim it.
export const createTask = spacetimedb.reducer(
  {
    session_id: t.string(),
    task: TaskInput,
    kind: t.string(),
    job_id: t.option(t.string()),
    assignee: t.option(t.string()),
  },
  (ctx, { session_id, task, kind, job_id, assignee }) => {
    checkSession(session_id);
    requireOperator(ctx, session_id);
    if (!['normal', 'map', 'reduce'].includes(kind)) throw new SenderError('bad kind');
    for (const dep of task.depends_on) {
      if (!ctx.db.tasks.pk.find(pk(session_id, dep))) throw new SenderError(`unknown dependency ${dep}`);
    }
    if (assignee !== undefined && !ctx.db.workers.pk.find(pk(session_id, assignee))) {
      throw new SenderError(`unknown worker ${assignee}`);
    }
    insertTask(ctx, session_id, task, kind, job_id, assignee, task.depends_on.length > 0 ? 'blocked' : 'open');
    addEvent(ctx, session_id, assignee, assignee ? 'task_assigned' : 'task_created', `Task created: ${task.title}`);
  }
);

// create_job: the map tasks, plus one merge task that stays blocked until every map task is done.
export const createJob = spacetimedb.reducer(
  {
    session_id: t.string(),
    job_id: t.string(),
    goal: t.string(),
    map_tasks: t.array(TaskInput),
    merge_task: TaskInput,
  },
  (ctx, { session_id, job_id, goal, map_tasks, merge_task }) => {
    checkSession(session_id);
    requireOperator(ctx, session_id);
    if (map_tasks.length === 0) throw new SenderError('a job needs at least one map task');
    for (const m of map_tasks) insertTask(ctx, session_id, { ...m, depends_on: [] }, 'map', job_id, undefined, 'open');
    insertTask(ctx, session_id, { ...merge_task, depends_on: map_tasks.map(m => m.id) }, 'reduce', job_id, undefined, 'blocked');
    addEvent(ctx, session_id, undefined, 'task_created', `Job started: ${goal} (${map_tasks.length} pieces + 1 merge)`);
  }
);

// One transaction does all of: pick a task, check its files are free, take the
// locks, mark it claimed. Two concurrent callers cannot both succeed.
// If nothing can be claimed, this does nothing; callers read the tasks table.
export const claimTask = spacetimedb.reducer(
  { session_id: t.string(), worker_id: t.string() },
  (ctx, { session_id, worker_id }) => {
    const worker = touchAndReap(ctx, session_id, worker_id);
    if (!worker) throw new SenderError('unknown worker');
    if (worker.status === 'capped') throw new SenderError('worker is capped');
    const mine = [...ctx.db.tasks.session_id.filter(session_id)];
    if (mine.some(x => x.status === 'claimed' && x.assignee === worker_id)) {
      throw new SenderError('worker already has a task');
    }

    // "Best" task for the POC = a task reserved for this worker first, then the first
    // open task. Open tasks come out in insertion order. Files must all be free.
    const candidates = [
      ...mine.filter(x => x.status === 'open' && x.assignee === worker_id),
      ...mine.filter(x => x.status === 'open' && x.assignee === undefined),
    ];
    for (const task of candidates) {
      if (task.files.some(p => ctx.db.locks.pk.find(pk(session_id, p)))) continue;
      for (const path of task.files) {
        ctx.db.locks.insert({
          pk: pk(session_id, path), session_id, path, task_id: task.id, worker_id, created_at: ctx.timestamp,
        });
      }
      ctx.db.tasks.pk.update({ ...task, status: 'claimed', assignee: worker_id });
      ctx.db.workers.pk.update({ ...worker, status: 'busy', last_seen: ctx.timestamp });
      addEvent(ctx, session_id, worker_id, 'task_claimed', `${worker.name} claimed: ${task.title}`);
      return;
    }
  }
);

export const completeTask = spacetimedb.reducer(
  {
    session_id: t.string(),
    worker_id: t.string(),
    task_id: t.string(),
    branch: t.string(),
    summary: t.string(),
    result: t.option(t.string()),
  },
  (ctx, { session_id, worker_id, task_id, branch, summary, result }) => {
    const task = ctx.db.tasks.pk.find(pk(session_id, task_id));
    if (!task) throw new SenderError('unknown task');
    if (task.status !== 'claimed' || task.assignee !== worker_id) {
      throw new SenderError('task is not claimed by this worker');
    }
    ctx.db.tasks.pk.update({ ...task, status: 'done', branch, result, result_summary: summary });
    freeLocksOf(ctx, session_id, task_id);
    const worker = ctx.db.workers.pk.find(pk(session_id, worker_id));
    if (worker) {
      ctx.db.workers.pk.update({
        ...worker,
        status: worker.status === 'busy' ? 'idle' : worker.status,
        last_seen: ctx.timestamp,
      });
    }
    addEvent(ctx, session_id, worker_id, 'task_done', `Done: ${task.title}`);

    // Open anything that was waiting on this task. A task only moves
    // blocked -> open once, so a merge task cannot open twice.
    const all = [...ctx.db.tasks.session_id.filter(session_id)];
    const doneIds = new Set(all.filter(x => x.status === 'done').map(x => x.id));
    for (const other of all) {
      if (other.status !== 'blocked') continue;
      if (!other.depends_on.every(d => doneIds.has(d))) continue;
      ctx.db.tasks.pk.update({ ...other, status: 'open' });
      const merge = other.kind === 'reduce';
      addEvent(ctx, session_id, undefined, merge ? 'merge_unblocked' : 'task_created',
        merge ? `Merge task unlocked: ${other.title}` : `Unblocked: ${other.title}`);
    }
    if (task.job_id !== undefined) {
      const maps = all.filter(x => x.job_id === task.job_id && x.kind === 'map');
      const finished = maps.filter(x => doneIds.has(x.id)).length;
      addEvent(ctx, session_id, worker_id, 'job_progress', `Job progress: ${finished}/${maps.length}`);
    }
  }
);

// All paths or none: if any path is held by another task, the whole call
// fails and the transaction rolls back, so no partial locks are left behind.
export const takeLocks = spacetimedb.reducer(
  { session_id: t.string(), worker_id: t.string(), task_id: t.string(), paths: t.array(t.string()) },
  (ctx, { session_id, worker_id, task_id, paths }) => {
    touchAndReap(ctx, session_id, worker_id);
    const task = ctx.db.tasks.pk.find(pk(session_id, task_id));
    if (!task || task.status !== 'claimed' || task.assignee !== worker_id) {
      throw new SenderError('task is not claimed by this worker');
    }
    for (const path of paths) {
      const held = ctx.db.locks.pk.find(pk(session_id, path));
      if (held && held.task_id !== task_id) {
        throw new SenderError(`${path} is held by task ${held.task_id}`);
      }
    }
    for (const path of paths) {
      if (!ctx.db.locks.pk.find(pk(session_id, path))) {
        ctx.db.locks.insert({
          pk: pk(session_id, path), session_id, path, task_id, worker_id, created_at: ctx.timestamp,
        });
      }
    }
    addEvent(ctx, session_id, worker_id, 'lock_taken', `Locked ${paths.length} file(s) for ${task.title}`);
  }
);

export const releaseLocks = spacetimedb.reducer(
  { session_id: t.string(), worker_id: t.string(), task_id: t.string() },
  (ctx, { session_id, worker_id, task_id }) => {
    const task = ctx.db.tasks.pk.find(pk(session_id, task_id));
    if (!task || task.assignee !== worker_id) {
      throw new SenderError('task is not assigned to this worker');
    }
    freeLocksOf(ctx, session_id, task_id);
    addEvent(ctx, session_id, worker_id, 'lock_released', `Released locks for ${task.title}`);
  }
);

export const reportProgress = spacetimedb.reducer(
  { session_id: t.string(), worker_id: t.string(), task_id: t.string(), message: t.string() },
  (ctx, { session_id, worker_id, task_id, message }) => {
    const task = ctx.db.tasks.pk.find(pk(session_id, task_id));
    if (!task) throw new SenderError('unknown task');
    touchAndReap(ctx, session_id, worker_id);
    addEvent(ctx, session_id, worker_id, 'progress', `${task.title}: ${message}`);
  }
);

// report_capacity. `status` is optional. A usage of 100 or more caps the worker.
// A capped worker's running task is put back to `open` so someone else can take it.
export const updateCapacity = spacetimedb.reducer(
  {
    session_id: t.string(),
    worker_id: t.string(),
    usage_5h: t.option(t.f64()),
    usage_week: t.option(t.f64()),
    reset_at: t.option(t.timestamp()),
    status: t.option(t.string()),
  },
  (ctx, { session_id, worker_id, usage_5h, usage_week, reset_at, status }) => {
    const worker = ctx.db.workers.pk.find(pk(session_id, worker_id));
    if (!worker) throw new SenderError('unknown worker');
    for (const u of [usage_5h, usage_week]) {
      if (u !== undefined && (u < 0 || u > 100)) throw new SenderError('usage must be 0-100');
    }
    if (status !== undefined && !['idle', 'busy', 'capped'].includes(status)) throw new SenderError('bad status');

    let next = status ?? worker.status;
    if (status === undefined && usage_5h !== undefined && usage_5h >= 100) next = 'capped';
    const running = [...ctx.db.tasks.session_id.filter(session_id)]
      .some(x => x.status === 'claimed' && x.assignee === worker_id);
    if (next === 'capped') {
      requeueTasksOf(ctx, session_id, worker_id, 'worker_capped', `${worker.name} hit a limit. Task moved back to the queue`);
    } else if (next === 'idle' && running) {
      next = 'busy';
    }
    ctx.db.workers.pk.update({
      ...worker,
      status: next,
      usage_5h_pct: usage_5h ?? worker.usage_5h_pct,
      usage_week_pct: usage_week ?? worker.usage_week_pct,
      reset_at: reset_at ?? worker.reset_at,
      last_seen: ctx.timestamp,
    });
    if (next === 'capped' && worker.status !== 'capped') {
      addEvent(ctx, session_id, worker_id, 'worker_capped', `${worker.name} is capped`);
    } else if (next === 'idle' && worker.status !== 'idle') {
      addEvent(ctx, session_id, worker_id, 'worker_idle', `${worker.name} is idle`);
    }
  }
);

export const setContext = spacetimedb.reducer(
  { session_id: t.string(), key: t.string(), value: t.string() },
  (ctx, { session_id, key, value }) => {
    checkSession(session_id);
    requireOperator(ctx, session_id);
    const row = ctx.db.context.pk.find(pk(session_id, key));
    if (row) ctx.db.context.pk.update({ ...row, value });
    else ctx.db.context.insert({ pk: pk(session_id, key), session_id, key, value });
  }
);

// Wipes one session, then loads the workers and context from contract/seed.json.
// Tasks are NOT loaded here: the scenario buttons add them with seed_tasks.
export const resetSession = spacetimedb.reducer(
  { session_id: t.string() },
  (ctx, { session_id }) => {
    checkSession(session_id);
    requireOperator(ctx, session_id);
    for (const r of [...ctx.db.workers.session_id.filter(session_id)]) ctx.db.workers.pk.delete(r.pk);
    for (const r of [...ctx.db.tasks.session_id.filter(session_id)]) ctx.db.tasks.pk.delete(r.pk);
    for (const r of [...ctx.db.locks.session_id.filter(session_id)]) ctx.db.locks.pk.delete(r.pk);
    for (const r of [...ctx.db.events.session_id.filter(session_id)]) ctx.db.events.id.delete(r.id);
    for (const r of [...ctx.db.context.session_id.filter(session_id)]) ctx.db.context.pk.delete(r.pk);
    for (const r of [...ctx.db.goals.session_id.filter(session_id)]) ctx.db.goals.pk.delete(r.pk);
    for (const w of seed.workers) {
      ctx.db.workers.insert({
        pk: pk(session_id, w.id), session_id, id: w.id, name: w.name, plan: w.plan, status: w.status,
        usage_5h_pct: w.usage_5h_pct ?? undefined, usage_week_pct: w.usage_week_pct ?? undefined,
        reset_at: undefined, last_seen: ctx.timestamp,
      });
    }
    for (const [key, value] of Object.entries(seed.context)) {
      ctx.db.context.insert({ pk: pk(session_id, key), session_id, key, value });
    }
    addEvent(ctx, session_id, undefined, 'task_created', 'Session reset');
  }
);

// Adds the seed tasks of one group. 'demo' = the login goal (t-login-*),
// 'review' = the 12-piece map-reduce job (t-review-*). Existing tasks are left alone.
export const seedTasks = spacetimedb.reducer(
  { session_id: t.string(), group: t.string() },
  (ctx, { session_id, group }) => {
    checkSession(session_id);
    requireOperator(ctx, session_id);
    if (group !== 'demo' && group !== 'review') throw new SenderError('group must be demo or review');
    const wanted = seed.tasks.filter(x => (group === 'review' ? x.job_id === 'job-review' : x.job_id === null));
    let added = 0;
    for (const s of wanted) {
      if (ctx.db.tasks.pk.find(pk(session_id, s.id))) continue;
      insertTask(ctx, session_id, s, s.kind, s.job_id ?? undefined, undefined, s.status);
      added++;
    }
    addEvent(ctx, session_id, undefined, 'task_created',
      group === 'review' ? `Map-reduce job started: ${added} tasks` : `Demo goal started: ${added} tasks`);
  }
);

// The first caller becomes the operator. After that, only operators can add or remove operators.
export const claimOperator = spacetimedb.reducer(ctx => {
  if ([...ctx.db.operators.iter()].length > 0) throw new SenderError('an operator already exists');
  ctx.db.operators.insert({ identity: ctx.sender, added_at: ctx.timestamp });
});

export const addOperator = spacetimedb.reducer(
  { identity: t.identity() },
  (ctx, { identity }) => {
    if (!ctx.db.operators.identity.find(ctx.sender)) throw new SenderError('operator only');
    if (!ctx.db.operators.identity.find(identity)) ctx.db.operators.insert({ identity, added_at: ctx.timestamp });
  }
);

export const removeOperator = spacetimedb.reducer(
  { identity: t.identity() },
  (ctx, { identity }) => {
    if (!ctx.db.operators.identity.find(ctx.sender)) throw new SenderError('operator only');
    if ([...ctx.db.operators.iter()].length <= 1) throw new SenderError('cannot remove the last operator');
    ctx.db.operators.identity.delete(identity);
  }
);

// The operator types a goal. It waits as `new` until the manager Claude picks it up.
export const postGoal = spacetimedb.reducer(
  { session_id: t.string(), id: t.string(), text: t.string() },
  (ctx, { session_id, id, text }) => {
    checkSession(session_id);
    requireOperator(ctx, session_id);
    const clean = text.trim();
    if (clean.length === 0 || clean.length > 2000) throw new SenderError('a goal is 1 to 2000 characters');
    if (ctx.db.goals.pk.find(pk(session_id, id))) throw new SenderError(`goal ${id} already exists`);
    ctx.db.goals.insert({ pk: pk(session_id, id), session_id, id, text: clean, status: 'new', created_at: ctx.timestamp });
    addEvent(ctx, session_id, undefined, 'task_created', `Goal sent to the manager: ${clean.slice(0, 80)}`);
  }
);

export const setGoalStatus = spacetimedb.reducer(
  { session_id: t.string(), id: t.string(), status: t.string() },
  (ctx, { session_id, id, status }) => {
    requireOperator(ctx, session_id);
    if (!['new', 'planning', 'planned'].includes(status)) throw new SenderError('bad status');
    const goal = ctx.db.goals.pk.find(pk(session_id, id));
    if (!goal) throw new SenderError('unknown goal');
    ctx.db.goals.pk.update({ ...goal, status });
  }
);
