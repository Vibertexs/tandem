// "Merge into my project", for a finished goal: the button, and what the manager answered. Used on
// the Board's lanes and on the Results page. The page asks by setting the shared note
// apply_<goal id> to "requested"; the manager merges the goal's branch into the branch the project
// is on and answers "done: ..." or "failed: ..." in the same note.
import { useState } from 'react';
import type { Api, Goal, Snapshot } from './brain';

export function ApplyControl({ g, snap, api, isOp, say }: { g: Goal; snap: Snapshot; api: Api | null; isOp: boolean; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const apply = snap.context[`apply_${g.id}`] ?? '';
  if (apply.startsWith('done:')) return <span className="small goal-note ok-note">{apply.slice(5).trim()}</span>;
  if (apply === 'requested' || apply === 'working') return <span className="small muted">Merging into your project…</span>;
  const ask = async () => {
    if (!api || busy) return;
    setBusy(true);
    try { await api.setNote(`apply_${g.id}`, 'requested'); say('Asked the manager to merge it into your project.'); }
    catch (e) { say('Could not do that: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  };
  return (
    <>
      {apply.startsWith('failed:') && <span className="small goal-note warn">{apply.slice(7).trim()}</span>}
      {isOp && api && (
        <button type="button" className="btn small-btn" disabled={busy}
          title="Brings this work into the branch your project is on, so it shows in your folder. Refuses if you have uncommitted changes; never forces anything."
          onClick={ask}>Merge into my project</button>
      )}
    </>
  );
}
