// The "goal done" webhook message, against a local server standing in for Slack.
import { createServer } from 'node:http';
import type { Goal, Task } from '../../mcp/src/brain-client.js';
import { goalDoneMessage, notify, payloadFor } from '../notify.js';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  notify: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const goal: Goal = { id: 'g1', text: 'Build the calculator', status: 'planned', created_at: '', branch: '', cost_usd: 0.01, effort: 'medium' };
const task = (id: string, assignee: string, cost: number): Task => ({
  id, job_id: null, kind: 'normal', title: id, description: '', files: [], difficulty: 'easy', model: '', effort: 'default',
  status: 'done', assignee, branch: `task/${id}`, depends_on: [], result: null, result_summary: null, goal_id: 'g1', cost_usd: cost,
});

const text = goalDoneMessage(goal, [task('a', 'w-alex', 0.02), task('b', 'w-sam', 0.03)], 'tandem/g1', 'Tests pass (python -m unittest).');
check('the message says what, who, what it cost, where and how it went',
  text === '✓ Goal done: Build the calculator\n2 tasks by 2 workers, ~$0.06 of Claude usage (estimated at API prices).\nAll of its work is on tandem/g1.\nTests pass (python -m unittest).', text);
check('Discord gets {content}, Slack gets {text}',
  'content' in payloadFor('https://discord.com/api/webhooks/1/x', 'hi') && 'text' in payloadFor('https://hooks.slack.com/services/T/B/x', 'hi'));

let body = '';
const server = createServer((req, res) => { req.on('data', d => { body += d; }); req.on('end', () => { res.end('ok'); }); });
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
const port = (server.address() as { port: number }).port;
check('it posts the message as JSON', await notify(`http://127.0.0.1:${port}/hook`, text) && JSON.parse(body).text === text, body);
server.close();
check('no URL: nothing is sent', !(await notify(undefined, text)));
check('an unreachable URL fails quietly', !(await notify(`http://127.0.0.1:${port}/gone`, text)));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
