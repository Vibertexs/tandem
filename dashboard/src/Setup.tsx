// Getting started is adding a teammate: start the conductor (your computer), add a teammate's
// computer, send a goal. One card on the Team page, under the workers.
import type { ReactNode } from 'react';
import type { Snapshot } from './brain';
import { shareable, type Team } from './config';
import { CodeLine, JoinSteps, managerOnline, onConductor, online, restartForSharingCommand, startCommand } from './ui';

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

export function TeamSetup({ snap, team, now, say, go, isOp }: { snap: Snapshot; team: Team; now: number; say: (m: string) => void; go: (page: string) => void; isOp: boolean }) {
  const ctx = snap.context;
  const tandemDir = ctx.tandem_dir || '<the Tandem folder>';
  const projectDir = ctx.project_dir || '<your project folder>';
  const share = shareable(team);
  const live = snap.workers.filter(w => online(w, now));
  // a teammate's computer: not the conductor's (it says which one is), else a joined name like omar-pc
  const joined = live.filter(w => (ctx.host_computer ? !onConductor(w, snap) : w.name.includes('-')));
  const conductor = managerOnline(snap, now);
  const started = conductor && live.length > 0;
  const tailscale = !!share && /^http:\/\/100\./.test(share.page);
  const restart = restartForSharingCommand(ctx.tandem_dir ?? '', ctx.project_dir ?? '');
  const gitUrl = ctx.git_url ?? ''; // set once the conductor serves the project (tandem --start)
  const uri = share?.uri ?? team.uri;
  const mcp = `claude mcp add tandem -e STDB_URI=${uri} -e STDB_DB=${team.db} -e TANDEM_SESSION=live -- node --import tsx <tandem-folder>/mcp/src/server.ts`;
  const startCode = <CodeLine code={startCommand(tandemDir, projectDir)} say={say} />;

  return (
    <section className="card setup" aria-labelledby="get-started-h">
      <h2 id="get-started-h">Get started: add a teammate</h2>
      <p className="small muted">The <strong>conductor</strong> is you: the computer that ran <code className="mono">tandem --start</code> holds the project, plans goals and merges the work. A <strong>teammate</strong> is another computer that joins with the invite and lends its Claude workers.</p>
      <ol className="plain steps-list">
        <Step done={started} title="1. Start the conductor (your computer)">
          <p className="small muted">{conductor ? 'Conductor online.' : 'Conductor not online yet.'} {live.length ? `${live.length} worker${live.length === 1 ? '' : 's'} online.` : 'No workers online yet.'}</p>
          {started
            ? <details><summary className="small">The command, to start it again</summary>{startCode}</details>
            : <><p className="small muted">Paste this in PowerShell or Terminal on the computer that holds the project.</p>{startCode}</>}
        </Step>

        <Step done={joined.length > 0} title="2. Add a teammate&apos;s computer">
          <div className="connect">
            {share ? (
              <>
                <p className="small muted">Send them the invite to watch the board: <a href={share.page}>{share.page}</a>. To let their computer&apos;s workers code too:</p>
                <JoinSteps link={share.page} gitUrl={gitUrl} say={say} restart={restart} />
                <p className="small muted">{tailscale ? 'This is a private Tailscale link: the teammate must be on your tailnet.' : 'This works on the same network. For different networks, use Tailscale and start Tandem again.'}</p>
              </>
            ) : (
              <>
                <p className="small warn">Right now only this computer can join. Start the conductor again without <code className="mono">--local</code> to invite others:</p>
                <CodeLine code={restart} say={say} />
                <p className="muted small">Or add more workers on this computer:</p>
                <CodeLine code="tandem --start --workers 4" say={say} />
              </>
            )}
            {joined.length > 0 && <p className="small muted">Teammates&apos; computers online: {joined.map(w => w.name).join(', ')}.</p>}
            <details>
              <summary className="small">Or use your own Claude Code session as a worker</summary>
              <ol className="steps small">
                <li>Connect it: <CodeLine code={mcp} say={say} /></li>
                <li>Give it the team rules: copy <code className="mono">mcp/skill/SKILL.md</code> to <code className="mono">.claude/skills/tandem-worker/SKILL.md</code> in your project.</li>
                <li>Tell it: <em>Register with the tandem tools using my name, then claim a task, do it, and complete it. Repeat until no tasks are left.</em></li>
              </ol>
            </details>
          </div>
        </Step>

        <Step done={snap.goals.length > 0} title="3. Send a goal">
          {isOp
            ? <p className="small muted">On the <a href="#/board" onClick={() => go('board')}>Board</a>, describe what you want built and pick an effort (it decides which Claude models plan and do the work). The conductor turns it into tasks, and every connected computer&apos;s workers pick them up.</p>
            : <p className="small muted">The conductor must approve this browser before it can send goals. Use <strong>Request control</strong> in the top bar, then go to the Board.</p>}
        </Step>
      </ol>
    </section>
  );
}
