// The only file in mcp/ that talks to the database. To swap SpacetimeDB for
// something else, replace BrainClient and keep the Brain interface.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'spacetimedb';
import { DbConnection, tables } from '../../brain/bindings/index.js';

export type Task = {
  id: string; job_id: string | null; kind: string; title: string; description: string;
  files: string[]; difficulty: string; model: string; effort: string; status: string;
  assignee: string | null; branch: string | null; depends_on: string[];
  result: unknown; result_summary: string | null; goal_id: string; cost_usd: number;
};
// effort: low | medium | high, chosen when the goal was sent. It picks the models that plan it and do its tasks.
export type Goal = { id: string; text: string; status: string; created_at: string; branch: string; cost_usd: number; effort: string };
export type Lock = { path: string; task_id: string; worker_id: string; created_at: string };
export type Worker = {
  id: string; name: string; plan: string; status: string; usage_5h_pct: number | null;
  usage_week_pct: number | null; reset_at: string | null; last_seen: string;
};
// What a manager passes in. model and effort are left empty when the launcher should decide.
export type TaskDraft = {
  title: string; description?: string; files: string[]; difficulty?: string;
  model?: string; effort?: string; depends_on?: string[];
};

export interface Brain {
  registerWorker(id: string, name: string, plan: string): Promise<void>;
  heartbeat(workerId: string): Promise<void>;
  reportCapacity(workerId: string, usage5h: number | null, usageWeek: number | null, resetAt: string | null): Promise<void>;
  claimTask(workerId: string): Promise<Task | null>;
  lockFiles(workerId: string, taskId: string, paths: string[]): Promise<{ ok: boolean; held_by: string | null }>;
  releaseFiles(workerId: string, taskId: string): Promise<void>;
  reportProgress(workerId: string, taskId: string, message: string): Promise<void>;
  completeTask(workerId: string, taskId: string, branch: string, summary: string, result?: unknown): Promise<void>;
  giveBackTask(workerId: string, taskId: string, reason: string): Promise<void>;
  getContext(): Record<string, string>;
  getJobResults(jobId: string): unknown[];
  assignTask(task: TaskDraft, assignee?: string): Promise<string>;
  createJob(goal: string, mapTasks: TaskDraft[], mergeTask: TaskDraft): Promise<string>;
  getCapacity(): Worker[];
  getStatus(): { tasks: Task[]; locks: Lock[] };
  setContext(key: string, value: string): Promise<void>;
  getGoals(): Goal[]; // status new, oldest first
  markGoal(goalId: string, status: string): Promise<void>;
  readonly identity: string;
  disconnect(): void;
}

// Reducers return nothing, so ids are made here and read back from the tables.
export const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

type RowOf<T> = T extends { iter(): Iterable<infer R> } ? R : never;
type TaskRow = RowOf<DbConnection['db']['tasks']>;
type LockRow = RowOf<DbConnection['db']['locks']>;
type WorkerRow = RowOf<DbConnection['db']['workers']>;

const iso = (ts: { microsSinceUnixEpoch: bigint }) => new Date(Number(ts.microsSinceUnixEpoch / 1000n)).toISOString();

const toTask = (r: TaskRow): Task => ({
  id: r.id, job_id: r.jobId ?? null, kind: r.kind, title: r.title, description: r.description,
  files: [...r.files], difficulty: r.difficulty, model: r.model, effort: r.effort, status: r.status,
  assignee: r.assignee ?? null, branch: r.branch ?? null, depends_on: [...r.dependsOn],
  result: r.result == null ? null : safeParse(r.result), result_summary: r.resultSummary ?? null, goal_id: r.goalId, cost_usd: r.costUsd,
});
type GoalRow = RowOf<DbConnection['db']['goals']>;
const toGoal = (r: GoalRow): Goal => ({ id: r.id, text: r.text, status: r.status, created_at: iso(r.createdAt), branch: r.branch, cost_usd: r.costUsd, effort: r.effort || 'medium' });
const toLock = (r: LockRow): Lock => ({ path: r.path, task_id: r.taskId, worker_id: r.workerId, created_at: iso(r.createdAt) });
const toWorker = (r: WorkerRow): Worker => ({
  id: r.id, name: r.name, plan: r.plan, status: r.status, usage_5h_pct: r.usage5HPct ?? null,
  usage_week_pct: r.usageWeekPct ?? null, reset_at: r.resetAt ? iso(r.resetAt) : null, last_seen: iso(r.lastSeen),
});

