// BRAIN_MODE=mock: every tool answers from contract/seed.json with no database running.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}

const client = new Client({ name: 'mock-test', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/server.ts'],
  env: { ...(process.env as Record<string, string>), BRAIN_MODE: 'mock' },
}));
const call = async (tool: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name: tool, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  return { isError: r.isError === true, text, data: r.isError ? null : JSON.parse(text) };
};

check('mock: 14 tools listed', (await client.listTools()).tools.length === 14);

const reg = await call('register_worker', { name: 'Tester', plan: 'pro' });
check('mock: register_worker', reg.data?.worker_id === 'w-tester', reg.text);
const cap = await call('get_capacity');
check('mock: get_capacity returns the 3 seed workers plus the new one', cap.data?.workers.length === 4, cap.text);
check('mock: get_context returns the seed context', (await call('get_context')).data?.context?.project_summary?.includes('Demo web app'));
check('mock: report_capacity', (await call('report_capacity', { usage_5h: 30, usage_week: 10, reset_at: null })).data?.ok === true);

const c1 = await call('claim_task');
check('mock: claim_task returns the first seed task', c1.data?.task?.id === 't-login-1', c1.text);
const lk = await call('lock_files', { task_id: 't-login-1', paths: ['docs/api.md', 'extra.md'] });
check('mock: lock_files', lk.data?.ok === true, lk.text);
check('mock: report_progress', (await call('report_progress', { task_id: 't-login-1', message: 'x' })).data?.ok === true);
check('mock: release_files', (await call('release_files', { task_id: 't-login-1' })).data?.ok === true);
await call('complete_task', { task_id: 't-login-1', branch: 'b', summary: 's' });
let st = await call('get_status');
check('mock: completing t-login-1 unblocks t-login-2 and t-login-3',
  ['t-login-2', 't-login-3'].every(id => st.data.tasks.find((t: { id: string }) => t.id === id).status === 'open'));

const job = await call('create_job', { goal: 'g', map_tasks: [{ title: 'a', files: ['a'] }], merge_task: { title: 'm', files: ['m'] } });
check('mock: create_job', typeof job.data?.job_id === 'string', job.text);
check('mock: assign_task', typeof (await call('assign_task', { task: { title: 'x', files: ['x'] } })).data?.task_id === 'string');
check('mock: set_context', (await call('set_context', { key: 'k', value: 'v' })).data?.ok === true && (await call('get_context')).data.context.k === 'v');
check('mock: get_job_results (none yet)', (await call('get_job_results', { job_id: job.data?.job_id })).data?.results?.length === 0);

await client.close();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
