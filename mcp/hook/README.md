# hook (owner: Omar)

PreToolUse hook that blocks edits to files another task has locked.

## Checklist
- [ ] Confirm the hook input format and the exit-code behavior in the Claude Code hooks docs
- [ ] Finish `check_lock.py` (`lookup_lock`: ask the brain, for example through a local endpoint on the MCP server)
- [ ] Add the config from `settings.example.json` to `.claude/settings.json`
- [ ] Test: edit a locked file and see the block message; edit an unlocked file and see it allowed

## Done when
The hook blocks an edit on a locked file and says why.
