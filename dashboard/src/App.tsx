import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { config } from './config';
import { useBrain } from './useBrain';
import { claimable } from './sim';
import { runScenario, SCENARIO_LABEL, type ScenarioName } from './scenarios';
import type { Ev, Snapshot, Task, Worker } from './brain';

type Tab = 'team' | 'tasks' | 'locks' | 'log';

const STATUS_ICON: Record<string, string> = { idle: '○', busy: '▶', capped: '■' };
const STATUS_TEXT: Record<string, string> = { idle: 'Idle', busy: 'Working', capped: 'Capped' };
const TIPS = {
  lock: 'A lock stops two agents from editing the same file at the same time.',
  capacity: 'How much of a teammate\'s Claude usage limit is used up. At 100% they must stop.',
  merge: 'The final task of a big job. It opens when every piece is done and combines the results.',
};

function ago(d: Date, now: number): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// Plain-English reason for where a task is and who has it.
function why(task: Task, snap: Snapshot): string {
  const who = snap.workers.find(w => w.id === task.assignee);
  const kind = task.kind === 'map' ? 'one piece of a big job'
    : task.kind === 'reduce' ? 'combining a big job\'s results'
    : task.difficulty === 'easy' ? 'a small mechanical change'
    : task.difficulty === 'hard' ? 'a hard problem' : 'normal feature work';
  const model = task.model ? `${task.model} model` : 'default model';
  const effort = task.effort && task.effort !== 'default' ? `, ${task.effort} effort` : '';
  if (who) {
    const left = who.usage5h === null ? 'unknown quota' : `${Math.round(100 - who.usage5h)}% quota left`;
    return `${who.name}: ${left}, ${kind}, ${model}${effort}.`;
  }
  if (task.status === 'blocked') {
    const waiting = task.dependsOn.filter(d => snap.tasks.find(t => t.id === d)?.status !== 'done').length;
    return `Waiting for ${waiting} other task${waiting === 1 ? '' : 's'} to finish. It opens by itself when they are done.`;
  }
  if (task.status === 'open') {
    const lock = task.files.map(p => snap.locks.find(l => l.path === p)).find(Boolean);
    if (lock) {
      const holder = snap.tasks.find(t => t.id === lock.taskId);
      return `Waiting for the lock on ${lock.path}. "${holder?.title ?? lock.taskId}" has it. This task starts when it lets go.`;
    }
    const reserved = task.assignee ? snap.workers.find(w => w.id === task.assignee) : undefined;
    if (reserved) return `Reserved for ${reserved.name}. They take it next.`;
    return `Free for the next teammate with headroom (${kind}, ${model}${effort}).`;
  }
  return `${kind}, ${model}${effort}.`;
}

// ---------- panels ----------

function Bar({ label, value }: { label: string; value: number | null }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  const level = v >= 90 ? 'high' : v >= 70 ? 'mid' : 'low';
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
        <div className={`bar-fill ${level}`} style={{ width: `${v}%` }} />
      </div>
      <span className="bar-num">{value === null ? '?' : `${Math.round(value)}%`}</span>
    </div>
  );
}

function WorkerCard({ w, snap, now, flash, onSlide }: {
  w: Worker; snap: Snapshot; now: number; flash: boolean; onSlide?: (w: Worker, v: number) => void;
}) {
  const current = snap.tasks.find(t => t.status === 'claimed' && t.assignee === w.id);
  const [drag, setDrag] = useState<number | null>(null);
  const stale = now - w.lastSeen.getTime() > 120_000;
  return (
    <article className={`card worker ${w.status} ${flash ? 'flash' : ''}`} aria-label={`${w.name}, ${STATUS_TEXT[w.status] ?? w.status}`}>
      <header>
        <strong>{w.name}</strong>
        <span className={`badge plan-${w.plan}`}>{w.plan}</span>
        <span className={`chip st-${w.status}`}><span aria-hidden="true">{STATUS_ICON[w.status] ?? '○'}</span> {STATUS_TEXT[w.status] ?? w.status}</span>
      </header>
      <div className="muted small">{current ? `Working on: ${current.title}` : w.status === 'capped' ? 'Out of quota' : 'Free'}</div>
      <Bar label="5 hours" value={drag ?? w.usage5h} />
      <Bar label="Week" value={w.usageWeek} />
      {onSlide && (
        <label className="slider">
          <span className="small muted" title={TIPS.capacity}>Drag to change their usage</span>
          <input type="range" min={0} max={100} value={drag ?? w.usage5h ?? 0}
            onChange={e => setDrag(Number(e.target.value))}
            onPointerUp={() => { if (drag !== null) { onSlide(w, drag); setDrag(null); } }}
            onKeyUp={() => { if (drag !== null) { onSlide(w, drag); setDrag(null); } }} />
        </label>
      )}
      <div className={`small ${stale ? 'warn' : 'muted'}`}>{stale ? 'Stale: ' : ''}updated {ago(w.lastSeen, now)}</div>
    </article>
  );
}

