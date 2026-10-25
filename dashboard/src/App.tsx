import { useEffect, useRef, useState } from 'react';
import { config, forgetTeam, rememberTeam, shareable, type Team } from './config';
import { useBrain } from './useBrain';
import { Landing, Unreachable } from './Landing';
import { BoardPage } from './Board';
import { ActivityPage, MemoryPage, SettingsPage, TeamPage } from './Pages';
import { SetupPage } from './Setup';
import { Dock } from './Dock';
import { CodeLine, JoinSteps, isManager, managerOnline, online, restartForSharingCommand, useNow } from './ui';
import type { Snapshot } from './brain';

const PAGES = [
  { key: 'setup', label: 'Get started' },
  { key: 'board', label: 'Board' },
  { key: 'team', label: 'Team' },
  { key: 'memory', label: 'Shared memory' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings' },
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
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (k: string) => { location.hash = `/${k}`; };

  // The tab title shows the team and how far along it is: "(3/7) tandem-local · Tandem".
  const doneCount = snap.tasks.filter(t => t.status === 'done').length;
  useEffect(() => {
    const name = config.mock ? 'Sample' : team?.db;
    const progress = snap.tasks.length && doneCount < snap.tasks.length ? `(${doneCount}/${snap.tasks.length}) ` : '';
    document.title = name ? `${progress}${name} · Tandem` : 'Tandem';
  }, [team?.db, doneCount, snap.tasks.length]);

  // Say so when a goal finishes, wherever you are in the app.
  const goalStatus = useRef(new Map<string, string>());
  useEffect(() => {
    for (const g of snap.goals) {
      const before = goalStatus.current.get(g.id);
      if (before && before !== 'done' && g.status === 'done') {
        say(`✓ Goal done: ${g.text.slice(0, 60)}${g.branch ? ` (branch ${g.branch})` : ''}`);
      }
      goalStatus.current.set(g.id, g.status);
    }
  }, [snap.goals, say]);

  // Whoever ran `tandem start` controls the team: the page it opens (host=1) takes control by
  // itself the first time, and approves the manager when it asks. No button, no choice.
  const claiming = useRef(false);
  useEffect(() => {
    if (!config.host || config.mock || !api || !me || status !== 'connected') return;
    if (snap.operators.length > 0 || claiming.current) return;
    claiming.current = true;
    api.claimTeam().then(
      () => say('You control this team. Describe what you want built.'),
      e => { claiming.current = false; say('Could not take control: ' + (e as Error).message); },
    );
  }, [api, me, status, snap.operators.length, say]);
  useEffect(() => {
    if (!config.host || !api || !me || !snap.operators.some(o => o.identity === me)) return;
    const mgr = snap.requests.find(r => isManager(r.name));
    if (mgr) void api.approve(mgr.identity).catch(() => {});
  }, [snap.requests, snap.operators, api, me]);

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

  const workersOnline = snap.workers.filter(w => online(w, now)).length;
  const badge: Partial<Record<PageKey, number>> = { settings: isOp ? snap.requests.length : 0 };
  const title = PAGES.find(p => p.key === page)!.label;
  const common = { snap, api, isOp, me, now, say };

  return (
    <div className={`shell ${config.present ? 'present' : ''}`}>
      {!config.present && <Dock items={PAGES} active={page} badge={badge} />}
      <div className="main">
        <header className="topbar">
          <h1>{config.present ? `${team?.db ?? 'Tandem'}` : title}</h1>
          <span className="spacer" />
          {!config.present && (
            <div className="team-pill" title={team?.uri}>
              <span className={`dot ${status === 'connected' ? 'on' : 'off'}`} aria-hidden="true" />
              <span className="team-name">{config.mock ? 'Sample data' : team!.db}</span>
              <span className="small muted">{status === 'connected' ? `${workersOnline} worker${workersOnline === 1 ? '' : 's'} online` : 'Reconnecting…'}</span>
              {status === 'connected' && !config.mock && (
                <span className="small muted">{managerOnline(snap, now) ? 'Manager online' : snap.operators.some(o => isManager(o.name)) ? 'Manager offline' : 'No manager yet'}</span>
              )}
            </div>
          )}
          {!config.present && (config.mock ? <span className="chip">Read only</span> : isOp ? <span className="chip st-busy">You control this team</span> : <span className="chip">Watching</span>)}
          {!config.mock && !config.present && team && <Invite team={team} snap={snap} say={say} />}
          {!config.mock && !isOp && !unowned && !config.present && status === 'connected' && (
            asked
              ? <span className="chip goal-new">Waiting for a controller to approve you</span>
              : <AskToManage onAsk={name => api!.askToManage(name).then(() => say('Control request sent. A controller sees it on the Board.'), e => say('Could not ask: ' + (e as Error).message))} />
          )}
        </header>
        {config.mock && <div className="banner">Sample data, not connected to a team. <a href="?">Host or join a team</a></div>}
        {status === 'connecting' && api && <div className="banner">Connection lost. Reconnecting…</div>}
        {unowned && !config.host && !config.present && <div className="banner">Waiting for the host to take control. This board shows what happens once they do.</div>}
        <main>
          {page === 'board' && <BoardPage {...common} isOp={isOp} present={config.present} go={go} />}
          {page === 'setup' && <SetupPage snap={snap} team={team ?? { uri: '', db: 'sample' }} now={now} say={say} go={go} isOp={isOp} />}
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

// The team's invite, on every page: a link others open in a browser, and the same link for
// `tandem join` on their computer.
function Invite({ team, snap, say }: { team: Team; snap: Snapshot; say: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const share = shareable(team);
  const restart = restartForSharingCommand(snap.context.tandem_dir ?? '', snap.context.project_dir ?? '');
  // closes on Escape or a click anywhere else, like other menus
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown); };
  }, [open]);
  if (!share) {
    return <span className="chip invite-local" title="To invite others: tandem stop --all, then tandem start, in the project's folder">This computer only</span>;
  }
  return (
    <div className="invite" ref={box}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>Invite</button>
      {open && (
        <div className="invite-pop card" role="dialog" aria-label="Invite">
          <p className="small"><strong>Send this link to watch the board.</strong></p>
          <CodeLine code={share.page} say={say} />
          <p className="small muted">To let their computer&apos;s workers code, send this one command block too:</p>
          <JoinSteps link={share.page} gitUrl={snap.context.git_url ?? ''} say={say} restart={restart} />
        </div>
      )}
    </div>
  );
}

function AskToManage({ onAsk }: { onAsk: (name: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return <button type="button" className="btn primary" onClick={() => setOpen(true)}>Request control</button>;
  return (
    <form className="inline-form" onSubmit={e => { e.preventDefault(); if (name.trim()) void onAsk(name.trim()).then(() => setOpen(false)); }}>
      <label className="sr-only" htmlFor="ask-name">Your name</label>
      <input id="ask-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name" />
      <span className="small muted">A current controller must approve this browser.</span>
      <button type="submit" className="btn primary" disabled={!name.trim()}>Request</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}
