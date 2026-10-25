# launcher (owner: Sam; TypeScript version built by Bilal while solo)

One per teammate. Runs on their machine, logged in as themselves. Pulls tasks and runs each one as a fresh headless Claude Code run in its own git worktree. Code: `launcher.ts` (the Python placeholder `launcher.py` is left untouched and unused).

## Run it
`tandem start` in your project starts two launchers for you (`--workers N` for more). `tandem join <invite>` starts them for someone else's team. By hand:
```
cd brain && npm install && cd ../mcp && npm install && cd ../launcher && npm install
# real runs (uses your Claude quota):
npx tsx launcher.ts --name Sam --repo C:\path\to\your\repo
# no Claude calls, for demos:
npx tsx launcher.ts --name Sam --repo C:\path\to\your\repo --exit-when-idle
```
Options: `--plan pro|max`, `--exit-when-idle`, `--max-tasks N`, `--poll <seconds>`, `--push`, `--sim-ms <ms>`, `--sim-limit <seconds>` (simulate a usage limit on the first task).
Env: `STDB_URI`, `STDB_DB`, `TANDEM_SESSION` (default `live`), `LAUNCHER_BUDGET_USD` (per-run cap, default 0.50), `LAUNCHER_MODEL` (force one model, for cheap tests).

## What one task looks like
1. `claim_task` (the brain locks its files).
2. `git worktree add .worktrees/<task words>-<task id>` on a new branch `task/<task id>`. A task that waited for others (`depends_on`) starts with their branches merged in, so its Claude can read the code it builds on. A task added to a finished goal (a test fix) starts from the goal branch.
3. `claude -p` in that worktree with the team rules (`mcp/skill/SKILL.md`) and the task. The run gets:
   - the tandem MCP, so it can report progress and lock extra files
   - the lock-check hook, via `--settings`, so it cannot edit files other tasks hold
   - the model and effort from `routing.json`
   - the budget cap
4. Commit the changes on the task branch, then `complete_task` with that branch. When every task of a goal is done, the manager merges these branches into one `tandem/<goal id>` branch.
5. A usage-limit message caps the worker (usage 100), and the brain puts the task back in the queue. The launcher reads when the limit resets (`limits.ts`: an epoch after `|`, or "resets 3pm"; else 30 minutes), stays online, then reports usage 0 and takes work again.
6. A failed run is retried once at `retry_effort`. If it fails again, the task is given back with the reason (`give_back_task`) and a different worker gets it.
7. A "Review the goal's work" task (manager `--review`) runs with read-only tools (Read, Glob, Grep), and its whole reply is kept as the result.
8. A "Resolve the merge conflict with task/X" task is special: the launcher starts that merge in the worktree, Claude only edits out the conflict markers, and the launcher commits the merge (retrying if markers are left).

`.worktrees/` is kept out of your repo's `git status` through `.git/info/exclude`, so nothing is committed to your repo.

## Checklist
- [x] Launcher loop: register, claim a task, run it in a git worktree, report progress and completion, repeat (`launcher.ts`; the Python placeholder is not used)
- [x] Run with `claude -p` using the model and effort on the task (`--model`, `--effort`; checked with `claude --help`)
- [x] Rate-limit handling: report it, requeue the task, mark the worker capped until `reset_at`, then come back. Tested with `--sim-limit` and sample limit messages (`test/limits.test.ts`); not yet against a real limit
- [x] Routing: `routing.json` fills in model and effort when the manager leaves them blank, and downgrades one step when the worker is above 80% usage (`test/routing.test.ts`)
- [x] Retry a failed task once at higher effort, then give it back (`give_back_task`). The give-back rules are tested in the brain and on the page; the launcher's retry has not met a real failure
- [ ] Capacity reporter (`statusline/report_usage.py`): not done; the placeholder is untouched
- [x] A tests-only simulate mode: fake runs with timed progress and canned results (including canned structured results for map tasks), no Claude calls (`test/simulate.test.ts`). It is not offered by the `tandem` command.

## Done when
- Assigning a task makes a teammate's machine run it and push a branch. **Done:** `test/real.ts` (1 haiku run) claims a task, runs Claude in a worktree and commits `hello.py` on `task/t-hello`. `manager/test/two-computers.ts` runs the worker on a second clone with `--push`, and the host merges its branches from origin.
- Simulate mode does the same visibly with no Claude calls. **Done:** `test/simulate.test.ts` has two launchers finish a 6-task job, with a dependency and a merge task, then exit by themselves.

## Tests
`npm test` (routing, limit parsing, simulate; no Claude calls). `npm run test:real` and `npm run test:conflict` (1 real haiku run each).