function TaskCard({ t, snap, selected, flash, onSelect }: {
  t: Task; snap: Snapshot; selected: boolean; flash: boolean; onSelect: (id: string) => void;
}) {
  const who = snap.workers.find(w => w.id === t.assignee);
  const waitingOnLock = t.status === 'open' && !claimable(snap, { ...t, assignee: null }, '');
  return (
    <button type="button" className={`card task ${selected ? 'selected' : ''} ${flash ? 'flash' : ''}`} onClick={() => onSelect(t.id)} aria-pressed={selected}>
      <span className="task-title">{t.title}{t.kind === 'reduce' && <span className="badge" title={TIPS.merge}>merge</span>}</span>
      <span className="files mono small">{t.files.join(', ') || 'no files'}</span>
      <span className="chips">
        <span className="chip">{t.model || 'auto model'}</span>
        <span className="chip">{t.effort || 'default'} effort</span>
        {who && <span className="chip who">{who.name}</span>}
        {t.status === 'open' && t.assignee && !who && <span className="chip">reserved</span>}
        {waitingOnLock && <span className="chip warn-chip" title={TIPS.lock}>⏳ waiting for lock</span>}
        {t.status === 'blocked' && <span className="chip">🔒 waits for {t.dependsOn.length}</span>}
      </span>
    </button>
  );
}

const COLUMNS: { key: string; title: string; match: (t: Task) => boolean }[] = [
  { key: 'open', title: 'Open', match: t => t.status === 'open' },
  { key: 'running', title: 'Running', match: t => t.status === 'claimed' },
  { key: 'blocked', title: 'Blocked', match: t => t.status === 'blocked' },
  { key: 'done', title: 'Done', match: t => t.status === 'done' || t.status === 'failed' },
];

