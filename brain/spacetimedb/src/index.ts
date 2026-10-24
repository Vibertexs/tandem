import { schema, table, t, SenderError } from 'spacetimedb/server';
import type { InferSchema, ReducerCtx } from 'spacetimedb/server';

// Tables follow contract/tables.md. session_id is left out of the POC.
// Enum-like fields (plan, status, kind) are plain strings, checked in reducers.

const workers = table(
  { name: 'workers', public: true },
  {
    id: t.string().primaryKey(),
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
    id: t.string().primaryKey(),
    job_id: t.option(t.string()),
    kind: t.string(), // normal | map | reduce
    title: t.string(),
    description: t.string(),
    files: t.array(t.string()),
    difficulty: t.string(), // easy | normal | hard
    model: t.string(),
    effort: t.string(),
    status: t.string(), // open | blocked | claimed | done | failed
    assignee: t.option(t.string()),
    branch: t.option(t.string()),
    depends_on: t.array(t.string()),
    result: t.option(t.string()), // JSON text; see contract/result-format.json
    result_summary: t.option(t.string()),
  }
);

// path is the primary key, so the database itself refuses two holders of one file.
const locks = table(
  { name: 'locks', public: true },
  {
    path: t.string().primaryKey(),
    task_id: t.string().index('btree'),
    worker_id: t.string(),
    created_at: t.timestamp(),
  }
);

const events = table(
  { name: 'events', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    timestamp: t.timestamp(),
    worker_id: t.option(t.string()),
    type: t.string(),
    message: t.string(),
  }
);

const spacetimedb = schema({ workers, tasks, locks, events });
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;

function addEvent(ctx: Ctx, workerId: string | undefined, type: string, message: string) {
  ctx.db.events.insert({
    id: 0n,
    timestamp: ctx.timestamp,
    worker_id: workerId,
    type,
    message,
  });
}

// A worker that has not sent a heartbeat for this long is treated as dead.
// The MCP server sends one every 30 seconds while its session is alive.
const STALE_AFTER_SECONDS = 120n;

// Frees the locks of every claimed task whose worker went silent and puts the
// task back to `open` so someone else can claim it.
function reapStaleWorkers(ctx: Ctx, ttlSeconds: bigint) {
  const now = ctx.timestamp.microsSinceUnixEpoch;
  for (const task of [...ctx.db.tasks.iter()]) {
    if (task.status !== 'claimed' || task.assignee === undefined) continue;
    const owner = ctx.db.workers.id.find(task.assignee);
    if (owner && now - owner.last_seen.microsSinceUnixEpoch <= ttlSeconds * 1_000_000n) continue;
    for (const lock of [...ctx.db.locks.task_id.filter(task.id)]) {
      ctx.db.locks.path.delete(lock.path);
    }
    ctx.db.tasks.id.update({ ...task, status: 'open', assignee: undefined });
    if (owner) {
      ctx.db.workers.id.update({ ...owner, status: owner.status === 'busy' ? 'idle' : owner.status });
    }
    addEvent(ctx, task.assignee, 'lock_released',
      `${owner?.name ?? task.assignee} went silent. Released locks and reopened: ${task.title}`);
  }
}

// Marks the caller as alive first (so it is never reaped by its own call), then reaps.
function touchAndReap(ctx: Ctx, workerId: string) {
  const worker = ctx.db.workers.id.find(workerId);
  if (!worker) return undefined;
  ctx.db.workers.id.update({ ...worker, last_seen: ctx.timestamp });
  reapStaleWorkers(ctx, STALE_AFTER_SECONDS);
  return ctx.db.workers.id.find(workerId);
}

export const heartbeat = spacetimedb.reducer(
  { worker_id: t.string() },
  (ctx, { worker_id }) => {
    if (!touchAndReap(ctx, worker_id)) throw new SenderError('unknown worker');
  }
);

// Test hook and manual cleanup. Anyone can call it, so the minimum is 1 second.
// TODO: restrict who may call this before the database is shared.
export const reapStale = spacetimedb.reducer(
  { ttl_seconds: t.u32() },
  (ctx, { ttl_seconds }) => {
    reapStaleWorkers(ctx, BigInt(Math.max(1, ttl_seconds)));
  }
);

export const registerWorker = spacetimedb.reducer(
  { id: t.string(), name: t.string(), plan: t.string() },
  (ctx, { id, name, plan }) => {
    if (plan !== 'pro' && plan !== 'max') throw new SenderError('plan must be pro or max');
    const existing = ctx.db.workers.id.find(id);
    if (existing) {
      ctx.db.workers.id.update({ ...existing, name, plan, last_seen: ctx.timestamp });
    } else {
      ctx.db.workers.insert({
        id,
        name,
        plan,
        status: 'idle',
        usage_5h_pct: undefined,
        usage_week_pct: undefined,
        reset_at: undefined,
        last_seen: ctx.timestamp,
      });
      addEvent(ctx, id, 'worker_idle', `${name} joined the team`);
    }
  }
);

export const createTask = spacetimedb.reducer(
  {
    id: t.string(),
    job_id: t.option(t.string()),
    kind: t.string(),
    title: t.string(),
    description: t.string(),
    files: t.array(t.string()),
    difficulty: t.string(),
    model: t.string(),
    effort: t.string(),
    depends_on: t.array(t.string()),
  },
  (ctx, a) => {
    if (ctx.db.tasks.id.find(a.id)) throw new SenderError(`task ${a.id} already exists`);
    if (!['normal', 'map', 'reduce'].includes(a.kind)) throw new SenderError('bad kind');
    for (const dep of a.depends_on) {
      if (!ctx.db.tasks.id.find(dep)) throw new SenderError(`unknown dependency ${dep}`);
    }
    ctx.db.tasks.insert({
      ...a,
      job_id: a.job_id,
      status: a.depends_on.length > 0 ? 'blocked' : 'open',
      assignee: undefined,
      branch: undefined,
      result: undefined,
      result_summary: undefined,
    });
    addEvent(ctx, undefined, 'task_created', `Task created: ${a.title}`);
  }
);

