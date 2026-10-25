// The practical first-use path: start the project host, control the browser, then add computers.
import type { ReactNode } from 'react';
import type { Snapshot } from './brain';
import { shareable, type Team } from './config';
import { CodeLine, managerOnline, online, restartForSharingCommand, startCommand } from './ui';

function Step({ done, title, children }: { done: boolean; title: string; children?: ReactNode }) {
  return (
    <li className={`step ${done ? 'done' : ''}`}>
      <span className="step-mark" aria-label={done ? 'done' : 'to do'}>{done ? '✓' : ''}</span>
      <div className="step-body">
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

// The first-use checklist, at the top of the Team page (getting started is about the team).
export function GetStarted({ snap, team, now, say, go, isOp }: { snap: Snapshot; team: Team; now: number; say: (m: string) => void; go: (page: string) => void; isOp: boolean }) {
  const ctx = snap.context;
  const tandemDir = ctx.tandem_dir || '<the Tandem folder>';
  const projectDir = ctx.project_dir || '<your project folder>';
  const share = shareable(team);
  const live = snap.workers.filter(w => online(w, now));
  const joined = live.filter(w => w.name.includes('-'));
  const manager = managerOnline(snap, now);
  const hostReady = manager && live.length > 0;
  const tailscale = !!share && /^http:\/\/100\./.test(share.page);
  const hostCommand = startCommand(tandemDir, projectDir);
  const shareCommand = restartForSharingCommand(tandemDir, projectDir);

  return (
    <section className="page setup" aria-labelledby="get-started-h">
      <h2 id="get-started-h">Get started</h2>
      <p className="muted lead">A <strong>project host</strong> is the computer running Tandem in the Git project. A <strong>team controller</strong> is a browser permission to send goals and approve people. They are usually the same person, but they do not have to be.</p>

      <section className="card setup-roles" aria-labelledby="roles-h">
        <h2 id="roles-h">This team</h2>
        <dl className="facts">
          <dt>Project host</dt><dd><code className="mono">{projectDir}</code><span className="small muted">Runs the manager, workers and shared project.</span></dd>
          <dt>This browser</dt><dd>{isOp ? <><strong>You control this team.</strong><span className="small muted">You can send goals, approve controllers and change settings.</span></> : <><strong>You are watching.</strong><span className="small muted">Use Request control in the top bar if a current controller should approve this browser.</span></>}</dd>
        </dl>
      </section>

      <ol className="plain steps-list">
        <Step done={hostReady} title="1. Start the project host">
          <p className="small muted">Paste this whole block in PowerShell or Terminal on the computer that holds the project. It calls Tandem by its full path, so it works before you set up your PATH.</p>
          <CodeLine code={hostCommand} say={say} />
          <p className="small muted">{manager ? 'Manager online.' : 'Manager not online yet.'} {live.length ? `${live.length} coding worker${live.length === 1 ? '' : 's'} online.` : 'No coding workers online yet.'}</p>
        </Step>

        <Step done={joined.length > 0} title="2. Add a teammate&apos;s computer">
          {!share ? (
            <>
              <p className="small warn">This team is only available on this computer. Start the project host without <code className="mono">--local</code> to create an invite.</p>
              <CodeLine code={shareCommand} say={say} />
            </>
          ) : (
            <>
              <p className="small muted">Use <strong>Add a teammate&apos;s computer</strong> below. It has the invite link and the commands to copy.</p>
              <p className="small muted">{tailscale ?'This is a private Tailscale link. The teammate must be allowed to reach this computer in Tailscale.' : 'This works on the same network. For different networks or public Wi-Fi, use Tailscale and restart Tandem on the project host.'}</p>
            </>
          )}
          {joined.length > 0 && <p className="small muted">Joined worker computers: {joined.map(w => w.name).join(', ')}.</p>}
        </Step>

        <Step done={snap.goals.length > 0} title="3. Send a goal">
          {isOp
            ? <p className="small muted">Go to the <a href="#/board" onClick={() => go('board')}>Board</a>, describe what you want built, and send it. The manager turns it into tasks, and every connected computer&apos;s workers pick them up.</p>
            : <p className="small muted">A controller must approve this browser before it can send goals. Use <strong>Request control</strong> in the top bar, then go to the Board.</p>}
        </Step>
      </ol>
    </section>
  );
}
