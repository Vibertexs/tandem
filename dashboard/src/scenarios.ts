// What each judge-mode button does. Each one is a few calls to the brain, as in contract/scenarios.md.
import type { Api, Snapshot } from './brain';

export type ScenarioName = 'demo' | 'mapreduce' | 'limit' | 'samefile' | 'idle' | 'reset';

const rid = () => Math.random().toString(36).slice(2, 6);

export const SCENARIO_LABEL: Record<ScenarioName, string> = {
  demo: 'Run the demo',
  mapreduce: 'Run map-reduce',
  limit: 'Make Sam hit a limit',
  samefile: 'Make two agents edit the same file',
  idle: 'Teammate goes idle',
  reset: 'Reset',
};

// Returns a short plain-English message for the toast.
export async function runScenario(name: ScenarioName, api: Api, snap: Snapshot): Promise<string> {
  switch (name) {
    case 'demo':
      await api.seed('demo');
      return 'Goal sent to the manager: 4 tasks created.';
    case 'mapreduce':
      await api.seed('review');
      return 'Big job started: 12 pieces and one merge task.';
    case 'limit': {
      const sam = snap.workers.find(w => w.name === 'Sam') ?? snap.workers[0];
      if (!sam) return 'No teammates yet. Press Reset first.';
      await api.capacity(sam.id, { usage5h: 100, status: 'capped' });
      return `${sam.name} hit their limit. Their task goes to someone else.`;
    }
    case 'samefile': {
      const id = rid();
      const file = 'src/shared/config.py';
      await api.createTask({ id: `t-same-a-${id}`, title: 'Change config (agent A)', files: [file], difficulty: 'normal' });
      await api.createTask({ id: `t-same-b-${id}`, title: 'Change config (agent B)', files: [file], difficulty: 'normal' });
      return 'Two tasks need the same file. One will wait for the lock.';
    }
    case 'idle': {
      // The most loaded teammate (or a capped one) becomes free, and gets an urgent task of their own.
      const pick = [...snap.workers].sort((a, b) => (b.usage5h ?? 0) - (a.usage5h ?? 0))[0];
      if (!pick) return 'No teammates yet. Press Reset first.';
      await api.capacity(pick.id, { usage5h: 5, status: 'idle' });
      await api.createTask({ id: `t-urgent-${rid()}`, title: 'Urgent hotfix', files: [`src/hotfix_${rid()}.py`], difficulty: 'easy' }, pick.id);
      return `${pick.name} is free and gets the next task right away.`;
    }
    case 'reset':
      await api.reset();
      return 'Back to the start.';
  }
}
