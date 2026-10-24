# Team Brain (working title)

A shared "brain" that lets a team's Claude Code sessions work as one: no file collisions, no idle quota, one shared view of what everyone's agents are doing.

Each teammate runs Claude Code on their own machine, logged in as themselves. Nobody's account is shared or automated. The brain only coordinates.

---

## 1. Problem

When four people run AI coding agents on the same repo:

1. **Collisions.** Agents edit the same files, duplicate work, and drift apart on decisions.
2. **Uneven limits.** One person is capped while a teammate (asleep, in class) has unused quota that resets and is wasted.
3. **No shared view.** Nobody knows what everyone's agents are doing.

Bigger plans don't fix 1 or 3. Routing work to whoever has headroom helps with 2.

## 2. What we're building

- A **brain**: a shared database of tasks, file locks, worker status, and project context.
- An **MCP server** that exposes the brain to every Claude as tools.
- A **skill + hook** so each Claude follows the rules (claim before editing, respect locks).
- A **launcher** on each machine that runs tasks headless with the model and effort the brain assigns.
- A **manager Claude** that splits a goal into tasks and assigns them, including **map-reduce jobs**: many independent tasks run in parallel across teammates, then one final task merges the results.
- A **dashboard** showing capacity, tasks, and locks live, with a **judge mode** anyone can try from a phone with no setup.

## 3. Architecture

```
            Manager Claude (planner)
                    |  MCP tools
                    v
   +----------------------------------+
   |  MCP server  <->  Brain (DB)     |  <-- Dashboard (live subscription)
   +----------------------------------+
        ^         ^          ^
        | pull    | pull     | pull
   Launcher A  Launcher B  Launcher C   (one per teammate, own login)
        |
   claude -p --model X --effort Y   (one fresh headless run per task,
                                     in its own git worktree)
```

Key rule: **no Claude controls another Claude's running session.** The manager writes assignments into the brain. Each teammate's launcher pulls its assignments and starts a fresh run.

## 4. Data model

| Table | Fields |
|---|---|
| `workers` | id, name, plan (pro/max), status (idle/busy/capped), usage_5h_pct, usage_week_pct, reset_at, last_seen |
| `tasks` | id, job_id, kind (normal/map/reduce), title, description, files[], difficulty, model, effort, status (open/blocked/claimed/done/failed), assignee, branch, depends_on, result (small structured JSON), result_summary |
| `locks` | path, task_id, worker_id, created_at |
| `context` | key, value (project summary, shared interfaces, decisions) |
| `events` | timestamp, worker_id, type, message (feeds the dashboard log) |

Every table also carries a `session_id`, so each judge gets an isolated sandbox (see section 11).

### Map-reduce jobs

For big jobs made of independent pieces ("review all 12 modules", "write tests for every module"):

- **Map:** the manager creates one task per piece (same `job_id`, `kind = map`). They run in parallel on whichever workers have headroom.
- **Reduce:** the manager also creates one merge task (`kind = reduce`, `status = blocked`, `depends_on` = every map task in the job). It opens automatically when the last map task finishes.
- **Auto-unblock:** completing a task runs one atomic reducer in the brain that checks whether every map task in the job is done and, if so, opens the merge task. Because it's atomic, it can't fire twice. If a map task fails, the merge task stays blocked until that piece is retried.
- **Structured results:** map tasks return a small fixed-format `result` (JSON: status, files touched, findings) instead of free text, so the merge task's context stays small. The merge task reads them with `get_job_results`.
- **Routing:** map tasks run on a smaller model. The merge task gets the strongest model and higher effort (section 7).
- **Naming:** SpacetimeDB's "reducers" are server functions and have nothing to do with the reduce step. In code and docs, call ours the **merge task** to avoid confusion.
- **Only for independent pieces.** If task B needs task A's output, that's a dependency chain, not map-reduce.
- **Stretch:** tree reduce (merge in groups of 5, then merge the merges) for jobs with too many results for one merge task.