// The server keeps the same identity between runs by saving its token. You authorize that identity
// once as an operator (dashboard, "Authorize another identity"). Never commit this file.
function tokenFile(database: string): string {
  return process.env.TANDEM_TOKEN_FILE
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.tandem', `token-${database}`);
}
function readToken(file: string): string | undefined {
  try { return readFileSync(file, 'utf8').trim() || undefined; } catch { return undefined; }
}
function saveToken(file: string, token: string) {
  try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, token, { mode: 0o600 }); } catch { /* run anonymous next time */ }
}

const toInput = (id: string, t: TaskDraft, dependsOn: string[] = t.depends_on ?? []) => ({
  id, title: t.title, description: t.description ?? '', files: t.files, difficulty: t.difficulty ?? 'normal',
  model: t.model ?? '', effort: t.effort ?? 'default', dependsOn,
});

export class BrainClient implements Brain {
  private constructor(private conn: DbConnection, private session: string, readonly identity: string) {}

  static connect(uri: string, database: string, session: string): Promise<BrainClient> {
    const file = tokenFile(database);
    let first = true;
    return new Promise((resolve, reject) => {
      DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(database)
        .withToken(readToken(file))
        // If the brain restarts, keep going: the SDK reconnects and replays the subscription.
        .withAutomaticReconnect()
        .onConnect((c, identity, token) => {
          saveToken(file, token);
          if (!first) return;
          first = false;
          c.subscriptionBuilder()
            .onApplied(() => resolve(new BrainClient(c, session, identity.toHexString())))
            .subscribe([
              tables.workers.where(r => r.sessionId.eq(session)),
              tables.tasks.where(r => r.sessionId.eq(session)),
              tables.locks.where(r => r.sessionId.eq(session)),
              tables.context.where(r => r.sessionId.eq(session)),
              tables.goals.where(r => r.sessionId.eq(session)),
              tables.operators,
            ]);
        })
        .onConnectError((_c, e) => reject(e))
        .build();
    });
  }

  disconnect() { this.conn.disconnect(); }

  private tasks() { return [...this.conn.db.tasks.iter()].filter(r => r.sessionId === this.session); }
  private locks() { return [...this.conn.db.locks.iter()].filter(r => r.sessionId === this.session); }

  async registerWorker(id: string, name: string, plan: string) {
    await this.conn.reducers.registerWorker({ sessionId: this.session, id, name, plan });
  }

  async heartbeat(workerId: string) {
    await this.conn.reducers.heartbeat({ sessionId: this.session, workerId });
  }

  async reportCapacity(workerId: string, usage5h: number | null, usageWeek: number | null, resetAt: string | null) {
    await this.conn.reducers.updateCapacity({
      sessionId: this.session, workerId,
      usage5H: usage5h ?? undefined, usageWeek: usageWeek ?? undefined,
      resetAt: resetAt ? Timestamp.fromDate(new Date(resetAt)) : undefined,
    });
  }

  // Reducers return nothing, so read the claimed task back from the table.
  async claimTask(workerId: string): Promise<Task | null> {
    await this.conn.reducers.claimTask({ sessionId: this.session, workerId });
    const row = this.tasks().find(t => t.status === 'claimed' && t.assignee === workerId);
    return row ? toTask(row) : null;
  }

  async lockFiles(workerId: string, taskId: string, paths: string[]): Promise<{ ok: boolean; held_by: string | null }> {
    try {
      await this.conn.reducers.takeLocks({ sessionId: this.session, workerId, taskId, paths });
      return { ok: true, held_by: null };
    } catch (e) {
      const blocker = this.locks().find(l => paths.includes(l.path) && l.taskId !== taskId);
      if (!blocker) throw e; // not a lock conflict (for example, task not claimed by this worker)
      return { ok: false, held_by: blocker.taskId };
    }
  }

  async releaseFiles(workerId: string, taskId: string) {
    await this.conn.reducers.releaseLocks({ sessionId: this.session, workerId, taskId });
  }

  async reportProgress(workerId: string, taskId: string, message: string) {
    await this.conn.reducers.reportProgress({ sessionId: this.session, workerId, taskId, message });
  }

