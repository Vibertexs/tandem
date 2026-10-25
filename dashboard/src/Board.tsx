// The main page: tell the team what to build, then watch the tasks move across the board.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Api, Goal, Snapshot, Task } from './brain';
import { Avatar, EV_ICON, agentLabel, STAGES, ago, copy, isManager, liveInfo, lockBlocking, managerOnline, modelFor, money, online, stageOf, took, why, type Stage } from './ui';

type Props = { snap: Snapshot; api: Api | null; isOp: boolean; now: number; say: (m: string) => void; present: boolean; go: (page: string) => void };

// One thing to do next, never a checklist. Highest priority first.
function NextStep({ snap, api, isOp, now, say, go, openTask }: Props & { openTask: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!isOp) return null;
  const req = snap.requests[0];
  if (req) {
    const act = async (fn: () => Promise<unknown>, done: string) => {
      setBusy(true);
      try { await fn(); say(done); } catch (e) { say('Could not do that: ' + (e as Error).message); } finally { setBusy(false); }
    };
    return (
      <div className="next card" role="status">
        <span className="next-icon" aria-hidden="true">✋</span>
        <div>
          <strong>{req.name} wants to control this team.</strong>
          <p className="small muted">{isManager(req.name) ? 'This is the manager: approve it so it can plan your goals.' : 'Approve to let this browser send goals and change the team.'}{snap.requests.length > 1 ? ` (${snap.requests.length - 1} more in Settings)` : ''}</p>
        </div>
        <div className="row-actions">
          <button type="button" className="btn primary" disabled={busy || !api} onClick={() => act(() => api!.approve(req.identity), `${req.name} can now manage the team.`)}>Approve</button>
          <button type="button" className="btn" disabled={busy || !api} onClick={() => act(() => api!.dismiss(req.identity), 'Request dismissed.')}>Dismiss</button>
        </div>
      </div>
    );
  }
  const unplanned = snap.goals.find(g => g.status === 'failed');
  if (unplanned) {
    return (
      <div className="next card alert" role="status">
        <span className="next-icon" aria-hidden="true">⚠</span>
        <div><strong>The manager could not plan "{unplanned.text.slice(0, 80)}".</strong>
          <p className="small muted">{unplanned.note}</p></div>
        <button type="button" className="btn" disabled={busy || !api} onClick={async () => {
          setBusy(true);
          try { await api!.retryGoal(unplanned.id); say('Sent to the manager again.'); }
          catch (e) { say('Could not do that: ' + (e as Error).message); }
          finally { setBusy(false); }
        }}>Try again</button>
      </div>
    );
  }
  const failed = snap.tasks.filter(t => t.status === 'failed');
  if (failed.length > 0) {
    return (
      <div className="next card alert" role="status">
        <span className="next-icon" aria-hidden="true">⚠</span>
        <div><strong>{failed.length === 1 ? `"${failed[0].title}" needs you.` : `${failed.length} tasks need you.`}</strong>
          <p className="small muted">Two workers could not finish {failed.length === 1 ? 'it' : 'them'}: {failed[0].resultSummary ?? 'no reason given'}. Open the task to read why, then try again.</p></div>
        <button type="button" className="btn" onClick={() => openTask(failed[0].id)}>Open it</button>
      </div>
    );
  }
  const hasManager = snap.operators.some(o => isManager(o.name));
  if (hasManager && !managerOnline(snap, now) && snap.goals.some(g => g.status === 'new')) {
    return (
      <div className="next card subtle">
        <span className="next-icon" aria-hidden="true">💤</span>
        <div><strong>The manager is offline, so new goals are waiting.</strong>
          <p className="small muted">On the host, run <code className="mono">tandem start</code> again in the project's folder. It picks up where it left off.</p></div>
      </div>
    );
  }
  if (!hasManager) {
    return (
      <div className="next card subtle">
        <span className="next-icon" aria-hidden="true">🧭</span>
        <div><strong>The manager is not connected yet.</strong>
          <p className="small muted">It turns your goals into tasks. On the host, run <code className="mono">tandem start</code> in the project's folder; then approve "Manager Claude" here. You can still add tasks by hand in Settings.</p></div>
      </div>
    );
  }
  if (!snap.workers.some(w => online(w, now))) {
    return (
      <div className="next card subtle">
        <span className="next-icon" aria-hidden="true">💻</span>
        <div><strong>No workers are online.</strong>
          <p className="small muted">Tasks wait until a worker picks them up. Start workers with <code className="mono">tandem start</code>, or invite another computer.</p></div>
        <button type="button" className="btn" onClick={() => go('team')}>Connect a computer</button>
      </div>
    );
  }
  return null;
}

