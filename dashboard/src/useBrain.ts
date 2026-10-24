import { useCallback, useEffect, useState } from 'react';
import seed from '../../contract/seed.json';
import type { Team } from './config';
import { connect, emptySnapshot, makeApi, readSnapshot, type Api, type Snapshot } from './brain';

// connecting -> connected; or unreachable if the brain does not answer.
export type Status = 'connecting' | 'connected' | 'unreachable';

// A still picture of contract/seed.json, for ?mock=1.
export function seedSnapshot(): Snapshot {
  const now = new Date();
  return {
    ...emptySnapshot,
    workers: seed.workers.map(w => ({
      id: w.id, name: w.name, plan: w.plan, status: w.status, usage5h: w.usage_5h_pct, usageWeek: w.usage_week_pct,
      resetAt: null, lastSeen: now, agent: 'claude', account: '',
    })),
    tasks: seed.tasks.slice(0, 8).map(t => ({
      id: t.id, jobId: t.job_id, kind: t.kind, title: t.title, description: t.description, files: t.files,
      difficulty: t.difficulty, model: t.model, effort: t.effort, status: t.status, assignee: null, branch: null,
      dependsOn: t.depends_on, result: null, resultSummary: null, goalId: '', costUsd: 0, triedBy: [],
    })),
    context: { ...seed.context },
  };
}

export function useBrain(team: Team | null, mock: boolean) {
  const [status, setStatus] = useState<Status>('connecting');
  const [snap, setSnap] = useState<Snapshot>(mock ? seedSnapshot() : emptySnapshot);
  const [api, setApi] = useState<Api | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const retry = useCallback(() => setAttempt(a => a + 1), []);

  useEffect(() => {
    if (mock || !team) return;
    setStatus('connecting');
    setApi(null);
    setProblem(null);
    let frame = 0;
    let conn: ReturnType<typeof connect> | undefined;
    let ok = false;
    const timeout = window.setTimeout(() => { if (!ok) setStatus('unreachable'); }, 6000);
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => conn && setSnap(readSnapshot(conn)));
    };
    conn = connect(team.uri, team.db, {
      change: refresh,
      connected: identity => {
        ok = true;
        window.clearTimeout(timeout);
        setMe(identity);
        setApi(makeApi(conn!));
        setSnap(readSnapshot(conn!));
        setStatus('connected');
      },
      error: e => { window.clearTimeout(timeout); setProblem(e instanceof Error ? e.message : String(e)); setStatus('unreachable'); },
      lost: () => setStatus(s => (s === 'connected' ? 'connecting' : s)),
    });
    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      conn?.disconnect();
    };
  }, [team?.uri, team?.db, mock, attempt]);

  return { snap, api, status: mock ? ('connected' as Status) : status, me, retry, problem };
}
