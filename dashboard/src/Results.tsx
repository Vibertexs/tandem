// Results: every finished goal in one place. Where its work is, what it cost, who built what, which
// files it touched, and the button that brings it into the project folder.
import type { Api, Snapshot } from './brain';
import { ApplyControl } from './Apply';
import { Avatar, copy, money, took } from './ui';

type P = { snap: Snapshot; api: Api | null; isOp: boolean; now: number; say: (m: string) => void };

export function ResultsPage({ snap, api, isOp, say }: P) {
  const finished = snap.goals.filter(g => g.status === 'done').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (finished.length === 0) {
    return (
      <div className="page">
        <div className="card empty-board">
          <p><strong>Nothing finished yet.</strong></p>
          <p className="muted">When a goal is done, it shows up here with its branch, its cost and what it changed, and a button to bring it into your project.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <p className="muted lead">The work stays on a branch until you merge it. <strong>Merge into my project</strong> brings it into the branch your project folder is on.</p>
      {finished.map(g => {
        const tasks = snap.tasks.filter(t => t.goalId === g.id);
        const cost = g.costUsd + tasks.reduce((s, t) => s + t.costUsd, 0);
        const files = [...new Set(tasks.flatMap(t => t.files))];
        const short = g.text.length > 60 ? `${g.text.slice(0, 57)}...` : g.text;
        const doneAt = snap.events.find(e => e.type === 'merge_unblocked' && e.message.startsWith(`Goal done: ${short}`))?.time;
        const byWorker = new Map<string, number>();
        for (const t of tasks) if (t.assignee) byWorker.set(t.assignee, (byWorker.get(t.assignee) ?? 0) + 1);
        return (
          <article className="card result" key={g.id} aria-label={`Result: ${g.text}`}>
            <header className="result-head">
              <strong className="result-title">{g.text}</strong>
              <span className="chip goal-done">Done</span>
            </header>
            <p className="small muted">
              {[doneAt ? `built in ${took(g.createdAt, doneAt.getTime())}` : '', `${tasks.length} task${tasks.length === 1 ? '' : 's'}`, cost > 0 ? `${money(cost)} of Claude usage` : ''].filter(Boolean).join(' · ')}
            </p>
            {g.note && <p className="small"><span className="goal-note ok-note">{g.note}</span></p>}
            <dl className="agent-facts result-facts">
              <dt>Branch</dt>
              <dd><code className="mono">{g.branch || 'none'}</code>{g.branch && <> <button type="button" className="link" onClick={() => copy(`git checkout ${g.branch}`, say, `Copied: git checkout ${g.branch}`)}>copy git checkout</button></>}</dd>
              <dt>Built by</dt>
              <dd className="built-by">{[...byWorker].map(([id, n]) => { const w = snap.workers.find(x => x.id === id); return <span className="who" key={id}><Avatar name={w?.name ?? id} size={20} />{w?.name ?? id} <span className="muted">· {n}</span></span>; })}</dd>
              <dt>Files</dt>
              <dd className="file-chips">{files.slice(0, 14).map(f => <code className="mono file-chip" key={f}>{f}</code>)}{files.length > 14 && <span className="muted small">+{files.length - 14} more</span>}</dd>
            </dl>
            {g.branch && <div className="row-actions"><ApplyControl g={g} snap={snap} api={api} isOp={isOp} say={say} /></div>}
          </article>
        );
      })}
    </div>
  );
}
