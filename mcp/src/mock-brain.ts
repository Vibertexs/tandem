// BRAIN_MODE=mock: the same Brain interface, in memory, loaded from contract/seed.json.
// For building against the tools without a database. It is simpler than the real brain:
// no sessions, no heartbeats, no stale cleanup, no capped-worker requeue.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newId, safeParse, type Brain, type Goal, type Lock, type Task, type TaskDraft, type Worker } from './brain-client.js';

type Seed = {
  workers: Worker[]; context: Record<string, string>;
  tasks: (Omit<Task, 'result'> & { result: unknown })[];
};

export class MockBrain implements Brain {
  private workers: Worker[];
  private tasks: Task[];
  private locks: Lock[] = [];
  private context: Record<string, string>;
  private goals: Goal[] = [];

  constructor() {
    const path = fileURLToPath(new URL('../../contract/seed.json', import.meta.url));
    const seed = JSON.parse(readFileSync(path, 'utf8')) as Seed;
    this.workers = seed.workers.map(w => ({ ...w, last_seen: new Date().toISOString() }));
    this.tasks = seed.tasks.map(t => ({ ...t }));
    this.context = { ...seed.context };
  }

  readonly identity = 'mock';

  disconnect() {}

  private worker(id: string) {
    const w = this.workers.find(x => x.id === id);
    if (!w) throw new Error('unknown worker');
    w.last_seen = new Date().toISOString();
    return w;
  }
  private task(id: string) {
    const t = this.tasks.find(x => x.id === id);
    if (!t) throw new Error('unknown task');
    return t;
  }
  private holder(path: string) { return this.locks.find(l => l.path === path); }

  async registerWorker(id: string, name: string, plan: string) {
    const w = this.workers.find(x => x.id === id);
    if (w) { w.name = name; w.plan = plan; return; }
    this.workers.push({ id, name, plan, status: 'idle', usage_5h_pct: null, usage_week_pct: null, reset_at: null, last_seen: new Date().toISOString() });
  }
  async heartbeat(workerId: string) { this.worker(workerId); }
  async reportCapacity(workerId: string, usage5h: number | null, usageWeek: number | null, resetAt: string | null) {
    const w = this.worker(workerId);
    w.usage_5h_pct = usage5h; w.usage_week_pct = usageWeek; w.reset_at = resetAt;
  }

  async claimTask(workerId: string) {
    const w = this.worker(workerId);
    if (this.tasks.some(t => t.status === 'claimed' && t.assignee === workerId)) throw new Error('worker already has a task');
    const task = this.tasks.find(t => t.status === 'open' && (t.assignee === null || t.assignee === workerId) &&
      !t.files.some(p => this.holder(p)));
    if (!task) return null;
    for (const path of task.files) this.locks.push({ path, task_id: task.id, worker_id: workerId, created_at: new Date().toISOString() });
    task.status = 'claimed'; task.assignee = workerId; w.status = 'busy';
    return { ...task };
  }

  async lockFiles(workerId: string, taskId: string, paths: string[]) {
    const t = this.task(taskId);
    if (t.status !== 'claimed' || t.assignee !== workerId) throw new Error('task is not claimed by this worker');
    const blocker = paths.map(p => this.holder(p)).find(l => l && l.task_id !== taskId);
    if (blocker) return { ok: false, held_by: blocker.task_id };
    for (const path of paths) if (!this.holder(path)) this.locks.push({ path, task_id: taskId, worker_id: workerId, created_at: new Date().toISOString() });
    return { ok: true, held_by: null };
  }

  async releaseFiles(_workerId: string, taskId: string) { this.locks = this.locks.filter(l => l.task_id !== taskId); }
  async reportProgress(workerId: string, taskId: string) { this.worker(workerId); this.task(taskId); }

  async completeTask(workerId: string, taskId: string, branch: string, summary: string, result?: unknown) {
    const t = this.task(taskId);
    if (t.status !== 'claimed' || t.assignee !== workerId) throw new Error('task is not claimed by this worker');
    t.status = 'done'; t.branch = branch; t.result_summary = summary; t.result = result ?? null;
    this.locks = this.locks.filter(l => l.task_id !== taskId);
    const w = this.worker(workerId);
    if (w.status === 'busy') w.status = 'idle';
    for (const o of this.tasks) {
      if (o.status === 'blocked' && o.depends_on.every(d => this.task(d).status === 'done')) o.status = 'open';
    }
  }

  getContext() { return { ...this.context }; }
  getJobResults(jobId: string) {
    return this.tasks.filter(t => t.job_id === jobId && t.kind === 'map' && t.status === 'done' && t.result != null)
      .map(t => (typeof t.result === 'string' ? safeParse(t.result) : t.result));
  }

  private add(d: TaskDraft, kind: string, jobId: string | null, assignee: string | null, dependsOn: string[]) {
    const id = newId('t');
    this.tasks.push({
      id, job_id: jobId, kind, title: d.title, description: d.description ?? '', files: d.files,
      difficulty: d.difficulty ?? 'normal', model: d.model ?? '', effort: d.effort ?? 'default',
      status: dependsOn.length ? 'blocked' : 'open', assignee, branch: null, depends_on: dependsOn,
      result: null, result_summary: null,
    });
    return id;
  }
  async assignTask(task: TaskDraft, assignee?: string) {
    return this.add(task, 'normal', null, assignee ?? null, task.depends_on ?? []);
  }
  async createJob(_goal: string, mapTasks: TaskDraft[], mergeTask: TaskDraft) {
    const jobId = newId('job');
    const ids = mapTasks.map(m => this.add(m, 'map', jobId, null, []));
    this.add(mergeTask, 'reduce', jobId, null, ids);
    return jobId;
  }

  getCapacity() { return this.workers.map(w => ({ ...w })); }
  getStatus() { return { tasks: this.tasks.map(t => ({ ...t })), locks: this.locks.map(l => ({ ...l })) }; }
  async setContext(key: string, value: string) { this.context[key] = value; }

  // The mock starts with one goal so the manager tools have something to read.
  getGoals() {
    if (this.goals.length === 0 && !this.seededGoal) {
      this.seededGoal = true;
      this.goals.push({ id: 'g-demo', text: 'Build a login page with an API', status: 'new', created_at: new Date().toISOString() });
    }
    return this.goals.filter(g => g.status === 'new').map(g => ({ ...g }));
  }
  private seededGoal = false;
  async markGoal(goalId: string, status: string) {
    if (!['new', 'planning', 'planned'].includes(status)) throw new Error('bad status');
    const g = this.goals.find(x => x.id === goalId);
    if (!g) throw new Error('unknown goal');
    g.status = status;
  }
}
