// Team, Shared memory, Activity and Settings. (Goals and their tasks are on the Board.)
import { useState } from 'react';
import type { Api, Snapshot } from './brain';
import { shareable, type Team } from './config';
import { TeamSetup } from './Setup';
import { LiveDatabase } from './Database';
import { AgentCards, NOTE_KEYS } from './Agents';
import { FinishedGoals } from './Finished';
import { Avatar, Bar, CodeLine, EV_ICON, Spend, ThemeSwitch, UnitSwitch, WorkerStatus, agentLabel, ago, copy, isManager, onConductor, online, restartForSharingCommand, took, liveInfo } from './ui';

type Common = { snap: Snapshot; api: Api | null; isOp: boolean; me: string | null; now: number; say: (m: string) => void };

// one wrapper so every action reports success or the brain's own reason for refusing
function useAct(say: (m: string) => void) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); say(done); return true; }
    catch (e) { say('Could not do that: ' + (e instanceof Error ? e.message : String(e))); return false; }
    finally { setBusy(false); }
  };
  return { busy, act };
}
const list = (text: string) => text.split(/[,\n]/).map(x => x.trim()).filter(Boolean);

// ---------- Team ----------
// The workers first (who is here and what they are doing), then how to add more.
export function TeamPage({ snap, now, say, team, isOp, go }: Common & { team: Team; go: (page: string) => void }) {
  const sorted = [...snap.workers].sort((a, b) => Number(online(b, now)) - Number(online(a, now)) || a.name.localeCompare(b.name));
  const live = sorted.filter(w => online(w, now)).length;
  return (
    <div className="page">
      <section aria-labelledby="workers-h">
        <h2 id="workers-h">Workers <span className="muted small">{live} online{sorted.length > live ? ` · ${sorted.length - live} offline` : ''}</span></h2>
        <p className="muted small">Each worker is a Claude Code agent on someone&apos;s computer. They pick up tasks by themselves.</p>
        {sorted.length === 0 && <div className="card empty-board"><p className="muted">No workers yet. Add a computer below.</p></div>}
        <div className="worker-grid">
          {sorted.map(w => {
            const current = snap.tasks.find(t => t.status === 'claimed' && t.assignee === w.id);
            const info = current ? liveInfo(current, snap.events) : null;
            const held = snap.locks.filter(l => l.workerId === w.id);
            const mine = snap.tasks.filter(t => t.assignee === w.id);
            const done = mine.filter(t => t.status === 'done').length;
            const spent = mine.reduce((sum, t) => sum + t.costUsd, 0);
            const tokens = mine.reduce((sum, t) => sum + t.tokens, 0);
            return (
              <article key={w.id} className={`card worker ${online(w, now) ? '' : 'is-offline'}`} aria-label={w.name}>
                <header><Avatar name={w.name} size={36} /><div><strong>{w.name}</strong><div className="small muted"><span className={`chip agent-${w.agent}`}>{agentLabel(w)}</span> <span className="chip">{onConductor(w, snap) ? "Conductor's computer" : 'Teammate'}</span> seen {ago(w.lastSeen, now)}</div></div><WorkerStatus w={w} now={now} /></header>
                <p className="small">{current ? <>On <strong>{current.title}</strong>{info?.since ? ` for ${took(info.since, now)}` : ''}</> : <span className="muted">No task right now</span>}</p>
                {/* Claude Code only reports the quota on some plans: no empty bars when it does not */}
                {w.usage5h !== null && <Bar label="5 hours" value={w.usage5h} />}
                {w.usageWeek !== null && <Bar label="Week" value={w.usageWeek} />}
                {held.length > 0 && <p className="small mono muted">Holding {held.map(l => l.path).join(', ')}</p>}
                <p className="small muted">{done} task{done === 1 ? '' : 's'} done{spent > 0 || tokens > 0 ? <> · <Spend usd={spent} tokens={tokens} /> used</> : ''}</p>
              </article>
            );
          })}
        </div>
      </section>
      <TeamSetup snap={snap} team={team} now={now} say={say} go={go} isOp={isOp} />
    </div>
  );
}

