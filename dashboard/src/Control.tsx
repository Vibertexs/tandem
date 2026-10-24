// The operator panel for the real team session. Only shown in live mode.
// Anyone can look. Only operators can change things: the brain enforces that, this page only reflects it.
import { useState } from 'react';
import type { Api, Snapshot } from './brain';

const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;
const list = (text: string) => text.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
const newId = () => 't-' + Math.random().toString(36).slice(2, 8);

const NOTE_KEYS = ['project_summary', 'interfaces', 'decisions'];

export function Control({ api, snap, me, say }: { api: Api | null; snap: Snapshot; me: string | null; say: (m: string) => void }) {
  const isOp = !!me && snap.operators.includes(me);
  const noOperatorYet = snap.operators.length === 0;
  const off = !api || !isOp;
  const [busy, setBusy] = useState(false);

  // one wrapper so every action reports success or the brain's own reason for refusing
  const act = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); say(done); return true; }
    catch (e) { say('Could not do that: ' + (e instanceof Error ? e.message : String(e))); return false; }
    finally { setBusy(false); }
  };

  // new task
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState('');
  const [desc, setDesc] = useState('');
  const [diff, setDiff] = useState('normal');
  const [who, setWho] = useState('');
  // big job
  const [goal, setGoal] = useState('');
  const [pieces, setPieces] = useState('');
  const [mergeTitle, setMergeTitle] = useState('Merge the results');
  const [mergeFile, setMergeFile] = useState('docs/report.md');
  // notes
  const [noteKey, setNoteKey] = useState(NOTE_KEYS[0]);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  // operators
  const [other, setOther] = useState('');

  const note = noteDraft ?? snap.context[noteKey] ?? '';

  return (
    <section className="panel control" aria-label="Operator controls">
      <h2>Control</h2>

      <div className="who-am-i">
        {!me && <span className="muted">Connecting…</span>}
        {me && isOp && <span className="chip st-busy">✓ You are an operator</span>}
        {me && !isOp && <span className="chip">○ View only</span>}
        {me && <span className="small muted">You are <code className="mono" title={me}>{short(me)}</code>
          <button type="button" className="link" onClick={() => { void navigator.clipboard?.writeText(me); say('Identity copied.'); }}>copy</button></span>}
        {me && !isOp && noOperatorYet && (
          <button type="button" className="btn primary" disabled={busy || !api}
            onClick={() => act(() => api!.claimOperator(), 'You are now the operator.')}>Become the operator</button>
        )}
        {me && !isOp && !noOperatorYet && (
          <span className="small muted">An operator must authorize this identity before you can change anything.</span>
        )}
      </div>

      <div className="control-grid">
        <form className="card form" onSubmit={e => {
          e.preventDefault();
          void act(() => api!.createTask({ id: newId(), title: title.trim(), description: desc.trim(), files: list(files), difficulty: diff }, who || undefined),
            'Task created.').then(ok => { if (ok) { setTitle(''); setFiles(''); setDesc(''); } });
        }}>
          <h3>New task</h3>
          <label>Title<input value={title} onChange={e => setTitle(e.target.value)} disabled={off} required placeholder="Add a login endpoint" /></label>
          <label>Files it will touch<input value={files} onChange={e => setFiles(e.target.value)} disabled={off} required placeholder="src/api/login.py, tests/test_login.py" /></label>
          <label>What to do<textarea value={desc} onChange={e => setDesc(e.target.value)} disabled={off} rows={2} placeholder="One or two sentences for whoever picks it up" /></label>
          <div className="row">
            <label>Difficulty
              <select value={diff} onChange={e => setDiff(e.target.value)} disabled={off}>
                <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
              </select></label>
            <label>Give it to
              <select value={who} onChange={e => setWho(e.target.value)} disabled={off}>
                <option value="">Whoever is free</option>
                {snap.workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></label>
          </div>
          <button type="submit" className="btn primary" disabled={off || busy || !title.trim() || list(files).length === 0}>Create task</button>
        </form>

        <form className="card form" onSubmit={e => {
          e.preventDefault();
          const parsed = pieces.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const [t, f = ''] = l.split('|');
            return { title: t.trim(), files: list(f) };
          });
          void act(() => api!.createJob(goal.trim(), parsed, { title: mergeTitle.trim(), files: list(mergeFile) }),
            `Big job created: ${parsed.length} pieces and a merge task.`).then(ok => { if (ok) { setGoal(''); setPieces(''); } });
        }}>
          <h3>New big job</h3>
          <label>Goal<input value={goal} onChange={e => setGoal(e.target.value)} disabled={off} required placeholder="Review every module" /></label>
          <label>Pieces, one per line: title | files<textarea value={pieces} onChange={e => setPieces(e.target.value)} disabled={off} required rows={4}
            placeholder={'Review module a | src/a.py\nReview module b | src/b.py'} /></label>
          <div className="row">
            <label>Merge task<input value={mergeTitle} onChange={e => setMergeTitle(e.target.value)} disabled={off} required /></label>
            <label>Merge file<input value={mergeFile} onChange={e => setMergeFile(e.target.value)} disabled={off} required /></label>
          </div>
          <button type="submit" className="btn primary" disabled={off || busy || !goal.trim() || !pieces.trim()}>Create job</button>
        </form>

        <form className="card form" onSubmit={e => {
          e.preventDefault();
          void act(() => api!.setContext(noteKey, note), 'Notes saved.').then(ok => { if (ok) setNoteDraft(null); });
        }}>
          <h3>Shared notes</h3>
          <label>Which note
            <select value={noteKey} onChange={e => { setNoteKey(e.target.value); setNoteDraft(null); }} disabled={off}>
              {NOTE_KEYS.map(k => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
            </select></label>
          <label>Text (keep it short: every task reads it)<textarea value={note} onChange={e => setNoteDraft(e.target.value)} disabled={off} rows={4} /></label>
          <button type="submit" className="btn primary" disabled={off || busy || note === (snap.context[noteKey] ?? '')}>Save notes</button>
        </form>

        <form className="card form" onSubmit={e => {
          e.preventDefault();
          void act(() => api!.addOperator(other), 'Identity authorized.').then(ok => { if (ok) setOther(''); });
        }}>
          <h3>Authorize another identity</h3>
          <p className="small muted">For a teammate's browser, or the terminal manager Claude (run <code className="mono">npm run whoami</code> in <code className="mono">mcp/</code>).</p>
          <label>Identity (64 hex characters)<input value={other} onChange={e => setOther(e.target.value)} disabled={off} className="mono" placeholder="c200a9…" /></label>
          <button type="submit" className="btn" disabled={off || busy || !other.trim()}>Authorize</button>
          <ul className="plain ops">
            {snap.operators.map(o => (
              <li key={o}>
                <code className="mono small" title={o}>{short(o)}</code>{o === me && <span className="chip">you</span>}
                {isOp && o !== me && (
                  <button type="button" className="link" disabled={busy} onClick={() => void act(() => api!.removeOperator(o), 'Operator removed.')}>remove</button>
                )}
              </li>
            ))}
          </ul>
        </form>
      </div>
    </section>
  );
}
