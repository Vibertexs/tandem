# PR: Tandem: a shared brain so a team's Claude Code agents work as one

Open from `bilal/git-share` into `main`. The branch carries every earlier branch, so this one PR is everything.

## Summary
You run `tandem start` in your project and type a goal on the board it opens. A manager Claude splits it into tasks with exact file lists. Each worker claims tasks from a shared SpacetimeDB brain, which locks their files atomically. A teammate clones Tandem once, then `tandem join <invite>` copies the host project and starts their worker; its task branches push directly back to the host, with no GitHub required. When a goal's tasks are done, their branches are merged into one `tandem/<goal>` branch and the project's tests run on it. The page shows all of it live, including what each task and goal cost.

- **Brain** (`brain/`, SpacetimeDB module in TypeScript)
  - Atomic claim and lock, all-or-none locks, and dependency unblocking.
  - Goals linked to tasks; finished goals carry their branch, note and cost.
  - Capacity capping with requeue (un-capped when usage drops), and stale-worker cleanup.
  - Giving a task back: a different worker gets it; after two, it is failed for a person to retry.
  - Goals the manager could not plan are failed with the reason, and can be sent again.
  - Owner and operators with one-click access requests, presence, and start over.
  - Each worker belongs to the identity that registered it.
- **MCP server** (`mcp/`)
  - The 17 tools in `contract/tools.json`, plus a mock mode.
  - A saved identity per machine, a heartbeat and automatic reconnect.
  - The worker rules skill and the lock-check hook.
- **Manager** (`manager/`)
  - A watcher that plans each new goal (`plan.ts`).
  - It then merges, tests and finishes the goal (`merge.ts`, `verify.ts`, `finish.ts`). A conflict becomes a "resolve the merge conflict" task, and failing tests become a fix task.
  - Optionally, it pushes the goal branch and opens a PR, posts "goal done" to Slack or Discord, and has a worker review the merged branch first (`--review`).
- **Launcher** (`launcher/`)
  - Claims a task and runs `claude -p` in a git worktree, with the hook and a budget cap.
  - Routes model and effort by difficulty, records the run's cost and commits.
  - Gives a task back after two failed runs. At a usage limit it waits for the reset and comes back.
  - Resolves merge conflicts: it starts the merge, Claude edits out the markers, it commits.
  - Pushes with `--push`. Fake-coding workers exist only for the automated tests (an environment variable, no option).
- **Page** (`dashboard/`, React + Vite)
  - A host-or-join start screen that takes a pasted invite link.
  - One board: each goal is a swimlane with its tasks in Waiting, To do, In progress and Done; finished goals fold. Also Team, Shared memory, Activity, Settings.
  - An Invite button on every page, one next step at a time, and a task details drawer.
  - One-click owner and approvals, a phone layout and dark mode.
  - "Needs you" alerts with the reason and Try again, and share links that work from other computers.
- **The `tandem` command** (`cli/tandem.ts`, one cross-platform TypeScript file, Node 22.18+): `tandem start` shares the project through Git's HTTP backend; `tandem join <invite>` copies it into Tandem's private work folder and starts workers that push task branches to the host. `tandem stop`, `tandem status`, `tandem open`, `tandem logs`. GitHub remains optional for `--push` and PRs.
- **Contract and docs**
  - `tools.json` gained `get_goals`, `mark_goal` and `give_back_task` (17 tools).
  - `tables.md` documents goals, the task's `goal_id`, `cost_usd` and `tried_by`, and the access tables.
  - `docs/SPEC.md` is the original plan, and `docs/DEMO.md` is the presenter script.

## Test plan
- [x] `.\test.ps1`: 11 suites, 362 checks, all pass. It covers:
  - the brain, access and worker ownership
  - MCP in mock mode, MCP against the real brain, and the manager identity
  - the hook, and the launcher with a usage limit and a restart while capped
  - the manager's merge, conflicts, test, finish, push, notify, and planning failures
  - the page in Chrome, on desktop and phone, including the failure screens
  - host project sharing: join from a second state, clone, and push a task branch back without GitHub
- [x] `.\test.ps1 -Restart`: the page and a worker survive a brain restart.
- [x] Real Claude (haiku, capped):
  - Real workers, four times: goal → plan → two Claudes → merged `tandem/<goal>` → tests pass → the goal's lane shows the result and its cost.
  - The same flow with `--review`: a worker reviewed the merged branch and its findings were on the board.
  - A real merge conflict resolved by a worker Claude, with the merged code running.
  - A teammate on another computer: the worker on a second clone pushes its branches, and the host merges them from origin, tests them and pushes the goal branch.
  - `tandem start` in a test project, end to end through the page, with fake-coding workers (tests only) and one real planning run.
  - The full loop, twice.
  - The hook blocking a real Claude.
  - The launcher in a worktree.
  - The direct host-share flow: a real manager and a real joined worker completed two tasks, pushed branches to the host, merged `tandem/g-live`, and passed `npm test` (two isolated states on one Windows computer).
- [ ] Not tried: `tandem` on a Mac or Linux, `gh pr create`, a second physical computer, a real Slack or Discord webhook, a real usage limit, and a real failing-tests fix round.

## Notes
- Every person runs Claude Code under their own login on their own machine. Tandem only coordinates.
- Identities are saved tokens, not accounts. A real login is the next step before hosting publicly.
- The host project server has no separate login. Use it only on a trusted private network such as Tailscale; `--local` disables sharing.
- The Python placeholders from the scaffold are left untouched and unused.

