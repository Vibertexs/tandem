// Finished goals. FinishedGoals is the full history on the Activity page: where each goal's work is,
// what it cost, who built it, which files it touched, and the button that brings it into the project
// folder. FinishedStrip is the short version on the Board: one line per goal, with the same button.
import type { Api, Goal, Snapshot } from './brain';
import { ApplyControl } from './Apply';
import { Avatar, copy, money, took } from './ui';

type P = { snap: Snapshot; api: Api | null; isOp: boolean; say: (m: string) => void };

const finishedGoals = (snap: Snapshot) => snap.goals.filter(g => g.status === 'done').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

// when it was finished, from the brain's "Goal done" log line
const doneAt = (snap: Snapshot, g: Goal) => {
  const short = g.text.length > 60 ? `${g.text.slice(0, 57)}...` : g.text;
  return snap.events.find(e => e.type === 'merge_unblocked' && e.message.startsWith(`Goal done: ${short}`))?.time;
};

export function FinishedStrip({ snap, api, isOp, say }: P) {
  const goals = finishedGoals(snap);
  if (goals.length === 0) return null;
  return (
    <section className="card finished-strip" aria-label="Finished goals">
      <header className="finished-head">
        <h2>Finished</h2>
        <a className="small" href="#/activity">Details and history in Activity</a>
      </header>
      <ul className="plain rows">
        {goals.slice(0, 3).map(g => (
          <li className="row" key={g.id}>
            <span className="grow goal-text" title={g.text}>{g.text}</span>
            <span className="chip goal-done">Done</span>
            {g.branch && <code className="mono small">{g.branch}</code>}
            {g.branch && <ApplyControl g={g} snap={snap} api={api} isOp={isOp} say={say} />}
          </li>
        ))}
      </ul>
      {goals.length > 3 && <p className="small muted">and {goals.length - 3} more in Activity</p>}
    </section>
  );
}

export function FinishedGoals({ snap, api, isOp, say }: P) {
  const goals = finishedGoals(snap);
  if (goals.length === 0) return null;
  return (
    <section className="finished-goals" aria-labelledby="finished-h">
      <h2 id="finished-h">Finished goals</h2>
      <p className="muted lead">The work stays on a branch until you merge it. <strong>Merge into my project</strong> brings it into the branch your project folder is on.</p>
      {goals.map(g => {
        const tasks = snap.tasks.filter(t => t.goalId === g.id);
        const cost = g.costUsd + tasks.reduce((s, t) => s + t.costUsd, 0);
        const files = [...new Set(tasks.flatMap(t => t.files))];
        const at = doneAt(snap, g);
        const byWorker = new Map<string, number>();
        for (const t of tasks) if (t.assignee) byWorker.set(t.assignee, (byWorker.get(t.assignee) ?? 0) + 1);
        return (
          <article className="card result" key={g.id} aria-label={`Result: ${g.text}`}>
            <header className="result-head">
              <strong className="result-title">{g.text}</strong>
              <span className="chip goal-done">Done</span>
            </header>
            <p className="small muted">
              {[at ? `built in ${took(g.createdAt, at.getTime())}` : '', `${tasks.length} task${tasks.length === 1 ? '' : 's'}`, cost > 0 ? `${money(cost)} of Claude usage` : ''].filter(Boolean).join(' · ')}
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
    </section>
  );
}