  async completeTask(workerId: string, taskId: string, branch: string, summary: string, result?: unknown) {
    await this.conn.reducers.completeTask({
      sessionId: this.session, workerId, taskId, branch, summary,
      result: result === undefined ? undefined : JSON.stringify(result),
    });
  }

  async giveBackTask(workerId: string, taskId: string, reason: string) {
    await this.conn.reducers.giveBackTask({ sessionId: this.session, workerId, taskId, reason });
  }

  getContext(): Record<string, string> {
    return Object.fromEntries(
      [...this.conn.db.context.iter()].filter(r => r.sessionId === this.session).map(r => [r.key, r.value]));
  }

  getJobResults(jobId: string): unknown[] {
    return this.tasks()
      .filter(t => t.jobId === jobId && t.kind === 'map' && t.status === 'done' && t.result != null)
      .map(t => safeParse(t.result!));
  }

  async assignTask(task: TaskDraft, assignee?: string) {
    const id = newId('t');
    await this.conn.reducers.createTask({
      sessionId: this.session, task: toInput(id, task), kind: 'normal', jobId: undefined, assignee,
    });
    return id;
  }

  async createJob(goal: string, mapTasks: TaskDraft[], mergeTask: TaskDraft) {
    const jobId = newId('job');
    await this.conn.reducers.createJob({
      sessionId: this.session, jobId, goal,
      mapTasks: mapTasks.map(m => toInput(newId('t'), m, [])),
      mergeTask: toInput(newId('t'), mergeTask, []),
    });
    return jobId;
  }

  getCapacity(): Worker[] {
    return [...this.conn.db.workers.iter()].filter(r => r.sessionId === this.session).map(toWorker);
  }

  getStatus(): { tasks: Task[]; locks: Lock[] } {
    return { tasks: this.tasks().map(toTask), locks: this.locks().map(toLock) };
  }

  async setContext(key: string, value: string) {
    await this.conn.reducers.setContext({ sessionId: this.session, key, value });
  }

  getGoals(): Goal[] {
    return [...this.conn.db.goals.iter()]
      .filter(r => r.sessionId === this.session && r.status === 'new')
      .sort((a, b) => Number(a.createdAt.microsSinceUnixEpoch - b.createdAt.microsSinceUnixEpoch))
      .map(toGoal);
  }

  // --- not part of the tools: used by the conductor watcher and the launcher ---
  listGoals(): Goal[] {
    return [...this.conn.db.goals.iter()].filter(r => r.sessionId === this.session).map(toGoal);
  }

  // The launcher gives a worker the shared notes before a task; this logs that it read them.
  async noteRead(workerId: string, taskId: string, keys: string[]) {
    await this.conn.reducers.noteRead({ sessionId: this.session, workerId, taskId, keys });
  }

  // The conductor stores the conductor's key, so the conductor's own page can always take control back.
  async setHostKey(key: string) {
    await this.conn.reducers.setHostKey({ sessionId: this.session, key });
  }

  async finishGoal(goalId: string, branch: string, note: string) {
    await this.conn.reducers.finishGoal({ sessionId: this.session, id: goalId, branch, note });
  }

  // which coding agent this worker runs and which login it uses (the launcher sends this)
  async describeWorker(workerId: string, agent: string, account: string) {
    await this.conn.reducers.describeWorker({ sessionId: this.session, workerId, agent, account });
  }

  async failGoal(goalId: string, note: string) {
    await this.conn.reducers.failGoal({ sessionId: this.session, id: goalId, note });
  }

  async recordCost(workerId: string, taskId: string, usd: number, tokens = 0) {
    await this.conn.reducers.recordCost({ sessionId: this.session, workerId, taskId, usd, tokens });
  }

  async addGoalCost(goalId: string, usd: number, tokens = 0) {
    await this.conn.reducers.addGoalCost({ sessionId: this.session, id: goalId, usd, tokens });
  }

  async ping(name: string, kind: string) {
    await this.conn.reducers.ping({ sessionId: this.session, name, kind });
  }

  // Not part of the tools: used by the manager watcher to get itself approved.
  isOperator(): boolean {
    return [...this.conn.db.operators.iter()].some(o => o.identity.toHexString() === this.identity);
  }

  async requestOperator(name: string) {
    await this.conn.reducers.requestOperator({ name });
  }

  async markGoal(goalId: string, status: string) {
    await this.conn.reducers.setGoalStatus({ sessionId: this.session, id: goalId, status });
  }
}
