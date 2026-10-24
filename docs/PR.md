# PR: Tandem POC: brain, MCP server, dashboard, manager, launcher, lock hook

Open from `bilal/overnight` into `main`. The branch carries every earlier branch (`bilal/brain` → `bilal/mcp` → `bilal/brain-full` → `bilal/dashboard` → `bilal/operator` → `bilal/simple-ui` → `bilal/overnight`), so this one PR is everything.

## Summary
A working local proof of concept of Tandem: you type a goal on a web page, a manager Claude splits it into tasks, worker Claudes do them without colliding, and the page shows it live.

- **Brain** (`brain/`, SpacetimeDB, TypeScript module)
  - Tables: goals, tasks, locks, workers, events, context and operators, all with `session_id`.
  - Atomic `claim_task`, which picks a task and locks its files in one step.
  - All-or-none `take_locks`.
  - `complete_task` unblocks dependents, and opens a job's merge task exactly once.
  - Capacity capping with requeue, and stale-worker cleanup (heartbeat).
  - Operators: only they may change the `live` session.
  - `reset_session` and `seed_tasks` for demo sandboxes.
- **MCP server** (`mcp/`, stdio, MCP SDK v2)
  - All 16 tools in `contract/tools.json`.
  - Mock mode, a saved identity per machine, `npm run whoami`, and a heartbeat.
- **Lock-check hook** (`mcp/hook/check-lock.mjs`): a PreToolUse hook that blocks edits to files another worker's task holds.
- **Worker rules** (`mcp/skill/SKILL.md`).
- **Manager** (`manager/PROMPT.md`, `manager/run.ps1`): turns goals into tasks with file lists and dependencies.
- **Launcher** (`launcher/launcher.ts`)
  - Claims tasks and runs `claude -p` in a git worktree per task, with routing from `routing.json`.
  - Uses the lock hook and a per-run budget cap.
  - Has a `--simulate` mode.
- **Dashboard** (`dashboard/`, Vite + React)
  - One page with Demo (private sandbox, simulated workers) and My team (the real session).
  - Prompt box, progress summary, a Waiting → Ready → Working → Done board, Add a teammate, Manage, and a phone layout.
- **Contract change:** `get_goals` and `mark_goal` added to `contract/tools.json`, and a `goals` table added to `contract/tables.md`. Nothing else in `contract/` changed. Other contract issues are listed in `mcp/NOTES.md`.
- **Untouched:** the Python placeholders (`launcher/launcher.py`, `launcher/statusline/report_usage.py`, `mcp/hook/check_lock.py`).

## Test plan
All local, against SpacetimeDB on `127.0.0.1:3001`. Nothing published to `tandem` or Maincloud.

| Suite | Command | Checks |
|---|---|---|
| Brain rules | `cd brain && npm test` | 51 |
| Operator rules | `cd brain && npm run test:auth` | 17 |
| MCP, mock mode | `cd mcp && npm run test:mock` | 16 |
| MCP, real brain | `cd mcp && npm test` | 29 |
| MCP, operator identity | `cd mcp && npm run test:operator` | 13 |
| Lock hook | `cd mcp && npm run test:hook` | 13 |
| Launcher routing + simulate | `cd launcher && npm test` | 19 |
| Dashboard scenarios | `cd dashboard && npm test` | 24 |
| Dashboard in Chrome | `cd dashboard && npm run build && npm run test:ui` | 64 |

All pass on the final commit, and `npx tsc` is clean in `mcp/`, `launcher/` and `dashboard/`.

Real headless Claude runs (haiku, each capped at $0.50):
- [x] **Full loop** `mcp/test/e2e/loop.ps1`: goal → manager → 3 tasks → two workers → all done, no collisions, the workers' own tests pass, and the dashboard shows the goal planned and every task done. See `docs/STATUS.md` for both runs.
- [x] **Hook** `mcp/test/e2e/hook-real.ps1`: a Claude told to edit a locked file was blocked, and the file was unchanged.
- [x] **Launcher** `launcher/test/real.ts`: one task run in a git worktree and committed on `task/t-hello`.

## Not done
- Nothing deployed (Maincloud needs `spacetime login` in a browser).
- No per-worker login. Rate limits, retries and `report_usage.py` are not tested against the real thing.
- Map-reduce has not been tried with a real manager run.
- Nobody has merged the `task/<id>` branches back into `main`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
