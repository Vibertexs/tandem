// One card per agent: what it is working on, which files it holds, and the shared notes it sees.
// Used on the Overview and on the Shared memory page.
import type { Snapshot } from './brain';
import { Avatar, WorkerStatus, agentLabel, isManager, managerOnline, online, took, liveInfo } from './ui';

export const NOTE_KEYS = ['project_summary', 'interfaces', 'decisions'] as const;
export const NOTE_TITLES: Record<string, string> = { project_summary: 'Project summary', interfaces: 'Interfaces', decisions: 'Decisions' };

// the notes that have something written in them: every worker's Claude gets these before each task
export const notesWritten = (snap: Snapshot) => NOTE_KEYS.filter(k => (snap.context[k] ?? '').trim());

export function AgentCards({ snap, now, compact = false }: { snap: Snapshot; now: number; compact?: boolean }) {
  const notes = notesWritten(snap);
  const workers = [...snap.workers].sort((a, b) => Number(online(b, now)) - Number(online(a, now)) || a.name.localeCompare(b.name));
  const manager = snap.operators.some(o => isManager(o.name)) || snap.presence.some(p => p.kind === 'manager');
  return (
    <div className={`agent-grid ${compact ? 'compact' : ''}`}>
      {manager && (
        <article className="card agent-card" aria-label="Manager">
          <header><span className="avatar manager-mark" aria-hidden="true" style={{ width: 32, height: 32 }}>M</span>
            <div><strong>Manager</strong><div className="small muted">Plans goals into tasks, merges their branches, writes the shared notes</div></div>
            <span className={`chip ${managerOnline(snap, now) ? 'st-idle' : 'st-offline'}`}><span className="status-dot" aria-hidden="true" />{managerOnline(snap, now) ? 'Online' : 'Offline'}</span>
          </header>
        </article>
      )}
      {workers.map(w => {
        const current = snap.tasks.find(t => t.status === 'claimed' && t.assignee === w.id);
        const info = current ? liveInfo(current, snap.events) : null;
        const held = snap.locks.filter(l => l.workerId === w.id);
        return (
          <article key={w.id} className={`card agent-card ${online(w, now) ? '' : 'is-offline'}`} aria-label={`Agent ${w.name}`}>
            <header>
              <Avatar name={w.name} size={32} />
              <div><strong>{w.name}</strong><div className="small muted">{agentLabel(w)}</div></div>
              <WorkerStatus w={w} now={now} />
            </header>
            <dl className="agent-facts">
              <dt>Working on</dt>
              <dd>{current ? <>{current.title}{info?.since ? <span className="muted"> · {took(info.since, now)}</span> : null}</> : <span className="muted">Nothing right now</span>}</dd>
              <dt>Holding</dt>
              <dd className="mono">{held.length ? held.map(l => <div key={l.path}>{l.path}</div>) : <span className="muted sans">No files</span>}</dd>
              <dt>Sees</dt>
              <dd>{notes.length ? notes.map(k => NOTE_TITLES[k]).join(', ') : <span className="muted">No notes written yet</span>}</dd>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
