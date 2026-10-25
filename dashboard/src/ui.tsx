// Small shared pieces: time, avatars, status chips, bars, stages, plain-English explanations.
import { useEffect, useState, useSyncExternalStore } from 'react';
import routing from '../../launcher/routing.json';
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

// Each person gets their own colour (from their name), so a worker is easy to spot across the board.
const HUES = [18, 38, 150, 188, 212, 262, 320, 350];
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  const initials = name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className="avatar" title={name} aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.42, '--h': hue } as React.CSSProperties}>
      {initials}
    </span>
  );
}

const STATUS_TEXT: Record<string, string> = { idle: 'Free', busy: 'Working', capped: 'Out of quota' };
export function WorkerStatus({ w, now }: { w: Worker; now: number }) {
  const offline = now - w.lastSeen.getTime() > 120_000;
  if (offline) return <span className="chip st-offline"><span className="status-dot" aria-hidden="true" />Offline</span>;
  const until = w.status === 'capped' && w.resetAt && w.resetAt.getTime() > now
    ? ` until ${w.resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  return <span className={`chip st-${w.status}`}><span className="status-dot" aria-hidden="true" />{STATUS_TEXT[w.status] ?? w.status}{until}</span>;
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

// The model and effort a task runs with: the one set on it, else launcher/routing.json for its
// goal's effort (low, medium, high), by kind (map / reduce), then difficulty. The same file the
// workers read, so the page and the workers always agree.
type Pick = { model: string; effort: string };
type Level = { conductor: Pick; difficulty: Record<string, Pick>; kind: Record<string, Pick> };
export const LEVELS = (routing as { by_goal_effort: Record<string, Level> }).by_goal_effort;
export const goalEffortOf = (task: Task, snap: Snapshot) => snap.goals.find(g => g.id === task.goalId)?.effort ?? 'medium';
export function routeFor(task: Task, goalEffort = 'medium'): Pick {
  const l = LEVELS[goalEffort] ?? LEVELS.medium;
  const base = l.kind[task.kind] ?? l.difficulty[task.difficulty] ?? l.difficulty.normal;
  return { model: task.model || base.model, effort: task.effort && task.effort !== 'default' ? task.effort : base.effort };
}
export const modelFor = (task: Task, goalEffort = 'medium') => routeFor(task, goalEffort).model;
// what the conductor plans a goal with
export const conductorPick = (goalEffort: string): Pick => (LEVELS[goalEffort] ?? LEVELS.medium).conductor;
export const EFFORTS = [
  { key: 'low', label: 'Low', hint: 'Quick and cheap: haiku plans it, and does most tasks.' },
  { key: 'medium', label: 'Medium', hint: 'Balanced: sonnet plans it; each task gets haiku, sonnet or opus by how hard it is.' },
  { key: 'high', label: 'High', hint: 'Best results: opus plans it, and does most tasks, thinking harder.' },
] as const;

// Plain-English reason for where a task is and who has it.
export function why(task: Task, snap: Snapshot): string {
  const who = snap.workers.find(w => w.id === task.assignee);
  const kind = task.kind === 'map' ? 'one piece of a big job'
    : task.kind === 'reduce' ? "combining a big job's results"
    : task.difficulty === 'easy' ? 'a small change'
    : task.difficulty === 'hard' ? 'a hard problem' : 'normal feature work';
  const model = modelFor(task, goalEffortOf(task, snap));
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

// Our own repo, where a teammate gets the tandem command.
export const TANDEM_REPO = 'https://github.com/Vibertexs/tandem';

// The one-time setup makes `tandem` available in every terminal. Thereafter, commands should look
// like product commands, not a script assembled from this computer's folder layout.
export function startCommand(_tandemDir: string, _projectDir: string) {
  return 'tandem --start';
}

// Use this when a host was started with --local, or its project share did not come up. Stopping
// the brain is deliberate: it must be rebound to the network before a teammate can reach it.
export function restartForSharingCommand(tandemDir: string, projectDir: string) {
  void tandemDir;
  void projectDir;
  return 'tandem stop --all\ntandem --start';
}

// What a teammate copies to add their computer's workers. First time only: get Tandem and put it on
// the PATH. Every time after: one command, from any folder. The join copies the conductor's project
// by itself, so there is no existing project folder to find or configure.
export function JoinSteps({ link, gitUrl, say, restart }: { link: string; gitUrl: string; say: (m: string) => void; restart?: string }) {
  if (!gitUrl) {
    return (
      <div className="join-steps">
        <p className="small warn">The project is not ready to share yet. Teammates can watch the board, but cannot add workers until the conductor restarts Tandem from the project folder.</p>
        {restart && <CodeLine code={restart} say={say} />}
      </div>
    );
  }
  return (
    <div className="join-steps">
      <p className="small"><strong>1. First time only: get Tandem</strong> <span className="muted">(Windows PowerShell), then open a new terminal. Already have it? Skip this.</span></p>
      <CodeLine code={`git clone ${TANDEM_REPO}\ncd tandem\n.\\tandem.cmd install`} say={say} />
      <p className="small"><strong>2. Join the team</strong> <span className="muted">(any time after, from any folder). It makes Tandem&apos;s private copy of the conductor&apos;s project and starts this computer&apos;s workers.</span></p>
      <CodeLine code={`tandem join "${link}"`} say={say} />
      <details className="join-platforms">
        <summary className="small">macOS or Linux</summary>
        <CodeLine code={`git clone ${TANDEM_REPO}\ncd tandem\n./tandem install`} say={say} />
        <CodeLine code={`tandem join "${link}"`} say={say} />
      </details>
      <p className="small muted">It needs Node.js 22.18+, Git, and Claude Code signed in (<code>tandem doctor</code> checks). The workers use that computer&apos;s own Claude login and quota; they do not change an existing project folder. To update Tandem later, run <code>git pull</code> in its folder.</p>
    </div>
  );
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
  task_created: '+', task_assigned: '→', task_claimed: '•', task_done: '✓', task_failed: '×', progress: '·',
  lock_taken: '•', lock_released: '•', worker_capped: '•', worker_idle: '•', job_progress: '•', merge_unblocked: '✓',
  context_read: '≡',
};

// The conductor's planning Claude ("Conductor Claude"; "Manager Claude" on teams from before the rename).
export const isManager = (name: string) => /conductor claude|manager/i.test(name);

// A worker on the conductor's own computer (the conductor publishes its computer's name), or a teammate's.
export const onConductor = (w: { name: string }, snap: Snapshot) => {
  const host = snap.context.host_computer;
  return !!host && (w.name === host || w.name.startsWith(`${host}-`));
};

// "Claude · work1", "Codex · school", "Claude" on the default login, or "Simulated" (fakes the coding)
export const agentLabel = (w: { agent: string; account: string }) =>
  `${w.agent === 'codex' ? 'Codex' : w.agent === 'simulated' ? 'Simulated' : 'Claude'}${w.account ? ` · ${w.account}` : ''}`;
// "$0.04" (or "$0.004" for tiny amounts), what a Claude run cost as reported by claude -p
export const money = (usd: number) => `$${usd > 0 && usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
// "850 tokens", "12.4k tokens", "1.2M tokens"
export const tokenText = (n: number) =>
  `${n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n)} tokens`;

// Light, Dark, or whatever the operating system uses (Settings). index.html applies it before the
// page draws; this keeps it in step after a change.
export type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'tandem-theme';
const readTheme = (): Theme => { try { const t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; } };
let theme = readTheme();
const themeListeners = new Set<() => void>();
export function setTheme(t: Theme) {
  theme = t;
  try { if (t === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* this visit only */ }
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  themeListeners.forEach(f => f());
}
export function ThemeSwitch() {
  const t = useSyncExternalStore(f => { themeListeners.add(f); return () => themeListeners.delete(f); }, () => theme);
  return (
    <div className="unit-switch" role="group" aria-label="Theme">
      {(['system', 'light', 'dark'] as const).map(k => (
        <button key={k} type="button" className={`chip ${t === k ? 'on' : ''}`} aria-pressed={t === k} onClick={() => setTheme(k)}>{k === 'system' ? 'System' : k === 'light' ? 'Light' : 'Dark'}</button>
      ))}
    </div>
  );
}

// Usage shows as dollars or as tokens; the choice is this browser's (Usage page and Settings).
// Dollars are what the runs would cost at API prices: an estimate, so they carry a "~".
export type Unit = 'dollars' | 'tokens';
const UNIT_KEY = 'tandem-usage-unit';
let unit: Unit = (() => { try { return localStorage.getItem(UNIT_KEY) === 'tokens' ? 'tokens' : 'dollars'; } catch { return 'dollars'; } })();
const unitListeners = new Set<() => void>();
export function setUnit(u: Unit) {
  unit = u;
  try { localStorage.setItem(UNIT_KEY, u); } catch { /* this visit only */ }
  unitListeners.forEach(f => f());
}
export const useUnit = () => useSyncExternalStore(f => { unitListeners.add(f); return () => unitListeners.delete(f); }, () => unit);
export const spendText = (usd: number, tokens: number, u: Unit) => (u === 'tokens' ? tokenText(tokens) : `~${money(usd)}`);
export function Spend({ usd, tokens }: { usd: number; tokens: number }) {
  const u = useUnit();
  return <span className="spend" title={u === 'dollars' ? 'Estimated at Claude API prices. On a Pro or Max plan nothing is billed per run.' : 'Tokens used: input, output and cache'}>{spendText(usd, tokens, u)}</span>;
}
export function UnitSwitch() {
  const u = useUnit();
  return (
    <div className="unit-switch" role="group" aria-label="Show usage as">
      {(['dollars', 'tokens'] as const).map(k => (
        <button key={k} type="button" className={`chip ${u === k ? 'on' : ''}`} aria-pressed={u === k} onClick={() => setUnit(k)}>{k === 'dollars' ? 'Dollars' : 'Tokens'}</button>
      ))}
    </div>
  );
}

// The conductor pings every 15 seconds while it runs (its presence kind is still "manager").
export const managerOnline = (snap: Snapshot, now: number) =>
  snap.presence.some(p => p.kind === 'manager' && now - p.lastSeen.getTime() < 45_000);
