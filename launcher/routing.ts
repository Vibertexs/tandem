// Picks the model and effort from routing.json, by the effort chosen when the goal was sent
// (low, medium, high). The conductor plans the goal with that level's "conductor" model. A task
// gets its level's model for its kind (map / reduce) or else its difficulty. A model or effort
// the conductor set on the task wins. A worker above the usage threshold is moved one model down.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Pick = { model: string; effort: string };
export type Level = { conductor: Pick; difficulty: Record<string, Pick>; kind: Record<string, Pick> };
export type Routing = {
  by_goal_effort: Record<string, Level>;
  downgrade_above_usage_pct: number;
  downgrade_order: string[];
  retry_effort: string;
};
export const EFFORTS = ['low', 'medium', 'high'] as const;

export const loadRouting = (): Routing =>
  JSON.parse(readFileSync(fileURLToPath(new URL('./routing.json', import.meta.url)), 'utf8'));

const level = (r: Routing, goalEffort: string): Level => r.by_goal_effort[goalEffort] ?? r.by_goal_effort.medium;

// The model and effort the conductor plans a goal with.
export const conductorRoute = (goalEffort: string, r: Routing = loadRouting()): Pick => level(r, goalEffort).conductor;

export function route(
  task: { kind: string; difficulty: string; model: string; effort: string },
  usage5h: number | null,
  r: Routing,
  goalEffort = 'medium',
): Pick {
  const l = level(r, goalEffort);
  const base = l.kind[task.kind] ?? l.difficulty[task.difficulty] ?? l.difficulty.normal;
  let model = task.model || base.model;
  const effort = task.effort && task.effort !== 'default' ? task.effort : base.effort;
  if (!task.model && usage5h !== null && usage5h > r.downgrade_above_usage_pct) {
    const i = r.downgrade_order.indexOf(model);
    if (i >= 0 && i < r.downgrade_order.length - 1) model = r.downgrade_order[i + 1];
  }
  return { model, effort };
}