// ---------- Shared memory ----------
// For developers: what each Claude is given before a task, what each agent is doing and holding,
// and the raw shared state behind it. (Why it is built this way belongs in the README.)
const NOTES: { key: string; title: string; hint: string }[] = [
  { key: 'project_summary', title: 'Project summary', hint: 'What this project is, in two or three sentences.' },
  { key: 'interfaces', title: 'Interfaces', hint: 'Names and shapes that parallel tasks must agree on. The conductor writes here too.' },
  { key: 'decisions', title: 'Decisions', hint: 'Rules everyone follows, like "TypeScript everywhere".' },
];
// Which workers' Claudes read a note (the launcher logs it each time one does), newest first.
function readersOf(snap: Snapshot, title: string) {
  const reads = snap.events.filter(e => e.type === 'context_read' && (/\(([^)]*)\)/.exec(e.message)?.[1] ?? '').split(', ').includes(title));
  const names = [...new Set(reads.map(e => e.message.split(' read the shared notes')[0]))];
  return { names, at: reads[0]?.time ?? null };
}
function Note({ k, title, hint, snap, api, isOp, say, now }: Common & { k: string; title: string; hint: string }) {
  const saved = snap.context[k] ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, act } = useAct(say);
  const value = draft ?? saved;
  const meta = snap.contextMeta[k];
  const readers = readersOf(snap, title);
  return (
    <form className="card memory-note" onSubmit={e => { e.preventDefault(); void act(() => api!.setNote(k, value), `${title} saved.`).then(ok => { if (ok) setDraft(null); }); }}>
      <h2>{title} <code className="mono small muted">{k}</code></h2>
      <p className="small muted">{hint}</p>
      <label className="sr-only" htmlFor={`note-${k}`}>{title}</label>
      <textarea id={`note-${k}`} value={value} onChange={e => setDraft(e.target.value)} disabled={!isOp} rows={4} placeholder={isOp ? 'Empty' : 'Nothing yet'} />
      {saved.trim() && (
        <p className="small muted note-meta">
          {meta?.by ? <>Written by <strong>{meta.by}</strong>{meta.at ? ` · ${ago(meta.at, now)}` : ''}</> : 'Written before Tandem kept track of who wrote it'}
          {' · '}{readers.names.length ? <>Read by {readers.names.join(', ')}{readers.at ? ` · last ${ago(readers.at, now)}` : ''}</> : 'No worker has read it yet'}
        </p>
      )}
      {isOp && <div className="row-actions">
        <button type="submit" className="btn primary" disabled={busy || value === saved}>Save</button>
        {draft !== null && draft !== saved && <button type="button" className="btn" onClick={() => setDraft(null)}>Undo</button>}
      </div>}
    </form>
  );
}
export function MemoryPage(c: Common & { team: Team }) {
  const { snap, now } = c;
  const nameOf = (id: string) => snap.workers.find(w => w.id === id)?.name ?? id;
  const titleOf = (id: string) => snap.tasks.find(t => t.id === id)?.title ?? id;
  // everything else in the shared context: where the project is, the conductor's computer, merge answers...
  const others = Object.keys(snap.context).filter(k => !(NOTE_KEYS as readonly string[]).includes(k)).sort();
  return (
    <div className="page">
      <p className="muted lead">What every worker&apos;s Claude is given before a task, what each agent is doing and holding right now, and the shared state behind it.</p>

      <section aria-labelledby="notes-h">
        <h2 id="notes-h">Notes in every task&apos;s prompt</h2>
        <div className="notes">{NOTES.map(n => <Note key={n.key} {...c} k={n.key} title={n.title} hint={n.hint} />)}</div>
      </section>

      <section aria-labelledby="agents-h">
        <h2 id="agents-h">Agents</h2>
        <AgentCards snap={snap} now={now} />
      </section>

      <section aria-labelledby="locks-h">
        <h2 id="locks-h">Files locked now <span className="muted small">{snap.locks.length}</span></h2>
        <ul className="plain rows card dev-rows">
          {snap.locks.map(l => (
            <li className="row" key={l.path}>
              <code className="mono grow">{l.path}</code>
              <span className="small">{titleOf(l.taskId)}</span>
              <span className="small who"><Avatar name={nameOf(l.workerId)} size={18} /> {nameOf(l.workerId)}</span>
              <span className="small muted nowrap">{ago(l.createdAt, now)}</span>
            </li>
          ))}
          {snap.locks.length === 0 && <li className="row muted small">No files locked. A worker locks its task&apos;s files when it claims it.</li>}
        </ul>
      </section>

      <section aria-labelledby="values-h">
        <h2 id="values-h">Other shared values <span className="muted small">{others.length}</span></h2>
        <ul className="plain rows card dev-rows">
          {others.map(k => {
            const m = snap.contextMeta[k];
            return (
              <li className="row" key={k}>
                <code className="mono dev-key">{k}</code>
                <code className="mono grow dev-value" title={snap.context[k]}>{snap.context[k] || '""'}</code>
                <span className="small muted nowrap">{m?.by ? `${m.by}${m.at ? ` · ${ago(m.at, now)}` : ''}` : ''}</span>
              </li>
            );
          })}
          {others.length === 0 && <li className="row muted small">Nothing else yet.</li>}
        </ul>
      </section>

      <details className="under-hood">
        <summary>Raw tables</summary>
        <LiveDatabase snap={snap} team={c.team} />
      </details>
    </div>
  );
}