function Prompt({ snap, api, isOp, say }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = snap.goals[0];
  // "/" jumps to the prompt, like search boxes do
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === '/' && !typing && input.current && !input.current.disabled) { e.preventDefault(); input.current.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!api || !text.trim() || busy) return;
    setBusy(true);
    try { await api.postGoal(text.trim()); setText(''); say('Sent. The manager is planning it.'); }
    catch (err) { say('Could not send: ' + (err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <section className="prompt" aria-label="Send work to the team">
      <form onSubmit={send} className={isOp ? '' : 'readonly'}>
        <input ref={input} value={text} onChange={e => setText(e.target.value)} disabled={!isOp || busy}
          aria-label="Describe what you want built"
          placeholder={isOp ? 'Describe what you want built…' : 'Watching: request control to send work'} />
        <button type="submit" className="btn primary" disabled={!isOp || busy || !text.trim()}>Send</button>
      </form>
    </section>
  );
}

export function GoalChip({ status }: { status: string }) {
  const text = status === 'new' ? '⏳ Waiting for the manager' : status === 'planning' ? '✎ Being planned'
    : status === 'done' ? '✓ Done' : status === 'failed' ? '✕ Could not plan' : status === 'cancelled' ? 'Cancelled' : '▶ Planned';
  return <span className={`chip goal-${status}`}>{text}</span>;
}

// One goal and its tasks: a swimlane. The header says what was asked and how it is going; the
// body is the goal's tasks in the four stages. A goal that was already finished starts folded.
type Lane = { key: string; goal: Goal | null; tasks: Task[] };
const FINISHED = ['done', 'cancelled'];
const EMPTY_LANE: Record<string, string> = {
  new: 'Waiting for the manager to plan it.', planning: 'The manager is splitting it into tasks…',
  planned: 'No tasks.', cancelled: 'Cancelled before any work started.', done: 'Done.', failed: '',
};

function GoalLane({ lane, p, open, setOpen, flash }: { lane: Lane; p: Props; open: string | null; setOpen: (id: string) => void; flash: Set<string> }) {
  const { snap, now, isOp, api, say } = p;
  const g = lane.goal;
  const [expanded, setExpanded] = useState(!(g && FINISHED.includes(g.status)));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); say(done); } catch (e) { say('Could not do that: ' + (e as Error).message); } finally { setBusy(false); setConfirm(false); }
  };
  const done = lane.tasks.filter(t => t.status === 'done').length;
  const cost = (g?.costUsd ?? 0) + lane.tasks.reduce((sum, t) => sum + t.costUsd, 0);
  // when it was finished, from the brain's "Goal done" log line
  const short = g && (g.text.length > 60 ? g.text.slice(0, 57) + '...' : g.text);
  const doneAt = g?.status === 'done' ? snap.events.find(e => e.type === 'merge_unblocked' && e.message.startsWith(`Goal done: ${short}`))?.time : undefined;
  const meta = g ? [
    `sent ${ago(g.createdAt, now)}`,
    doneAt ? `done in ${took(g.createdAt, doneAt.getTime())}` : '',
    cost > 0 ? `${money(cost)} of Claude usage` : '',
  ].filter(Boolean).join(' · ') : 'Added by hand, not part of a goal';
  const warn = g && (g.status === 'failed' || /fail|could not|not on this|by hand/i.test(g.note));
  return (
    <section className={`goal-lane goal-${g?.status ?? 'other'} ${expanded ? '' : 'folded'}`} aria-label={g ? `Goal: ${g.text}` : 'Other tasks'}>
      <header className="lane-head">
        <button type="button" className="lane-toggle" aria-expanded={expanded} aria-label={expanded ? 'Fold' : 'Unfold'} onClick={() => setExpanded(!expanded)}>{expanded ? '▾' : '▸'}</button>
        <div className="lane-title">
          <strong className="goal-text">{g ? g.text : 'Other tasks'}</strong>
          <span className="small muted">{meta}</span>
        </div>
        {lane.tasks.length > 0 && (
          <span className="lane-progress">
            <span className="bar"><span className="bar-fill job-fill" style={{ width: `${Math.round((100 * done) / lane.tasks.length)}%` }} /></span>
            <span className="small muted nowrap">{done}/{lane.tasks.length}</span>
          </span>
        )}
        {g && <GoalChip status={g.status} />}
        {g && isOp && api && !FINISHED.includes(g.status) && !confirm && (
          <button type="button" className="link small cancel-goal" onClick={() => setConfirm(true)}>Cancel goal</button>
        )}
      </header>
      {g && confirm && (
        <p className="small row-actions lane-foot">Cancel this goal? Tasks not started yet are removed.
          <button type="button" className="btn danger small-btn" disabled={busy} onClick={() => act(() => api!.cancelGoal(g.id), 'Goal cancelled.')}>Yes, cancel it</button>
          <button type="button" className="btn small-btn" onClick={() => setConfirm(false)}>Keep it</button>
        </p>
      )}
      {(g?.note || g?.branch || (isOp && api && g?.status === 'failed')) && (
        <div className="lane-foot">
          {g?.note && <span className={`small goal-note ${warn ? 'warn' : 'ok-note'}`}>{g.note}</span>}
          {g?.branch && (
            <span className="small branch">
              Work is on <code className="mono">{g.branch}</code>{' '}
              <button type="button" className="link" onClick={() => copy(`git checkout ${g.branch}`, say, `Copied: git checkout ${g.branch}`)}>copy git checkout</button>
            </span>
          )}
          {g && isOp && api && g.status === 'failed' && <button type="button" className="btn small-btn" disabled={busy} onClick={() => act(() => api.retryGoal(g.id), 'Sent to the manager again.')}>Try again</button>}
        </div>
      )}
      {expanded && (lane.tasks.length === 0
        ? (g && EMPTY_LANE[g.status] ? <p className="small muted lane-empty">{EMPTY_LANE[g.status]}</p> : null)
        : (
          <div className="lane-body">
            {STAGES.map(s => {
              const items = lane.tasks.filter(t => stageOf(t) === s.key);
              return (
                <div className="column" key={s.key} aria-label={s.title}>
                  {items.map(t => <Card key={t.id} t={t} snap={snap} now={now} selected={open === t.id} flash={flash.has(t.id)} onOpen={() => setOpen(t.id)} />)}
                </div>
              );
            })}
          </div>
        ))}
    </section>
  );
}

