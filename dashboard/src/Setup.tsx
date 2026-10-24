// Setup: the steps to follow, in order, with this computer's real folders in the commands and a
// tick on every step that is already done. Nothing here needs an install beyond Node and Git.
import type { ReactNode } from 'react';
import type { Snapshot } from './brain';
import { shareable, type Team } from './config';
import { CodeLine, JoinSteps, managerOnline, online } from './ui';

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className={`step ${done ? 'done' : ''}`}>
      <span className="step-mark" aria-label={done ? 'done' : 'to do'}>{done ? '✓' : '○'}</span>
      <div className="step-body">
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

export function SetupPage({ snap, team, now, say, go }: { snap: Snapshot; team: Team; now: number; say: (m: string) => void; go: (page: string) => void }) {
  const ctx = snap.context;
  const tandemDir = ctx.tandem_dir || '<the Tandem folder>';
  const projectDir = ctx.project_dir || '<your project folder>';
  const repoUrl = ctx.repo_url ?? '';
  const share = shareable(team);
  const live = snap.workers.filter(w => online(w, now));
  const real = live.filter(w => w.agent !== 'simulated');
  const fake = live.filter(w => w.agent === 'simulated');
  const joined = live.filter(w => w.name.includes('-')); // workers that joined from another computer are named <name>-<computer>
  const tailscale = !!share && /^http:\/\/100\./.test(share.page);

  return (
    <div className="page setup">
      <p className="muted lead">Follow these in order. Each step ticks when Tandem sees it is done. The commands already have this computer's folders in them.</p>
      <ol className="plain steps-list">
        <Step done title="1. Tandem is running on this computer">
          <p className="small muted">You are looking at it. The team is <code className="mono">{team.db}</code>. If you ever open a new terminal and <code className="mono">tandem</code> is not found:</p>
          <p className="small muted">This terminal only (Windows PowerShell):</p>
          <CodeLine code={`$env:Path += ";${tandemDir}"`} say={say} />
          <p className="small muted">Mac or Linux:</p>
          <CodeLine code={`export PATH="$PATH:${tandemDir}"`} say={say} />
          <p className="small muted">Or, once and forever, in the Tandem folder: <code className="mono">npm install -g .</code></p>
        </Step>

        <Step done={managerOnline(snap, now)} title="2. The manager is online">
          <p className="small muted">It turns each goal into tasks. If it is offline, start Tandem again from your project:</p>
          <CodeLine code={`cd ${projectDir}\ntandem start`} say={say} />
        </Step>

        <Step done={real.length > 0} title="3. Workers that do the real coding">
          {fake.length > 0 && real.length === 0 && <p className="small warn">Your workers are simulated: they fake the coding. For real Claude workers, restart without <code className="mono">--simulate</code>:</p>}
          {real.length === 0 && <CodeLine code={`cd ${projectDir}\ntandem stop\ntandem start`} say={say} />}
          {real.length > 0 && <p className="small muted">{real.map(w => `${w.name} (${w.agent === 'codex' ? 'Codex' : 'Claude'}${w.account ? `, ${w.account}` : ''})`).join(', ')} online. Each runs under its owner's own login.</p>}
          <p className="small muted">Claude Code has to be signed in on this computer. Check by running <code className="mono">claude</code> in a terminal.</p>
        </Step>

        <Step done={!!repoUrl} title="4. The project is on GitHub (so a teammate's work can reach yours)">
          {repoUrl
            ? <p className="small muted">Yes: <code className="mono">{repoUrl}</code></p>
            : (
              <>
                <p className="small muted">Create an empty private repo on github.com (no README), add your teammate under Settings, Collaborators, then:</p>
                <CodeLine code={`cd ${projectDir}\ngit remote add origin https://github.com/<you>/<repo>.git\ngit push -u origin main`} say={say} />
                <p className="small muted">Then restart so Tandem notices: <code className="mono">tandem stop</code>, then <code className="mono">tandem start</code>.</p>
              </>
            )}
        </Step>

        <Step done={joined.length > 0} title="5. Invite a teammate">
          {!share ? (
            <>
              <p className="small warn">Only this computer can join right now.</p>
              <CodeLine code="tandem stop --all\ntandem start" say={say} />
            </>
          ) : (
            <>
              {tailscale
                ? <p className="small muted">This invite uses your Tailscale address, so it works on any wifi. Share this computer with them in Tailscale first (Tailscale admin, Machines, <strong>⋯</strong>, Share) and they accept.</p>
                : <p className="small muted">This invite uses your wifi address. It only works if both computers are on the same wifi and the wifi lets devices talk to each other. On public wifi, use Tailscale and run <code className="mono">tandem start</code> again.</p>}
              <p className="small muted">Send them this link. In a browser it shows this board:</p>
              <CodeLine code={share.page} say={say} />
              <JoinSteps link={share.page} repoUrl={repoUrl} say={say} />
            </>
          )}
          {joined.length > 0 && <p className="small muted">Joined: {joined.map(w => w.name).join(', ')}.</p>}
        </Step>

        <Step done={snap.goals.length > 0} title="6. Send a goal">
          <p className="small muted">On the <a href="#/board" onClick={() => go('board')}>Board</a>, click an example or describe what you want built, then Send. The manager plans it, and tasks go to every worker that is online.</p>
        </Step>
      </ol>
    </div>
  );
}
