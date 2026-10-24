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
- **MCP server** (`mcp/`): the buttons Claude can press. 16 tools from `contract/tools.json`. One file (`src/brain-client.ts`) talks to the database. `BRAIN_MODE=mock` swaps in an in-memory copy.
- **Dashboard** (`dashboard/`): one page. Demo is a private sandbox with simulated workers. My team is the real session: a prompt box, staged progress, Add a teammate, and Manage.
- **Manager** (`manager/`): `PROMPT.md` plus `run.ps1`. A Claude that reads goals (`get_goals`), splits each into tasks with file lists and dependencies (`assign_task`, `create_job`), and marks it planned (`mark_goal`).
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
- **A worker hits its limit (usage 100):** it is capped and its running task goes back to the queue.

## How teammates join
A teammate does not need approval to work. Either they run the launcher, or they connect their own Claude Code with one `claude mcp add` command (the dashboard's "Add a teammate" shows it) plus the worker skill. Only sending goals or changing the team needs an operator.

## Who may do what
- **Worker actions** (register, claim, lock, complete, heartbeat, report): open to everyone, in every session. No per-worker login yet.
- **Manager actions** (create task or job, goals, shared notes, seed, reset): in the `live` session only an **operator** may do them. The first person to claim becomes the operator and authorizes others: their browser, or the manager Claude, whose identity `run.ps1` prints.
- Demo sandboxes stay open.

## Sessions
Every row has a `session_id`. The real team uses `live`. Each demo visitor gets their own session, so ten people never see each other's data, and Reset only clears your own.

## Open design questions
- Who merges the `task/<id>` branches into `main`, and who resolves conflicts? Suggestion: an integrate task run by a worker Claude, escalating to a human, landing through a reviewed PR.
- No per-worker authentication. Any client can claim to be any worker.
- No fail tool: a task that fails twice waits for the 2-minute stale cleanup before someone else can take it.
- Hosting: teammates on other machines and judges need a public brain (Maincloud or a tunnel). Nothing is deployed.
