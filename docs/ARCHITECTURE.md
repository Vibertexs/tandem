# How Tandem fits together (what is built today)

Plain words. Everything meets in one shared notebook, the brain. Nothing talks to anything else directly.

```
 You, in a browser             Manager Claude (terminal)        Launcher on each laptop
 "What should your             reads goals, splits them         claims a task, runs
  team build?"                 into tasks                       claude -p in a worktree
        |                              |                                 |
        | dashboard                    | MCP tools                       | MCP tools + lock hook
        v                              v                                 v
 +------------------------------------------------------------------------------------+
 |  BRAIN: SpacetimeDB database (brain/)                                              |
 |  tables:  goals | tasks | locks | workers | events | context | operators           |
 |  rules:   post_goal, claim_task, take_locks, complete_task, report_capacity, ...   |
 |  Rules run one at a time, so two claims can never both win.                        |
 +------------------------------------------------------------------------------------+
```

## The parts
- **Brain** (`brain/`): the shared notebook. Holds goals, tasks, file locks, workers, an event log and shared notes. Its rules are the point: claiming a task, locking its files and unblocking waiting tasks each happen as one indivisible step.
- **MCP server** (`mcp/`): the buttons Claude can press. 17 tools from `contract/tools.json`. One file (`src/brain-client.ts`) talks to the database. `BRAIN_MODE=mock` swaps in an in-memory copy.
- **Dashboard** (`dashboard/`): the web page. Start screen (host or join), then a Jira-style app: Board (prompt, next step, Waiting → To do → In progress → Done, task details), Goals, Team, Shared memory, Activity, Settings.
- **Manager** (`manager/`): `watch.ts` waits for goals and runs `plan.ts` (one headless Claude with `PROMPT.md`) that reads goals (`get_goals`), splits each into tasks with file lists and dependencies (`assign_task`, `create_job`), and marks it planned (`mark_goal`). When every task of a goal is done, `finish.ts` merges their branches into `tandem/<goal>`, runs the project's tests, and either finishes the goal or adds one fix task.
- **start.ps1 / stop.ps1**: one command starts the brain, the page, the manager and the workers (`-Simulate` for fake coding, `-Lan` to let others join, `-Join` to add workers to someone else's team).
- **Worker rules** (`mcp/skill/SKILL.md`): what every worker Claude follows. Claim, touch only your files, respect locks, report, complete.
- **Lock-check hook** (`mcp/hook/check-lock.mjs`): stops a Claude from editing a file another task holds. This is enforcement, not just a rule.
- **Launcher** (`launcher/launcher.ts`): on each teammate's machine. Claims a task, runs `claude -p` in a git worktree on branch `task/<id>`, commits, completes. `--simulate` fakes the coding for demos.

## The whole loop (tested with real Claude runs: `mcp/test/e2e/loop.ps1`)
1. You type a goal on the dashboard. It is saved as a goal: "Waiting for the manager".
2. The manager Claude reads it, writes a shared interface note, and creates tasks. For example "write calc.py" and "write the README" in parallel, then "test calc.py" after calc.py. The goal shows "✓ Planned".
3. Worker Claudes (or launchers) claim tasks. The brain gives each a task whose files are free and locks them.
4. They do the work, report progress, and complete. Waiting tasks open by themselves.
5. The page shows every step live: Waiting → Ready → Working → Done.

## One task, start to finish
1. `register_worker`: the worker joins the team.
2. `claim_task`: the brain picks an open task whose files are free, locks those files and writes the worker's name on it, all in one step.
3. The worker edits only those files. `lock_files` adds more files, all or none. The hook blocks edits to anyone else's files.
4. `report_progress` writes to the event log. A heartbeat every 30s says the worker is alive.
5. `complete_task`: the task is done, locks are freed, and any task waiting on it opens. A job's merge task opens once, when its last piece finishes.

## When things go wrong
- **Two workers claim at once:** the brain handles one first. The other gets a different task or nothing.
- **A file is already locked:** the task waits (stays `open`) until the lock is freed. A Claude that tries to edit it anyway is blocked by the hook.
- **A worker crashes:** no heartbeat for 2 minutes, so the brain frees its locks and reopens its task.
- **A worker hits its limit (usage 100):** it is capped and its running task goes back to the queue for someone with headroom. The launcher reads when the limit resets from Claude's message (or waits 30 minutes), stays online, then reports usage 0 and takes work again. The page shows "Out of quota until 3:00 PM".
- **A worker cannot finish a task:** it calls `give_back_task` with a reason (the launcher does this after two failed runs). The locks are freed and a different worker gets it. If a second worker gives it back too, it is marked failed: the page says "needs you" with the reason, and an operator presses **Try again**.
- **Two task branches conflict:** the manager adds a "Resolve the merge conflict with task/X" task for the files that conflict. The launcher starts that merge in the worker's worktree, Claude edits out the conflict markers, and the launcher commits the merge. The goal is finished once it is merged. A conflict that is still there after its fix task is left for a person ("merge by hand").
- **The tests fail on the goal branch:** the manager adds one "Fix the failing tests" task to the goal and checks again when it is done.

## How teammates join
A teammate does not need approval to work. On their computer they run `.\start.ps1 -Join ws://<host>:3001 -Db <team>` (the Team page shows the exact command), or connect their own Claude Code with one `claude mcp add` command plus the worker skill. To send goals or change the team, they click **Ask to make changes**, and the owner clicks **Approve**. The manager asks the same way.

## Who may do what
- **Worker actions** (claim, lock, complete, heartbeat, report, cost): only by the identity that registered that worker (or an operator). Anyone may register a new worker; a name in use can only be taken over after its owner has been quiet for 2 minutes.
- **Manager actions** (goals, tasks and jobs, shared memory, clearing the board, approvals): only an **operator** may do them in the team's `live` session. The first visitor becomes the owner ("Make me the owner"); others ask, and an operator approves.

## Teams and sessions
A team is one database on a brain (`-Db`, default `tandem-local`). The page and every Claude use its `live` session. The brain still supports other sessions (the tests use them to stay isolated).

## Open design questions
- Identities are saved tokens, not accounts. A real login (GitHub through SpacetimeDB's OIDC support) is the next step before hosting publicly.
- Hosting: teammates on other machines and judges need a public brain (Maincloud or a tunnel). Nothing is deployed.
