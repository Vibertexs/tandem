import { useEffect, useState } from 'react';
import { config, forgetTeam, rememberTeam, type Team } from './config';
import { useBrain } from './useBrain';
import { Landing, Unreachable } from './Landing';
import { BoardPage } from './Board';
import { ActivityPage, GoalsPage, MemoryPage, SettingsPage, TeamPage } from './Pages';
import { online, useNow } from './ui';

const PAGES = [
  { key: 'board', label: 'Board', icon: '▦' },
  { key: 'goals', label: 'Goals', icon: '◎' },
  { key: 'team', label: 'Team', icon: '◉' },
  { key: 'memory', label: 'Shared memory', icon: '✎' },
  { key: 'activity', label: 'Activity', icon: '≡' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
] as const;
type PageKey = typeof PAGES[number]['key'];

const pageFromHash = (): PageKey => {
  const k = location.hash.replace(/^#\/?/, '');
  return (PAGES.find(p => p.key === k)?.key ?? 'board') as PageKey;
};

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);
  const el = toast ? <div className="toast" role="status" aria-live="polite">{toast}</div> : null;
  return { say: setToast, el };
}

export function App() {
  const [team, setTeam] = useState<Team | null>(config.team);
  const { snap, api, status, me, retry, problem } = useBrain(team, config.mock);
  const now = useNow();
  const { say, el: toast } = useToast();
  const [page, setPage] = useState<PageKey>(pageFromHash());
  const [justWatch, setJustWatch] = useState(false);
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (k: string) => { location.hash = `/${k}`; };

  const open = (t: Team) => {
    rememberTeam(t);
    history.replaceState(null, '', `?db=${encodeURIComponent(t.db)}${/127\.0\.0\.1/.test(t.uri) ? '' : `&uri=${encodeURIComponent(t.uri)}`}`);
    setTeam(t);
  };
  const leave = () => { forgetTeam(); history.replaceState(null, '', location.pathname); setTeam(null); };

  if (!config.mock && !team) return <>{<Landing onOpen={open} say={say} />}{toast}</>;
  if (!config.mock && status === 'unreachable') return <Unreachable team={team!} problem={problem} onRetry={retry} onLeave={leave} />;
  if (!config.mock && status === 'connecting' && !api) {
    return <main className="landing"><p className="muted center" role="status">Connecting to {team!.db}…</p></main>;
  }

  const isOp = !config.mock && !!me && snap.operators.some(o => o.identity === me);
  const unowned = !config.mock && snap.operators.length === 0;
  const asked = !!me && snap.requests.some(r => r.identity === me);

  if (unowned && !justWatch && !config.present) {
    return (
      <main className="landing">
        <section className="card choice narrow">
          <span className="brand-mark" aria-hidden="true" />
          <h2>"{team!.db}" has no owner yet</h2>
          <p className="muted">The owner sends work to the team and approves who else can. If you started this team, that's you.</p>
          <div className="row-actions">
            <button type="button" className="btn primary" disabled={!api} onClick={() => api!.claimTeam().then(() => say("You're the owner. Describe what you want built."), e => say('Could not do that: ' + (e as Error).message))}>Make me the owner</button>
            <button type="button" className="btn" onClick={() => setJustWatch(true)}>Just watch</button>
          </div>
        </section>
        {toast}
      </main>
    );
  }

  const workersOnline = snap.workers.filter(w => online(w, now)).length;
  const badge: Partial<Record<PageKey, number>> = {
    goals: snap.goals.filter(g => g.status === 'new').length,
    settings: isOp ? snap.requests.length : 0,
  };
  const title = PAGES.find(p => p.key === page)!.label;
  const common = { snap, api, isOp, me, now, say };

  return (
    <div className={`shell ${config.present ? 'present' : ''}`}>
      {!config.present && (
        <nav className="sidebar" aria-label="Sections">
          <div className="brand"><span className="brand-mark" aria-hidden="true" /><span>Tandem</span></div>
          <div className="team-chip" title={team?.uri}>
            <span className={`dot ${status === 'connected' ? 'on' : 'off'}`} aria-hidden="true" />
            <span className="team-name">{config.mock ? 'Sample data' : team!.db}</span>
            <span className="small muted">{status === 'connected' ? `${workersOnline} worker${workersOnline === 1 ? '' : 's'} online` : 'Reconnecting…'}</span>
          </div>
          <ul className="plain nav">
            {PAGES.map(p => (
              <li key={p.key}>
                <a href={`#/${p.key}`} aria-current={page === p.key ? 'page' : undefined}>
                  <span className="nav-icon" aria-hidden="true">{p.icon}</span><span className="nav-label">{p.label}</span>
                  {badge[p.key] ? <span className="badge-count" aria-label={`${badge[p.key]} new`}>{badge[p.key]}</span> : null}
                </a>
              </li>
            ))}
          </ul>
          <div className="you small">
            {config.mock ? <span className="chip">Read only</span> : isOp ? <span className="chip st-busy">✓ You manage this team</span> : <span className="chip">Viewing</span>}
          </div>
        </nav>
      )}
      <div className="main">
        <header className="topbar">
          <h1>{config.present ? `${team?.db ?? 'Tandem'}` : title}</h1>
          <span className="spacer" />
          {!config.mock && !isOp && !config.present && status === 'connected' && (
            asked
              ? <span className="chip goal-new">⏳ Waiting for the owner to approve you</span>
              : <AskToManage onAsk={name => api!.askToManage(name).then(() => say('Asked. The owner sees your request on their board.'), e => say('Could not ask: ' + (e as Error).message))} />
          )}
        </header>
        {config.mock && <div className="banner">Sample data, not connected to a team. <a href="?">Host or join a team</a></div>}
        {status === 'connecting' && api && <div className="banner">Connection lost. Reconnecting…</div>}
        <main>
          {page === 'board' && <BoardPage {...common} isOp={isOp} present={config.present} go={go} />}
          {page === 'goals' && <GoalsPage {...common} />}
          {page === 'team' && <TeamPage {...common} team={team ?? { uri: '', db: 'sample' }} />}
          {page === 'memory' && <MemoryPage {...common} />}
          {page === 'activity' && <ActivityPage {...common} />}
          {page === 'settings' && <SettingsPage {...common} team={team ?? { uri: '', db: 'sample' }} onLeave={leave} />}
        </main>
      </div>
      {toast}
    </div>
  );
}

function AskToManage({ onAsk }: { onAsk: (name: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return <button type="button" className="btn primary" onClick={() => setOpen(true)}>Ask to make changes</button>;
  return (
    <form className="inline-form" onSubmit={e => { e.preventDefault(); if (name.trim()) void onAsk(name.trim()).then(() => setOpen(false)); }}>
      <label className="sr-only" htmlFor="ask-name">Your name</label>
      <input id="ask-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
      <button type="submit" className="btn primary" disabled={!name.trim()}>Ask</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
