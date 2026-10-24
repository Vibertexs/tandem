# Status: morning of 2026-10-24 (overnight run on `bilal/overnight`)

## In one line
**The whole loop works.** You type a goal, a manager Claude plans it, two worker Claudes do it without colliding, and the page shows it all done. It passed with real Claude runs twice in a row.

## Try this first (about 2 minutes, uses 3 small haiku runs)
The local database (port 3001) and the dashboard (port 5173) were left running.
```
powershell -File mcp\test\e2e\loop.ps1
```
Then open http://localhost:5173/?mode=team&db=bilal-loop to see the result: the goal "✓ Planned", 3 tasks in Done, and Alice and Bob on the team.

Do it by hand instead:
1. Open http://localhost:5173/?mode=team. If the page offers it, claim the team. Type a goal.
2. Run `powershell -File manager/run.ps1 -Db bilal-dev`. The first time, paste the identity it prints into Manage > Who can operate, then run it again.
3. Start workers: `cd launcher; npx tsx launcher.ts --name You --repo <a git repo>`. Or connect your own Claude Code with "Add a teammate".

## What was built tonight
| Milestone | What | Proof |
|---|---|---|
| M1 | `get_goals` and `mark_goal` added to `contract/tools.json` (16 tools) and the MCP server | mcp suites: 16 + 29 + 13 checks |
| M2 | Manager: `manager/PROMPT.md` (rules + worked example), `manager/run.ps1` (headless, haiku, $0.50 cap) | full loop, both runs |
| M3 | Worker rules skill `mcp/skill/SKILL.md`. "Add a teammate" now includes the skill step | full loop, both runs |
| M4 | Full-loop test `mcp/test/e2e/loop.ps1`: goal → manager → 2 workers → done → dashboard | **LOOP PASSED x2** |
| M5 | Lock-check hook `mcp/hook/check-lock.mjs` (PreToolUse, exit 2 blocks) | 13 checks, plus a real Claude blocked |
| M6 | Launcher `launcher/launcher.ts`: worktrees, routing, hook, budget cap, `--simulate` | 19 checks, plus 1 real run |
| M7 | This file, `docs/PR.md`, `docs/ARCHITECTURE.md`, README checklists | |

### The full loop, both runs
- The manager split "tiny Python calculator" into `Write calc.py` and `Write the README` in parallel, then `Test calc.py` after calc.py. It wrote the shared interface into context first.
- Two workers (Alice, Bob) split the work. Nothing that shares a file overlapped. Every planned file exists, and `python -m unittest` on the workers' own tests passes.
- The dashboard (My team) shows the goal "✓ Planned", "3 of 3 tasks done", every card in Done, and both workers.

### The hook with a real Claude
A Claude told to rewrite `notes.txt`, while Alice's task held it, answered: "Blocked: a Tandem lock hook refused the write because notes.txt is locked by task t-notes (worker w-alice), so I stopped without changing the file." The file was unchanged.

### The launcher with a real Claude
It claimed `t-hello`, made a worktree on branch `task/t-hello`, ran haiku, committed `hello.py` on that branch, completed the task, and left `main` alone.

## Automated suites on the final commit (no Claude calls)
| Suite | Command | Result |
|---|---|---|
| brain | `cd brain && npm test` | 51 PASS |
| brain auth | `npm run test:auth` | 17 PASS |
| mcp mock | `cd mcp && npm run test:mock` | 16 PASS |
| mcp real brain | `npm test` | 29 PASS |
| mcp operator | `npm run test:operator` | 13 PASS |
| mcp hook | `npm run test:hook` | 13 PASS |
| launcher | `cd launcher && npm test` | 19 PASS |
| dashboard scenarios | `cd dashboard && npm test` | 24 PASS |
| dashboard in Chrome | `npm run build && npm run test:ui` (preview on 4173) | 64 PASS |

`npx tsc`: 0 errors in `mcp/`, `launcher/` and `dashboard/`.

## Real Claude runs used: 8 of 12 (all haiku, each `--max-budget-usd 0.50`)
| # | What | Result |
|---|---|---|
| 1-3 | Full loop, run 1 (manager, Alice, Bob) | passed |
| 4 | Hook: Bob tries to edit a locked file | blocked, as it should be |
| 5 | Launcher: one task in a worktree | passed |
| 6-8 | Full loop, run 2 | passed |

## Not done or not proven
- **Hosting:** only this laptop can reach the brain. Publishing to Maincloud needs `spacetime login` in a browser, which only you can do.
- **Launcher, untested paths:** real rate limits (it caps the worker, which requeues the task, but `reset_at` is not read) and the retry-at-higher-effort path have not been tested against real failures. It commits but does not push, because the test repo has no remote.
- **No fail tool:** a task that fails twice waits for the 2-minute stale cleanup.
- **Map-reduce from a real manager:** not tried. The tools and brain do it (tested), but no real "for every module" goal has been planned.
- **`report_usage.py`:** the statusLine capacity reporter is not built. The placeholder is untouched.
- **Interactive setup:** `claude mcp add` and the skill in `.claude/skills/` have not been tried by hand. Every real run used `--mcp-config` and pasted the skill into the prompt.
- **No per-worker login.** Merging `task/<id>` branches back into `main` is still a manual step.

## Notes for you
- `contract/` changed in one way only: the two goal tools and a `goals` table, as you agreed. Other contract issues are in `mcp/NOTES.md`.
- The Python placeholders are untouched. No settings file was changed. Nothing went to `main`. Nothing was published to `tandem` or Maincloud.
- One PR from `bilal/overnight` into `main` carries everything. The description is in `docs/PR.md`. `gh` is not installed, so open it on GitHub: https://github.com/Vibertexs/tandem/pull/new/bilal/overnight
