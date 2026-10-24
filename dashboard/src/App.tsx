import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { config } from './config';
import { useBrain } from './useBrain';
import { claimable } from './sim';
import { runScenario, SCENARIO_LABEL, type ScenarioName } from './scenarios';
import { Manage } from './Manage';
import { Join } from './Join';
import type { Api, Ev, Snapshot, Task, Worker } from './brain';

type Tab = 'team' | 'tasks' | 'locks' | 'log' | 'manage';

const STATUS_ICON: Record<string, string> = { idle: '○', busy: '▶', capped: '■' };
const STATUS_TEXT: Record<string, string> = { idle: 'Idle', busy: 'Working', capped: 'Capped' };
const TIPS = {
  lock: 'A lock stops two agents from editing the same file at the same time.',
  capacity: 'How much of a teammate\'s Claude usage limit is used up. At 100% they must stop.',
  merge: 'The final task of a big job. It opens when every piece is done and combines the results.',
};

// A task is always in exactly one of four stages.
type Stage = 'waiting' | 'ready' | 'working' | 'done';
const stageOf = (t: Task): Stage =>
  t.status === 'blocked' ? 'waiting' : t.status === 'open' ? 'ready' : t.status === 'claimed' ? 'working' : 'done';
const STAGES: { key: Stage; title: string; hint: string }[] = [
  { key: 'waiting', title: 'Waiting', hint: 'Needs other tasks to finish first' },
  { key: 'ready', title: 'Ready', hint: 'Free for the next teammate' },
  { key: 'working', title: 'Working', hint: 'A teammate is on it now' },
  { key: 'done', title: 'Done', hint: 'Finished' },
];

