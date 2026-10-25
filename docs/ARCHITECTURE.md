# How Tandem fits together (what is built today)

Plain words. Everything meets in one shared notebook, the brain. Nothing talks to anything else directly.

Two roles. The **conductor** is you and your computer: you ran `tandem --start` in the project, so your computer holds the project, the brain, the planning Claude ("Conductor Claude") and workers. A **teammate** is any other computer that joins with the invite and lends its Claude workers.

```
 The conductor's page          Conductor Claude (terminal)       Launcher on each computer
 "What should your             reads goals, splits them          claims a task, runs
  team build?" + effort        into tasks                        claude -p in a worktree
        |                              |                                 |
        | dashboard                    | MCP tools                       | MCP tools + lock hook
        v                              v                                 v
 +------------------------------------------------------------------------------------+
 |  BRAIN: SpacetimeDB database (brain/)                                              |
 |  tables:  goals | tasks | locks | workers | events | context | operators | ...     |
 |  rules:   post_goal, claim_task, take_locks, complete_task, report_capacity, ...   |
 |  Rules run one at a time, so two claims can never both win.                        |
 +------------------------------------------------------------------------------------+
```

## The parts
- **Brain** (`brain/`): the shared notebook. Holds goals (with their effort), tasks, file locks, workers, an event log, shared notes (with who wrote each one and when), who controls the team, who is online, and a private table with the conductor's key. Its rules are the point: claiming a task, locking its files and unblocking waiting tasks each happen as one indivisible step.
- **MCP server** (`mcp/`): the buttons Claude can press. 17 tools from `contract/tools.json`. One file (`src/brain-client.ts`) talks to the database. `BRAIN_MODE=mock` swaps in an in-memory copy.
- **Dashboard** (`dashboard/`): the web page. Its start screen explains how to start a team (which makes your computer the conductor) or open an invite, then an app with a floating dock of six pages: Board (prompt with an effort choice, next step, Waiting → To do → In progress → Done inside each active goal's lane, task details, and a one-line strip of finished goals with **Merge into my project**), Team (with the Get started steps at the top), Shared memory (the notes, who wrote and read them, and one card per agent), Usage (tokens or estimated dollars, and quota), Activity (finished goals with their results, then the log) and Settings.
- **Conductor** (`manager/`; the folder keeps its old name): `watch.ts` waits for goals and runs `plan.ts` (one headless Claude with `PROMPT.md`, its model picked by the goal's effort) that reads goals (`get_goals`), splits each into tasks with file lists and dependencies (`assign_task`, `create_job`), and marks it planned (`mark_goal`). When every task of a goal is done, `finish.ts` merges their branches into `tandem/<goal>`, runs the project's tests, and either finishes the goal or adds one fix task. The work stays on that branch until the user presses **Merge into my project**: the page sets the shared note `apply_<goal id>` to `requested`, `watch.ts` calls `apply.ts`, which merges the branch into the branch the project is on (refusing when there are uncommitted changes, undoing a conflicting merge) and answers `done: …` or `failed: …` in the same note.
- **tandem** (`cli/tandem.ts`): `tandem --start` in your project starts the brain, the page, the conductor and the workers, open to your network, and prints the invite link. `tandem join "<invite>"` copies the conductor's project into Tandem's private work folder and adds a computer's workers to the team. `tandem install` (once) puts `tandem` on the PATH. `tandem stop`, `tandem status`, `tandem doctor`.
- **Worker rules** (`mcp/skill/SKILL.md`): what every worker Claude follows. Claim, touch only your files, respect locks, report, complete.
- **Lock-check hook** (`mcp/hook/check-lock.mjs`): stops a Claude from editing a file another task holds. This is enforcement, not just a rule.
- **Launcher** (`launcher/launcher.ts`): on each computer. Claims a task, picks its model from `routing.json` (the goal's effort and the task's difficulty), puts the shared notes in the prompt and logs that it did, runs `claude -p` in a git worktree, commits, completes, and records the run's cost and tokens. A test-only switch fakes the coding so the automated tests need no Claude usage; the product has no such option.

## Effort: which model does what
The goal's effort, chosen on the Board, picks every model (`launcher/routing.json`, `by_goal_effort`). The conductor rates each task easy, normal or hard; the pieces of a big job (map) and their merge (reduce) have their own rows.

| Goal effort | Plans it | Easy task | Normal task | Hard task | Map piece | Merge (reduce) |
|---|---|---|---|---|---|---|
| Low | haiku | haiku | haiku | sonnet, medium | haiku | sonnet, medium |
| Medium | sonnet, medium | haiku | sonnet | opus, high | sonnet | opus, high |
| High | opus, high | sonnet, medium | opus, medium | opus, xhigh | opus, medium | opus, xhigh |

"medium", "high", "xhigh" are Claude Code's `--effort`. A worker above 80% of its 5-hour quota steps down one model (opus → sonnet → haiku). A task run again after a failure gets at least `high` effort. When several goals wait, the conductor plans them together at the highest of their efforts.

## Usage: tokens and dollars
Every `claude -p` run reports its cost and its tokens (input, output, cache writes and reads). The launcher records both on the task (`record_cost`), the conductor on the goal for its planning run (`add_goal_cost`). The page shows either one; dollars carry a "~" because they are what the runs would cost at API prices, and on a Pro or Max plan nothing is billed per run.

## The whole loop (tested with real Claude runs: `mcp/test/e2e/loop.ps1`)
1. You type a goal on the dashboard and pick an effort. It is saved as a goal: "Waiting for the conductor".
2. Conductor Claude reads it, writes a shared interface note, and creates tasks. For example "write calc.py" and "write the README" in parallel, then "test calc.py" after calc.py. The goal shows "Planned".
3. Worker Claudes (or launchers) claim tasks. The brain gives each a task whose files are free and locks them.
4. They read the shared notes, do the work, report progress, and complete. Waiting tasks open by themselves.
5. The page shows every step live: Waiting → To do → In progress → Done.

## One task, start to finish
1. `register_worker`: the worker joins the team.
2. `claim_task`: the brain picks an open task whose files are free, locks those files and writes the worker's name on it, all in one step.
3. The launcher gives Claude the shared notes and logs `note_read` ("bilal-pc read the shared notes (Interfaces) before …"). The worker edits only its files, in its own git worktree. A task that waited for others starts with their work merged in. `lock_files` adds more files, all or none. The hook blocks edits to anyone else's files.
4. `report_progress` writes to the event log. A heartbeat every 30s says the worker is alive.
5. `complete_task`: the task is done, locks are freed, and any task waiting on it opens. A job's merge task opens once, when its last piece finishes.

## When things go wrong
- **Two workers claim at once:** the brain handles one first. The other gets a different task or nothing.
- **A file is already locked:** the task waits (stays `open`) until the lock is freed. A Claude that tries to edit it anyway is blocked by the hook.
- **A worker crashes:** no heartbeat for 2 minutes, so the brain frees its locks and reopens its task.
- **A worker hits its limit (usage 100):** it is capped and its running task goes back to the queue for someone with headroom. The launcher reads when the limit resets from Claude's message (or waits 30 minutes), stays online, then reports usage 0 and takes work again. The page shows "Out of quota until 3:00 PM".
- **A worker cannot finish a task:** it calls `give_back_task` with a reason (the launcher does this after two failed runs). The locks are freed and a different worker gets it. If a second worker gives it back too, it is marked failed: the page says "needs you" with the reason, and the conductor presses **Try again**.
- **Two task branches conflict:** the conductor adds a "Resolve the merge conflict with task/X" task for the files that conflict. The launcher starts that merge in the worker's worktree, Claude edits out the conflict markers, and the launcher commits the merge. The goal is finished once it is merged. A conflict that is still there after its fix task is left for a person ("merge by hand").
- **The tests fail on the goal branch:** the conductor adds one "Fix the failing tests" task to the goal and checks again when it is done.
- **With `--review`:** before the goal is done, the conductor adds one "Review the goal's work" task. The launcher runs it with read-only tools on the goal branch, and its findings go into the goal's note and the PR.

## How teammates join
A teammate does not need approval to work. The Invite box first gives them a board link to watch. To add their computer's workers, once only, they get Tandem and put it on the PATH (Windows PowerShell), then open a new terminal:
```powershell
git clone https://github.com/Vibertexs/tandem
cd tandem
.\tandem.cmd install
```
Then, any time, from any folder:
```powershell
tandem join "<invite>"
```
The join copies the project from the conductor into Tandem's private work folder and starts workers that push task branches back to the conductor. It does not change an existing project folder. macOS and Linux (untested) use `./tandem install`. The conductor's Git server has no separate login: Tandem is meant for home networks and Tailscale, which are private, and you hand out the link yourself. A teammate can instead connect their own Claude Code with one `claude mcp add` command plus the worker skill. To send goals, they click **Request control** and the conductor clicks **Approve**.

## Who may do what
- **Worker actions** (claim, lock, complete, heartbeat, report, cost, note read): only by the identity that registered that worker (or an operator). Anyone may register a new worker; a name in use can only be taken over after its owner has been quiet for 2 minutes.
- **Conductor actions** (goals, tasks and jobs, shared memory, clearing the board, approvals): only an **operator** may do them in the team's `live` session. The page `tandem --start` opens (`host=1`, never in the invite link) takes control by itself when nobody has it yet, and approves Conductor Claude's request. Another browser uses **Request control**, and the conductor approves it. This is a saved browser identity, not a Tandem account or a Claude login.
- **Taking control back:** `tandem --start` makes a random key per team (kept in Tandem's `teams.json`), passes it to Conductor Claude, which stores it in the private `hostKeys` table (`set_host_key`, operators only), and opens the conductor's page with `&key=…`. That page calls `claim_as_host` with it, which makes it an operator even when others already are. The page removes the key from the address bar once read; a wrong key is refused.

## Teams and sessions
A team is one database on a brain (`--team`, default `tandem-local`). The page and every Claude use its `live` session. The brain still supports other sessions (the tests use them to stay isolated).

## Open design questions
- Identities are saved tokens, not accounts. A real login (GitHub through SpacetimeDB's OIDC support) is the next step before hosting publicly.
- Hosting: Tandem runs on a home network or Tailscale today. Nothing is deployed publicly.
