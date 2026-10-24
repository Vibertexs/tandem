# Where Tandem can go

## Who it is for, today
- **Small teams on one repo** (2 to 6 people, each with their own Claude Code login). The goal → tasks → workers → one branch loop removes the "two agents edited the same file" problem and spreads work over everyone's quota.
- **One person, many runs.** A single laptop running `.\start.ps1 -Workers 3` already runs three Claude Code sessions in parallel, each in its own worktree, with no collisions. It's a practical way to get through a backlog faster.
- **Hackathon and agency teams.** A shared board everyone can watch (even from a phone), and a branch per goal to review.

Every person runs Claude Code under their own account on their own machine. Tandem only coordinates. It never shares logins and never drives anyone's web UI.

## Next steps, in the order that adds the most
1. **A pull request per goal.** When a goal is done, push `tandem/<goal>` and open a PR. Its description lists every task, who did it, and the result summaries. The page links to it. This turns "done" into something you can review and merge in one click.
2. **Check before done.** After merging, run the project's tests on the goal branch. If they fail, the manager adds follow-up tasks ("fix the failing test in test_calc.py") instead of marking the goal done.
3. **Host it for real.** Publish the brain to SpacetimeDB Maincloud and log in with GitHub (SpacetimeDB supports OIDC). Then every worker has a real identity: no more "anyone can act as any worker", and teammates join with a link instead of an IP address.
4. **Real capacity.** Feed real usage numbers into `report_capacity` (Claude Code's statusLine), and route work to whoever has headroom. The brain already caps a worker at 100% and requeues its task.
5. **Failing well.** A `fail_task` tool (retry once at higher effort, then hand back), and cost per goal (sum of the `claude -p` costs of its tasks) shown on the Goals page.
6. **Mac and Linux.** A `start.sh` next to `start.ps1`. Everything else is already cross-platform TypeScript.
7. **Bigger plans.** Let the manager read the repo before planning (it may already use Read, Glob and Grep). Map-reduce goals ("review every module") are built into the brain and tools; they need a real trial.

## Ideas worth trying
- **Notifications:** post "goal done, branch X" to Slack or Discord.
- **Templates:** saved goal prompts per repo ("add tests for every file in src/").
- **A reviewer worker:** a task kind run with a stronger model that only reviews another task's branch and leaves findings in the structured result.