function Summary({ snap }: { snap: Snapshot }) {
  const total = snap.tasks.length;
  const counts: Record<Stage, number> = { waiting: 0, todo: 0, doing: 0, done: 0 };
  for (const t of snap.tasks) counts[stageOf(t)]++;
  const pct = total ? Math.round((100 * counts.done) / total) : 0;
  const jobs = [...new Set(snap.tasks.filter(t => t.jobId).map(t => t.jobId!))].map(id => {
    const maps = snap.tasks.filter(t => t.jobId === id && t.kind === 'map');
    return { id, done: maps.filter(t => t.status === 'done').length, total: maps.length };
  });
  return (
    <section className="summary" aria-label="Progress">
      <div className="summary-top">
        <strong>{counts.done} of {total} tasks done</strong>
        <span className="stage-chips">
          {STAGES.map(s => <span key={s.key} className={`stage-chip stage-${s.key}`} title={s.hint}>{counts[s.key]} {s.title.toLowerCase()}</span>)}
        </span>
      </div>
      <div className="bar tall" role="progressbar" aria-label="All tasks" aria-valuemin={0} aria-valuemax={total} aria-valuenow={counts.done}>
        <div className="bar-fill job-fill" style={{ width: `${pct}%` }} />
      </div>
      {jobs.map(j => (
        <div className="job" key={j.id}>
          <span className="small">Big job: {j.done}/{j.total} pieces done</span>
          <div className="bar"><div className="bar-fill job-fill" style={{ width: `${j.total ? (100 * j.done) / j.total : 0}%` }} /></div>
        </div>
      ))}
    </section>
  );
}