// One transaction does all of: pick a task, check its files are free, take the
// locks, mark it claimed. Two concurrent callers cannot both succeed.
// If nothing can be claimed, this does nothing; callers read the tasks table.
export const claimTask = spacetimedb.reducer(
  { worker_id: t.string() },
  (ctx, { worker_id }) => {
    const worker = touchAndReap(ctx, worker_id);
    if (!worker) throw new SenderError('unknown worker');
    if (worker.status === 'capped') throw new SenderError('worker is capped');
    for (const task of ctx.db.tasks.iter()) {
      if (task.status === 'claimed' && task.assignee === worker_id) {
        throw new SenderError('worker already has a task');
      }
    }

    // "Best" task for the POC = first open task whose files are all free.
    // Open tasks come out in insertion order.
    for (const task of ctx.db.tasks.iter()) {
      if (task.status !== 'open') continue;
      const blocker = task.files.find(p => ctx.db.locks.path.find(p));
      if (blocker !== undefined) continue;

      for (const path of task.files) {
        ctx.db.locks.insert({ path, task_id: task.id, worker_id, created_at: ctx.timestamp });
      }
      ctx.db.tasks.id.update({ ...task, status: 'claimed', assignee: worker_id });
      ctx.db.workers.id.update({ ...worker, status: 'busy', last_seen: ctx.timestamp });
      addEvent(ctx, worker_id, 'task_claimed', `${worker.name} claimed: ${task.title}`);
      return;
    }
  }
);

export const completeTask = spacetimedb.reducer(
  {
    worker_id: t.string(),
    task_id: t.string(),
    branch: t.string(),
    summary: t.string(),
    result: t.option(t.string()),
  },
  (ctx, { worker_id, task_id, branch, summary, result }) => {
    const task = ctx.db.tasks.id.find(task_id);
    if (!task) throw new SenderError('unknown task');
    if (task.status !== 'claimed' || task.assignee !== worker_id) {
      throw new SenderError('task is not claimed by this worker');
    }
    ctx.db.tasks.id.update({
      ...task,
      status: 'done',
      branch,
      result,
      result_summary: summary,
    });
    for (const lock of [...ctx.db.locks.task_id.filter(task_id)]) {
      ctx.db.locks.path.delete(lock.path);
    }
    const worker = ctx.db.workers.id.find(worker_id);
    if (worker) {
      ctx.db.workers.id.update({
        ...worker,
        status: worker.status === 'busy' ? 'idle' : worker.status,
        last_seen: ctx.timestamp,
      });
    }
    addEvent(ctx, worker_id, 'task_done', `Done: ${task.title}`);

    // Open anything that was waiting on this task. A task only moves
    // blocked -> open once, so a merge task cannot open twice.
    const all = [...ctx.db.tasks.iter()];
    const doneIds = new Set(all.filter(x => x.status === 'done').map(x => x.id));
    for (const other of all) {
      if (other.status !== 'blocked') continue;
      if (!other.depends_on.every(d => doneIds.has(d))) continue;
      ctx.db.tasks.id.update({ ...other, status: 'open' });
      addEvent(
        ctx,
        undefined,
        other.kind === 'reduce' ? 'merge_unblocked' : 'task_created',
        other.kind === 'reduce' ? `Merge task unlocked: ${other.title}` : `Unblocked: ${other.title}`
      );
    }
  }
);

// All paths or none: if any path is held by another task, the whole call
// fails and the transaction rolls back, so no partial locks are left behind.
export const takeLocks = spacetimedb.reducer(
  { worker_id: t.string(), task_id: t.string(), paths: t.array(t.string()) },
  (ctx, { worker_id, task_id, paths }) => {
    touchAndReap(ctx, worker_id);
    const task = ctx.db.tasks.id.find(task_id);
    if (!task || task.status !== 'claimed' || task.assignee !== worker_id) {
      throw new SenderError('task is not claimed by this worker');
    }
    for (const path of paths) {
      const held = ctx.db.locks.path.find(path);
      if (held && held.task_id !== task_id) {
        throw new SenderError(`${path} is held by task ${held.task_id}`);
      }
    }
    for (const path of paths) {
      if (!ctx.db.locks.path.find(path)) {
        ctx.db.locks.insert({ path, task_id, worker_id, created_at: ctx.timestamp });
      }
    }
    addEvent(ctx, worker_id, 'lock_taken', `Locked ${paths.length} file(s) for ${task.title}`);
  }
);

export const releaseLocks = spacetimedb.reducer(
  { worker_id: t.string(), task_id: t.string() },
  (ctx, { worker_id, task_id }) => {
    const task = ctx.db.tasks.id.find(task_id);
    if (!task || task.assignee !== worker_id) {
      throw new SenderError('task is not assigned to this worker');
    }
    for (const lock of [...ctx.db.locks.task_id.filter(task_id)]) {
      ctx.db.locks.path.delete(lock.path);
    }
    addEvent(ctx, worker_id, 'lock_released', `Released locks for ${task.title}`);
  }
);
