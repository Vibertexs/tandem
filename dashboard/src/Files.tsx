// Files: the closest thing to watching changes live. Which files are being edited right now (the file
// locks), and every file any task works on, with who has it and where it stands. The code itself
// stays on branches until you merge it; this shows what is happening to it.
import { useState } from 'react';
import type { Api, Snapshot } from './brain';
import { Avatar, ago, stageOf, STAGES, type Stage } from './ui';

type P = { snap: Snapshot; api: Api | null; isOp: boolean; now: number; say: (m: string) => void };
const FILTERS = [
  { key: 'all', label: 'All', keep: (_s: Stage) => true },
  { key: 'doing', label: 'Being edited', keep: (s: Stage) => s === 'doing' },
  { key: 'next', label: 'Not started', keep: (s: Stage) => s === 'todo' || s === 'waiting' },
  { key: 'done', label: 'Done', keep: (s: Stage) => s === 'done' },
] as const;
const ORDER: Record<Stage, number> = { doing: 0, todo: 1, waiting: 2, done: 3 };

export function FilesPage({ snap, now }: P) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');
  const keep = FILTERS.find(f => f.key === filter)!.keep;
  const name = (id: string | null) => snap.workers.find(w => w.id === id)?.name ?? '';
  const goalText = (id: string) => snap.goals.find(g => g.id === id)?.text ?? '';
  const rows = snap.tasks
    .flatMap(t => t.files.map(file => ({ file, task: t, stage: stageOf(t) })))
    .filter(r => keep(r.stage))
    .sort((a, b) => ORDER[a.stage] - ORDER[b.stage] || a.file.localeCompare(b.file));
  const distinct = new Set(snap.tasks.flatMap(t => t.files)).size;

  return (
    <div className="page">
      <p className="muted lead">The files the team is working on. Workers edit their own copy on a branch, so nothing in your folder changes until you merge a goal. This is what is happening to each file.</p>

      <section aria-labelledby="files-now"><h2 id="files-now">Being edited right now</h2>
        {snap.locks.length === 0
          ? <div className="card"><p className="muted small">No file is being edited at the moment.</p></div>
          : (
            <ul className="plain rows card" aria-label="Files being edited">
              {snap.locks.map(l => {
                const task = snap.tasks.find(t => t.id === l.taskId);
                return (
                  <li className="row" key={l.path}>
                    <code className="mono grow">{l.path}</code>
                    <span className="who"><Avatar name={name(l.workerId) || l.workerId} size={20} />{name(l.workerId) || l.workerId}</span>
                    <span className="small muted">{task?.title ?? ''} · {ago(l.createdAt, now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      <section aria-labelledby="files-all">
        <h2 id="files-all">All files <span className="muted small">· {distinct} file{distinct === 1 ? '' : 's'}</span></h2>
        <div className="row-actions filters" role="group" aria-label="Show">
          {FILTERS.map(f => <button key={f.key} type="button" className={`chip ${filter === f.key ? 'on' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>)}
        </div>
        {rows.length === 0
          ? <div className="card empty-board"><p className="muted">No files {filter === 'all' ? 'yet. They appear when the manager plans a goal.' : 'in this group.'}</p></div>
          : (
            <ul className="plain rows card file-list" aria-label="All files">
              {rows.map(r => {
                const stage = STAGES.find(s => s.key === r.stage)!;
                const who = name(r.task.assignee);
                return (
                  <li className="row" key={`${r.task.id}:${r.file}`}>
                    <code className="mono grow">{r.file}</code>
                    <span className={`stage-tag stage-${stage.key}`}><i className="tag-dot" />{stage.title}</span>
                    {who ? <span className="who"><Avatar name={who} size={20} />{who}</span> : <span className="muted small">no one yet</span>}
                    <span className="small muted file-task" title={goalText(r.task.goalId)}>{r.task.title}</span>
                  </li>
                );
              })}
            </ul>
          )}
      </section>
    </div>
  );
}
