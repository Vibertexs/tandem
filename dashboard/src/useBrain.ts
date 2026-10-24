import { useEffect, useMemo, useRef, useState } from 'react';
import seed from '../../contract/seed.json';
import { config } from './config';
import { connect, emptySnapshot, makeApi, readSnapshot, type Api, type Snapshot } from './brain';
import { newSimState, simStep } from './sim';

export type Status = 'connecting' | 'connected' | 'offline';

// A still picture of contract/seed.json. Used for ?mock=1 and as the fallback when the brain is unreachable.
function seedSnapshot(): Snapshot {
  const now = new Date();
  return {
    workers: seed.workers.map(w => ({
      id: w.id, name: w.name, plan: w.plan, status: w.status, usage5h: w.usage_5h_pct, usageWeek: w.usage_week_pct,
      resetAt: null, lastSeen: now,
    })),
    tasks: seed.tasks.map(t => ({
      id: t.id, jobId: t.job_id, kind: t.kind, title: t.title, description: t.description, files: t.files,
      difficulty: t.difficulty, model: t.model, effort: t.effort, status: t.status, assignee: null, branch: null,
      dependsOn: t.depends_on, resultSummary: null,
    })),
    locks: [],
    events: [],
    goals: [],
    context: { ...seed.context },
    operators: [],
  };
}

export function useBrain() {
  const [status, setStatus] = useState<Status>(config.mock ? 'offline' : 'connecting');
  const [snap, setSnap] = useState<Snapshot>(config.mock ? seedSnapshot() : emptySnapshot);
  const [api, setApi] = useState<Api | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  useEffect(() => {
    if (config.mock) return;
    let frame = 0;
    let conn: ReturnType<typeof connect> | undefined;
    const timeout = window.setTimeout(() => {
      // Never a dead end: if the brain does not answer, show a still picture and say so.
      setStatus(s => {
        if (s === 'connecting') setSnap(seedSnapshot());
        return s === 'connecting' ? 'offline' : s;
      });
    }, 6000);
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => conn && setSnap(readSnapshot(conn, config.session)));
    };
    conn = connect(config.uri, config.db, config.session, {
      change: refresh,
      connected: identity => {
        window.clearTimeout(timeout);
        setMe(identity);
        const a = makeApi(conn!, config.session);
        setApi(a);
        setStatus('connected');
        const s = readSnapshot(conn!, config.session);
        setSnap(s);
        // A new demo sandbox starts with the seed teammates. Never auto-reset the real team session.
        if (config.demo && s.workers.length === 0) void a.reset().catch(() => {});
      },
      error: () => {
        window.clearTimeout(timeout);
        setSnap(seedSnapshot());
        setStatus('offline');
      },
    });
    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      conn?.disconnect();
    };
  }, []);

  // Demo: simulated workers do the "coding". The real team never simulates.
  const simState = useMemo(newSimState, []);
  useEffect(() => {
    if (!api || !config.demo) return;
    const id = window.setInterval(() => { void simStep(api, snapRef.current, simState, Date.now()); }, 1000);
    return () => window.clearInterval(id);
  }, [api, simState]);

  return { snap, api, status, me };
}
