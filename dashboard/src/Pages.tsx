// Team, Shared memory, Activity and Settings. (Goals and their tasks are on the Board.)
import { useState } from 'react';
import type { Api, Snapshot } from './brain';
import { shareable, type Team } from './config';
import { Avatar, Bar, CodeLine, EV_ICON, WorkerStatus, ago, copy, isManager, money, online, took, liveInfo } from './ui';

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
export function TeamPage({ snap, now, say, team }: Common & { team: Team }) {
  const share = shareable(team);
  const uri = share?.uri ?? team.uri;
  // The manager says which repo the team works on (its origin). Real workers elsewhere need a clone.
  const repoUrl = snap.context.repo_url ?? '';
  const mcp = `claude mcp add tandem -e STDB_URI=${uri} -e STDB_DB=${team.db} -e TANDEM_SESSION=live -- node --import tsx <tandem-folder>/mcp/src/server.ts`;
  const sorted = [...snap.workers].sort((a, b) => Number(online(b, now)) - Number(online(a, now)) || a.name.localeCompare(b.name));
  return (
    <div className="page">
      <p className="muted lead">Each worker is a computer running Claude Code for the team. They pick up tasks by themselves.</p>
      {sorted.length === 0 && <div className="card empty-board"><p className="muted">No workers yet. Connect one below.</p></div>}
      <div className="worker-grid">
        {sorted.map(w => {
          const current = snap.tasks.find(t => t.status === 'claimed' && t.assignee === w.id);
          const info = current ? liveInfo(current, snap.events) : null;
          const held = snap.locks.filter(l => l.workerId === w.id);
          const theirs = snap.tasks.filter(t => t.assignee === w.id && t.status === 'done');
          const spent = snap.tasks.filter(t => t.assignee === w.id).reduce((sum, t) => sum + t.costUsd, 0);
          return (
            <article key={w.id} className={`card worker ${online(w, now) ? '' : 'is-offline'}`} aria-label={w.name}>
              <header><Avatar name={w.name} size={36} /><div><strong>{w.name}</strong><div className="small muted">{w.plan} plan · seen {ago(w.lastSeen, now)}</div></div><WorkerStatus w={w} now={now} /></header>
              <p className="small">{current ? <>On <strong>{current.title}</strong>{info?.since ? ` for ${took(info.since, now)}` : ''}</> : <span className="muted">No task right now</span>}</p>
              <Bar label="5 hours" value={w.usage5h} />
              <Bar label="Week" value={w.usageWeek} />
              {held.length > 0 && <p className="small mono muted">🔒 {held.map(l => l.path).join(', ')}</p>}
              <p className="small muted">{theirs.length} task{theirs.length === 1 ? '' : 's'} done{spent > 0 ? ` · ${money(spent)} spent` : ''}</p>
            </article>
          );
        })}
      </div>
      <section className="card connect" aria-labelledby="connect-h">
        <h2 id="connect-h">Connect a computer</h2>
        {share ? (
          <>
            <p className="muted small">Send them the invite: <a href={share.page}>{share.page}</a>. In a browser it shows this board. To add their computer's workers:</p>
            {repoUrl ? (
              <>
                <p className="muted small">1. Get the project:</p>
                <CodeLine code={`git clone ${repoUrl}`} say={say} />
                <p className="muted small">2. In that folder:</p>
                <CodeLine code={`tandem join ${share.page}`} say={say} />
              </>
            ) : (
              <>
                <CodeLine code={`tandem join ${share.page} --simulate`} say={say} />
                <p className="small muted">This project has no GitHub remote (origin), so workers on other computers can only fake the coding. Add a remote to the repo and run <code className="mono">tandem start</code> again, and they can do real work.</p>
              </>
            )}
            <p className="small muted">Their Claude Code runs under their own login and quota.</p>
          </>
        ) : (
          <>
            <p className="small warn">Right now only this computer can join.</p>
            <p className="muted small">To invite others, start it open to your network, in the project's folder:</p>
            <CodeLine code="tandem stop --all; tandem start" say={say} />
            <p className="muted small">Or add more workers on this computer:</p>
            <CodeLine code="tandem start --workers 4" say={say} />
          </>
        )}
        <details>
          <summary className="small">Or use your own Claude Code session as a worker</summary>
          <ol className="steps small">
            <li>Connect it: <CodeLine code={mcp} say={say} /></li>
            <li>Give it the team rules: copy <code className="mono">mcp/skill/SKILL.md</code> to <code className="mono">.claude/skills/tandem-worker/SKILL.md</code> in your project.</li>
            <li>Tell it: <em>Register with the tandem tools using my name, then claim a task, do it, and complete it. Repeat until no tasks are left.</em></li>
          </ol>
        </details>
      </section>
    </div>
  );
}

