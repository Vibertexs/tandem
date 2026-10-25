// Which team this page shows, and how. A "team" is a brain address plus a team name (the database).
//   ?db=<team>&uri=<ws://host:3001>   open a team (tandem --start opens the page this way); remembered
//   &lan=<ip>                           the conductor's network address, for links others can use
//   &host=1&key=<hex>                   the conductor's own page, and its key to take control back
//   ?view=present                       big type, no controls
//   ?mock=1                             a still picture from contract/seed.json, no brain
// Without ?db, the last team you opened is used. With none, the page asks: start or join?
const q = new URLSearchParams(location.search);
const KEY = 'tandem-team';

export type Team = { uri: string; db: string; lan?: string };

// Opened from another machine (http://192.168.1.5:5173), the brain is on that machine too.
export const defaultUri = () =>
  `ws://${location.hostname && location.hostname !== 'localhost' ? location.hostname : '127.0.0.1'}:3001`;

const isLocal = (uri: string) => /\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri);

// The page link and brain address another computer can use, or null if this team is only
// reachable from this computer.
export function shareable(team: Team): { page: string; uri: string } | null {
  const db = `?db=${encodeURIComponent(team.db)}`;
  if (team.lan) return { page: `http://${team.lan}:${location.port || '5173'}${location.pathname}${db}`, uri: `ws://${team.lan}:3001` };
  if (isLocal(team.uri)) return null;
  const sameHost = team.uri === defaultUri();
  return { page: `${location.origin}${location.pathname}${db}${sameHost ? '' : `&uri=${encodeURIComponent(team.uri)}`}`, uri: team.uri };
}

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
    const lan = q.get('lan');
    const t: Team = { db, uri: q.get('uri') ?? import.meta.env.VITE_STDB_URI ?? defaultUri(), ...(lan ? { lan } : {}) };
    rememberTeam(t);
    return t;
  }
  return load();
}

export const config = {
  team: initialTeam(),
  mock: q.get('mock') === '1',
  present: q.get('view') === 'present',
  // The localhost page `tandem --start` opens carries host=1: the person who started Tandem is the
  // conductor. Invite links never carry it, so teammates open the board as viewers.
  host: q.get('host') === '1',
  // ...and the conductor's key, with which that page can always take control back
  hostKey: q.get('key') ?? '',
  local: ['localhost', '127.0.0.1', ''].includes(location.hostname),
};

// The key has done its job once it is read: keep it out of the address bar (and so out of anything
// copied from it). `tandem` opens the conductor's page with it again whenever needed.
if (config.hostKey) {
  const url = new URL(location.href);
  url.searchParams.delete('key');
  history.replaceState(history.state, '', url.toString());
}
