# manager (owner: Sam; first version built by Bilal while solo)

The planner: a Claude Code session with the tandem MCP that turns the operator's goals into tasks.

## How to run it
1. The operator types a goal on the dashboard (My team). It waits as "Waiting for the manager".
2. Run `powershell -File manager/run.ps1 -Db bilal-dev`. It prints the manager's identity.
3. The first time, authorize that identity on the dashboard (Manage > Who can operate). Then run it again.
4. The manager reads every waiting goal, splits each into tasks with file lists and dependencies, and marks the goal planned. Workers pick the tasks up.

`run.ps1` is one headless `claude -p` run (haiku, `--max-budget-usd 0.50` by default; change with `-Model` and `-MaxBudgetUsd`). It uses `--mcp-config`, so nothing is added to your Claude Code settings. For an interactive manager instead, start Claude Code with the tandem MCP and paste `PROMPT.md`.

## Checklist
- [x] Finish `PROMPT.md` (fill in the [FILL] parts): goals come from `get_goals`; 1 worked example
- [x] Splitting rules: list the files each task touches, no overlapping files between parallel tasks, set difficulty (checked by `mcp/test/e2e/loop-verify.ts plan`)
- [ ] Map-reduce: split a big job into independent map tasks plus one merge task using `create_job` (in the prompt; not yet tried with a real goal)
- [x] Fixed result format for map tasks (`contract/result-format.json`), written into the worker skill `mcp/skill/SKILL.md`
- [ ] Assignment logic: call `get_capacity`, prefer workers with headroom, skip anyone capped or stale. The manager reads capacity; who gets a task is decided by `claim_task` (first free worker) and reservations, not by the manager
- [x] Write shared interfaces to context with `set_context` before parallel work starts (seen in the real run)

## Done when
One goal produces a sensible task list assigned across at least two workers: **done**, see `mcp/test/e2e/loop.ps1` (goal -> 3 tasks -> two workers -> all done, their tests pass, dashboard shows it). One big job produces N map tasks and one blocked merge task: the brain and tools do this (`create_job`, tested); a real manager run on a "for every module" goal has not been tried.
