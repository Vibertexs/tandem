// Tandem MCP server (stdio). All 16 tools from contract/tools.json. Env:
//   STDB_URI          default ws://127.0.0.1:3001
//   STDB_DB           default bilal-dev
//   TANDEM_SESSION    default "live"
//   TANDEM_WORKER_ID  optional; otherwise call register_worker first
//   HEARTBEAT_MS      default 30000
//   TANDEM_TOKEN_FILE where this server saves its login (default mcp/.tandem/token-<db>)
//   BRAIN_MODE=mock   in-memory brain loaded from contract/seed.json, no database
// stdout is the protocol channel. Log to stderr only.
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { BrainClient, type Brain } from './brain-client.js';
import { MockBrain } from './mock-brain.js';

const URI = process.env.STDB_URI ?? 'ws://127.0.0.1:3001';
const DB = process.env.STDB_DB ?? 'bilal-dev';
const SESSION = process.env.TANDEM_SESSION ?? 'live';
let workerId: string | undefined = process.env.TANDEM_WORKER_ID;

const brainReady: Promise<Brain> = process.env.BRAIN_MODE === 'mock'
  ? Promise.resolve(new MockBrain())
  : BrainClient.connect(URI, DB, SESSION);
brainReady.then(b => console.error(`tandem: connected to ${SESSION} as ${b.identity}`), e => console.error('cannot connect to brain:', e));

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
function tool<A>(fn: (brain: Brain, args: A) => unknown | Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(await brainReady, args));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('operator only')) {
        return fail('Only an operator can do this in the live session. Run "npm run whoami" in mcp/ and authorize that identity on the dashboard.');
      }
      return fail(msg);
    }
  };
}

function me(): string {
  if (!workerId) throw new Error('No worker yet. Call register_worker first.');
  return workerId;
}

const taskDraft = z.object({
  title: z.string(),
  description: z.string().optional(),
  files: z.array(z.string()).describe('Files this task will touch. Used for locks.'),
  difficulty: z.enum(['easy', 'normal', 'hard']).optional(),
  model: z.string().optional().describe('Leave out unless there is a reason. The launcher routes by difficulty.'),
  effort: z.string().optional(),
  depends_on: z.array(z.string()).optional().describe('Task ids that must finish first.'),
});

const handle = serveStdio(() => {
  const server = new McpServer({ name: 'tandem', version: '0.2.0' });

  // ---- worker side ----
  server.registerTool('register_worker', {
    description: 'Adds the teammate to the brain. Call once per session.',
    inputSchema: z.object({ name: z.string(), plan: z.enum(['pro', 'max']) }),
  }, tool(async (brain, { name, plan }) => {
    const id = 'w-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await brain.registerWorker(id, name, plan);
    workerId = id;
    return { worker_id: id };
  }));

  server.registerTool('report_capacity', {
    description: "Updates this worker's usage numbers. 100 in usage_5h caps the worker and puts their running task back in the queue.",
    inputSchema: z.object({
      usage_5h: z.number().min(0).max(100).nullable(),
      usage_week: z.number().min(0).max(100).nullable(),
      reset_at: z.string().nullable().describe('ISO timestamp when the cap lifts, or null'),
    }),
  }, tool(async (brain, { usage_5h, usage_week, reset_at }) => {
    await brain.reportCapacity(me(), usage_5h, usage_week, reset_at);
    return { ok: true };
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

  server.registerTool('report_progress', {
    description: 'Adds a progress message to the event log.',
    inputSchema: z.object({ task_id: z.string(), message: z.string() }),
  }, tool(async (brain, { task_id, message }) => {
    await brain.reportProgress(me(), task_id, message);
    return { ok: true };
  }));

  server.registerTool('complete_task', {
    description: 'Marks the task done and releases its locks. May unblock dependents or the merge task.',
    inputSchema: z.object({
      task_id: z.string(), branch: z.string(), summary: z.string(),
      result: z.unknown().optional().describe('Map tasks: the structured result, see contract/result-format.json'),
    }),
  }, tool(async (brain, { task_id, branch, summary, result }) => {
    await brain.completeTask(me(), task_id, branch, summary, result);
    return { ok: true };
  }));

  server.registerTool('get_context', {
    description: 'Returns the shared project summary, interfaces and decisions.',
  }, tool(brain => ({ context: brain.getContext() })));

  server.registerTool('get_job_results', {
    description: "Returns the structured results of a job's finished map tasks (used by the merge task).",
    inputSchema: z.object({ job_id: z.string() }),
  }, tool((brain, { job_id }) => ({ results: brain.getJobResults(job_id) })));

  // ---- manager side ----
  server.registerTool('assign_task', {
    description: 'Creates a task for a worker\'s launcher to pick up. With an assignee, only that worker can claim it.',
    inputSchema: z.object({ task: taskDraft, assignee: z.string().optional().describe('worker id, for example w-sam') }),
  }, tool(async (brain, { task, assignee }) => ({ task_id: await brain.assignTask(task, assignee) })));

  server.registerTool('create_job', {
    description: 'Creates the map tasks and one merge task that stays blocked until every map task is done.',
    inputSchema: z.object({ goal: z.string(), map_tasks: z.array(taskDraft).min(1), merge_task: taskDraft }),
  }, tool(async (brain, { goal, map_tasks, merge_task }) => ({ job_id: await brain.createJob(goal, map_tasks, merge_task) })));

  server.registerTool('get_capacity', {
    description: "Everyone's usage, status and last_seen.",
  }, tool(brain => ({ workers: brain.getCapacity() })));

  server.registerTool('get_status', {
    description: 'Task board and locks.',
  }, tool(brain => brain.getStatus()));

  server.registerTool('get_goals', {
    description: 'Returns the goals the operator typed that are still waiting to be planned (status new), oldest first.',
  }, tool(brain => ({ goals: brain.getGoals() })));

  server.registerTool('mark_goal', {
    description: 'Marks a goal "planning" when you start splitting it, and "planned" once its tasks exist.',
    inputSchema: z.object({ goal_id: z.string(), status: z.enum(['planning', 'planned']) }),
  }, tool(async (brain, { goal_id, status }) => {
    await brain.markGoal(goal_id, status);
    return { ok: true };
  }));

  server.registerTool('set_context', {
    description: 'Updates shared decisions and interfaces. Keep values short: every task reads them.',
    inputSchema: z.object({ key: z.string(), value: z.string() }),
  }, tool(async (brain, { key, value }) => {
    await brain.setContext(key, value);
    return { ok: true };
  }));

  return server;
});

const shutdown = () => {
  void handle.close();
  void brainReady.then(b => b.disconnect()).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('end', shutdown);
