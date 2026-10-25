// Usage: what the team has used, per computer and per goal, and each computer's quota.
// Shown as dollars (estimated at API prices) or as tokens; the switch is at the top.
import type { Api, Snapshot } from './brain';
import { Avatar, Bar, Spend, UnitSwitch, agentLabel, spendText, useUnit } from './ui';

type P = { snap: Snapshot; api: Api | null; isOp: boolean; now: number; say: (m: string) => void };

export function UsagePage({ snap }: P) {
  const unit = useUnit();
  const perWorker = snap.workers.map(w => {
    const mine = snap.tasks.filter(t => t.assignee === w.id);
    return { w, spent: mine.reduce((s, t) => s + t.costUsd, 0), tokens: mine.reduce((s, t) => s + t.tokens, 0), done: mine.filter(t => t.status === 'done').length };
  }).sort((a, b) => b.spent - a.spent || b.tokens - a.tokens || a.w.name.localeCompare(b.w.name));
  const perGoal = snap.goals.map(g => {
    const mine = snap.tasks.filter(t => t.goalId === g.id);
    return { g, tasks: mine.length, cost: g.costUsd + mine.reduce((s, t) => s + t.costUsd, 0), tokens: g.tokens + mine.reduce((s, t) => s + t.tokens, 0) };
  }).sort((a, b) => b.g.createdAt.getTime() - a.g.createdAt.getTime());
  const loose = snap.tasks.filter(t => !snap.goals.some(g => g.id === t.goalId));
  const total = perGoal.reduce((s, r) => s + r.cost, 0) + loose.reduce((s, t) => s + t.costUsd, 0);
  const totalTokens = perGoal.reduce((s, r) => s + r.tokens, 0) + loose.reduce((s, t) => s + t.tokens, 0);
  const size = (r: { cost: number; tokens: number }) => (unit === 'tokens' ? r.tokens : r.cost);
  const max = Math.max(0.0001, ...perGoal.map(size));
  const quotaKnown = snap.workers.some(w => w.usage5h !== null || w.usageWeek !== null);

  return (
    <div className="page">
      <div className="usage-head">
        <UnitSwitch />
        <span className="small muted">~ = estimated at Claude API prices. On a Pro or Max plan nothing is billed per run.</span>
      </div>
      <div className="stat-grid">
        <div className="card stat-card"><span className="small muted">Used in total</span><strong className="stat-value"><Spend usd={total} tokens={totalTokens} /></strong><span className="small muted">as each Claude run reported it</span></div>
        <div className="card stat-card"><span className="small muted">Goals</span><strong className="stat-value">{snap.goals.length}</strong><span className="small muted">{perGoal.length ? `${spendText(total / perGoal.length, totalTokens / perGoal.length, unit)} on average` : 'none yet'}</span></div>
        <div className="card stat-card"><span className="small muted">Tasks done</span><strong className="stat-value">{snap.tasks.filter(t => t.status === 'done').length}</strong><span className="small muted">of {snap.tasks.length}</span></div>
      </div>

      <section aria-labelledby="usage-people"><h2 id="usage-people">By computer</h2>
        {perWorker.length === 0
          ? <div className="card empty-board"><p className="muted">No workers yet.</p></div>
          : (
            <div className="worker-grid">
              {perWorker.map(({ w, spent, tokens, done }) => (
                <article className="card worker" key={w.id} aria-label={`Usage ${w.name}`}>
                  <header><Avatar name={w.name} size={32} /><div><strong>{w.name}</strong><div className="small muted">{agentLabel(w)}</div></div><strong className="usage-money"><Spend usd={spent} tokens={tokens} /></strong></header>
                  <p className="small muted">{done} task{done === 1 ? '' : 's'} done</p>
                  {w.usage5h !== null && <Bar label="5 hours" value={w.usage5h} />}
                  {w.usageWeek !== null && <Bar label="Week" value={w.usageWeek} />}
                  {w.usage5h === null && w.usageWeek === null && <p className="small muted">Quota not reported</p>}
                </article>
              ))}
            </div>
          )}
        {!quotaKnown && perWorker.length > 0 && <p className="small muted">Claude Code reports the 5-hour and weekly quota only on some plans. When a computer does, its bars show here.</p>}
      </section>

      <section aria-labelledby="usage-goals"><h2 id="usage-goals">By goal</h2>
        {perGoal.length === 0
          ? <div className="card empty-board"><p className="muted">No goals yet.</p></div>
          : (
            <ul className="plain rows card">
              {perGoal.map(r => (
                <li className="row" key={r.g.id}>
                  <span className="grow goal-text" title={r.g.text}>{r.g.text}</span>
                  <span className="small muted nowrap">{r.g.effort} effort · {r.tasks} task{r.tasks === 1 ? '' : 's'}</span>
                  <span className="usage-bar"><span className="bar"><span className="bar-fill job-fill" style={{ width: `${Math.round((100 * size(r)) / max)}%` }} /></span></span>
                  <strong className="usage-money"><Spend usd={r.cost} tokens={r.tokens} /></strong>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
