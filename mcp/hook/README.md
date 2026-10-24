# hook (owner: Omar; built by Bilal while solo)

PreToolUse hook that blocks edits to files another task has locked: `check-lock.mjs` (plain JavaScript, so it starts fast before every edit). The Python placeholder `check_lock.py` is left untouched and unused.

## How it works
1. Claude Code sends the tool call as JSON on stdin. For Edit and Write, `tool_input.file_path` is absolute.
2. The hook makes it repo-relative (against `CLAUDE_PROJECT_DIR`) and asks the brain for a lock on that path in `TANDEM_SESSION`, through SpacetimeDB's HTTP SQL endpoint (one quick request, no login needed for the public `locks` table).
3. If another worker holds it (anyone but `TANDEM_WORKER_ID`), it exits 2 with a message saying which task holds the file and what to do. Claude sees the message and the edit does not happen.
4. If the brain is unreachable, it lets the edit through and warns (fail open).

## Checklist
- [x] Confirm the hook input format and the exit-code behavior in the Claude Code hooks docs (https://code.claude.com/docs/en/hooks)
- [x] Look up the lock in the brain (HTTP SQL; `check_lock.py` stays a placeholder)
- [x] Config: `settings.example.json`. Use it in the worked repo's `.claude/settings.json`, or for one run with `claude --settings <file>`
- [x] Test: edit a locked file and see the block message; edit an unlocked file and see it allowed (`npm run test:hook` in `mcp/`, 13 checks)

## Done when
The hook blocks an edit on a locked file and says why: **done**. `mcp/test/e2e/hook-real.ps1` (1 haiku run): a real headless Claude told to edit a file Alice's task holds was blocked and left the file unchanged. It replied: "Blocked: a Tandem lock hook refused the write because notes.txt is locked by task t-notes (worker w-alice), so I stopped without changing the file."

## Limits
- A worker that does not set `TANDEM_WORKER_ID` is blocked by every lock, including the ones its own task holds. The launcher sets it; for an interactive session, set it yourself.
- It only guards Claude's file tools. A shell command (`Bash`) that writes a file is not checked.
