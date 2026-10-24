// The manager tools in the live session need an operator identity.
// Publishes a FRESH dev database each run. Needs `spacetime` on PATH and the local server on dev3001.
// Run from mcp/: npm run test:operator
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URI = 'ws://127.0.0.1:3001';
const DB = 'bilal-auth';
execSync(`spacetime publish ${DB} --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes`, { stdio: 'pipe' });

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const tokenFile = join(mkdtempSync(join(tmpdir(), 'tandem-op-')), 'token');
const env = { ...(process.env as Record<string, string>), STDB_URI: URI, STDB_DB: DB, TANDEM_SESSION: 'live', TANDEM_TOKEN_FILE: tokenFile };

// 1. What `npm run whoami` prints, twice: the identity must stay the same between runs.
const who = () => execSync(`"${process.execPath}" --import tsx src/whoami.ts`, { env, encoding: 'utf8' }).trim().split(/\s+/).pop()!;
const id1 = who();
const id2 = who();
check('whoami: prints a hex identity', /^[0-9a-f]{64}$/i.test(id1), id1);
check('whoami: the identity is the same on the next run (token is saved)', id1 === id2, [id1, id2]);

// 2. A human operator claims the database, then the manager tools are tried before and after authorizing.
const human = await new Promise<DbConnection>((resolve, reject) => {
  DbConnection.builder().withUri(URI).withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => resolve(c)).subscribe([tables.operators, tables.tasks]); })
    .onConnectError((_c, e) => reject(e)).build();
});
await human.reducers.claimOperator({});

const client = new Client({ name: 'manager', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/server.ts'], env }));
const call = async (tool: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name: tool, arguments: args });
  const text = (r.content as { text: string }[])[0].text;
  return { isError: r.isError === true, text, data: r.isError ? null : JSON.parse(text) };
};

const draft = { title: 'plan the thing', files: ['plan.md'] };
const before = await call('assign_task', { task: draft });
check('before authorizing: assign_task in live is refused with a helpful message', before.isError && /whoami/.test(before.text) && /operator/.test(before.text), before.text);
const beforeJob = await call('create_job', { goal: 'g', map_tasks: [draft], merge_task: { title: 'm', files: ['m.md'] } });
check('before authorizing: create_job is refused too', beforeJob.isError, beforeJob.text);
const beforeCtx = await call('set_context', { key: 'k', value: 'v' });
check('before authorizing: set_context is refused too', beforeCtx.isError, beforeCtx.text);
const beforeGoals = await call('get_goals');
check('before authorizing: reading goals works (reads are open)', !beforeGoals.isError, beforeGoals.text);
await human.reducers.postGoal({ sessionId: 'live', id: 'g1', text: 'Plan me' });
const beforeMark = await call('mark_goal', { goal_id: 'g1', status: 'planning' });
check('before authorizing: mark_goal is refused', beforeMark.isError && /operator/.test(beforeMark.text), beforeMark.text);
const reg = await call('register_worker', { name: 'Mgr', plan: 'pro' });
check('before authorizing: worker tools still work (register_worker)', reg.data?.worker_id === 'w-mgr', reg.text);

await human.reducers.addOperator({ identity: Identity.fromString(id1) });
await sleep(400);
const after = await call('assign_task', { task: draft });
check('after authorizing: assign_task works', !after.isError && typeof after.data?.task_id === 'string', after.text);
const afterJob = await call('create_job', { goal: 'g', map_tasks: [draft], merge_task: { title: 'm', files: ['m.md'] } });
check('after authorizing: create_job works', !afterJob.isError && typeof afterJob.data?.job_id === 'string', afterJob.text);
check('after authorizing: set_context works', !(await call('set_context', { key: 'k', value: 'v' })).isError);
check('after authorizing: mark_goal works', !(await call('mark_goal', { goal_id: 'g1', status: 'planned' })).isError);
await sleep(400);
check('after authorizing: the 3 tasks (1 assigned, 1 map piece, 1 merge) really exist in live', [...human.db.tasks.iter()].filter(t => t.sessionId === 'live').length === 3);

await client.close();
human.disconnect();
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
