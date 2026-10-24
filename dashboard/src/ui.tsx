// Small shared pieces: time, avatars, status chips, bars, stages, plain-English explanations.
import { useEffect, useState } from 'react';
import type { Ev, Snapshot, Task, Worker } from './brain';

export function ago(d: Date, now: number): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString();
}
export function took(d: Date, now: number): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const HUES = [160, 210, 265, 25, 330, 190, 45, 120];
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const initials = name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="avatar" title={name} aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 55% 88%)`, color: `hsl(${hue} 45% 28%)` }}>
      {initials}
    </span>
  );
}

const STATUS_ICON: Record<string, string> = { idle: '○', busy: '▶', capped: '■' };
const STATUS_TEXT: Record<string, string> = { idle: 'Free', busy: 'Working', capped: 'Out of quota' };
export function WorkerStatus({ w, now }: { w: Worker; now: number }) {
  const offline = now - w.lastSeen.getTime() > 120_000;
  if (offline) return <span className="chip st-offline"><span aria-hidden="true">◌</span> Offline</span>;
  const until = w.status === 'capped' && w.resetAt && w.resetAt.getTime() > now
    ? ` until ${w.resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  return <span className={`chip st-${w.status}`}><span aria-hidden="true">{STATUS_ICON[w.status] ?? '○'}</span> {STATUS_TEXT[w.status] ?? w.status}{until}</span>;
}
export const online = (w: Worker, now: number) => now - w.lastSeen.getTime() <= 120_000;

export function Bar({ label, value }: { label: string; value: number | null }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const level = v >= 90 ? 'high' : v >= 70 ? 'mid' : 'low';
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        <div className={`bar-fill ${level}`} style={{ width: `${v}%` }} />
      </div>
      <span className="bar-num">{value === null ? '—' : `${Math.round(value)}%`}</span>
    </div>
  );
}

// A task is always in exactly one of four stages, shown left to right on the board.
// A failed task stays in To do, marked, until someone tries it again.
export type Stage = 'waiting' | 'todo' | 'doing' | 'done';
export const stageOf = (t: Task): Stage =>
  t.status === 'blocked' ? 'waiting' : t.status === 'open' || t.status === 'failed' ? 'todo' : t.status === 'claimed' ? 'doing' : 'done';
const nameOf = (id: string, snap: Snapshot) => snap.workers.find(w => w.id === id)?.name ?? id;
// The reason the last worker gave when handing it back, from the activity log.
export const giveBackReason = (t: Task, events: Ev[]) =>
  t.resultSummary && t.status === 'failed' ? t.resultSummary
    : events.find(e => e.type === 'task_failed' && e.message.includes(` gave back ${t.title}: `))?.message.split(` gave back ${t.title}: `)[1] ?? null;
export const STAGES: { key: Stage; title: string; hint: string }[] = [
  { key: 'waiting', title: 'Waiting', hint: 'Needs other tasks to finish first' },
  { key: 'todo', title: 'To do', hint: 'Ready for the next free worker' },
  { key: 'doing', title: 'In progress', hint: 'A worker is on it now' },
  { key: 'done', title: 'Done', hint: 'Finished' },
];

// When a task started and its latest progress note, read from the activity log.
export function liveInfo(t: Task, events: Ev[]): { since: Date | null; note: string | null } {
  const started = events.find(e => e.type === 'task_claimed' && e.message.endsWith(`: ${t.title}`));
  const progress = events.find(e => e.type === 'progress' && e.message.startsWith(`${t.title}: `));
  return { since: started?.time ?? null, note: progress ? progress.message.slice(t.title.length + 2) : null };
}

export const lockBlocking = (t: Task, snap: Snapshot) =>
  t.status === 'open' ? t.files.map(p => snap.locks.find(l => l.path === p && l.taskId !== t.id)).find(Boolean) : undefined;

// Plain-English reason for where a task is and who has it.
export function why(task: Task, snap: Snapshot): string {
  const who = snap.workers.find(w => w.id === task.assignee);
  const kind = task.kind === 'map' ? 'one piece of a big job'
    : task.kind === 'reduce' ? "combining a big job's results"
    : task.difficulty === 'easy' ? 'a small change'
    : task.difficulty === 'hard' ? 'a hard problem' : 'normal feature work';
  const model = task.model ? `${task.model} model` : 'the model picked by difficulty';
  if (task.status === 'done') return `Finished${who ? ` by ${who.name}` : ''}. It was ${kind}.`;
  if (task.status === 'failed') {
    return `${task.triedBy.map(id => nameOf(id, snap)).join(' and ')} could not finish it: ${task.resultSummary ?? 'no reason given'}. Check the task, then press Try again.`;
  }
  if (task.status === 'open' && task.triedBy.length > 0) {
    const reason = giveBackReason(task, snap.events);
    return `${task.triedBy.map(id => nameOf(id, snap)).join(' and ')} gave it back${reason ? ` (${reason})` : ''}. It waits for a different worker.`;
  }
  if (task.status === 'claimed' && who) {
    const left = who.usage5h === null ? 'quota unknown' : `${Math.round(100 - who.usage5h)}% quota left`;
    return `${who.name} has it (${left}). It is ${kind}, run with ${model}.`;
  }
  if (task.status === 'blocked') {
    const waiting = task.dependsOn.map(d => snap.tasks.find(t => t.id === d)).filter(t => t && t.status !== 'done');
    return `Waiting for ${waiting.map(t => `"${t!.title}"`).join(' and ') || 'other tasks'} to finish. It moves to To do by itself.`;
  }
  const lock = lockBlocking(task, snap);
  if (lock) {
    const holder = snap.tasks.find(t => t.id === lock.taskId);
    return `Waiting for ${lock.path}: "${holder?.title ?? lock.taskId}" is editing it. This starts as soon as that file is free.`;
  }
  const reserved = task.assignee ? snap.workers.find(w => w.id === task.assignee) : undefined;
  if (reserved) return `Reserved for ${reserved.name}. They take it next.`;
  return `Ready. The next free worker takes it. It is ${kind}.`;
}

export const copy = (text: string, say: (m: string) => void, what = 'Copied') => {
  void navigator.clipboard?.writeText(text).then(() => say(`${what}.`), () => say('Could not copy. Select the text instead.'));
};

// A command to run, with a copy button beside it.
export function CodeLine({ code, say }: { code: string; say: (m: string) => void }) {
  return (
    <div className="codeline">
      <pre className="mono">{code}</pre>
      <button type="button" className="copy-btn" onClick={() => copy(code, say, 'Copied')} aria-label={`Copy: ${code}`}>Copy</button>
    </div>
  );
}

export const EV_ICON: Record<string, string> = {
  task_created: '＋', task_assigned: '→', task_claimed: '▶', task_done: '✓', task_failed: '✕', progress: '…',
  lock_taken: '🔒', lock_released: '🔓', worker_capped: '■', worker_idle: '○', job_progress: '▤', merge_unblocked: '★',
};

export const isManager = (name: string) => /manager/i.test(name);
// "$0.04" (or "$0.004" for tiny amounts), what a Claude run cost as reported by claude -p
export const money = (usd: number) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
// The manager pings every 15 seconds while it runs.
export const managerOnline = (snap: Snapshot, now: number) =>
  snap.presence.some(p => p.kind === 'manager' && now - p.lastSeen.getTime() < 45_000);
