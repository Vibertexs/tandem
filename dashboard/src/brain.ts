// The only file in the dashboard that knows about SpacetimeDB. Everything else uses the plain
// types below and the Api object.
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../../brain/bindings/index.js';

export const SESSION = 'live'; // the real team session

export type Worker = {
  id: string; name: string; plan: string; status: string;
  usage5h: number | null; usageWeek: number | null; resetAt: Date | null; lastSeen: Date;
};
export type Task = {
  id: string; jobId: string | null; kind: string; title: string; description: string; files: string[];
  difficulty: string; model: string; effort: string; status: string; assignee: string | null;
  branch: string | null; dependsOn: string[]; result: string | null; resultSummary: string | null; goalId: string;
};
export type Lock = { path: string; taskId: string; workerId: string; createdAt: Date };
export type Ev = { id: number; time: Date; workerId: string | null; type: string; message: string };
export type Goal = { id: string; text: string; status: string; createdAt: Date; branch: string; note: string };
export type Presence = { name: string; kind: string; lastSeen: Date };
export type Person = { identity: string; name: string; at: Date }; // operators and access requests
export type Snapshot = {
  workers: Worker[]; tasks: Task[]; locks: Lock[]; events: Ev[]; goals: Goal[];
  context: Record<string, string>; operators: Person[]; requests: Person[]; presence: Presence[];
};

export const emptySnapshot: Snapshot = { workers: [], tasks: [], locks: [], events: [], goals: [], context: {}, operators: [], requests: [], presence: [] };

const date = (ts: { microsSinceUnixEpoch: bigint }) => new Date(Number(ts.microsSinceUnixEpoch / 1000n));

export function readSnapshot(conn: DbConnection): Snapshot {
  const mine = <R extends { sessionId: string }>(rows: Iterable<R>) => [...rows].filter(r => r.sessionId === SESSION);
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
      result: r.result ?? null, resultSummary: r.resultSummary ?? null, goalId: r.goalId,
    })),
    locks: mine(conn.db.locks.iter()).map(r => ({
      path: r.path, taskId: r.taskId, workerId: r.workerId, createdAt: date(r.createdAt),
    })),
    events: mine(conn.db.events.iter())
      .map(r => ({ id: Number(r.id), time: date(r.timestamp), workerId: r.workerId ?? null, type: r.type, message: r.message }))
      .sort((a, b) => b.id - a.id),
    goals: mine(conn.db.goals.iter())
      .map(r => ({ id: r.id, text: r.text, status: r.status, createdAt: date(r.createdAt), branch: r.branch, note: r.note }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    context: Object.fromEntries(mine(conn.db.context.iter()).map(r => [r.key, r.value])),
    operators: [...conn.db.operators.iter()].map(r => ({ identity: r.identity.toHexString(), name: r.name, at: date(r.addedAt) })),
    requests: [...conn.db.operatorRequests.iter()].map(r => ({ identity: r.identity.toHexString(), name: r.name, at: date(r.createdAt) })),
    presence: [...conn.db.presence.iter()].filter(r => r.sessionId === SESSION).map(r => ({ name: r.name, kind: r.kind, lastSeen: date(r.lastSeen) })),
  };
}

// The browser keeps its login (token) so it stays the same identity between visits.
// That is what lets you stay the owner of the team you host.
const tokenKey = (uri: string, database: string) => `tandem-token:${uri}|${database}`;
function loadToken(key: string): string | undefined {
  try { return globalThis.localStorage?.getItem(key) ?? undefined; } catch { return undefined; }
}
function saveToken(key: string, token: string) {
  try { globalThis.localStorage?.setItem(key, token); } catch { /* anonymous next time */ }
}

export function connect(
  uri: string, database: string,
  on: { change: () => void; connected: (identity: string) => void; error: (e: unknown) => void; lost: () => void },
): DbConnection {
  const key = tokenKey(uri, database);
  let first = true;
  return DbConnection.builder()
    .withUri(uri)
    .withDatabaseName(database)
    .withToken(loadToken(key))
    .withAutomaticReconnect()
    .onConnect((c, identity, token) => {
      saveToken(key, token);
      // After a reconnect the SDK replays the subscription and the row callbacks stay registered;
      // registering them again would double every update.
      if (!first) { on.connected(identity.toHexString()); on.change(); return; }
      first = false;
      for (const t of [c.db.workers, c.db.tasks, c.db.locks, c.db.events, c.db.context, c.db.goals, c.db.operators, c.db.operatorRequests, c.db.presence]) {
        t.onInsert(on.change);
        t.onUpdate(on.change);
        t.onDelete(on.change);
      }
      c.subscriptionBuilder()
        .onApplied(() => { on.connected(identity.toHexString()); on.change(); })
        // An older brain is missing a table this page reads: say so instead of hanging.
        .onError(ctx => on.error(new Error(`outdated: ${String((ctx as { event?: unknown }).event ?? 'subscription refused')}`)))
        .subscribe([
          tables.workers.where(r => r.sessionId.eq(SESSION)),
          tables.tasks.where(r => r.sessionId.eq(SESSION)),
          tables.locks.where(r => r.sessionId.eq(SESSION)),
          tables.events.where(r => r.sessionId.eq(SESSION)),
          tables.context.where(r => r.sessionId.eq(SESSION)),
          tables.goals.where(r => r.sessionId.eq(SESSION)),
          tables.operators,
          tables.operatorRequests,
          tables.presence.where(r => r.sessionId.eq(SESSION)),
        ]);
    })
    .onConnectError((_c, e) => on.error(e))
    .onDisconnect(() => on.lost())
    .build();
}

export type PieceSpec = { title: string; description?: string; files: string[] };
const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
const toInput = (id: string, p: PieceSpec, difficulty = 'normal') => ({
  id, title: p.title, description: p.description ?? '', files: p.files, difficulty, model: '', effort: 'default', dependsOn: [] as string[],
});
const ident = (hex: string) => Identity.fromString(hex.trim().replace(/^0x/i, ''));

// Every method returns a promise that rejects with the brain's own reason if it refuses.
export function makeApi(conn: DbConnection) {
  const sessionId = SESSION;
  return {
    claimTeam: () => conn.reducers.claimOperator({}),
    askToManage: (name: string) => conn.reducers.requestOperator({ name }),
    approve: (identity: string) => conn.reducers.approveOperator({ identity: ident(identity) }),
    dismiss: (identity: string) => conn.reducers.dismissRequest({ identity: ident(identity) }),
    removeOperator: (identity: string) => conn.reducers.removeOperator({ identity: ident(identity) }),
    postGoal: (text: string) => conn.reducers.postGoal({ sessionId, id: newId('g'), text }),
    createTask: (p: PieceSpec & { difficulty?: string }, assignee?: string) =>
      conn.reducers.createTask({ sessionId, kind: 'normal', assignee, task: toInput(newId('t'), p, p.difficulty) }),
    createJob: (goal: string, pieces: PieceSpec[], merge: PieceSpec) =>
      conn.reducers.createJob({
        sessionId, jobId: newId('job'), goal,
        mapTasks: pieces.map(p => toInput(newId('t'), p)),
        mergeTask: toInput(newId('t'), merge, 'hard'),
      }),
    setNote: (key: string, value: string) => conn.reducers.setContext({ sessionId, key, value }),
    clearBoard: () => conn.reducers.clearBoard({ sessionId }),
  };
}
export type Api = ReturnType<typeof makeApi>;
