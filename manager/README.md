# manager (owner: Sam; first version built by Bilal while solo)

The planner: a Claude Code session with the tandem MCP that turns the operator's goals into tasks.

## How to run it
`.\start.ps1` in the repo root starts the manager for you (`watch.ts`). By hand: `cd manager && npm install && npx tsx watch.ts --repo <repo>` (env `STDB_URI`, `STDB_DB`).

1. The first time, the watcher asks to manage the team. The page shows "Manager Claude wants to help manage this team"; click **Approve**. Its login is saved, so this happens once.
2. You type a goal on the Board. Within a few seconds the watcher sees it and runs `plan.ts` once for all waiting goals.
3. The manager splits each goal into tasks with file lists and dependencies, writes shared interfaces to Shared memory when needed, and marks the goal planned. Workers pick the tasks up.
4. A goal that fails to plan twice is skipped, so one bad goal cannot use up your quota.

`npx tsx plan.ts --db <team>` plans whatever is waiting once and stops (`run.ps1` is the same, for PowerShell scripts).

5. When every task of a goal is done, `finish.ts` merges the task branches into `tandem/<goal id>` (`merge.ts`, in a separate worktree), runs the project's tests on it (`verify.ts`: an npm `test` script or Python unittest files), and finishes the goal. If the tests fail, it adds one "Fix the failing tests" task to the goal first; the launcher starts that task from the goal branch. With `--push`, the goal branch is pushed to origin and, if the GitHub CLI is set up, a PR is opened.

Tests: `npm test` here (merge, verify, finish, push; no Claude calls).

Planning is one headless `claude -p` run (haiku, `--max-budget-usd 0.50` by default; `start.ps1 -ManagerModel` changes the model). It uses `--mcp-config`, so nothing is added to your Claude Code settings. For an interactive manager instead, start Claude Code with the tandem MCP and paste `PROMPT.md`.

## Checklist
- [x] Finish `PROMPT.md` (fill in the [FILL] parts): goals come from `get_goals`; 1 worked example
- [x] Splitting rules: list the files each task touches, no overlapping files between parallel tasks, set difficulty (checked by `mcp/test/e2e/loop-verify.ts plan`)
- [ ] Map-reduce: split a big job into independent map tasks plus one merge task using `create_job` (in the prompt; not yet tried with a real goal)
- [x] Fixed result format for map tasks (`contract/result-format.json`), written into the worker skill `mcp/skill/SKILL.md`
- [ ] Assignment logic: call `get_capacity`, prefer workers with headroom, skip anyone capped or stale. The manager reads capacity; who gets a task is decided by `claim_task` (first free worker) and reservations, not by the manager
- [x] Write shared interfaces to context with `set_context` before parallel work starts (seen in the real run)

## Done when
One goal produces a sensible task list assigned across at least two workers: **done**, see `mcp/test/e2e/loop.ps1` (goal -> 3 tasks -> two workers -> all done, their tests pass, dashboard shows it). One big job produces N map tasks and one blocked merge task: the brain and tools do this (`create_job`, tested); a real manager run on a "for every module" goal has not been tried.
