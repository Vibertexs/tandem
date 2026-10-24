# launcher (owner: Sam; TypeScript version built by Bilal while solo)

One per teammate. Runs on their machine, logged in as themselves. Pulls tasks and runs each one as a fresh headless Claude Code run in its own git worktree. Code: `launcher.ts` (the Python placeholder `launcher.py` is left untouched and unused).

## Run it
`.\start.ps1` in the repo root starts two launchers for you (`-Workers N` for more, `-Simulate` for fake coding, `-Join ws://<host>:3001 -Db <team>` to work for someone else's team). By hand:
```
cd brain && npm install && cd ../mcp && npm install && cd ../launcher && npm install
# real runs (uses your Claude quota):
npx tsx launcher.ts --name Sam --repo C:\path\to\your\repo
# no Claude calls, for demos:
npx tsx launcher.ts --name Sam --simulate
```
Options: `--plan pro|max`, `--exit-when-idle`, `--max-tasks N`, `--poll <seconds>`, `--sim-ms <ms>`.
Env: `STDB_URI`, `STDB_DB`, `TANDEM_SESSION` (default `live`), `LAUNCHER_BUDGET_USD` (per-run cap, default 0.50), `LAUNCHER_MODEL` (force one model, for cheap tests).

## What one task looks like
1. `claim_task` (the brain locks its files).
2. `git worktree add .worktrees/<task id>` on a new branch `task/<task id>`.
3. `claude -p` in that worktree with the team rules (`mcp/skill/SKILL.md`) and the task. The run gets:
   - the tandem MCP, so it can report progress and lock extra files
   - the lock-check hook, via `--settings`, so it cannot edit files other tasks hold
   - the model and effort from `routing.json`
   - the budget cap
4. Commit the changes on the task branch, then `complete_task` with that branch. When every task of a goal is done, the manager merges these branches into one `tandem/<goal id>` branch.
5. A rate-limit message caps the worker (usage 100), and the brain puts the task back in the queue. A failed run is retried once at `retry_effort`.

## Checklist
- [x] Launcher loop: register, claim a task, run it in a git worktree, report progress and completion, repeat (`launcher.ts`; the Python placeholder is not used)
- [x] Run with `claude -p` using the model and effort on the task (`--model`, `--effort`; checked with `claude --help`)
- [ ] Rate-limit handling: report it, requeue the task, mark the worker capped until `reset_at`. Built (caps the worker, which requeues the task), but not tested against a real rate limit, and `reset_at` is not read from the error
- [x] Routing: `routing.json` fills in model and effort when the manager leaves them blank, and downgrades one step when the worker is above 80% usage (`test/routing.test.ts`)
- [ ] Retry a failed task once at higher effort. Built, not tested with a real failure. After two failures the task is left to the stale-worker cleanup (there is no fail tool yet)
- [ ] Capacity reporter (`statusline/report_usage.py`): not done; the placeholder is untouched
- [x] `--simulate` mode: fake runs with timed progress and canned results (including canned structured results for map tasks), no Claude calls (`test/simulate.test.ts`)

## Done when
- Assigning a task makes a teammate's machine run it and push a branch. **Mostly done:** `test/real.ts` (1 haiku run) claims a task, runs Claude in a worktree and commits `hello.py` on `task/t-hello`. It does not push; the test repo has no remote.
- Simulate mode does the same visibly with no Claude calls. **Done:** `test/simulate.test.ts` has two launchers finish a 6-task job, with a dependency and a merge task, then exit by themselves.

## Tests
`npm test` (routing + simulate, no Claude calls). `npx tsx test/real.ts` (1 real haiku run).