function Card({ t, snap, now, selected, flash, onOpen }: { t: Task; snap: Snapshot; now: number; selected: boolean; flash: boolean; onOpen: () => void }) {
  const who = snap.workers.find(w => w.id === t.assignee);
  const stage = stageOf(t);
  const info = stage === 'doing' ? liveInfo(t, snap.events) : null;
  const lock = lockBlocking(t, snap);
  const waitsFor = stage === 'waiting'
    ? t.dependsOn.map(d => snap.tasks.find(x => x.id === d)).filter((x): x is Task => !!x && x.status !== 'done')
    : [];
  return (
    <button type="button" className={`card task stage-${stage} ${t.status === 'failed' ? 'is-failed' : ''} ${selected ? 'selected' : ''} ${flash ? 'flash' : ''}`} onClick={onOpen} aria-pressed={selected}>
      <span className="task-title">{t.title}</span>
      {waitsFor.length > 0 && <span className="small muted">after {waitsFor.slice(0, 2).map(x => x.title).join(', ')}{waitsFor.length > 2 ? ` +${waitsFor.length - 2}` : ''}</span>}
      {stage === 'doing' && (
        <span className="working">
          <span className="work-bar" aria-hidden="true"><i /></span>
          {info?.note && <span className="small muted note">“{info.note}”</span>}
        </span>
      )}
      <span className="card-foot">
        <span className="mono small muted files" title={t.files.join(', ')}>{t.files.length === 1 ? t.files[0] : `${t.files.length} files`}</span>
        {t.kind === 'reduce' && <span className="chip">merge</span>}
        {lock && <span className="chip warn-chip" title={`Waiting for ${lock.path}`}>⏳ file busy</span>}
        {t.status === 'failed' && <span className="chip fail-chip">needs you</span>}
        {t.status === 'open' && t.triedBy.length > 0 && <span className="chip warn-chip" title="A worker gave it back">↩ given back</span>}
        {stage === 'doing' && info?.since && <span className="small muted">{took(info.since, now)}</span>}
        {stage === 'done' && <span className="small done-line">✓</span>}
        {who ? <Avatar name={who.name} size={24} /> : t.assignee && stage === 'todo' ? <span className="chip">reserved</span> : null}
      </span>
    </button>
  );
}

function Drawer({ t, snap, now, onClose, api, isOp, say }: { t: Task; snap: Snapshot; now: number; onClose: () => void; api: Api | null; isOp: boolean; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const canRetry = isOp && !!api && (t.status === 'failed' || (t.status === 'open' && t.triedBy.length > 0));
  const retry = async () => {
    setBusy(true);
    try { await api!.retryTask(t.id); say('Back on the board for any worker.'); }
    catch (e) { say('Could not do that: ' + (e as Error).message); }
    finally { setBusy(false); }
  };
  const who = snap.workers.find(w => w.id === t.assignee);
  const stage = STAGES.find(s => s.key === stageOf(t))!;
  const deps = t.dependsOn.map(d => snap.tasks.find(x => x.id === d)).filter((x): x is Task => !!x);
  const timeline = snap.events.filter(e => e.message.includes(t.title)).slice(0, 20);
  let result: { findings?: { file: string; severity: string; note: string }[] } | null = null;
  try { result = t.result ? JSON.parse(t.result) : null; } catch { result = null; }
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, [t.id]);
  // Escape closes it wherever focus is (a button inside may have just disappeared).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className="drawer" role="dialog" aria-label={`Task: ${t.title}`}>
      <header>
        <span className={`stage-chip stage-${stage.key} ${t.status === 'failed' ? 'is-failed' : ''}`}>{t.status === 'failed' ? 'Needs you' : stage.title}</span>
        <button ref={ref} type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <h2>{t.title}</h2>
      <p className="muted mono small">{t.id}</p>
      <dl className="facts">
        {t.goalId && <><dt>Goal</dt><dd>{snap.goals.find(g => g.id === t.goalId)?.text ?? t.goalId}</dd></>}
        <dt>Assignee</dt><dd>{who ? <span className="who"><Avatar name={who.name} size={22} /> {who.name} <span className="small muted">{agentLabel(who)}</span></span> : t.assignee ? `Reserved for ${t.assignee}` : 'Nobody yet'}</dd>
        <dt>Files</dt><dd className="mono small">{t.files.map(f => <div key={f}>{snap.locks.some(l => l.path === f) ? '🔒 ' : ''}{f}</div>)}</dd>
        {deps.length > 0 && <><dt>After</dt><dd>{deps.map(d => <div key={d.id}>{d.status === 'done' ? '✓' : '○'} {d.title}</div>)}</dd></>}
        <dt>Model</dt><dd>{modelFor(t)} · {t.difficulty} task <span className="small muted">(the timeline shows what ran)</span></dd>
        {t.branch && <><dt>Branch</dt><dd className="mono small">{t.branch}</dd></>}
        {t.costUsd > 0 && <><dt>Cost</dt><dd>{money(t.costUsd)}</dd></>}
      </dl>
      {t.description && <section><h3>What to do</h3><p>{t.description}</p></section>}
      <section><h3>Why it is here</h3><p>{why(t, snap)}</p>
        {canRetry && <button type="button" className="btn primary" disabled={busy} onClick={retry}>Try again</button>}
      </section>
      {t.resultSummary && t.status === 'done' && <section><h3>Result</h3><p>{t.resultSummary}</p>
        {result?.findings?.length ? <ul className="plain findings">{result.findings.map((f, i) => <li key={i}><span className={`chip sev-${f.severity}`}>{f.severity}</span> <span className="mono small">{f.file}</span> {f.note}</li>)}</ul> : null}
      </section>}
      <section><h3>Timeline</h3>
        <ol className="plain timeline">
          {timeline.map(e => <li key={e.id}><span aria-hidden="true">{EV_ICON[e.type] ?? '•'}</span> {e.message} <span className="muted small">{ago(e.time, now)}</span></li>)}
          {timeline.length === 0 && <li className="muted small">Nothing yet.</li>}
        </ol>
      </section>
    </aside>
  );
}

