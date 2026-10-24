// Judge-mode workers. No Claude calls: each simulated worker claims a task through the real
// brain, "works" for a few seconds, then completes it with a canned result.
import type { Api, Snapshot, Task } from './brain';

export const RUN_MS: Record<string, number> = { easy: 2500, normal: 4000, hard: 6000 };

export type SimState = {
  started: Map<string, number>; // task id -> when we first saw it running
  halfway: Set<string>;
  nextTry: Map<string, number>; // worker id -> earliest time to try claiming again
};
export const newSimState = (): SimState => ({ started: new Map(), halfway: new Set(), nextTry: new Map() });

export const cannedResult = (task: Task) => ({
  status: 'ok',
  files_touched: task.files,
  findings: task.kind === 'map'
    ? [{ file: task.files[0] ?? '', severity: 'low', note: `Looks fine: ${task.title}` }]
    : [],
  notes: '',
});

// Can this worker start this task right now? (Same test the brain applies.)
export function claimable(snap: Snapshot, task: Task, workerId: string): boolean {
  if (task.status !== 'open') return false;
  if (task.assignee !== null && task.assignee !== workerId) return false;
  return !task.files.some(p => snap.locks.some(l => l.path === p));
}

// One tick of the simulator. `jitter` returns a delay in ms and `speed` divides the run times,
// so tests can run fast and deterministically.
export async function simStep(
  api: Api, snap: Snapshot, state: SimState, now: number,
  jitter: () => number = () => 400 + Math.random() * 1200, speed = 1,
): Promise<void> {
  const calls: Promise<unknown>[] = [];
  for (const w of snap.workers) {
    if (w.status === 'capped') continue;
    const running = snap.tasks.find(t => t.status === 'claimed' && t.assignee === w.id);
    if (running) {
      const since = state.started.get(running.id) ?? now;
      state.started.set(running.id, since);
      const total = (RUN_MS[running.difficulty] ?? RUN_MS.normal) / speed;
      if (now - since >= total) {
        const result = running.kind === 'map' ? cannedResult(running) : undefined;
        calls.push(api.complete(w.id, running.id, result).catch(() => {}));
        state.started.delete(running.id);
        state.halfway.delete(running.id);
      } else if (now - since >= total / 2 && !state.halfway.has(running.id)) {
        state.halfway.add(running.id);
        calls.push(api.progress(w.id, running.id, 'halfway').catch(() => {}));
      }
      continue;
    }
    if ((state.nextTry.get(w.id) ?? 0) > now) continue;
    if (snap.tasks.some(t => claimable(snap, t, w.id))) {
      state.nextTry.set(w.id, now + jitter());
      calls.push(api.claim(w.id).catch(() => {}));
    }
  }
  await Promise.all(calls);
}
