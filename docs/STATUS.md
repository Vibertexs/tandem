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
| When things go wrong | A worker that can't finish a task gives it back with a reason (`give_back_task`, tool 17), and a different worker gets it. After two, the board says "needs you" with the reason and a **Try again** button. A merge conflict between two tasks becomes a "Resolve the merge conflict" task: the launcher starts the merge, Claude edits out the markers, and the launcher commits. A worker at its usage limit waits for the reset ("Out of quota until 3:00 PM") and comes back by itself. A goal the manager can't plan (for example, Claude not logged in) shows why, with Try again. |
| Sharing | With `-Lan`, the page gets the real network address (the adapter with a gateway, not a VirtualBox one), so the Team page's join command, the link and the QR code work from other computers. A local-only team says how to open it up instead of showing a command that can't work. |
| Notifications | `-Notify <webhook url>` posts "goal done" (branch, test result, cost) to Slack or Discord. |
| Better work | A task that waited for others starts with their work merged into its worktree, so its Claude reads the real code. |
| Teammates elsewhere | With `-Push`, the manager tells the page the repo's remote, and the Team page shows the clone step and the join command with `-Repo` and `-Push`. `-Join` checks the host is reachable before starting workers. Proven with real Claude through a shared origin. |
| Smaller | Cancel a goal. Example goals for a new owner. `/` jumps to the prompt. Goal cards say how long the goal took. An Activity filter (All, Problems, Finished). Commands shown for your OS (start.sh on macOS and Linux). `.worktrees/` stays out of your repo's `git status`. `-SimLimit` for demos. |
| Docs | New root README with screenshots. New `docs/ROADMAP.md` and `docs/DEMO.md` (the presenter script). Architecture updated. The original spec moved to `docs/SPEC.md`. |

## Tested
`.\test.ps1` on the final code: **9 suites, 321 checks, all pass** (no Claude calls).

| Suite | Checks |
|---|---|
| brain (atomic rules, sessions, goals, presence, costs, giving back, limits, cancel) | 75 |
| brain: who may do what (owner, requests, worker ownership) | 33 |
| mcp: mock mode | 17 |
| mcp: 17 tools, real brain | 32 |
| mcp: manager identity | 13 |
| mcp: lock-check hook | 13 |
| launcher: routing, limit parsing, simulate (including a limit and a restart while capped) | 32 |
| manager: merge, conflicts, dependencies, test, finish, push, notify, planning failures | 45 |
| page in Chrome (the whole first-use journey, failures, sharing, desktop and phone) | 61 |

Also passing:
- `.\test.ps1 -Restart`: the page and a worker survive a brain restart.
- Real Claude runs (haiku, each capped at $0.50):
  - **`start.ps1` with real workers** (`FLOW_REAL=1`), four times, the last one on the final launcher and manager code (its "Test calc.py" task started from the "Write calc.py" branch). The goal is typed on the page, and the manager plans it. Two real Claudes build the calculator, which is merged into `tandem/<goal>`. The workers' tests pass on that branch, and the goal card shows "Tests pass" and its cost. The manager also wrote the shared interface to Shared memory by itself.
  - **A real merge conflict** (`launcher/test/conflict-real.ts`): two branches added different functions at the same spot. Haiku resolved the markers, kept both functions, and the merged `calc.py` runs.
  - **A teammate on another computer** (`manager/test/two-computers.ts`): a bare repo stands in for GitHub, with two clones. The host's manager runs on one, and the only worker runs on the other with `--push`. Every task was done on the teammate's clone. The host fetched and merged those branches, the tests passed, and the goal branch was pushed.
  - `start.ps1 -Simulate`: goal → plan → done, several times.
  - Earlier in the night: the full loop twice, the hook blocking a real Claude, and the launcher in a worktree recording a real cost.
- About 34 real runs were used in total, all haiku.

## Not done, or not proven
- Not tried on a Mac: `start.sh` was only checked in Git Bash.
- The PR-per-goal step (`gh pr create`) is built but not tried, because `gh` is not installed here. Pushing to an origin is tested against a local bare repo.
- Two things were not run with real Claude: a real usage limit, and a real "tests fail, fix task" round. The limit is tested with simulated workers (capped, requeued, waits, resumes) and the limit-message parsing with sample messages. The fix round is tested with real git repos and a fake brain.
- `-Lan` was not tried from a second physical computer. The address detection, the page's share links and the whole push/fetch/merge path (two clones and an origin on one machine) are tested. Windows may ask to allow node and spacetime on private networks.
- `-Notify` was tested against a local server, not a real Slack or Discord channel.
- Identities are saved tokens on each computer, not accounts. Anyone who can reach the brain can watch and add a worker. Keep it on your machine or network until there is a real login.
- Nothing is hosted on Maincloud (it needs `spacetime login` in a browser).

## Branches
`bilal/polish` carries everything:
`bilal/brain` → `bilal/mcp` → `bilal/brain-full` → `bilal/dashboard` → `bilal/operator` → `bilal/simple-ui` → `bilal/overnight` → `bilal/polish`.

Nothing is on `main`. The PR text is in `docs/PR.md`. Open it at https://github.com/Vibertexs/tandem/pull/new/bilal/polish
