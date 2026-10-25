// The Shared memory page's window onto the SpacetimeDB database: every table, how many rows it has
// right now, what it is for, and a read-only peek at its rows. It updates the moment anything
// changes, because the page is subscribed to these tables.
import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from './brain';
import type { Team } from './config';

type TableView = { name: string; about: string; rows: (s: Snapshot) => unknown[] };

const TABLES: TableView[] = [
  { name: 'goals', about: 'What was asked for, and at what effort. The conductor reads each one and plans it into tasks.', rows: s => s.goals },
  { name: 'tasks', about: 'The work: its files, its owner, its result. A worker claims one in a single atomic step.', rows: s => s.tasks },
  { name: 'workers', about: 'Each coding agent: whose it is, which Claude, how much of its quota is used.', rows: s => s.workers },
  { name: 'locks', about: 'Files being edited right now, so two workers never touch the same one.', rows: s => s.locks },
  { name: 'events', about: 'The activity log: everything that happened, newest first.', rows: s => s.events },
  { name: 'context', about: 'The shared notes above, and facts like where the project is. Every Claude reads them.', rows: s => Object.entries(s.context) },
  { name: 'presence', about: 'Who is connected right now: the conductor and every page that is open.', rows: s => s.presence },
  { name: 'operators', about: 'Who may send goals and approve people.', rows: s => s.operators },
  { name: 'operator_requests', about: 'People who asked for that permission and are waiting.', rows: s => s.requests },
];

const text = (row: unknown) => JSON.stringify(row, (_k, v) => (v instanceof Date ? v.toISOString() : typeof v === 'string' && v.length > 90 ? `${v.slice(0, 87)}…` : v));
// What decides that a table "changed". Heartbeats (a worker's or page's last_seen, refreshed every
// few seconds) are left out, or the workers and presence cards would blink all the time.
const signature = (row: unknown) => JSON.stringify(row, (k, v) => (k === 'lastSeen' ? undefined : v instanceof Date ? v.toISOString() : v));

export function LiveDatabase({ snap, team }: { snap: Snapshot; team: Team }) {
  const live = !!team.uri;
  const rows = TABLES.map(t => t.rows(snap));
  // a table lights up for a moment when its rows change (a new row, or a row that changed)
  const sigs = rows.map(r => signature(r));
  const before = useRef<string[]>(sigs);
  const [lit, setLit] = useState<Set<string>>(new Set());
  const key = sigs.join('\u0000');
  useEffect(() => {
    const changed = new Set(TABLES.filter((_, i) => before.current[i] !== sigs[i]).map(t => t.name));
    before.current = sigs;
    if (changed.size === 0) return;
    setLit(changed);
    const id = window.setTimeout(() => setLit(new Set()), 1200);
    return () => window.clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <section className="live-db" aria-labelledby="live-db-h">
      <h2 id="live-db-h">Live database</h2>
      <p className="muted lead">
        {live
          ? <>This is <strong>SpacetimeDB</strong>: the database <code className="mono">{team.db}</code> at <code className="mono">{team.uri}</code>. Everything on the Board, the Team page and the notes above is rows in these tables. Changes are pushed to every connected computer the moment they happen; nothing polls.</>
          : <>Sample data, not a live database. With a real team, this shows its SpacetimeDB tables and updates the moment anything changes.</>}
      </p>
      <div className="db-grid">
        {TABLES.map((t, i) => (
          <article key={t.name} className={`card db-card ${lit.has(t.name) ? 'lit' : ''}`} aria-label={`Table ${t.name}`}>
            <header className="db-name"><code className="mono">{t.name}</code>{live && <span className="status-dot db-live" aria-hidden="true" title="Live" />}</header>
            <p className="db-count"><strong>{rows[i].length}</strong> <span className="muted small">row{rows[i].length === 1 ? '' : 's'}</span></p>
            <p className="small muted db-about">{t.about}</p>
            {rows[i].length > 0 && (
              <details className="db-rows">
                <summary className="small">Show rows</summary>
                <pre className="mono">{rows[i].slice(0, 8).map(text).join('\n')}{rows[i].length > 8 ? `\n… and ${rows[i].length - 8} more` : ''}</pre>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
