# Where Tandem can go

## Who it is for, today
- **Small teams on one repo** (2 to 6 people, each with their own Claude Code login). The loop goes from a goal to tasks, then to workers, then to one tested branch. It removes the "two agents edited the same file" problem and spreads the work over everyone's quota.
- **One person, many runs.** A single laptop running `.\start.ps1 -Workers 3` runs three Claude Code sessions in parallel, each in its own worktree, with no collisions. It's a practical way to clear a backlog while you do something else.
- **Hackathon and agency teams.** A shared board everyone can watch (even from a phone), a branch per goal to review, and what each goal cost.

Every person runs Claude Code under their own account on their own machine. Tandem only coordinates. It never shares logins and never drives anyone's web UI.

## Already built
- A branch per goal, with the project's tests run on it. A failing run adds a "fix the tests" task.
- A pull request per goal (`-Push`, with the GitHub CLI installed).
- Cost per task and per goal, from `claude -p`.
- Handing a task back with a reason. After two workers, it waits for a person ("needs you", then Try again).
- Merge conflicts as tasks: a worker Claude resolves the conflict markers and the launcher commits the merge.
- Usage limits: a capped worker waits for the reset and comes back by itself.
- A "goal done" post to Slack or Discord (`-Notify`).
- Workers that reconnect on their own, worker ownership, and `start.sh` for macOS and Linux.

## Next steps, in the order that adds the most
1. **Host it for real.** Publish the brain to SpacetimeDB Maincloud and log in with GitHub (SpacetimeDB supports OIDC). Then every identity is a real account, and teammates join with a link instead of an IP address.
2. **Real capacity.** Feed real usage numbers into `report_capacity` (from Claude Code's statusLine), and route work to whoever has headroom. The brain already caps a worker at 100% and requeues its task.
3. **A reviewer worker.** A task kind run with a stronger model that only reviews a goal branch and leaves findings, before the PR is opened.
4. **Bigger plans.** Map-reduce goals ("review every module") are built into the brain and tools; they need a real trial with real Claude.

## Ideas worth trying
- **Templates:** saved goal prompts per repo ("add tests for every file in src/").
- **Budgets:** a spending cap per goal. The manager stops creating tasks when the goal's cost reaches it.