// ---------- Activity ----------
const PROBLEMS = new Set(['task_failed', 'worker_capped', 'lock_blocked', 'lock_released']);
const FINISHED = new Set(['task_done', 'merge_unblocked', 'job_progress']);
const FILTERS = [
  { key: 'all', label: 'All', keep: () => true },
  { key: 'problems', label: 'Problems', keep: (type: string) => PROBLEMS.has(type) },
  { key: 'finished', label: 'Finished', keep: (type: string) => FINISHED.has(type) },
] as const;

export function ActivityPage({ snap, api, isOp, say, now }: Common) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const keep = FILTERS.find(f => f.key === filter)!.keep;
  const shown = snap.events.filter(e => keep(e.type)).slice(0, 200);
  return (
    <div className="page">
      <FinishedGoals snap={snap} api={api} isOp={isOp} say={say} />
      <h2>Activity</h2>
      <p className="muted lead">What just happened, newest first.</p>
      <div className="row-actions filters" role="group" aria-label="Show">
        {FILTERS.map(f => (
          <button key={f.key} type="button" className={`chip ${filter === f.key ? 'on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}{f.key === 'problems' ? ` (${snap.events.filter(e => PROBLEMS.has(e.type)).length})` : ''}
          </button>
        ))}
      </div>
      <ol className="plain log card">
        {shown.map(e => (
          <li key={e.id} className={PROBLEMS.has(e.type) ? 'problem' : ''}><span aria-hidden="true" className="ev-icon">{EV_ICON[e.type] ?? '•'}</span><span>{e.message}</span><span className="muted small time">{ago(e.time, now)}</span></li>
        ))}
        {shown.length === 0 && <li className="muted">{snap.events.length === 0 ? 'Nothing yet.' : 'Nothing like that yet.'}</li>}
      </ol>
    </div>
  );
}

// ---------- Settings ----------
export function SettingsPage(c: Common & { team: Team; onLeave: () => void }) {
  const { snap, api, isOp, me, say, team, onLeave } = c;
  const { busy, act } = useAct(say);
  const [qr, setQr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // by hand
  const [title, setTitle] = useState(''); const [files, setFiles] = useState(''); const [desc, setDesc] = useState('');
  const [diff, setDiff] = useState('normal'); const [who, setWho] = useState('');
  const [goal, setGoal] = useState(''); const [pieces, setPieces] = useState('');
  const share = shareable(team);
  const pageUrl = share?.page ?? `${location.origin}${location.pathname}?db=${encodeURIComponent(team.db)}`;
  const restart = restartForSharingCommand(snap.context.tandem_dir ?? '', snap.context.project_dir ?? '');
  return (
    <div className="page settings">
      {isOp && snap.requests.length > 0 && (
        <section className="card" aria-labelledby="req-h">
          <h2 id="req-h">Control requests</h2>
          <ul className="plain rows">
            {snap.requests.map(r => (
              <li key={r.identity} className="row">
                <Avatar name={r.name} /><span className="grow"><strong>{r.name}</strong>{isManager(r.name) && <span className="small muted"> · plans your goals</span>}</span>
                <button type="button" className="btn primary" disabled={busy} onClick={() => act(() => api!.approve(r.identity), `${r.name} approved.`)}>Approve</button>
                <button type="button" className="btn" disabled={busy} onClick={() => act(() => api!.dismiss(r.identity), 'Dismissed.')}>Dismiss</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="ops-h">
        <h2 id="ops-h">Who can send goals</h2>
        <p className="small muted">The conductor (the computer that ran <code className="mono">tandem --start</code>) controls the team, and can approve others to send goals and edit shared memory too. This is a browser permission, not a Tandem account or anyone&apos;s Claude login. Teammates can always watch. The conductor&apos;s own page can always take control back.</p>
        <ul className="plain rows">
          {snap.operators.map(o => (
            <li key={o.identity} className="row">
              <Avatar name={o.name || 'Someone'} /><span className="grow">{o.name || 'Someone'}{o.identity === me && <span className="chip">you</span>}</span>
              {isOp && o.identity !== me && <button type="button" className="link" disabled={busy} onClick={() => act(() => api!.removeOperator(o.identity), 'Removed.')}>remove</button>}
            </li>
          ))}
          {snap.operators.length === 0 && <li className="muted small">Nobody yet.</li>}
        </ul>
      </section>

      {isOp && (
        <section className="card" aria-labelledby="hand-h">
          <h2 id="hand-h">Add work by hand</h2>
          <p className="small muted">Normally the conductor does this from your goals.</p>
          <div className="control-grid">
            <form className="form" onSubmit={e => { e.preventDefault(); void act(() => api!.createTask({ title: title.trim(), description: desc.trim(), files: list(files), difficulty: diff }, who || undefined), 'Task created.').then(ok => { if (ok) { setTitle(''); setFiles(''); setDesc(''); } }); }}>
              <h3>One task</h3>
              <label>Title<input value={title} onChange={e => setTitle(e.target.value)} required placeholder="Add a login endpoint" /></label>
              <label>Files it will touch<input value={files} onChange={e => setFiles(e.target.value)} required placeholder="src/login.py, tests/test_login.py" /></label>
              <label>What to do<textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} /></label>
              <div className="row2">
                <label>Difficulty<select value={diff} onChange={e => setDiff(e.target.value)}><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>
                <label>Give it to<select value={who} onChange={e => setWho(e.target.value)}><option value="">Whoever is free</option>{snap.workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
              </div>
              <button type="submit" className="btn primary" disabled={busy || !title.trim() || list(files).length === 0}>Create task</button>
            </form>
            <form className="form" onSubmit={e => {
              e.preventDefault();
              const parsed = pieces.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [t, f = ''] = l.split('|'); return { title: t.trim(), files: list(f) }; });
              void act(() => api!.createJob(goal.trim(), parsed, { title: 'Merge the results', files: ['docs/report.md'] }), `Big job created: ${parsed.length} pieces and a merge task.`).then(ok => { if (ok) { setGoal(''); setPieces(''); } });
            }}>
              <h3>A big job (many independent pieces)</h3>
              <label>Goal<input value={goal} onChange={e => setGoal(e.target.value)} required placeholder="Review every module" /></label>
              <label>Pieces, one per line: title | files<textarea value={pieces} onChange={e => setPieces(e.target.value)} rows={4} required placeholder={'Review module a | src/a.py\nReview module b | src/b.py'} /></label>
              <button type="submit" className="btn primary" disabled={busy || !goal.trim() || !pieces.trim()}>Create job</button>
            </form>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="share-h">
        <h2 id="share-h">This team</h2>
        <dl className="facts">
          <dt>Team name</dt><dd className="mono">{team.db}</dd>
          <dt>Address</dt><dd className="mono">{team.uri}</dd>
          {share && share.uri !== team.uri && <><dt>Others use</dt><dd className="mono">{share.uri}</dd></>}
        </dl>
        {!share && <><p className="small muted">Only this computer can open this team. On the conductor&apos;s computer, restart Tandem without <code className="mono">--local</code> to share the link:</p><CodeLine code={restart} say={say} /></>}
        <div className="row-actions">
          <button type="button" className="btn" onClick={async () => { try { const QRCode = (await import('qrcode')).default; setQr(await QRCode.toDataURL(pageUrl, { margin: 1, width: 220 })); } catch { setQr(''); } }}>Show QR code</button>
          <button type="button" className="btn" onClick={() => copy(pageUrl, say, 'Link copied')}>Copy link</button>
          <button type="button" className="btn" onClick={onLeave}>Switch team</button>
        </div>
        {qr !== null && (qr ? <img className="qr" src={qr} alt="QR code for this team's page" width={220} height={220} /> : <p className="small">Could not make a QR code.</p>)}
        <p className="small muted">For a projector or a second screen: <a href={`${pageUrl}${pageUrl.includes('?') ? '&' : '?'}view=present`} target="_blank" rel="noreferrer">the big-type board</a>, no controls.</p>
      </section>

      <section className="card" aria-labelledby="unit-h">
        <h2 id="unit-h">This browser</h2>
        <dl className="facts prefs">
          <dt>Theme</dt><dd><ThemeSwitch /></dd>
          <dt>Show usage as</dt><dd><UnitSwitch /><span className="small muted">Dollars are estimated at Claude API prices (~). On a Pro or Max plan nothing is billed per run.</span></dd>
        </dl>
        <p className="small muted">Remembered in this browser only.</p>
      </section>

      {isOp && (
        <section className="card danger-zone" aria-labelledby="clear-h">
          <h2 id="clear-h">Start over</h2>
          <p className="small muted">Clears every task, goal and the activity log. The team, its workers and the shared memory stay.</p>
          {!confirm
            ? <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Clear the board…</button>
            : <div className="row-actions">
                <button type="button" className="btn danger" disabled={busy} onClick={() => act(() => api!.clearBoard(), 'The board is clear.').then(() => setConfirm(false))}>Yes, clear everything</button>
                <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              </div>}
        </section>
      )}
    </div>
  );
}
