// The only file in the dashboard that knows about SpacetimeDB. Everything else uses the
// plain types below and the Api object, so tests can drive the same logic from node.
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../../brain/bindings/index.js';

export type Worker = {
  id: string; name: string; plan: string; status: string;
  usage5h: number | null; usageWeek: number | null; resetAt: Date | null; lastSeen: Date;
};
export type Task = {
  id: string; jobId: string | null; kind: string; title: string; description: string; files: string[];
  difficulty: string; model: string; effort: string; status: string; assignee: string | null;
  branch: string | null; dependsOn: string[]; resultSummary: string | null;
};
export type Lock = { path: string; taskId: string; workerId: string; createdAt: Date };
export type Ev = { id: number; time: Date; workerId: string | null; type: string; message: string };
export type Snapshot = {
  workers: Worker[]; tasks: Task[]; locks: Lock[]; events: Ev[];
  context: Record<string, string>; operators: string[]; // operators are identity hex strings
};

export const emptySnapshot: Snapshot = { workers: [], tasks: [], locks: [], events: [], context: {}, operators: [] };

const date = (ts: { microsSinceUnixEpoch: bigint }) => new Date(Number(ts.microsSinceUnixEpoch / 1000n));

export function readSnapshot(conn: DbConnection, session: string): Snapshot {
  const mine = <R extends { sessionId: string }>(rows: Iterable<R>) => [...rows].filter(r => r.sessionId === session);
  return {
    workers: mine(conn.db.workers.iter()).map(r => ({
      id: r.id, name: r.name, plan: r.plan, status: r.status,
      usage5h: r.usage5HPct ?? null, usageWeek: r.usageWeekPct ?? null,
      resetAt: r.resetAt ? date(r.resetAt) : null, lastSeen: date(r.lastSeen),
    })),
    tasks: mine(conn.db.tasks.iter()).map(r => ({
      id: r.id, jobId: r.jobId ?? null, kind: r.kind, title: r.title, description: r.description,
      files: [...r.files], difficulty: r.difficulty, model: r.model, effort: r.effort, status: r.status,
      assignee: r.assignee ?? null, branch: r.branch ?? null, dependsOn: [...r.dependsOn],
      resultSummary: r.resultSummary ?? null,
    })),
    locks: mine(conn.db.locks.iter()).map(r => ({
      path: r.path, taskId: r.taskId, workerId: r.workerId, createdAt: date(r.createdAt),
    })),
    events: mine(conn.db.events.iter())
      .map(r => ({ id: Number(r.id), time: date(r.timestamp), workerId: r.workerId ?? null, type: r.type, message: r.message }))
      .sort((a, b) => b.id - a.id),
    context: Object.fromEntries(mine(conn.db.context.iter()).map(r => [r.key, r.value])),
    operators: [...conn.db.operators.iter()].map(r => r.identity.toHexString()),
  };
}

// The browser keeps its login (token) so it stays the same identity between visits.
// That is what lets you authorize this browser as an operator once.
const tokenKey = (uri: string, database: string) => `tandem-token:${uri}|${database}`;
function loadToken(key: string): string | undefined {
  try { return globalThis.localStorage?.getItem(key) ?? undefined; } catch { return undefined; }
}
function saveToken(key: string, token: string) {
  try { globalThis.localStorage?.setItem(key, token); } catch { /* anonymous next time */ }
}

export function connect(
  uri: string, database: string, session: string,
  on: { change: () => void; connected: (identity: string) => void; error: (e: unknown) => void },
): DbConnection {
  const key = tokenKey(uri, database);
  return DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .withToken(loadToken(key))
    .withAutomaticReconnect()
    .onConnect((c, identity, token) => {
      saveToken(key, token);
      for (const t of [c.db.workers, c.db.tasks, c.db.locks, c.db.events, c.db.context, c.db.operators]) {
        t.onInsert(on.change);
        t.onUpdate(on.change);
        t.onDelete(on.change);
      }
      c.subscriptionBuilder()
        .onApplied(() => { on.connected(identity.toHexString()); on.change(); })
        .subscribe([
          tables.workers.where(r => r.sessionId.eq(session)),
          tables.tasks.where(r => r.sessionId.eq(session)),
          tables.locks.where(r => r.sessionId.eq(session)),
          tables.events.where(r => r.sessionId.eq(session)),
          tables.context.where(r => r.sessionId.eq(session)),
          tables.operators,
        ]);
    })
    .onConnectError((_c, e) => on.error(e))
    .build();
}

export type PieceSpec = { title: string; description?: string; files: string[] };
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
const toInput = (id: string, p: PieceSpec, difficulty = 'normal') => ({
  id, title: p.title, description: p.description ?? '', files: p.files, difficulty, model: '', effort: 'default', dependsOn: [] as string[],
});

export function parseIdentity(hex: string) {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('An identity is 64 hex characters.');
  return Identity.fromString(clean);
}

export type TaskSpec = {
  id: string; title: string; description?: string; files: string[]; difficulty?: string;
  model?: string; effort?: string;
};

// Every method returns a promise that rejects if the brain refuses. Callers decide whether that matters.
export function makeApi(conn: DbConnection, session: string) {
  return {
    claim: (workerId: string) => conn.reducers.claimTask({ sessionId: session, workerId }),
    complete: (workerId: string, taskId: string, result?: unknown) =>
      conn.reducers.completeTask({
        sessionId: session, workerId, taskId, branch: `sim/${taskId}`, summary: 'Simulated run',
        result: result === undefined ? undefined : JSON.stringify(result),
      }),
    progress: (workerId: string, taskId: string, message: string) =>
      conn.reducers.reportProgress({ sessionId: session, workerId, taskId, message }),
    capacity: (workerId: string, patch: { usage5h?: number; usageWeek?: number; status?: string }) =>
      conn.reducers.updateCapacity({
        sessionId: session, workerId, usage5H: patch.usage5h, usageWeek: patch.usageWeek, status: patch.status,
      }),
    createTask: (task: TaskSpec, assignee?: string) =>
      conn.reducers.createTask({
        sessionId: session, kind: 'normal', assignee,
        task: {
          id: task.id, title: task.title, description: task.description ?? '', files: task.files,
          difficulty: task.difficulty ?? 'normal', model: task.model ?? '', effort: task.effort ?? 'default', dependsOn: [],
        },
      }),
    seed: (group: 'demo' | 'review') => conn.reducers.seedTasks({ sessionId: session, group }),
    reset: () => conn.reducers.resetSession({ sessionId: session }),
    // --- operator controls (the real "live" session only accepts these from operators) ---
    claimOperator: () => conn.reducers.claimOperator({}),
    addOperator: (hex: string) => conn.reducers.addOperator({ identity: parseIdentity(hex) }),
    removeOperator: (hex: string) => conn.reducers.removeOperator({ identity: parseIdentity(hex) }),
    createJob: (goal: string, pieces: PieceSpec[], merge: PieceSpec) =>
      conn.reducers.createJob({
        sessionId: session, jobId: newId('job'), goal,
        mapTasks: pieces.map(p => toInput(newId('t'), p)),
        mergeTask: toInput(newId('t'), merge, 'hard'),
      }),
    setContext: (key: string, value: string) => conn.reducers.setContext({ sessionId: session, key, value }),
  };
}
export type Api = ReturnType<typeof makeApi>;
