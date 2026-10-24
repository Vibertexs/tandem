# mcp notes

## Contract issues found (contract/ not changed)
1. No tool fails or requeues a task, but the launcher requeues on rate limits and "Make Sam hit a limit" needs it. Suggest `fail_task(task_id, reason, requeue?)`.
2. Tools have no worker or session argument. This server keeps the worker id from `register_worker` (or env `TANDEM_WORKER_ID`). Session id is not in the POC.
3. `register_worker`, `assign_task`, `create_job` "return" ids, but reducers return nothing. POC: `register_worker` builds the id from the name (`w-<name>`). The others are not built yet.
4. `scenarios.md` says "Blocked" for a task waiting on a lock, but `tables.md` uses `blocked` for waiting on `depends_on`. In the brain, a task waiting on a lock simply stays `open`.
5. `tools.json` says `lock_files` returns `held_by: task_id`. Implemented that way.

## Decisions
- MCP SDK: `@modelcontextprotocol/server` and `@modelcontextprotocol/client` v2.4 (npm `latest`; the v1 `@modelcontextprotocol/sdk` README calls v1 the maintenance line). Zod v4 (`zod/v4`). Docs: https://ts.sdk.modelcontextprotocol.io/v2/
- Tool errors come back as `isError: true` with a plain message.
- Tool results are JSON text in `content`.

## Known limits
- `src/brain-client.ts` imports `../../brain/bindings`, so `brain/` needs `npm install` too. A shared package would fix this.
- Default database is `bilal-dev` on `ws://127.0.0.1:3001`. Set `STDB_URI` and `STDB_DB` for anything else.
- Only 6 of the 14 tools exist. Missing: report_capacity, report_progress, get_context, get_job_results, assign_task, create_job, get_capacity, set_context.
