# Demo

The product is the demo: one command starts it, and the page shows real Claude Code workers doing a real goal.

## Before you go on stage
- [ ] `tandem start --fresh` in the demo project runs clean on the presenting laptop (brain, page, manager, 1 worker per computer)
- [ ] `claude` is logged in on that laptop
- [ ] A second computer (or phone) on the same wifi can open the invite link
- [ ] Backup: a recorded video of a full real run is on the laptop
- [ ] Backup video of a full run is on the laptop

## Presenter script (about 3 minutes)
1. Pitch line: your team's Claude Codes working as one, with no collisions and no idle quota.
2. Open the page with `tandem -d`. You already control the team and the manager is approved; nothing to click.
3. Type a goal, for example: *Create a tiny Python calculator: calc.py with add and sub, test_calc.py with unittest tests, and a README.md.*
4. The manager plans it (about 30 seconds). The goal gets its own lane on the board, with its tasks and their files.
5. Two workers pick them up. Click a card: why it went to that worker, which files it holds, its timeline.
6. **Shared memory** tab: the interfaces the manager wrote so parallel workers agree.
7. When every task is done, the goal's lane shows the merged branch, "Tests pass", and the Claude cost.
8. **Invite** (top right): the link a teammate opens to watch, plus the one copyable clone-and-join block that adds their computer's workers.

If there is time, show what happens when things go wrong:
- **A usage limit:** a worker that hits its plan limit goes "Out of quota until …", its task moves to another worker, and it comes back by itself after the reset.
- **Cancel a goal:** in the goal's lane, Cancel goal removes its tasks that had not started.
- **The page on a phone:** scan the QR code in Settings.

## If a judge asks
- "Is it real?" Yes. Each task is a headless `claude -p` run in its own git worktree. The goal's tasks are merged into one `tandem/<goal>` branch and its tests are run.
- "What stops two Claudes editing the same file?" File locks in the brain, plus a hook that blocks the edit before it happens.
- "What if someone hits their limit?" Their worker is capped and its task goes back on the board for someone else. It comes back when the limit resets.
- "What if two tasks conflict?" The manager adds a "resolve the merge conflict" task; a worker Claude fixes the markers and the launcher commits the merge.
- "What if a task can't be done?" The worker gives it back with a reason; a second worker tries; then the board says "needs you", with Try again.
- "Why not one big Claude?" One plan's quota runs out. A team has several, and today they sit idle while one person waits.
