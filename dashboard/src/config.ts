// Everything the page reads from its URL and environment.
//   (default)     Demo: your own private sandbox with simulated workers
//   ?mode=team    My team: the real "live" session, no simulation (?mode=live also works)
//   ?view=present big type, no controls
//   ?mock=1       static data from contract/seed.json, no brain
//   ?uri= &db=    point at another SpacetimeDB
const q = new URLSearchParams(location.search);

function sandboxSession(): string {
  try {
    const saved = sessionStorage.getItem('tandem-session');
    if (saved) return saved;
    const fresh = 'j-' + Math.random().toString(36).slice(2, 8);
    sessionStorage.setItem('tandem-session', fresh);
    return fresh;
  } catch {
    return 'j-' + Math.random().toString(36).slice(2, 8);
  }
}

const mode = q.get('mode');
const team = mode === 'team' || mode === 'live';
export const config = {
  team,
  demo: !team,
  mock: q.get('mock') === '1',
  present: q.get('view') === 'present',
  uri: q.get('uri') ?? import.meta.env.VITE_STDB_URI ?? 'ws://127.0.0.1:3001',
  db: q.get('db') ?? import.meta.env.VITE_STDB_DB ?? 'bilal-dev',
  session: team ? 'live' : sandboxSession(),
};
