// Goals, Team, Shared memory, Activity and Settings.
import { useState } from 'react';
import QRCode from 'qrcode';
import type { Api, Snapshot } from './brain';
import type { Team } from './config';
import { GoalChip } from './Board';
import { stageOf } from './ui';
import { Avatar, Bar, CodeLine, EV_ICON, WorkerStatus, ago, copy, isManager, online, took, liveInfo } from './ui';

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

// ---------- Goals ----------
const STAGE_ICON = { waiting: '○', todo: '○', doing: '▶', done: '✓' } as const;
export function GoalsPage({ snap, now, say }: Common) {
  return (
    <div className="page">
      <p className="muted lead">Everything you asked for, newest first. The manager turns each goal into tasks; when they are all done, their work is merged into one branch.</p>
      {snap.goals.length === 0 && <div className="card empty-board"><p className="muted">No goals yet. Send one from the Board.</p></div>}
      <div className="goal-cards">
        {snap.goals.map(g => {
          const mine = snap.tasks.filter(t => t.goalId === g.id);
          const done = mine.filter(t => t.status === 'done').length;
          return (
            <article key={g.id} className="card goal-card">
              <header><h2 className="grow">{g.text}</h2><GoalChip status={g.status} /></header>
              <p className="small muted">Sent {ago(g.createdAt, now)}{mine.length ? ` · ${done} of ${mine.length} tasks done` : ''}</p>
              {mine.length > 0 && <div className="bar"><div className="bar-fill job-fill" style={{ width: `${Math.round((100 * done) / mine.length)}%` }} /></div>}
              {mine.length > 0 && (
                <ul className="plain goal-tasks">
                  {mine.map(t => {
                    const who = snap.workers.find(w => w.id === t.assignee);
                    const st = stageOf(t);
                    return <li key={t.id} className={`stage-${st}`}><span aria-hidden="true">{STAGE_ICON[st]}</span> {t.title}{who ? <span className="small muted"> · {who.name}</span> : null}</li>;
                  })}
                </ul>
              )}
              {g.status === 'new' && <p className="small muted">The manager has not picked this up yet.</p>}
              {g.branch && (
                <div className="branch-box">
                  <span className="small">All of its work is on <code className="mono">{g.branch}</code></span>
                  <button type="button" className="link" onClick={() => copy(`git checkout ${g.branch}`, say, 'Command copied')}>copy git checkout</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Team ----------
export function TeamPage({ snap, now, say, team }: Common & { team: Team }) {
  const join = `.\\start.ps1 -Join ${team.uri} -Db ${team.db}`;
  const mcp = `claude mcp add tandem -e STDB_URI=${team.uri} -e STDB_DB=${team.db} -e TANDEM_SESSION=live -- node --import tsx <tandem-folder>/mcp/src/server.ts`;
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
          return (
            <article key={w.id} className={`card worker ${online(w, now) ? '' : 'is-offline'}`} aria-label={w.name}>
              <header><Avatar name={w.name} size={36} /><div><strong>{w.name}</strong><div className="small muted">{w.plan} plan · seen {ago(w.lastSeen, now)}</div></div><WorkerStatus w={w} now={now} /></header>
              <p className="small">{current ? <>On <strong>{current.title}</strong>{info?.since ? ` for ${took(info.since, now)}` : ''}</> : <span className="muted">No task right now</span>}</p>
              <Bar label="5 hours" value={w.usage5h} />
              <Bar label="Week" value={w.usageWeek} />
              {held.length > 0 && <p className="small mono muted">🔒 {held.map(l => l.path).join(', ')}</p>}
            </article>
          );
        })}
      </div>
      <section className="card connect" aria-labelledby="connect-h">
        <h2 id="connect-h">Connect a computer</h2>
        <p className="muted small">On the other computer, get the Tandem folder (clone the repo), then run:</p>
        <CodeLine code={join} say={say} />
        <p className="small muted">It starts workers there that join this team. Use <code className="mono">-Simulate</code> instead for workers that fake the coding.</p>
        <details>
          <summary className="small">Or use your own Claude Code session as a worker</summary>
          <ol className="steps small">
            <li>Connect it: <CodeLine code={mcp} say={say} /></li>
            <li>Give it the team rules: copy <code className="mono">mcp/skill/SKILL.md</code> to <code className="mono">.claude/skills/tandem-worker/SKILL.md</code> in your project.</li>
            <li>Tell it: <em>Register with the tandem tools using my name, then claim a task, do it, and complete it. Repeat until no tasks are left.</em></li>
          </ol>
        </details>
        {/127\.0\.0\.1|localhost/.test(team.uri) && <p className="small warn">This team's address is only reachable from this computer. To let others join, the host runs <code className="mono">.\start.ps1 -Lan</code> and shares its network address.</p>}
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
export function ActivityPage({ snap, now }: Common) {
  return (
    <div className="page">
      <p className="muted lead">What just happened, newest first.</p>
      <ol className="plain log card">
        {snap.events.slice(0, 200).map(e => (
          <li key={e.id}><span aria-hidden="true" className="ev-icon">{EV_ICON[e.type] ?? '•'}</span><span>{e.message}</span><span className="muted small time">{ago(e.time, now)}</span></li>
        ))}
        {snap.events.length === 0 && <li className="muted">Nothing yet.</li>}
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
  const pageUrl = `${location.origin}${location.pathname}?db=${encodeURIComponent(team.db)}${/127\.0\.0\.1/.test(team.uri) ? '' : `&uri=${encodeURIComponent(team.uri)}`}`;
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
        </dl>
        <div className="row-actions">
          <button type="button" className="btn" onClick={async () => { try { setQr(await QRCode.toDataURL(pageUrl, { margin: 1, width: 220 })); } catch { setQr(''); } }}>Show QR code</button>
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