function ago(d: Date, now: number): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
function took(d: Date, now: number): string {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

// When a working task started and its latest progress note, read from the event log.
function liveInfo(t: Task, events: Ev[]): { since: Date | null; note: string | null } {
  const started = events.find(e => e.type === 'task_claimed' && e.message.endsWith(`: ${t.title}`));
  const progress = events.find(e => e.type === 'progress' && e.message.startsWith(`${t.title}: `));
  return { since: started?.time ?? null, note: progress ? progress.message.slice(t.title.length + 2) : null };
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

// ---------- pieces ----------

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
  const info = current ? liveInfo(current, snap.events) : null;
  const [drag, setDrag] = useState<number | null>(null);
  const stale = now - w.lastSeen.getTime() > 120_000;
  return (
    <article className={`card worker ${w.status} ${flash ? 'flash' : ''}`} aria-label={`${w.name}, ${STATUS_TEXT[w.status] ?? w.status}`}>
      <header>
        <strong>{w.name}</strong>
        <span className={`badge plan-${w.plan}`}>{w.plan}</span>
        <span className={`chip st-${w.status}`}><span aria-hidden="true">{STATUS_ICON[w.status] ?? '○'}</span> {STATUS_TEXT[w.status] ?? w.status}</span>
      </header>
      <div className="muted small">
        {current ? <>Working on: {current.title}{info?.since ? ` · ${took(info.since, now)}` : ''}</> : w.status === 'capped' ? 'Out of quota' : 'Free'}
      </div>
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

function TaskCard({ t, snap, now, selected, flash, onSelect }: {
  t: Task; snap: Snapshot; now: number; selected: boolean; flash: boolean; onSelect: (id: string) => void;
}) {
  const who = snap.workers.find(w => w.id === t.assignee);
  const stage = stageOf(t);
  const waitingOnLock = stage === 'ready' && !claimable(snap, { ...t, assignee: null }, '');
  const info = stage === 'working' ? liveInfo(t, snap.events) : null;
  const waitsFor = stage === 'waiting'
    ? t.dependsOn.map(d => snap.tasks.find(x => x.id === d)).filter((x): x is Task => !!x && x.status !== 'done')
    : [];
  return (
    <button type="button" className={`card task stage-${stage} ${selected ? 'selected' : ''} ${flash ? 'flash' : ''}`} onClick={() => onSelect(t.id)} aria-pressed={selected}>
      <span className="task-title">{t.title}{t.kind === 'reduce' && <span className="badge" title={TIPS.merge}>merge</span>}</span>
      <span className="files mono small" title={t.files.join(', ')}>{t.files.join(', ') || 'no files'}</span>
      {stage === 'working' && (
        <span className="working">
          <span className="work-bar" aria-hidden="true"><i /></span>
          <span className="small"><strong>{who?.name ?? 'Someone'}</strong>{info?.since ? ` · ${took(info.since, now)}` : ''}</span>
          {info?.note && <span className="small muted">“{info.note}”</span>}
        </span>
      )}
      {stage === 'done' && <span className="small done-line">✓ {who ? `Finished by ${who.name}` : 'Finished'}</span>}
      {stage === 'waiting' && <span className="small muted">Waits for {waitsFor.length > 0 ? waitsFor.slice(0, 2).map(x => x.title).join(', ') + (waitsFor.length > 2 ? ` +${waitsFor.length - 2}` : '') : 'other tasks'}</span>}
      <span className="chips">
        <span className="chip">{t.model || 'auto model'}</span>
        {t.effort && t.effort !== 'default' && <span className="chip">{t.effort} effort</span>}
        {stage === 'ready' && t.assignee && <span className="chip">reserved{who ? ` for ${who.name}` : ''}</span>}
        {waitingOnLock && <span className="chip warn-chip" title={TIPS.lock}>⏳ waiting for lock</span>}
      </span>
    </button>
  );
}

function Summary({ snap }: { snap: Snapshot }) {
  const total = snap.tasks.length;
  const counts = { waiting: 0, ready: 0, working: 0, done: 0 };
  for (const t of snap.tasks) counts[stageOf(t)]++;
  const pct = total ? Math.round((100 * counts.done) / total) : 0;
  return (
    <section className="summary" aria-label="Progress">
      <div className="summary-top">
        <strong>{counts.done} of {total} tasks done</strong>
        <span className="muted small">{pct}%</span>
      </div>
      <div className="bar tall" role="progressbar" aria-label="All tasks" aria-valuemin={0} aria-valuemax={total} aria-valuenow={counts.done}>
        <div className="bar-fill job-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="stage-chips">
        {STAGES.map(s => <span key={s.key} className={`stage-chip stage-${s.key}`} title={s.hint}>{counts[s.key]} {s.title.toLowerCase()}</span>)}
      </div>
    </section>
  );
}

function Board({ snap, now, selected, flashIds, onSelect }: {
  snap: Snapshot; now: number; selected: string | null; flashIds: Set<string>; onSelect: (id: string) => void;
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
      <div className="columns" style={{ '--cols': STAGES.map(s => {
        const n = snap.tasks.filter(t => stageOf(t) === s.key).length;
        return n === 0 ? '0.55fr' : n > 6 ? '2.4fr' : '1fr';
      }).join(' ') } as React.CSSProperties}>
        {STAGES.map((s, i) => {
          const items = snap.tasks.filter(t => stageOf(t) === s.key);
          return (
            <div className="column" key={s.key}>
              <h3 title={s.hint}>{s.title} <span className="count">{items.length}</span>{i < STAGES.length - 1 && <span className="arrow" aria-hidden="true">→</span>}</h3>
              <div className={`list ${items.length > 6 ? 'wrap' : ''}`}>
                {items.map(t => <TaskCard key={t.id} t={t} snap={snap} now={now} selected={selected === t.id} flash={flashIds.has(t.id)} onSelect={onSelect} />)}
              </div>
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

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'task';

// The one box: tell the team what you want.
function PromptBar({ api, snap, canSend, run, say }: {
  api: Api | null; snap: Snapshot; canSend: boolean; run: (n: ScenarioName) => void; say: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const goal = text.trim();
    if (!api || !goal || busy) return;
    setBusy(true);
    try {
      if (config.team) {
        await api.postGoal(goal);
        say('Sent. The manager Claude will plan it.');
      } else {
        // Demo has no manager: turn what you typed into one task so you can watch it flow.
        await api.createTask({ id: 't-' + Math.random().toString(36).slice(2, 7), title: goal, files: [`work/${slug(goal)}.txt`], difficulty: 'normal' });
        say('Task created. A simulated teammate picks it up.');
      }
      setText('');
    } catch (err) {
      say('Could not do that: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="prompt" aria-label="Tell the team what to do">
      <form onSubmit={send}>
        <input value={text} onChange={e => setText(e.target.value)} disabled={!canSend || busy}
          aria-label="What should your team build?"
          placeholder={canSend ? 'What should your team build?' : 'View only: ask the operator to approve you'} />
        <button type="submit" className="btn primary" disabled={!canSend || busy || !text.trim()}>Send</button>
      </form>
      {config.demo ? (
        <div className="prompt-chips">
          <span className="muted small">Or try one:</span>
          <button type="button" className="chip-btn" disabled={!canSend} onClick={() => run('demo')}>Build a login page with an API</button>
          <button type="button" className="chip-btn" disabled={!canSend} onClick={() => run('mapreduce')}>Review all 12 modules</button>
        </div>
      ) : (
        <>
          <p className="muted small">The manager Claude splits it into tasks and hands them to whoever has room.</p>
          {snap.goals.length > 0 && (
            <ul className="plain goals" aria-label="Goals">
              {snap.goals.slice(0, 3).map(g => (
                <li key={g.id}>
                  <span className="goal-text">{g.text}</span>
                  <span className={`chip goal-${g.status}`}>
                    {g.status === 'new' ? 'Waiting for the manager' : g.status === 'planning' ? 'Being planned' : '✓ Planned'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------- app ----------

const BREAKS: ScenarioName[] = ['limit', 'samefile', 'idle'];
const STEPS = ['Send a goal', 'Break it', 'Poke around', 'Reset'];

export function App() {
  const { snap, api, status, me } = useBrain();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('tasks');
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const isOp = !!me && snap.operators.includes(me);
  const connected = status === 'connected';
  // Demo: everyone may drive their own sandbox. Team: only operators may change anything.
  const canAct = connected && !config.present && (config.demo || isOp);

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
  const goTab = (t: Tab) => { setTab(t); if (t === 'manage') setManageOpen(true); };

  const openShare = async () => {
    const url = location.origin + location.pathname;
    try { setShare(await QRCode.toDataURL(url, { margin: 1, width: 240 })); } catch { setShare(''); }
  };

  const step = snap.tasks.length === 0 ? 0 : !BREAKS.some(b => used.has(b)) ? 1 : !used.has('poke') ? 2 : 3;
  const selectedTask = snap.tasks.find(t => t.id === selected);
  const tabs: Tab[] = config.team ? ['tasks', 'team', 'locks', 'log', 'manage'] : ['tasks', 'team', 'locks', 'log'];
  const TAB_LABEL: Record<Tab, string> = { tasks: 'Tasks', team: 'Team', locks: 'Locks', log: 'Log', manage: 'Manage' };

  return (
    <div className={`app ${config.present ? 'present' : ''}`}>
      <header className="topbar">
        <h1>Tandem</h1>
        {!config.present && (
          <nav className="seg" aria-label="Mode">
            <a href="?" aria-current={config.demo ? 'page' : undefined} title="Your own private sandbox with simulated workers">Demo</a>
            <a href="?mode=team" aria-current={config.team ? 'page' : undefined} title="The real team session">My team</a>
          </nav>
        )}
        <span className={`conn ${status}`} role="status">
          {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Offline'}
        </span>
        {config.demo && <span className="badge mode sim" title="The coordination is real. Only the coding is faked, so it is safe and instant.">Simulated workers</span>}
        <span className="spacer" />
        {!config.present && config.team && <button type="button" className="btn" onClick={() => setJoining(true)}>Add a teammate</button>}
        {!config.present && <button type="button" className="btn" onClick={openShare}>Share</button>}
        {canAct && config.demo && <button type="button" className="btn" onClick={() => run('reset')} disabled={busy}>Reset</button>}
      </header>

      {status === 'offline' && (
        <div className="banner" role="alert">
          Can't reach the brain at {config.uri}. Showing a still picture of the demo data. Controls are off.
        </div>
      )}

      {config.team && connected && !config.present && !isOp && (
        <div className="notice" role="status">
          {snap.operators.length === 0 ? (
            <>
              <span><strong>You're first here.</strong> Claim this team to send goals and manage it.</span>
              <button type="button" className="btn primary" disabled={!api} onClick={() => api!.claimOperator().then(() => setToast('You now run this team.'), e => setToast('Could not do that: ' + (e instanceof Error ? e.message : String(e))))}>Claim this team</button>
            </>
          ) : (
            <>
              <span><strong>View only.</strong> An operator has to approve you before you can change anything.</span>
              {me && <button type="button" className="link" data-identity={me} onClick={() => { void navigator.clipboard?.writeText(me); setToast('Your identity is copied. Send it to the operator.'); }}>Copy my identity</button>}
            </>
          )}
        </div>
      )}

      {!config.present && <PromptBar api={api} snap={snap} canSend={canAct} run={run} say={setToast} />}

      {snap.tasks.length > 0 && <Summary snap={snap} />}

      {config.demo && !config.present && snap.tasks.length > 0 && (
        <div className="scenario-bar">
          <ol className="stepper" aria-label="Steps">
            {STEPS.map((s, i) => <li key={s} className={i === step ? 'now' : i < step ? 'past' : ''} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span> {s}</li>)}
          </ol>
          <div className="scenarios" role="group" aria-label="Try breaking it">
            {BREAKS.map(n => (
              <button key={n} type="button" className={`btn danger ${step === 1 ? 'next' : ''}`} disabled={!canAct || busy} onClick={() => run(n)}>{SCENARIO_LABEL[n]}</button>
            ))}
          </div>
        </div>
      )}

      <nav className="tabs" aria-label="Sections">
        {tabs.map(t => (
          <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => goTab(t)} aria-pressed={tab === t}>{TAB_LABEL[t]}</button>
        ))}
      </nav>

      {snap.tasks.length === 0 && connected && snap.workers.length === 0 && config.demo ? (
        <main className="empty-state"><p className="muted">Setting up your sandbox…</p></main>
      ) : (
        <main className="grid">
          <div className={`panel team ${tab === 'team' ? 'show' : ''}`}>
            <h2>Team</h2>
            {snap.workers.length === 0 && <p className="muted small">No teammates yet. Each one appears here when their Claude calls register_worker.{config.team && ' Use "Add a teammate" to see how.'}</p>}
            {snap.workers.map(w => <WorkerCard key={w.id} w={w} snap={snap} now={now} flash={flashIds.has(w.id)} onSlide={config.demo && canAct ? slide : undefined} />)}
          </div>
          <div className={`panel tasks ${tab === 'tasks' ? 'show' : ''}`}>
            <h2>Tasks</h2>
            {snap.tasks.length === 0
              ? <p className="muted">{config.team ? 'No tasks yet. Send a goal above, or add tasks by hand under Manage.' : 'No tasks yet. Send a goal above, or pick one of the examples.'}</p>
              : <Board snap={snap} now={now} selected={selected} flashIds={flashIds} onSelect={pickTask} />}
          </div>
          <div className={`panel locks ${tab === 'locks' ? 'show' : ''}`}>
            <h2>Locks</h2>
            <LocksPanel snap={snap} selectedTask={selectedTask} />
          </div>
          <div className={`panel log ${tab === 'log' ? 'show' : ''}`}>
            <h2>Log</h2>
            <Log events={snap.events} now={now} />
          </div>
          {config.team && !config.present && (
            <div className={`panel manage-panel ${tab === 'manage' ? 'show' : ''}`}>
              <details open={manageOpen} onToggle={e => setManageOpen(e.currentTarget.open)}>
                <summary>Manage: add tasks by hand, shared notes, who can operate</summary>
                <Manage api={api} snap={snap} me={me} say={setToast} />
              </details>
            </div>
          )}
        </main>
      )}

      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
      {joining && <Join onClose={() => setJoining(false)} say={setToast} />}
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
