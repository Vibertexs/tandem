# mcp notes

## Contract issues found (contract/ not changed)
1. No tool fails or requeues a task, but the launcher requeues on rate limits and "Make Sam hit a limit" needs it. Workaround in the brain: `report_capacity` with usage 100 caps the worker and puts their running task back in the queue. A launcher that fails a run still has no tool to say so. Suggest `fail_task(task_id, reason, requeue?)`.
2. Tools have no worker or session argument. This server keeps the worker id from `register_worker` (or env `TANDEM_WORKER_ID`) and the session from env `TANDEM_SESSION`.
3. `register_worker`, `assign_task`, `create_job` "return" ids, but reducers return nothing. The id is made here (`w-<name>`, `t-xxxxxx`, `job-xxxxxx`) and passed in.
4. `scenarios.md` says "Blocked" for a task waiting on a lock, but `tables.md` uses `blocked` for waiting on `depends_on`. In the brain, a task waiting on a lock simply stays `open`.
5. `scenarios.md` says `reset_session` reloads `seed.json`, and also that "Run the demo" creates the login tasks "from seed". Both cannot be true at once. The brain's `reset_session` loads workers and context only; `seed_tasks('demo' | 'review')` adds the tasks.
6. `tools.json` gives `report_capacity` no `status`. The dashboard's "teammate goes idle" needs one, so the brain reducer has an optional `status`; the MCP tool does not expose it.
7. `get_job_results` returns `result[]`, which has no task id. Returned as the plain parsed results.
8. `assign_task` has both a `task` and separate `model` and `effort`. Here `model` and `effort` are optional fields on the task. Left empty, the launcher decides (as `manager/PROMPT.md` says).

9. **Goals have no tool.** The dashboard saves what the operator types as a goal (`post_goal`), but the 14 tools have no way for the manager Claude to read goals or mark one planned. Proposed contract additions: `get_goals()` returns the goals with status `new`; `mark_goal(goal_id, status)` sets `planning` or `planned`. The brain already supports both (`set_goal_status`). Not added here, because `contract/` and `tools.json` are not changed without agreement.

## Decisions
- MCP SDK: `@modelcontextprotocol/server` and `@modelcontextprotocol/client` v2.4 (npm `latest`; the v1 `@modelcontextprotocol/sdk` README calls v1 the maintenance line). Zod v4 (`zod/v4`). Docs: https://ts.sdk.modelcontextprotocol.io/v2/
- Tool errors come back as `isError: true` with a plain message. Results are JSON text in `content`.
- A `Brain` interface sits in front of the real client and the mock, so tools do not know which one they use.

## Crashed workers
The server sends a heartbeat every 30s (`HEARTBEAT_MS`) once a worker is registered. If Claude dies, the heartbeat stops. After 2 minutes the brain frees that worker's locks and reopens its task. Tested with a killed server process. If a worker was only slow and comes back, its `complete_task` is rejected because the task was reopened.

## Known limits
- `src/brain-client.ts` imports `../../brain/bindings`, so `brain/` needs `npm install` too. A shared package would fix this.
- Default database is `bilal-dev` on `ws://127.0.0.1:3001`.
- The mock is simpler than the real brain: no sessions, no heartbeats, no capped-worker requeue.
- No per-worker auth: whoever runs the server picks the worker id.