### Why SpacetimeDB

Yes, it's a good fit for the brain.

- It's built for real-time shared state with many writers. Data lives in memory and the app logic runs inside the database.
- Subscriptions push row changes to every connected client, so the dashboard and every judge's screen update with no polling code.
- Reducers are atomic, so two workers can never both claim the same task or the same file lock.
- The module is the backend: no separate server, API layer, or persistence to set up. That saves hackathon hours.
- Per-judge sandboxes are just a `session_id` filter on subscriptions.

It's not meant for analytics or batch jobs. We don't need either.

**Risks and how to handle them**
- **New to the team.** Budget about 2 hours (Brain owner) to get hello world, publish, and generated client bindings working before Phase 1 ends.
- **Reducers do not return data to the caller.** Read results through the subscription or table updates, and design `claim_task` that way (call the reducer, then watch for the task row to show your worker as assignee).
- **Reducers are deterministic: no network, no file access.** Anything external (reading usage, calling Claude) happens in the MCP server or launcher.
- **Hosting.** Judges need a public URL, so use a hosted instance (check the SpacetimeDB docs for options) or a tunnel to a laptop, and test on venue wifi.
- **Module language.** Use whichever supported language the Brain owner already knows (check the docs for the current list).
- **Escape hatch.** All database access goes through the MCP server and one thin client module. If SpacetimeDB is blocking the team by hour 6, swap to SQLite or Postgres plus WebSockets without changing the tool contract in section 5.

## 5. MCP tools

**Worker side**

| Tool | Does |
|---|---|
| `register_worker(name, plan)` | Adds the teammate to the brain |
| `report_capacity(usage_5h, usage_week, reset_at)` | Updates their capacity row |
| `claim_task()` | Atomically claims the best open task for this worker |
| `lock_files(task_id, paths[])` | Takes locks; fails if anyone else holds them |
| `release_files(task_id)` | Releases locks |
| `report_progress(task_id, message)` | Adds an event |
| `complete_task(task_id, branch, summary, result?)` | Marks done; map tasks include their structured result; may unblock a merge task |
| `get_job_results(job_id)` | Returns the structured results of a job's map tasks (used by the merge task) |
| `get_context()` | Returns the shared project summary and decisions |

**Manager side**

| Tool | Does |
|---|---|
| `assign_task(task, model, effort, assignee?)` | Creates a task row for a worker's launcher to pick up |
| `create_job(goal, map_tasks[], merge_task)` | Creates the map tasks and a blocked merge task in one call |
| `get_capacity()` | Everyone's usage, status, and last-seen |
| `get_status()` | Task board and locks |
| `set_context(key, value)` | Updates shared decisions and interfaces |
| `get_goals()` | The goals the operator typed that are still waiting to be planned |
| `mark_goal(goal_id, status)` | Marks a goal `planning`, then `planned` once its tasks exist |

## 6. Capacity reporting

- Claude Code's `/usage` shows the 5-hour window and weekly limit for a human. For automation, configure a **statusLine** script that writes the usage numbers to a local file; a small reporter pushes that file to the brain every few minutes.
- Each worker declares their plan at registration.
- Caveats: the statusLine only updates while Claude Code is active, so idle workers go stale. Always show `last_seen` and treat old data as unknown. Usage-reading methods are community-built and unofficial, so they may break.
- Backstop: if a run hits a rate limit anyway, the launcher reports it, the task is requeued, and the worker is marked capped until `reset_at`.

## 7. Model and effort routing

Plain rules in the launcher. No model needed to route.

