// What you see before you are connected to a team: host one, or join one.
import { useState } from 'react';
import { defaultUri, type Team } from './config';
import { copy } from './ui';

export function Landing({ onOpen, say }: { onOpen: (t: Team) => void; say: (m: string) => void }) {
  const [hostTeam, setHostTeam] = useState('tandem-local');
  const [address, setAddress] = useState('');
  const [joinTeam, setJoinTeam] = useState('tandem-local');
  const toUri = (a: string) => {
    const x = a.trim();
    if (!x) return defaultUri();
    if (/^wss?:\/\//.test(x)) return x;
    if (/^https?:\/\//.test(x)) return x.replace(/^http/, 'ws');
    return `ws://${x.includes(':') ? x : `${x}:3001`}`;
  };
  return (
    <main className="landing">
      <header className="landing-head">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Tandem</h1>
        <p>Your team's AI coders, working as one. Describe what you want built; a manager Claude splits it into tasks, and every teammate's Claude picks up work without stepping on each other.</p>
      </header>
      <div className="landing-cards">
        <section className="card choice" aria-labelledby="host-h">
          <h2 id="host-h">Host a team</h2>
          <p className="muted">Run the team on this computer. Do this once.</p>
          <ol className="steps">
            <li>In the Tandem folder, run:
              <pre className="mono">.\start.ps1</pre>
              <button type="button" className="link" onClick={() => copy('.\\start.ps1', say, 'Command copied')}>copy</button>
              <span className="small muted">It starts the brain, the manager and two workers, then opens this page. Add <code className="mono">-Simulate</code> for workers that fake the coding (no Claude usage).</span>
            </li>
            <li>Already running? Open it:
              <form className="inline-form" onSubmit={e => { e.preventDefault(); onOpen({ uri: defaultUri(), db: hostTeam.trim() || 'tandem-local' }); }}>
                <label className="sr-only" htmlFor="host-team">Team name</label>
                <input id="host-team" value={hostTeam} onChange={e => setHostTeam(e.target.value)} aria-label="Team name" />
                <button type="submit" className="btn primary">Open my team</button>
              </form>
            </li>
          </ol>
        </section>
        <section className="card choice" aria-labelledby="join-h">
          <h2 id="join-h">Join a team</h2>
          <p className="muted">Someone else hosts it. Ask them for the address and the team name.</p>
          <form className="form" onSubmit={e => { e.preventDefault(); onOpen({ uri: toUri(address), db: joinTeam.trim() || 'tandem-local' }); }}>
            <label>Host address<input value={address} onChange={e => setAddress(e.target.value)} placeholder="192.168.1.20  (blank = this computer)" /></label>
            <label>Team name<input value={joinTeam} onChange={e => setJoinTeam(e.target.value)} /></label>
            <button type="submit" className="btn primary">Join</button>
          </form>
          <p className="small muted">You can watch right away. To send work, ask to make changes and the owner approves you.</p>
        </section>
      </div>
      <p className="small muted center"><a href="?mock=1">See a sample board</a> without connecting.</p>
    </main>
  );
}

export function Unreachable({ team, problem, onRetry, onLeave }: { team: Team; problem: string | null; onRetry: () => void; onLeave: () => void }) {
  const local = /127\.0\.0\.1|localhost/.test(team.uri);
  if (problem?.startsWith('outdated')) {
    return (
      <main className="landing">
        <section className="card choice narrow" role="alert">
          <h2>"{team.db}" needs an update</h2>
          <p className="muted">Its brain runs an older version of Tandem than this page.</p>
          <p>On the host, run <code className="mono">.\start.ps1 -Db {team.db}</code>. It updates the team and keeps its data.</p>
          <div className="row-actions">
            <button type="button" className="btn primary" onClick={onRetry}>Try again</button>
            <button type="button" className="btn" onClick={onLeave}>Choose another team</button>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="landing">
      <section className="card choice narrow" role="alert">
        <h2>Can't reach "{team.db}"</h2>
        <p className="muted">Nothing answered at <code className="mono">{team.uri}</code>.</p>
        {local
          ? <p>If this computer hosts the team, start it with <code className="mono">.\start.ps1</code> in the Tandem folder.</p>
          : <p>Check that the host is running Tandem and that the address is right.</p>}
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={onRetry}>Try again</button>
          <button type="button" className="btn" onClick={onLeave}>Choose another team</button>
        </div>
      </section>
    </main>
  );
}
