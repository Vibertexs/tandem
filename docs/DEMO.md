# Demo

The product is the demo: one command starts it, and the page shows real Claude Code workers doing a real goal.

## Before you go on stage
- [ ] `.\start.ps1 -Fresh` runs clean on the presenting laptop (brain, page, manager, 2 workers)
- [ ] `claude` is logged in on that laptop
- [ ] A second computer (or phone) on the same wifi can open the page (`.\start.ps1 -Lan`)
- [ ] Backup: `.\start.ps1 -Simulate -Fresh` works too (no Claude calls, same page)
- [ ] Backup video of a full run is on the laptop

## Presenter script (about 3 minutes)
1. Pitch line: your team's Claude Codes working as one, with no collisions and no idle quota.
2. Open the page. Click **Make me the owner** (it also approves the manager).
3. Type a goal, for example: *Create a tiny Python calculator: calc.py with add and sub, test_calc.py with unittest tests, and a README.md.*
4. The manager plans it (about 30 seconds). Tasks appear on the board, each with its files.
5. Two workers pick them up. Click a card: why it went to that worker, which files it holds, its timeline.
6. **Shared memory** tab: the interfaces the manager wrote so parallel workers agree.
7. When every task is done, the goal card shows the merged branch, "Tests pass", and the Claude cost.
8. **Team** tab: "Connect a computer" gives the one line a teammate runs to join.

## If a judge asks
- "Is it real?" Yes. Each task is a headless `claude -p` run in its own git worktree. The goal's tasks are merged into one `tandem/<goal>` branch and its tests are run.
- "What stops two Claudes editing the same file?" File locks in the brain, plus a hook that blocks the edit before it happens.
- "What if someone hits their limit?" Their worker is capped and its task goes back on the board for someone else.
- "Why not one big Claude?" One plan's quota runs out. A team has several, and today they sit idle while one person waits.
