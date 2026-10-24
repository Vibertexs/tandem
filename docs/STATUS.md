# Status (morning of 2026-10-24, branch `bilal/polish`)

## In one line
**Tandem works end to end as a product.**
1. `.\start.ps1` starts everything and opens the page.
2. You make yourself the owner, approve the manager with one click, and type a goal.
3. The manager splits the goal into tasks, and the workers (real Claude runs or simulated) do them without colliding.
4. Their work is merged into one `tandem/<goal>` branch, and your tests run on it.
5. The page shows every step live.

## Try this first (about 2 minutes, one small Claude run for planning)
```
.\start.ps1 -Simulate
```
On the page that opens:
1. Click **Make me the owner**.
2. Click **Approve** on "Manager Claude".
3. Type *"A tiny Python calculator with add and sub, tests, and a README"* and press Send.
4. Watch the board, then open **Goals**.

For the real thing, `.\start.ps1` (no `-Simulate`): each task becomes a real Claude Code run (haiku by default) in the playground repo next to this folder, and the goal ends as one branch you can `git checkout`.

`.\stop.ps1` stops it. `.\test.ps1` runs every test.

## What changed overnight
| Area | What |
|---|---|
| Page | Start screen (Host a team / Join a team; "Can't reach" and "needs an update" screens). Jira-style app: Board, Goals, Team, Shared memory, Activity, Settings. One next step at a time, not a checklist. Demo mode removed. |
| Access | "Make me the owner" for the first visitor. Anyone else (and the manager) clicks **Ask to make changes**; the owner clicks **Approve**. No identities to copy. |
| Goals | Tasks remember their goal. Per-goal progress on the board, a goal filter, and goal cards with their tasks. A finished goal shows its branch and how it went ("Tests pass"). A toast when a goal is done. |
| Result | When a goal's tasks are done, the manager merges their branches into `tandem/<goal>` (in a separate worktree, so your open files are never touched) and runs your tests on it. If the tests fail, it adds one "Fix the failing tests" task to the goal and tries again. |
| Start | `start.ps1` / `stop.ps1`: one command for the brain, page, manager and workers (`-Simulate`, `-Lan`, `-Join`, `-Workers`, `-Repo`, `-Push`, `-Model auto`, `-Fresh`). Safe to run twice. Returns at once even when piped (no handle inheritance). `start.sh` / `stop.sh` for macOS and Linux. |
| Connection | Workers and the manager reconnect by themselves after a brain restart. The page says "Reconnecting…" and recovers; it no longer doubles its subscriptions. The sidebar shows "Manager online". |
| Teams on several computers | `-Push`: workers push their task branches and the manager pushes each goal branch (and opens a PR if the GitHub CLI is set up). |
| Docs | New root README (with screenshots), `docs/ROADMAP.md`, architecture updated, the original spec moved to `docs/SPEC.md`. |

## Tested
`.\test.ps1` on the final code: **9 suites, 245 checks, all pass** (no Claude calls).

| Suite | Checks |
|---|---|
| brain (atomic rules, sessions, goals, presence) | 57 |
| brain: who may do what (owner, requests, approvals) | 28 |
| mcp: mock mode | 16 |
| mcp: 16 tools, real brain | 29 |
| mcp: manager identity | 13 |
| mcp: lock-check hook | 13 |
| launcher (routing, simulate) | 19 |
| manager: merge, test, finish, push | 27 |
| page in Chrome (the whole first-use journey, desktop and phone) | 43 |

Also passing:
- `.\test.ps1 -Restart` (the page and a worker survive a brain restart): 6 checks.
- Real Claude runs (haiku, each capped at $0.50):
  - **`start.ps1` with real workers** (`FLOW_REAL=1`): goal typed on the page → manager planned 3 tasks → two real Claudes built them → merged into `tandem/<goal>` → the workers' tests pass on that branch. The git history shows the three task branches merged cleanly.
  - `start.ps1 -Simulate`: goal → plan → done, twice (the second time through the new cross-platform `plan.ts`).
  - Earlier in the night: the full loop twice, the hook blocking a real Claude, and the launcher in a worktree.
- About 14 real runs were used in total, all haiku.

## Not done, or not proven
- Not tried on a Mac: `start.sh` was only checked in Git Bash.
- The PR-per-goal step (`gh pr create`) is built but not tried, because `gh` is not installed here. Pushing to an origin is tested against a local bare repo.
- Real rate limits, and a real "tests fail, fix task" round with real Claude. The fix round is tested with real git repos and a fake brain.
- No per-worker login: anyone who can reach the brain can act as any worker. Managing the team is restricted to approved people.
- Nothing is hosted on Maincloud (needs `spacetime login` in a browser).

## Branches
`bilal/polish` carries everything:
`bilal/brain` → `bilal/mcp` → `bilal/brain-full` → `bilal/dashboard` → `bilal/operator` → `bilal/simple-ui` → `bilal/overnight` → `bilal/polish`.

Nothing is on `main`. The PR text is in `docs/PR.md`. Open it at https://github.com/Vibertexs/tandem/pull/new/bilal/polish