export function BoardPage(p: Props) {
  const { now, present, say, snap } = p;
  const [open, setOpen] = useState<string | null>(null);
  const task = snap.tasks.find(t => t.id === open);

  // Highlight cards that just moved.
  const prev = useRef(new Map<string, string>());
  const [flash, setFlash] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map(snap.tasks.map(t => [t.id, `${t.status}|${t.assignee}`]));
    const changed = new Set<string>();
    next.forEach((sig, id) => { if (prev.current.size && prev.current.get(id) !== sig) changed.add(id); });
    prev.current = next;
    if (changed.size) {
      setFlash(changed);
      const id = window.setTimeout(() => setFlash(new Set()), 1200);
      return () => window.clearTimeout(id);
    }
  }, [snap.tasks]);

  // Goals still going come first (newest first), then tasks that belong to no goal, then
  // finished goals. A cancelled goal with nothing left on it is not shown.
  const lanes = useMemo((): Lane[] => {
    const goalLanes = snap.goals
      .map(g => ({ key: g.id, goal: g, tasks: snap.tasks.filter(t => t.goalId === g.id) }))
      .filter(l => l.goal.status !== 'cancelled' || l.tasks.length > 0);
    const loose = snap.tasks.filter(t => !snap.goals.some(g => g.id === t.goalId));
    return [
      ...goalLanes.filter(l => !FINISHED.includes(l.goal.status)),
      ...(loose.length ? [{ key: 'other', goal: null, tasks: loose }] : []),
      ...goalLanes.filter(l => FINISHED.includes(l.goal.status)),
    ];
  }, [snap.goals, snap.tasks]);

  return (
    <div className="page board-page">
      {!present && <NextStep {...p} openTask={setOpen} />}
      {!present && <Prompt {...p} />}
      {snap.tasks.length > 0 && <Summary snap={snap} />}
      {lanes.length === 0 ? (
        <div className="empty-board card">
          <p><strong>Nothing yet.</strong></p>
          <p className="muted">{p.isOp ? 'Describe what you want built above. The manager splits it into tasks, and workers pick them up.' : 'When a controller sends a goal, it shows up here with its tasks.'}</p>
          <p className="small muted">New here? <a href="#/setup">See how to get started</a>.</p>
        </div>
      ) : (
        <div className="lanes">
          <div className="lane-cols" aria-hidden="true">{STAGES.map(s => <span key={s.key} title={s.hint}>{s.title}</span>)}</div>
          {lanes.map(l => <GoalLane key={l.key} lane={l} p={p} open={open} setOpen={setOpen} flash={flash} />)}
        </div>
      )}
      {task && <><div className="scrim" onClick={() => setOpen(null)} /><Drawer t={task} snap={snap} now={now} onClose={() => setOpen(null)} api={p.api} isOp={p.isOp} say={say} /></>}
    </div>
  );
}
