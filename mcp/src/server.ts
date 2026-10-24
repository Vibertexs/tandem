// Tandem MCP server (stdio). Env:
//   STDB_URI  default ws://127.0.0.1:3001   STDB_DB  default bilal-dev
//   TANDEM_WORKER_ID  optional; otherwise call register_worker first
//   HEARTBEAT_MS      default 30000
// stdout is the protocol channel. Log to stderr only.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { BrainClient } from './brain-client.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
let workerId: string | undefined = process.env.TANDEM_WORKER_ID;

const brainReady = BrainClient.connect(URI, DB);
brainReady.catch(e => console.error('cannot connect to brain:', e));

// While this process is alive the worker is alive. If Claude crashes, the
// heartbeat stops and the brain frees this worker's locks after a while.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 30_000);
setInterval(() => {
  if (!workerId) return;
  brainReady.then(b => b.heartbeat(workerId!)).catch(e => console.error('heartbeat failed:', e));
}, HEARTBEAT_MS);

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

// Wraps a tool: waits for the brain connection, turns thrown errors into tool errors.
function tool<A>(fn: (brain: BrainClient, args: A) => unknown | Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(await brainReady, args));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}

function me(): string {
  if (!workerId) throw new Error('No worker yet. Call register_worker first.');
  return workerId;
}

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'tandem', version: '0.1.0' });

  server.registerTool('register_worker', {
    description: 'Adds the teammate to the brain. Call once per session.',
    inputSchema: z.object({ name: z.string(), plan: z.enum(['pro', 'max']) }),
  }, tool(async (brain, { name, plan }) => {
    const id = 'w-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await brain.registerWorker(id, name, plan);
    workerId = id;
    return { worker_id: id };
  }));

  server.registerTool('claim_task', {
    description: 'Atomically claims the best open task for this worker and locks its files. Returns the task, or null if none is free.',
  }, tool(async brain => ({ task: await brain.claimTask(me()) })));

  server.registerTool('lock_files', {
    description: 'Takes locks for all paths or none. Fails if another task holds one.',
    inputSchema: z.object({ task_id: z.string(), paths: z.array(z.string()) }),
  }, tool((brain, { task_id, paths }) => brain.lockFiles(me(), task_id, paths)));

  server.registerTool('release_files', {
    description: "Releases this task's locks.",
    inputSchema: z.object({ task_id: z.string() }),
  }, tool(async (brain, { task_id }) => {
    await brain.releaseFiles(me(), task_id);
    return { ok: true };
  }));

  server.registerTool('complete_task', {
    description: 'Marks the task done and releases its locks. May unblock dependents or the merge task.',
    inputSchema: z.object({
      task_id: z.string(), branch: z.string(), summary: z.string(), result: z.unknown().optional(),
    }),
  }, tool(async (brain, { task_id, branch, summary, result }) => {
    await brain.completeTask(me(), task_id, branch, summary, result);
    return { ok: true };
  }));

  server.registerTool('get_status', {
    description: 'Task board and locks.',
  }, tool(brain => brain.getStatus()));

  return server;
});

const shutdown = () => {
  void handle.close();
  void brainReady.then(b => b.disconnect()).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
