# launcher (owner: Sam)

One per teammate. Runs on their machine, logged in as themselves. Pulls assigned tasks and runs each one as a fresh headless Claude Code run.

## Checklist
- [ ] `launcher.py`: register, report capacity, claim a task, run it in a git worktree, report progress and completion, repeat
- [ ] Run with `claude -p` using the model and effort on the task (check `claude --help` for exact flags on your version)
- [ ] Rate-limit handling: report it, requeue the task, mark the worker capped until `reset_at`
- [ ] Routing: read `routing.json` to fill in model and effort when the manager leaves them blank, and downgrade one step when the worker is above about 80% usage
- [ ] Retry a failed task once at higher effort
- [ ] Capacity reporter: `statusline/report_usage.py`, configured as the Claude Code statusLine, pushes numbers to the brain every few minutes
- [ ] `--simulate` mode: fake runs with timed progress and canned results (including canned structured results for map tasks), no Claude calls. **Ship this early.** Omar's judge mode needs it.

## Checkpoint (about hour 6)
The launcher runs one dummy task in a worktree and reports back.

## Done when
Assigning a task from a terminal makes a teammate's machine run it and push a branch, and simulate mode does the same visibly with no Claude calls.

## Notes
- Avoid the lowest effort on unattended runs (nobody is there to answer questions).
- The statusLine only updates while Claude Code is active, so idle workers go stale. Always report `last_seen`.
- Check what fields the statusLine JSON contains on your Claude Code version before relying on it for usage numbers.
- Never automate anyone's web UI or share credentials.
