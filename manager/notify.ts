// Optional: tells a Slack or Discord channel when a goal is done (an "incoming webhook" URL,
// from start.ps1 -Notify or TANDEM_WEBHOOK). Never throws: a notification is never worth failing for.
import type { Goal, Task } from '../mcp/src/brain-client.js';

export function goalDoneMessage(goal: Goal, tasks: Task[], branch: string, note: string): string {
  const cost = goal.cost_usd + tasks.reduce((sum, t) => sum + t.cost_usd, 0);
  const workers = [...new Set(tasks.map(t => t.assignee).filter(Boolean))].length;
  return [
    `✓ Goal done: ${goal.text}`,
    `${tasks.length} task${tasks.length === 1 ? '' : 's'} by ${workers} worker${workers === 1 ? '' : 's'}${cost > 0 ? `, $${cost.toFixed(2)} of Claude usage` : ''}.`,
    branch ? `All of its work is on ${branch}.` : '',
    note,
  ].filter(Boolean).join('\n');
}

// Discord wants {content}; Slack (and most others) want {text}.
export const payloadFor = (url: string, text: string) =>
  /discord(app)?\.com\/api\/webhooks/i.test(url) ? { content: text } : { text };

export async function notify(url: string | undefined, text: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payloadFor(url, text)), signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch { return false; }
}