// ---------- Shared memory ----------
const NOTES: { key: string; title: string; hint: string }[] = [
  { key: 'project_summary', title: 'Project summary', hint: 'What this project is, in two or three sentences.' },
  { key: 'interfaces', title: 'Interfaces', hint: 'Names and shapes that parallel tasks must agree on. The manager writes here too.' },
  { key: 'decisions', title: 'Decisions', hint: 'Rules everyone follows, like "TypeScript everywhere".' },
];
function Note({ k, title, hint, snap, api, isOp, say }: Common & { k: string; title: string; hint: string }) {
  const saved = snap.context[k] ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, act } = useAct(say);
  const value = draft ?? saved;
  return (
    <form className="card memory-note" onSubmit={e => { e.preventDefault(); void act(() => api!.setNote(k, value), `${title} saved.`).then(ok => { if (ok) setDraft(null); }); }}>
      <h2>{title}</h2>
      <p className="small muted">{hint}</p>
      <label className="sr-only" htmlFor={`note-${k}`}>{title}</label>
      <textarea id={`note-${k}`} value={value} onChange={e => setDraft(e.target.value)} disabled={!isOp} rows={4} placeholder={isOp ? 'Empty' : 'Nothing yet'} />
      {isOp && <div className="row-actions">
        <button type="submit" className="btn primary" disabled={busy || value === saved}>Save</button>
        {draft !== null && draft !== saved && <button type="button" className="btn" onClick={() => setDraft(null)}>Undo</button>}
      </div>}
    </form>
  );
}
export function MemoryPage(c: Common) {
  return (
    <div className="page">
      <p className="muted lead">Every Claude on the team reads this before it starts a task. Keep it short.</p>
      <div className="notes">{NOTES.map(n => <Note key={n.key} {...c} k={n.key} title={n.title} hint={n.hint} />)}</div>
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

export function ActivityPage({ snap, now }: Common) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const keep = FILTERS.find(f => f.key === filter)!.keep;
  const shown = snap.events.filter(e => keep(e.type)).slice(0, 200);
  return (
    <div className="page">
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
  return (
    <div className="page settings">
      {isOp && snap.requests.length > 0 && (
        <section className="card" aria-labelledby="req-h">
          <h2 id="req-h">Asking to manage</h2>
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
        <h2 id="ops-h">Who can manage</h2>
        <p className="small muted">They can send goals, edit shared memory and change the team. Anyone else can watch.</p>
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
          <p className="small muted">Normally the manager does this from your goals.</p>
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
        {!share && <p className="small muted">Only this computer can open this team. To share the link: <code className="mono">tandem stop --all; tandem start</code> in the project's folder.</p>}
        <div className="row-actions">
          <button type="button" className="btn" onClick={async () => { try { const QRCode = (await import('qrcode')).default; setQr(await QRCode.toDataURL(pageUrl, { margin: 1, width: 220 })); } catch { setQr(''); } }}>Show QR code</button>
          <button type="button" className="btn" onClick={() => copy(pageUrl, say, 'Link copied')}>Copy link</button>
          <button type="button" className="btn" onClick={onLeave}>Switch team</button>
        </div>
        {qr !== null && (qr ? <img className="qr" src={qr} alt="QR code for this team's page" width={220} height={220} /> : <p className="small">Could not make a QR code.</p>)}
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
