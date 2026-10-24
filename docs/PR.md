# PR: Tandem: a shared brain so a team's Claude Code agents work as one

Open from `bilal/polish` into `main`. The branch carries every earlier branch, so this one PR is everything.

## Summary
Type a goal on a web page. A manager Claude splits it into tasks with exact file lists. Each teammate's Claude Code (or a worker started by `start.ps1`) claims tasks from a shared SpacetimeDB brain that locks their files atomically. When a goal's tasks are done, their branches are merged into one `tandem/<goal>` branch and the project's tests run on it. The page shows all of it live.

- **Brain** (`brain/`, SpacetimeDB module in TypeScript)
  - Atomic claim and lock, all-or-none locks, and dependency unblocking.
  - Goals linked to tasks, finished goals with their branch and note.
  - Capacity capping with requeue, and stale-worker cleanup.
  - Owner and operators with one-click access requests, presence, start over.
- **MCP server** (`mcp/`): the 16 tools in `contract/tools.json`, a mock mode, a saved identity per machine, a heartbeat, automatic reconnect, the worker rules skill, and the lock-check hook.
- **Manager** (`manager/`): a watcher that plans each new goal (`plan.ts`), then merges, tests and finishes it (`merge.ts`, `verify.ts`, `finish.ts`). Optionally it pushes the goal branch and opens a PR.
- **Launcher** (`launcher/`): claims a task, runs `claude -p` in a git worktree with the hook and a budget cap, routes model and effort by difficulty, and commits. It has a `--simulate` mode, and can push with `--push`.
- **Page** (`dashboard/`, React + Vite)
  - Host-or-join start screen.
  - A Jira-style app: Board, Goals, Team, Shared memory, Activity, Settings.
  - One next step at a time, a goal filter and per-goal progress, a task details drawer.
  - Approvals, a phone layout and dark mode.
- **Scripts:** `start.ps1` / `stop.ps1` (Windows), `start.sh` / `stop.sh` (macOS, Linux), `test.ps1` (every suite).
- **Contract:** `tools.json` gained `get_goals` and `mark_goal`, and `tables.md` documents goals, the task's `goal_id`, and the access tables. `docs/SPEC.md` is the original plan.

## Test plan
- [x] `.\test.ps1`: 9 suites, 245 checks, all pass (brain, access, MCP mock and real, manager identity, hook, launcher, manager merge/test/finish/push, the page in Chrome on desktop and phone).
- [x] `.\test.ps1 -Restart`: the page and a worker survive a brain restart.
- [x] Real Claude (haiku, capped):
  - `start.ps1` with real workers: goal → 3 tasks → two Claudes → merged `tandem/<goal>` → tests pass.
  - `start.ps1 -Simulate`, twice.
  - The full loop, twice.
  - The hook blocking a real Claude.
  - The launcher in a worktree.
- [ ] Not tried: `start.sh` on a Mac; `gh pr create`; real rate limits; a real failing-tests fix round.

## Notes
- Every person runs Claude Code under their own login on their own machine. Tandem only coordinates.
- No per-worker login yet; managing the team is restricted to approved people.
- The Python placeholders from the scaffold are left untouched and unused.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
