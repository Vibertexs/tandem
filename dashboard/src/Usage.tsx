// Usage: what the team has spent, per computer and per goal, and each computer's quota.
import type { Api, Snapshot } from './brain';
import { Avatar, Bar, agentLabel, money } from './ui';

type P = { snap: Snapshot; api: Api | null; isOp: boolean; now: number; say: (m: string) => void };

export function UsagePage({ snap }: P) {
  const perWorker = snap.workers.map(w => {
    const mine = snap.tasks.filter(t => t.assignee === w.id);
    return { w, spent: mine.reduce((s, t) => s + t.costUsd, 0), done: mine.filter(t => t.status === 'done').length };
  }).sort((a, b) => b.spent - a.spent || a.w.name.localeCompare(b.w.name));
  const perGoal = snap.goals.map(g => {
    const mine = snap.tasks.filter(t => t.goalId === g.id);
    return { g, tasks: mine.length, cost: g.costUsd + mine.reduce((s, t) => s + t.costUsd, 0) };
  }).sort((a, b) => b.g.createdAt.getTime() - a.g.createdAt.getTime());
  const loose = snap.tasks.filter(t => !snap.goals.some(g => g.id === t.goalId)).reduce((s, t) => s + t.costUsd, 0);
  const total = perGoal.reduce((s, r) => s + r.cost, 0) + loose;
  const max = Math.max(0.0001, ...perGoal.map(r => r.cost));

  return (
    <div className="page">
      <div className="stat-grid">
        <div className="card stat-card"><span className="small muted">Spent in total</span><strong className="stat-value">{money(total)}</strong><span className="small muted">Claude usage, as each run reported it</span></div>
        <div className="card stat-card"><span className="small muted">Goals</span><strong className="stat-value">{snap.goals.length}</strong><span className="small muted">{perGoal.length ? `${money(total / perGoal.length)} on average` : 'none yet'}</span></div>
        <div className="card stat-card"><span className="small muted">Tasks done</span><strong className="stat-value">{snap.tasks.filter(t => t.status === 'done').length}</strong><span className="small muted">of {snap.tasks.length}</span></div>
      </div>

      <section aria-labelledby="usage-people"><h2 id="usage-people">By computer</h2>
        {perWorker.length === 0
          ? <div className="card empty-board"><p className="muted">No workers yet.</p></div>
          : (
            <div className="worker-grid">
              {perWorker.map(({ w, spent, done }) => (
                <article className="card worker" key={w.id} aria-label={`Usage ${w.name}`}>
                  <header><Avatar name={w.name} size={32} /><div><strong>{w.name}</strong><div className="small muted">{agentLabel(w)}</div></div><strong className="usage-money">{money(spent)}</strong></header>
                  <p className="small muted">{done} task{done === 1 ? '' : 's'} done</p>
                  <Bar label="5 hours" value={w.usage5h} />
                  <Bar label="Week" value={w.usageWeek} />
                </article>
              ))}
            </div>
          )}
        <p className="small muted">Quota bars show what each computer reports, and stay empty until one does.</p>
      </section>

      <section aria-labelledby="usage-goals"><h2 id="usage-goals">By goal</h2>
        {perGoal.length === 0
          ? <div className="card empty-board"><p className="muted">No goals yet.</p></div>
          : (
            <ul className="plain rows card">
              {perGoal.map(({ g, tasks, cost }) => (
                <li className="row" key={g.id}>
                  <span className="grow goal-text" title={g.text}>{g.text}</span>
                  <span className="small muted nowrap">{tasks} task{tasks === 1 ? '' : 's'}</span>
                  <span className="usage-bar"><span className="bar"><span className="bar-fill job-fill" style={{ width: `${Math.round((100 * cost) / max)}%` }} /></span></span>
                  <strong className="usage-money">{money(cost)}</strong>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
