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
- **Dashboard** (`dashboard/`): the web page. Its start screen explains how to start a project host or open an invite, then an app with a floating dock: Board (prompt, next step, Waiting → To do → In progress → Done inside each goal's lane, task details, and a **Merge into my project** button on a finished goal), Team (with the Get started steps at the top), Shared memory, Activity and Settings.
- **Manager** (`manager/`): `watch.ts` waits for goals and runs `plan.ts` (one headless Claude with `PROMPT.md`) that reads goals (`get_goals`), splits each into tasks with file lists and dependencies (`assign_task`, `create_job`), and marks it planned (`mark_goal`). When every task of a goal is done, `finish.ts` merges their branches into `tandem/<goal>`, runs the project's tests, and either finishes the goal or adds one fix task. The work stays on that branch until the user presses **Merge into my project**: the page sets the shared note `apply_<goal id>` to `requested`, `watch.ts` calls `apply.ts`, which merges the branch into the branch the project is on (refusing when there are uncommitted changes, undoing a conflicting merge) and answers `done: …` or `failed: …` in the same note.
- **tandem** (`cli/tandem.ts`): `tandem start` in your project starts the brain, the page, the manager and the workers, open to your network, and prints the invite link. `tandem join <invite>` copies the project host's project into Tandem's private work folder and adds a computer's workers to the team. `tandem stop`, `tandem status`.
- **Worker rules** (`mcp/skill/SKILL.md`): what every worker Claude follows. Claim, touch only your files, respect locks, report, complete.
- **Lock-check hook** (`mcp/hook/check-lock.mjs`): stops a Claude from editing a file another task holds. This is enforcement, not just a rule.
- **Launcher** (`launcher/launcher.ts`): on each teammate's machine. Claims a task, runs `claude -p` in a git worktree on branch `task/<id>`, commits, completes. A test-only switch fakes the coding so the automated tests need no Claude usage; the product has no such option.

## The whole loop (tested with real Claude runs: `mcp/test/e2e/loop.ps1`)
1. You type a goal on the dashboard. It is saved as a goal: "Waiting for the manager".
2. The manager Claude reads it, writes a shared interface note, and creates tasks. For example "write calc.py" and "write the README" in parallel, then "test calc.py" after calc.py. The goal shows "✓ Planned".
3. Worker Claudes (or launchers) claim tasks. The brain gives each a task whose files are free and locks them.
4. They do the work, report progress, and complete. Waiting tasks open by themselves.
5. The page shows every step live: Waiting → Ready → Working → Done.

## One task, start to finish
1. `register_worker`: the worker joins the team.
2. `claim_task`: the brain picks an open task whose files are free, locks those files and writes the worker's name on it, all in one step.
3. The worker edits only those files, in its own git worktree. A task that waited for others starts with their work merged in. `lock_files` adds more files, all or none. The hook blocks edits to anyone else's files.
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
- **With `--review`:** before the goal is done, the manager adds one "Review the goal's work" task. The launcher runs it with read-only tools on the goal branch, and its findings go into the goal's note and the PR.

## How teammates join
A teammate does not need controller approval to work. The Invite box first gives them a board link to watch. To add their computer's workers, they run two separate blocks in Windows PowerShell. First, once only, to get Tandem:
```powershell
git clone https://github.com/Vibertexs/tandem
```
Then, any time, to join:
```powershell
cd tandem
.\tandem.cmd join "<invite>"
```
The join copies the project from the project host into Tandem's private work folder and starts workers that push task branches back to the host. It does not change an existing project folder. The Team page shows the exact commands; macOS/Linux uses the same clone, then `cd tandem` and `./tandem join "<invite>"`. The host's Git server has no separate login, so the invite must stay on a trusted private network such as Tailscale. A teammate can instead connect their own Claude Code with one `claude mcp add` command plus the worker skill. To send goals or change the team, they click **Request control**; a current controller clicks **Approve**. The manager requests the same browser permission.

## Who may do what
- **Worker actions** (claim, lock, complete, heartbeat, report, cost): only by the identity that registered that worker (or an operator). Anyone may register a new worker; a name in use can only be taken over after its owner has been quiet for 2 minutes.
- **Manager actions** (goals, tasks and jobs, shared memory, clearing the board, approvals): only an **operator** may do them in the team's `live` session. The page `tandem start` opens (`host=1`, never in the invite link) takes control by itself when the team has no controller, and approves the manager's request; another browser uses **Request control**, and a current controller approves it. This is a saved browser identity, not a Tandem account or a Claude login.

## Teams and sessions
A team is one database on a brain (`-Db`, default `tandem-local`). The page and every Claude use its `live` session. The brain still supports other sessions (the tests use them to stay isolated).

## Open design questions
- Identities are saved tokens, not accounts. A real login (GitHub through SpacetimeDB's OIDC support) is the next step before hosting publicly.
- Hosting: teammates on other machines and judges need a public brain (Maincloud or a tunnel). Nothing is deployed.
