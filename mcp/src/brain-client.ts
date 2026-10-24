// The only file in mcp/ that talks to the database. To swap SpacetimeDB for
// something else, replace this module and keep the method signatures.
import { DbConnection, tables } from '../../brain/bindings/index.js';

export type Task = {
  id: string; job_id: string | null; kind: string; title: string; description: string;
  files: string[]; difficulty: string; model: string; effort: string; status: string;
  assignee: string | null; branch: string | null; depends_on: string[];
  result: unknown; result_summary: string | null;
};
export type Lock = { path: string; task_id: string; worker_id: string; created_at: string };

type RowOf<T> = T extends { iter(): Iterable<infer R> } ? R : never;
type TaskRow = RowOf<DbConnection['db']['tasks']>;
type LockRow = RowOf<DbConnection['db']['locks']>;

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

const toTask = (r: TaskRow): Task => ({
  id: r.id, job_id: r.jobId ?? null, kind: r.kind, title: r.title, description: r.description,
  files: [...r.files], difficulty: r.difficulty, model: r.model, effort: r.effort, status: r.status,
  assignee: r.assignee ?? null, branch: r.branch ?? null, depends_on: [...r.dependsOn],
  result: r.result == null ? null : safeParse(r.result), result_summary: r.resultSummary ?? null,
});

const toLock = (r: LockRow): Lock => ({
  path: r.path, task_id: r.taskId, worker_id: r.workerId,
  created_at: new Date(Number(r.createdAt.microsSinceUnixEpoch / 1000n)).toISOString(),
});

export class BrainClient {
  private constructor(private conn: DbConnection) {}

  static connect(uri: string, database: string): Promise<BrainClient> {
    return new Promise((resolve, reject) => {
      DbConnection.builder()
        .withUri(uri)
        .withDatabaseName(database)
        .onConnect(c => {
          c.subscriptionBuilder()
            .onApplied(() => resolve(new BrainClient(c)))
            .subscribe([tables.workers, tables.tasks, tables.locks]);
        })
        .onConnectError((_c, e) => reject(e))
        .build();
    });
  }

  disconnect() { this.conn.disconnect(); }

  async heartbeat(workerId: string) {
    await this.conn.reducers.heartbeat({ workerId });
  }

  async registerWorker(id: string, name: string, plan: string) {
    await this.conn.reducers.registerWorker({ id, name, plan });
  }

  // Reducers return nothing, so read the claimed task back from the table.
  async claimTask(workerId: string): Promise<Task | null> {
    await this.conn.reducers.claimTask({ workerId });
    const row = [...this.conn.db.tasks.iter()].find(t => t.status === 'claimed' && t.assignee === workerId);
    return row ? toTask(row) : null;
  }

  async lockFiles(workerId: string, taskId: string, paths: string[]): Promise<{ ok: boolean; held_by: string | null }> {
    try {
      await this.conn.reducers.takeLocks({ workerId, taskId, paths });
      return { ok: true, held_by: null };
    } catch (e) {
      const blocker = [...this.conn.db.locks.iter()].find(l => paths.includes(l.path) && l.taskId !== taskId);
      if (!blocker) throw e; // not a lock conflict (for example, task not claimed by this worker)
      return { ok: false, held_by: blocker.taskId };
    }
  }

  async releaseFiles(workerId: string, taskId: string) {
    await this.conn.reducers.releaseLocks({ workerId, taskId });
  }

  async completeTask(workerId: string, taskId: string, branch: string, summary: string, result?: unknown) {
    await this.conn.reducers.completeTask({
      workerId, taskId, branch, summary,
      result: result === undefined ? undefined : JSON.stringify(result),
    });
  }

  getStatus(): { tasks: Task[]; locks: Lock[] } {
    return {
      tasks: [...this.conn.db.tasks.iter()].map(toTask),
      locks: [...this.conn.db.locks.iter()].map(toLock),
    };
  }
}
