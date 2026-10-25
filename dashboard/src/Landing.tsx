// What you see before you are connected to a team: start a project, or open an invite.
import { useState } from 'react';
import { type Team } from './config';
import { CodeLine } from './ui';

// The invite the conductor's page and `tandem --start` show: http://192.168.1.20:5173/?db=shop.
// Also accepts host/team or host:3001/team. Returns null if it cannot tell the team.
export function parseInvite(text: string): { page: string | null; team: Team } | null {
  const x = text.trim();
  if (!x) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(x) ? x : `http://${x}`);
    const db = u.searchParams.get('db') ?? u.pathname.replace(/^\/+|\/+$/g, '');
    if (!db) return null;
    const page = /^https?:$/.test(u.protocol) && u.port !== '3001' && u.searchParams.has('db') ? u.href : null;
    // a page link's port is the page's; otherwise a port given is the brain's
    const port = !page && u.port ? u.port : '3001';
    return { page, team: { db, uri: `ws://${u.hostname}:${port}` } };
  } catch { return null; }
}

export function Landing({ onOpen, say }: { onOpen: (t: Team) => void; say: (m: string) => void }) {
  const [invite, setInvite] = useState('');
  const [bad, setBad] = useState(false);
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseInvite(invite);
    if (!r) { setBad(true); return; }
    // the invite is a page on the conductor's computer: go there, so its links work too
    if (r.page && new URL(r.page).host !== location.host) { location.href = r.page; return; }
    onOpen(r.team);
  };
  return (
    <main className="landing">
      <header className="landing-head">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Tandem</h1>
        <p>Your team's AI coders, working as one. Describe what you want built; the conductor's Claude splits it into tasks, and every teammate's Claude picks up work without stepping on each other.</p>
      </header>
      <div className="landing-cards">
        <section className="card choice" aria-labelledby="host-h">
          <h2 id="host-h">Start a team for a project</h2>
          <p className="muted">Run Tandem in the Git project on this computer. That makes this computer the conductor: it runs the team, and this browser is its dashboard.</p>
          <ol className="steps">
            <li>Open PowerShell or Terminal in your project&apos;s folder, then run:
              <CodeLine code="tandem --start" say={say} />
              <span className="small muted">It starts the conductor, its workers and this page. The page opens automatically.</span>
            </li>
            <li>On that page you are the conductor automatically. Describe what you want built and pick an effort.</li>
          </ol>
          <details className="start-help">
            <summary className="small">If <code className="mono">tandem</code> is not recognised</summary>
            <p className="small muted">Keep the terminal in your project and run Tandem by its path instead:</p>
            <CodeLine code={'& "C:\\path\\to\\tandem\\tandem.cmd" --start'} say={say} />
            <p className="small muted">Run <code className="mono">tandem install</code> once in the Tandem folder to put it on your PATH. On macOS or Linux (untested): <code className="mono">/path/to/tandem/tandem --start</code>.</p>
          </details>
        </section>
        <section className="card choice" aria-labelledby="join-h">
          <h2 id="join-h">Open a teammate&apos;s team</h2>
          <p className="muted">Paste the invite they sent you to open the board. Watching needs no setup.</p>
          <form className="form" onSubmit={join}>
            <label>Invite link<input value={invite} onChange={e => { setInvite(e.target.value); setBad(false); }} placeholder="http://192.168.1.20:5173/?db=shop" aria-invalid={bad} /></label>
            {bad && <p className="small warn">That doesn't look like an invite. It looks like http://192.168.1.20:5173/?db=shop</p>}
            <button type="submit" className="btn primary" disabled={!invite.trim()}>Open team</button>
          </form>
          <p className="small muted">Want this computer&apos;s Claude workers to code too? Open the team, then use <strong>Invite</strong> → <strong>Add a teammate&apos;s computer</strong> for one copyable command block.</p>
        </section>
      </div>
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
          <p>On the conductor's computer, run <code className="mono">tandem --start</code> again in the project's folder. It updates the team and keeps its data.</p>
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
          ? <p>If this computer is the team's conductor, run <code className="mono">tandem --start</code> in the project's folder.</p>
          : <p>Check that the conductor is running Tandem and that the invite link is right.</p>}
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={onRetry}>Try again</button>
          <button type="button" className="btn" onClick={onLeave}>Choose another team</button>
        </div>
      </section>
    </main>
  );
}
