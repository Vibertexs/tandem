// Picks the model and effort for a task from routing.json (section 7 of the root README).
// A model or effort the manager set on the task wins. Otherwise: by kind (map / reduce), then by
// difficulty. A worker above the usage threshold is moved one model down.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Routing = {
  by_difficulty: Record<string, { model: string; effort: string }>;
  by_kind: Record<string, { model: string; effort: string }>;
  downgrade_above_usage_pct: number;
  downgrade_order: string[];
  retry_effort: string;
};

export const loadRouting = (): Routing =>
  JSON.parse(readFileSync(fileURLToPath(new URL('./routing.json', import.meta.url)), 'utf8'));

export function route(
  task: { kind: string; difficulty: string; model: string; effort: string },
  usage5h: number | null,
  r: Routing,
): { model: string; effort: string } {
  const base = r.by_kind[task.kind] ?? r.by_difficulty[task.difficulty] ?? r.by_difficulty.normal;
  let model = task.model || base.model;
  const effort = task.effort && task.effort !== 'default' ? task.effort : base.effort;
  if (!task.model && usage5h !== null && usage5h > r.downgrade_above_usage_pct) {
    const i = r.downgrade_order.indexOf(model);
    if (i >= 0 && i < r.downgrade_order.length - 1) model = r.downgrade_order[i + 1];
  }
  return { model, effort };
}