| Situation | Setting |
|---|---|
| Mechanical edits, renames, boilerplate | Smaller model, default effort |
| Normal feature work | Default model, default effort |
| Architecture, hard bugs, big refactors | Strongest model, higher effort |
| Map task (one independent piece of a job) | Smaller model, default effort |
| Merge task (combining a job's results) | Strongest model, higher effort |
| Worker above ~80% usage | Downgrade one step, or route elsewhere |
| Task failed or skipped steps | Retry at higher effort |

Notes: avoid the lowest effort on unattended runs (at low effort Claude asks for context instead of working it out, and nobody is there to answer). Available models and effort levels vary by version and plan, so check `/model` and `/effort` on each machine before hardcoding.

## 8. Collision prevention

1. Every task declares the files it will touch. Locks are granted at claim time; overlapping tasks wait.
2. Each task runs in its own git worktree on its own branch.
3. The manager writes shared interfaces (types, API spec) into `context` first so parallel work doesn't drift.
4. A **PreToolUse hook** on edit/write calls checks the brain and blocks edits to files another task holds.
5. One merge step runs the tests.

## 9. Workstreams (one person each)

Everyone builds against the contract in sections 4 and 5, with mocks, so nobody waits on anyone.

**A. Brain**
SpacetimeDB module: tables, reducers (`claim_task`, `take_locks`, `release_locks`, `update_capacity`, `complete_task` with the map-reduce auto-unblock), seed data.
Done when: two clients claiming the same task at once results in exactly one winner, and finishing the last map task of a job opens its merge task exactly once.

**B. MCP server, skill, hook**
MCP server wrapping the brain with all tools in section 5. Skill file with the team rules. Lock-check hook.
Done when: a Claude Code session can call every tool and the hook blocks an edit on a locked file.

**C. Launcher and capacity reporter**
Script that registers the worker, polls for assigned tasks, creates a worktree, runs `claude -p` with the assigned model and effort, reports progress and completion, handles rate-limit errors. Plus the statusLine script and reporter.
Also builds a `--simulate` mode that fakes runs with timed progress and canned results (including canned structured results for map tasks), no Claude calls. Judge mode uses it (section 11).
Done when: assigning a task from a terminal causes a teammate's machine to run it and push a branch, and simulate mode does the same visibly with no Claude calls.

**D. Manager**
Prompt and skill for splitting a goal into tasks with file lists and difficulty tags, plus assignment logic using `get_capacity`. Also splits big jobs into independent map tasks plus one merge task, and defines the fixed result format map tasks return. Owns the routing table in section 7.
Done when: one goal produces a sensible task list assigned across at least two workers, and one big job produces N map tasks and one blocked merge task.

**E. Dashboard, judge mode, and demo**
Live web page built to the UI/UX spec in section 12: team capacity, task board, locks, event log, scenario buttons (including Run map-reduce), job progress bar, Reset, per-judge sessions, mobile layout. Also owns the presenter script, backup video, and pitch.
Done when: a stranger can complete the judge flow in section 11 on their phone with no help, and the page updates in real time with no refresh.

### Assignments (team of 3)

| Person | Owns | Workstreams |
|---|---|---|
| **Bilal** | Brain and MCP server | A, and B except the skill file and hook |
| **Sam** | Launcher, capacity reporter, simulator, manager | C and D |
| **Omar** | Dashboard, judge mode, demo; then the skill file and lock-check hook | E, plus the small parts of B |

**Bilal: Brain and MCP server**
- Builds the SpacetimeDB module (tables, atomic claim and lock reducers, map-reduce auto-unblock, seed data) and the MCP server with every tool in section 5.
- First checkpoint (about hour 6): hello world published; two clients claiming one task gives exactly one winner; the MCP server answers every tool.
- Everyone depends on this, so post a stub of the tables and tools in hours 0-2. Sam needs `claim_task` and `complete_task`; Omar needs live tables.

**Sam: Launcher, capacity reporter, simulator, manager**
- Builds the launcher (pull a task, make a git worktree, run `claude -p` with the assigned model and effort, requeue on rate limit), the statusLine capacity reporter, the `--simulate` mode, and the manager prompt and skill (split goals and map-reduce jobs, assignment logic, the fixed result format).
- First checkpoint (about hour 6): the launcher runs one dummy task in a worktree and reports back.
- Ship `--simulate` early, even if crude. Omar's judge mode depends on it.

**Omar: Dashboard, judge mode, demo**
- Builds the dashboard to the spec in section 12 (team, task board, locks, event log, scenario buttons, Reset, mobile layout, per-judge sessions), plus the presenter script, backup video, and pitch.
- First checkpoint (about hour 6): a static dashboard with fake data that works on a phone.
- Once the base is working (about hour 10), takes the team-rules skill file and the lock-check hook, which are small, so Bilal isn't overloaded.

**Where you work together**
- Hours 0-2, all three: agree on the tables and tool signatures, set up the repo.
- About hour 6, Bilal and Omar: connect the dashboard to the real tables.
- Hour 14, all three: first end-to-end run (manager to worker to branch to dashboard).
- Hours 22 and later: Omar leads judge-mode hardening using Sam's simulator, and everyone tests with someone who hasn't seen the project.

*If the team changes size: with 4, merge D into B; with 5, one workstream each.*

## 10. Roadmap

Assumes about 36 hours.

| Phase | Hours | Goal |
|---|---|---|
| 0. Contract | 0-2 | Agree on the schemas and tool signatures above; set up repo; stub the brain so everyone can start |
| 1. Parallel build | 2-14 | Each person builds their workstream against mocks |
| 2. Integration | 14-22 | Wire everything together; first end-to-end run: manager assigns, worker runs, branch pushed, dashboard updates; then the first map-reduce job end to end (map tasks, auto-unblock, merge task) |
| 3. Hardening | 22-30 | Rate-limit requeue, lock conflicts, stale-capacity handling; build judge mode (simulated workers, scenario buttons, Reset, per-judge sessions); rehearse the demo |
| 4. Polish | 30-36 | Hand it to someone who has never seen the project and fix whatever confuses them; record a backup demo video; print the QR code |

**Cut list if behind (drop in this order):** capacity-based routing (assign by hand), model/effort rules (use defaults), retry at higher effort, map-reduce (keep the single-goal flow), dashboard styling.
**Stretch:** tree reduce.
**Never cut:** atomic task claiming, file locks, the live dashboard, and judge mode's scenario buttons plus Reset. Those are the demo.

## 11. Demo and judge experience

**Goal:** a judge with no setup and no explanation can understand the project and break it on purpose in under two minutes, from a phone or a laptop.

### Two modes

| Mode | Who uses it | What's real |
|---|---|---|
| **Judge mode** (default) | Judges, on their own device | Brain, locks, routing, capacity logic, and dashboard are real. Workers are simulated: timed progress and canned results, no Claude calls. |
| **Live mode** (`?mode=live`) | Presenter, on stage | Everything is real: actual Claude Code sessions on teammates' machines. |

Judge mode always shows a visible "Simulated workers" badge. If a judge asks "is it real?", be upfront: the coordination is real, and only the coding is faked so it's safe, instant, and works for many judges at once. Then show Live mode on the presenter's laptop.

### Judge flow (about 60 seconds)

Open the URL or scan the QR code. No login, no install.

1. **Run the demo.** One big button. A preset goal ("Build a login page with an API") goes to the manager, tasks appear, and they flow out to teammates.
   Or press **Run map-reduce**: a 12-piece job (for example, "review all 12 modules") fans out across teammates, a progress bar goes from 0/12 to 12/12, then the merge task unlocks and a combined report appears.
2. **Break it, one click each:**
   - **"Make Sam hit a limit"**: Sam's bar fills, status flips to capped, and the running task requeues to someone with headroom.
   - **"Make two agents edit the same file"**: one is blocked by a lock and waits. The locks panel and log show why.
   - **"Teammate goes idle"**: the next open task is routed to them immediately.
3. **Poke around.** Drag any teammate's capacity slider. Click any task to see "Why this assignment?" (for example: "Alex: 62% quota left, normal feature work, default model").
4. **Reset** returns everything to the start in under a second.

Each judge gets an isolated sandbox (`session_id`), so ten judges can play at once without affecting each other. Reset only affects your own session.

### Presenter script (about 3 minutes)

1. Say the pitch line, then run the demo: one goal, tasks flow out to three teammates.
2. Press Run map-reduce: 12 pieces fan out, the progress bar fills, the merge task unlocks.
3. Trigger the lock collision and show the block.
4. Trigger the limit hit and show the requeue.
5. Switch to Live mode on the laptop: a real Claude Code run, same dashboard.
6. Show the QR code: "try it yourself."

Pitch line: your team's AI coders working as one team, with no collisions, no idle quota, and one shared brain.

## 12. Dashboard UI/UX spec

### Layout (desktop)

- **Top bar:** project name, mode badge (Simulated / Live), Reset, QR/share.
- **Scenario bar** under it: a 4-step stepper plus the scenario buttons. The stepper highlights what to do next.
- **Left, Team:** one card per teammate with name, plan badge, 5-hour and weekly usage bars, status chip (idle / busy / capped), current task, and "updated Xs ago".
- **Center, Task board:** columns Open / Running / Blocked / Done. Each card shows title, files, model and effort chips, and assignee. Map-reduce jobs show a progress bar (done/total), and the merge card sits in Blocked until the last piece finishes.
- **Right, Locks and Why:** file locks (path -> holder) and the "Why this assignment?" panel for the selected item.
- **Bottom, Event log:** plain-English lines, newest first.

### Layout (mobile)

Single column with tabs: **Team | Tasks | Locks | Log**. Scenario buttons live in a sticky bottom bar. Tap targets are at least 44px.

### UX rules

- No login or setup. First meaningful screen in under 3 seconds.
- The empty state is just the Run the demo button and one sentence explaining the project.
- Every action reacts within 1 second: the affected element highlights, a toast appears, and a plain-English log line is added ("Sam hit their limit. Fix login bug moved to Alex.").
- Status never relies on color alone: use an icon plus a text label.
- Buttons say what they do. Jargon like "lock" and "capacity" gets a tooltip.
- Motion is subtle (cards slide between columns) and respects reduced-motion settings.
- Never a dead end: if the brain is unreachable, show a banner and play a prerecorded run.
- `?view=present` gives bigger type and hides the controls, readable from the back of the room.

### Acceptance checks

- A stranger completes judge flow steps 1-3 without help.
- Ten simultaneous sessions don't interfere with each other.
- Reset works from any state.
- Works on iPhone Safari, Android Chrome, and a laptop, on venue wifi.
- A backup demo video is ready in case wifi dies.

## 13. Risks and open decisions

- **Judge question: "why not just buy a bigger plan?"** Answer: bigger plans don't fix collisions or the shared view, and small teams can't always upgrade.
- **Everyone capped at once.** Routing can't help; demo the uneven case and lean on the coordination value.
- **Map-reduce only fits independent pieces.** If one piece needs another's output, it's a dependency chain. Don't demo it as map-reduce.
- **Context cost.** Every map task reads project context, so keep `get_context()` short or a 12-piece job burns quota fast.
- **Usage reading is unofficial.** Have a manual capacity override ready.
- **Terms.** Each person runs Claude Code under their own login on their own machine, and the team has permission. Do not automate anyone's web UI or share credentials.
- **Judge mode is simulated.** Label it clearly (badge in the UI) and show Live mode on the presenter's laptop so nobody feels misled.
- **Open:** who hosts the brain and dashboard (judges need a public URL, so a hosted instance or a tunnel, not just one laptop on local wifi), and which model runs the manager (one teammate's account vs. a small API budget).

## 14. Repo layout

```
/brain        SpacetimeDB module                (Bilal)
/mcp          MCP server, skill, hook           (Bilal; skill and hook: Omar)
/launcher     launcher, reporter, simulator     (Sam)
/manager      planner prompt and assign logic   (Sam)
/dashboard    web UI + judge mode               (Omar)
/docs         this README, demo script
```
