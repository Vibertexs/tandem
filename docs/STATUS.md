# Status (morning of 2026-10-24, branch `bilal/polish`)

## In one line
**Tandem works end to end as a product.**
1. `.\start.ps1` starts everything and opens the page.
2. You click **Make me the owner**. That one click also approves the manager.
3. You type a goal. The manager splits it into tasks with exact file lists.
4. The workers (real Claude runs, or simulated) do them without colliding.
5. Their work is merged into one `tandem/<goal>` branch, your tests run on it, and the goal card shows the result and what it cost.

## Try this first (about 2 minutes, one small Claude run for planning)
```
.\start.ps1 -Simulate
```
On the page that opens:
1. Click **Make me the owner**.
2. Type *"A tiny Python calculator with add and sub, tests, and a README"* and press Send.
3. Watch the board. Click a card to see why it went to that worker.
4. Open **Goals** when it is done.

For the real thing, run `.\start.ps1` (no `-Simulate`). Each task becomes a real Claude Code run (haiku by default) in the playground repo next to this folder. The goal ends as one branch you can `git checkout`.

`.\stop.ps1` stops it. `.\test.ps1` runs every test.

## What changed overnight
| Area | What |
|---|---|
| Page | Start screen (Host a team / Join a team, plus "Can't reach" and "needs an update" screens). Jira-style app: Board, Goals, Team, Shared memory, Activity, Settings. One next step at a time, not a checklist. Demo mode removed: the product is the demo. |
| Access | The first visitor clicks **Make me the owner**, which also approves a waiting manager. Anyone else clicks **Ask to make changes** and the owner clicks **Approve**. No identities to copy. |
| Ownership | A worker belongs to the computer that registered it. Only it, or an operator, can claim, lock, complete or report for it. A name in use can't be taken over while its owner is online. |
| Goals | Tasks remember their goal. The board shows per-goal progress and a goal filter, and goal cards list their tasks. A finished goal shows its branch, how it went ("Tests pass") and its Claude cost. A toast appears when a goal is done. |
| Cost | Every real run records its `total_cost_usd`: per task (workers) and per goal (planning plus tasks). It is shown on cards, goals and the Team page. |
| Result | When a goal's tasks are done, the manager merges their branches into `tandem/<goal>` and runs your tests on it. The merge happens in a separate worktree, so your open files are never touched. If the tests fail, it adds one "Fix the failing tests" task and tries again. |
| Start | `start.ps1` / `stop.ps1`: one command for the brain, page, manager and workers. Flags: `-Simulate`, `-Lan`, `-Join`, `-Workers`, `-Repo`, `-Push`, `-Model auto`, `-Fresh`. Safe to run twice. `start.sh` / `stop.sh` for macOS and Linux. |
| Connection | Workers and the manager reconnect on their own after a brain restart. The page says "Reconnecting…" and recovers. The sidebar shows whether the manager is online. |
| Teams on several computers | With `-Push`, workers push their task branches and the manager pushes each goal branch. It also opens a PR if the GitHub CLI is set up. |
| Docs | New root README with screenshots. New `docs/ROADMAP.md` and `docs/DEMO.md` (the presenter script). Architecture updated. The original spec moved to `docs/SPEC.md`. |

## Tested
`.\test.ps1` on the final code: **9 suites, 256 checks, all pass** (no Claude calls).

| Suite | Checks |
|---|---|
| brain (atomic rules, sessions, goals, presence, costs) | 61 |
| brain: who may do what (owner, requests, worker ownership) | 33 |
| mcp: mock mode | 16 |
| mcp: 16 tools, real brain | 29 |
| mcp: manager identity | 13 |
| mcp: lock-check hook | 13 |
| launcher (routing, simulate) | 19 |
| manager: merge, test, finish, push | 27 |
| page in Chrome (the whole first-use journey, desktop and phone) | 45 |

Also passing:
- `.\test.ps1 -Restart`: the page and a worker survive a brain restart.
- Real Claude runs (haiku, each capped at $0.50):
  - **`start.ps1` with real workers** (`FLOW_REAL=1`), twice. The goal is typed on the page, and the manager plans it. Two real Claudes build the calculator, which is merged into `tandem/<goal>`. The workers' tests pass on that branch, and the goal card shows "Tests pass" and its cost. The manager also wrote the shared interface to Shared memory by itself.
  - `start.ps1 -Simulate`: goal → plan → done, several times.
  - Earlier in the night: the full loop twice, the hook blocking a real Claude, and the launcher in a worktree recording a real cost.
- About 21 real runs were used in total, all haiku.

## Not done, or not proven
- Not tried on a Mac: `start.sh` was only checked in Git Bash.
- The PR-per-goal step (`gh pr create`) is built but not tried, because `gh` is not installed here. Pushing to an origin is tested against a local bare repo.
- Two things were not run with real Claude: a real rate limit, and a real "tests fail, fix task" round. The fix round is tested with real git repos and a fake brain.
- Identities are saved tokens on each computer, not accounts. Anyone who can reach the brain can watch and add a worker. Keep it on your machine or network until there is a real login.
- Nothing is hosted on Maincloud (it needs `spacetime login` in a browser).

## Branches
`bilal/polish` carries everything:
`bilal/brain` → `bilal/mcp` → `bilal/brain-full` → `bilal/dashboard` → `bilal/operator` → `bilal/simple-ui` → `bilal/overnight` → `bilal/polish`.

Nothing is on `main`. The PR text is in `docs/PR.md`. Open it at https://github.com/Vibertexs/tandem/pull/new/bilal/polish
