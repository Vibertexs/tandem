// Which team this page shows, and how. A "team" is a brain address plus a team name (the database).
//   ?db=<team>&uri=<ws://host:3001>   open a team (start.ps1 opens the page this way); remembered
//   ?view=present                       big type, no controls
//   ?mock=1                             a still picture from contract/seed.json, no brain
// Without ?db, the last team you opened is used. With none, the page asks: host or join?
const q = new URLSearchParams(location.search);
const KEY = 'tandem-team';

export type Team = { uri: string; db: string };

// Opened from another machine (http://192.168.1.5:5173), the brain is on that machine too.
export const defaultUri = () =>
  `ws://${location.hostname && location.hostname !== 'localhost' ? location.hostname : '127.0.0.1'}:3001`;

function load(): Team | null {
  try { const t = JSON.parse(localStorage.getItem(KEY) ?? 'null'); return t?.db ? t : null; } catch { return null; }
}
export function rememberTeam(t: Team) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* not remembered */ }
}
export function forgetTeam() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

function initialTeam(): Team | null {
  const db = q.get('db');
  if (db) {
    const t = { db, uri: q.get('uri') ?? import.meta.env.VITE_STDB_URI ?? defaultUri() };
    rememberTeam(t);
    return t;
  }
  return load();
}

export const config = {
  team: initialTeam(),
  mock: q.get('mock') === '1',
  present: q.get('view') === 'present',
  local: ['localhost', '127.0.0.1', ''].includes(location.hostname),
};
