// Overview: the team at a glance. Numbers, who is doing what right now, the goals, the latest news.
import type { Api, Snapshot } from './brain';
import { AgentCards } from './Agents';
import { EV_ICON, ago, money, online } from './ui';

type P = { snap: Snapshot; api: Api | null; isOp: boolean; now: number; say: (m: string) => void; go: (page: string) => void };

export function OverviewPage({ snap, now, go }: P) {
  const live = snap.workers.filter(w => online(w, now)).length;
  const active = snap.goals.filter(g => !['done', 'cancelled'].includes(g.status));
  const done = snap.tasks.filter(t => t.status === 'done').length;
  const spent = snap.tasks.reduce((s, t) => s + t.costUsd, 0) + snap.goals.reduce((s, g) => s + g.costUsd, 0);
  const stats: [string, string, string][] = [
    ['Goals in progress', String(active.length), `${snap.goals.length} in total`],
    ['Tasks done', `${done} of ${snap.tasks.length}`, snap.tasks.some(t => t.status === 'failed') ? 'some need you' : 'on the Board'],
    ['Workers online', String(live), `${snap.workers.length} known`],
    ['Spent so far', money(spent), 'Claude usage'],
  ];
  return (
    <div className="page">
      <div className="stat-grid">
        {stats.map(([label, value, note]) => (
          <div className="card stat-card" key={label}>
            <span className="small muted">{label}</span>
            <strong className="stat-value">{value}</strong>
            <span className="small muted">{note}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="ov-agents"><h2 id="ov-agents">Right now</h2>
        <AgentCards snap={snap} now={now} compact />
      </section>

      <section aria-labelledby="ov-goals"><h2 id="ov-goals">Goals</h2>
        {snap.goals.length === 0
          ? <div className="card empty-board"><p className="muted">No goals yet. Describe what you want built on the <a href="#/board" onClick={() => go('board')}>Board</a>.</p></div>
          : (
            <ul className="plain rows card">
              {snap.goals.map(g => {
                const mine = snap.tasks.filter(t => t.goalId === g.id);
                const d = mine.filter(t => t.status === 'done').length;
                return (
                  <li className="row" key={g.id}>
                    <span className="grow goal-text" title={g.text}>{g.text}</span>
                    <span className="lane-progress"><span className="bar"><span className="bar-fill job-fill" style={{ width: `${mine.length ? Math.round((100 * d) / mine.length) : 0}%` }} /></span><span className="small muted nowrap">{d}/{mine.length}</span></span>
                    <span className={`chip goal-${g.status}`}>{g.status === 'new' ? 'Waiting' : g.status === 'planning' ? 'Being planned' : g.status === 'done' ? 'Done' : g.status === 'failed' ? 'Could not plan' : g.status === 'cancelled' ? 'Cancelled' : 'Planned'}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      <section aria-labelledby="ov-news"><h2 id="ov-news">Latest</h2>
        <ol className="plain log card">
          {snap.events.slice(0, 6).map(e => <li key={e.id}><span aria-hidden="true" className="ev-icon">{EV_ICON[e.type] ?? '•'}</span><span>{e.message}</span><span className="muted small time">{ago(e.time, now)}</span></li>)}
          {snap.events.length === 0 && <li><span /><span className="muted">Nothing has happened yet.</span><span /></li>}
        </ol>
        <p className="small"><a href="#/activity" onClick={() => go('activity')}>See all activity</a></p>
      </section>
    </div>
  );
}