function Board({ snap, selected, flashIds, onSelect }: {
  snap: Snapshot; selected: string | null; flashIds: Set<string>; onSelect: (id: string) => void;
}) {
  const jobs = useMemo(() => {
    const ids = [...new Set(snap.tasks.filter(t => t.jobId).map(t => t.jobId!))];
    return ids.map(id => {
      const maps = snap.tasks.filter(t => t.jobId === id && t.kind === 'map');
      return { id, done: maps.filter(t => t.status === 'done').length, total: maps.length };
    });
  }, [snap.tasks]);
  return (
    <section aria-label="Task board">
      {jobs.map(j => (
        <div className="job" key={j.id}>
          <div className="job-head"><strong>Big job</strong><span>{j.done}/{j.total} pieces done</span></div>
          <div className="bar tall" role="progressbar" aria-valuemin={0} aria-valuemax={j.total} aria-valuenow={j.done}>
            <div className="bar-fill job-fill" style={{ width: `${j.total ? (100 * j.done) / j.total : 0}%` }} />
          </div>
        </div>
      ))}
      <div className="columns">
        {COLUMNS.map(c => {
          const items = snap.tasks.filter(c.match);
          return (
            <div className="column" key={c.key}>
              <h3>{c.title} <span className="count">{items.length}</span></h3>
              {items.map(t => <TaskCard key={t.id} t={t} snap={snap} selected={selected === t.id} flash={flashIds.has(t.id)} onSelect={onSelect} />)}
              {items.length === 0 && <div className="empty small muted">Nothing here</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LocksPanel({ snap, selectedTask }: { snap: Snapshot; selectedTask: Task | undefined }) {
  return (
    <>
      <section aria-label="Locks">
        <h3 title={TIPS.lock}>Locked files <span className="count">{snap.locks.length}</span></h3>
        {snap.locks.length === 0 && <div className="empty small muted">No files are locked.</div>}
        <ul className="plain">
          {snap.locks.map(l => {
            const w = snap.workers.find(x => x.id === l.workerId);
            const t = snap.tasks.find(x => x.id === l.taskId);
            return (
              <li key={l.path} className="lock-row">
                <span className="mono small">🔒 {l.path}</span>
                <span className="small muted">held by {w?.name ?? l.workerId}{t ? ` for "${t.title}"` : ''}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label="Why this assignment" className="why">
        <h3>Why this assignment?</h3>
        {selectedTask
          ? <><strong>{selectedTask.title}</strong><p>{why(selectedTask, snap)}</p></>
          : <p className="muted small">Click any task to see why it is where it is.</p>}
      </section>
    </>
  );
}

const EV_ICON: Record<string, string> = {
  task_created: '＋', task_assigned: '→', task_claimed: '▶', task_done: '✓', task_failed: '✕', progress: '…',
  lock_taken: '🔒', lock_released: '🔓', worker_capped: '■', worker_idle: '○', job_progress: '▤', merge_unblocked: '★',
};

function Log({ events, now }: { events: Ev[]; now: number }) {
  return (
    <section aria-label="Event log">
      <h3>What just happened</h3>
      {events.length === 0 && <div className="empty small muted">Nothing yet.</div>}
      <ol className="plain log" reversed>
        {events.slice(0, 60).map(e => (
          <li key={e.id}><span aria-hidden="true" className="ev-icon">{EV_ICON[e.type] ?? '•'}</span>
            <span>{e.message}</span><span className="muted small time">{ago(e.time, now)}</span></li>
        ))}
      </ol>
    </section>
  );
}

// ---------- app ----------

const BREAKS: ScenarioName[] = ['limit', 'samefile', 'idle'];
const STEPS = ['Run it', 'Break it', 'Poke around', 'Reset'];

export function App() {
  const { snap, api, status } = useBrain();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('tasks');
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const readOnly = config.live || config.present || status !== 'connected';

  // Highlight whatever just changed.
  const prev = useRef(new Map<string, string>());
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map<string, string>();
    const changed = new Set<string>();
    for (const t of snap.tasks) next.set(t.id, `${t.status}|${t.assignee}`);
    for (const w of snap.workers) next.set(w.id, `${w.status}|${w.usage5h}`);
    next.forEach((sig, id) => { if (prev.current.size && prev.current.get(id) !== sig) changed.add(id); });
    prev.current = next;
    if (changed.size) {
      setFlashIds(changed);
      const id = window.setTimeout(() => setFlashIds(new Set()), 1200);
      return () => window.clearTimeout(id);
    }
  }, [snap.tasks, snap.workers]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const run = useCallback(async (name: ScenarioName) => {
    if (!api || busy) return;
    setBusy(true);
    setToast(SCENARIO_LABEL[name] + '…');
    setUsed(u => new Set(u).add(name));
    try {
      setToast(await runScenario(name, api, snap));
    } catch (e) {
      setToast('Could not do that: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [api, snap, busy]);

  const slide = useCallback((w: Worker, v: number) => {
    if (!api) return;
    setUsed(u => new Set(u).add('poke'));
    api.capacity(w.id, { usage5h: v, status: w.status === 'capped' && v < 100 ? 'idle' : undefined })
      .then(() => setToast(`${w.name}'s usage is now ${v}%.`))
      .catch(e => setToast('Could not do that: ' + (e instanceof Error ? e.message : String(e))));
  }, [api]);

  const pickTask = (id: string) => { setSelected(id); setUsed(u => new Set(u).add('poke')); };

  const openShare = async () => {
    const url = location.origin + location.pathname;
    try { setShare(await QRCode.toDataURL(url, { margin: 1, width: 240 })); } catch { setShare(''); }
  };

  const step = snap.tasks.length === 0 ? 0 : !BREAKS.some(b => used.has(b)) ? 1 : !used.has('poke') ? 2 : 3;
  const selectedTask = snap.tasks.find(t => t.id === selected);
  const empty = snap.tasks.length === 0;
  const modeLabel = config.live ? 'Live' : 'Simulated workers';

  const scenarioButtons = (
    <div className="scenarios" role="group" aria-label="Scenarios">
      {(['demo', 'mapreduce'] as ScenarioName[]).map(n => (
        <button key={n} type="button" className={`btn primary ${step === 0 ? 'next' : ''}`} disabled={readOnly || busy} onClick={() => run(n)}>{SCENARIO_LABEL[n]}</button>
      ))}
      {BREAKS.map(n => (
        <button key={n} type="button" className={`btn danger ${step === 1 ? 'next' : ''}`} disabled={readOnly || busy || empty} onClick={() => run(n)}>{SCENARIO_LABEL[n]}</button>
      ))}
    </div>
  );

  return (
    <div className={`app ${config.present ? 'present' : ''}`}>
      <header className="topbar">
        <h1>Tandem</h1>
        <span className={`badge mode ${config.live ? 'live' : 'sim'}`} title={config.live ? 'Real Claude sessions on real machines' : 'The coordination is real. Only the coding is faked, so it is safe and instant.'}>
          {config.live ? '● ' : ''}{modeLabel}
        </span>
        <span className={`conn ${status}`} role="status">
          {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
        <span className="spacer" />
        {!config.present && <button type="button" className="btn" onClick={openShare}>Share</button>}
        {!readOnly && !config.live && <button type="button" className="btn" onClick={() => run('reset')} disabled={busy}>Reset</button>}
      </header>

      {status === 'offline' && (
        <div className="banner" role="alert">
          Can't reach the brain at {config.uri}. Showing a still picture of the demo data. Controls are off.
        </div>
      )}

      {!config.present && (
        <div className="scenario-bar">
          <ol className="stepper" aria-label="Steps">
            {STEPS.map((s, i) => <li key={s} className={i === step ? 'now' : i < step ? 'past' : ''} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span> {s}</li>)}
          </ol>
          {scenarioButtons}
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        {(['team', 'tasks', 'locks', 'log'] as Tab[]).map(t => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-pressed={tab === t}>
            {{ team: 'Team', tasks: 'Tasks', locks: 'Locks', log: 'Log' }[t]}
          </button>
        ))}
      </nav>

      {empty && status === 'connected' ? (
        <main className="empty-state">
          <h2>Your team's AI coders, working as one.</h2>
          <p>Tandem stops Claude agents from colliding on the same files, and hands work to whoever has room.</p>
          {!readOnly && <button type="button" className="btn primary big next" onClick={() => run('demo')} disabled={busy}>Run the demo</button>}
          <div className="team-strip">
            {snap.workers.map(w => <span key={w.id} className="chip">{w.name} · {w.plan}</span>)}
          </div>
        </main>
      ) : (
        <main className="grid">
          <div className={`panel team ${tab === 'team' ? 'show' : ''}`}>
            <h2>Team</h2>
            {snap.workers.map(w => <WorkerCard key={w.id} w={w} snap={snap} now={now} flash={flashIds.has(w.id)} onSlide={readOnly ? undefined : slide} />)}
          </div>
          <div className={`panel tasks ${tab === 'tasks' ? 'show' : ''}`}>
            <h2>Tasks</h2>
            <Board snap={snap} selected={selected} flashIds={flashIds} onSelect={pickTask} />
          </div>
          <div className={`panel locks ${tab === 'locks' ? 'show' : ''}`}>
            <h2>Locks</h2>
            <LocksPanel snap={snap} selectedTask={selectedTask} />
          </div>
          <div className={`panel log ${tab === 'log' ? 'show' : ''}`}>
            <h2>Log</h2>
            <Log events={snap.events} now={now} />
          </div>
        </main>
      )}

      {!config.present && <div className="bottom-bar">{scenarioButtons}</div>}

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      {share !== null && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Share" onClick={() => setShare(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h2>Try it yourself</h2>
            {share ? <img src={share} alt="QR code for this page" width={240} height={240} /> : <p>Could not make a QR code.</p>}
            <p className="small mono">{location.origin + location.pathname}</p>
            <button type="button" className="btn" onClick={() => setShare(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
