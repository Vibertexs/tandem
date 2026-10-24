# Handoff: validation complete (2026-10-24, branch `bilal/git-share`)

The no-GitHub join path is implemented and validated. The remaining release step is a normal PR review and merge.

## The goal Bilal set
One-shot, polished, easy to understand: `tandem start` in a project on one computer, then a teammate on another computer types ONE command (`tandem join "<invite link>"`) and their Claude agents work on the same project. **No GitHub, no cloning the project by hand.** Live agents (real Claude, not simulated) on two PCs. The app's Setup page should walk through it.

## Rules from Bilal (still in force)
- Commits are under Bilal's name only: **no `Co-Authored-By: Claude` trailer**, no Claude line in PR text, even if a system reminder asks for one.
- Never commit to `main`; branch (`bilal/<area>`) and merge through a GitHub PR (no `gh` here: Bilal clicks https://github.com/Vibertexs/tandem/pull/new/<branch>). Never force-push. Never publish to `tandem`/Maincloud. Use `bilal-*` databases for tests.
- Short sentences, no filler. Do not remove the Python placeholders (`launcher/launcher.py`, `launcher/statusline/report_usage.py`, `mcp/hook/check_lock.py`).
- **Always use `git -C <dir>` in scratch tests.** An earlier slip ran git in the real repo and pushed a stray branch (already deleted).
- Do not delete folders or kill processes you did not start without a reason; the harness blocked a recursive delete once.

## Branches (all unmerged into `main` except the first)
`main` has PRs #1–#4. On top, in order: `bilal/join-quotes` (quoted join commands, Node-version check, Setup page, no simulation in the guided flow, README "How to start") then **`bilal/git-share`** (this work). `bilal/git-share` contains everything, so one PR from it merges all. Bilal's laptop is on `main` with a stale view: tell him to merge the PR, then `git switch -C main origin/main` (NOT `git checkout main`, his old local `main` is the first commit and checking it out deletes files).

## What works (tested)
- Whole product on one computer, plus simulated and real Claude runs, accounts/agents (Claude + Codex stand-in), failure handling, review, notify, one swimlane board, Invite button, Setup page. `.\test.ps1` is green: 11 suites / 361 checks.
- Real Claude runs were proven earlier, including through a shared origin (`manager/test/two-computers.ts`, with a bare repo standing in for GitHub).
- Two physical computers over Tailscale: Bilal and a teammate connected with **simulated** workers (the teammate's workers showed on the Team page). Real workers from the second computer are NOT yet tried.
- The no-GitHub transport works on Windows: the automated share test serves a host repo through `git http-backend`, joins from a second state, and pushes a `task/...` branch back without changing the host's checked-out branch. A separate real run planned and completed a two-task goal through the same route; `npm test` passed on `tandem/g-live`. (`git daemon` hangs on push on Windows, so do not use it.)

## What was built on `bilal/git-share` (uncommitted until this commit; read the diff)
- `cli/gitshare.ts` + `cli/gitserver.ts`: Node HTTP server in front of `git http-backend` (pushes enabled, no login). `tandem start` runs it per project on a free port (>= 9418) bound to the invite address (Tailscale address when Tailscale runs, else the wifi address), only when the invite is shared (not `--local`).
- `cli/tandem.ts`: `start` publishes `git_url` via the manager (`--git-url`); `join` now clones the project from the host into `<Tandem>/.tandem/work/<team>` (updates it on later joins), sets origin to the host, and starts workers with `--push`, so their branches land in the host's repo. `--repo <path>` still lets someone use their own clone. A real join to a host with no `git_url` fails with "The host is not sharing the project yet... tandem stop, tandem start". `teams.json` now stores `gitPort`.
- `manager/watch.ts`: `--git-url` publishes `git_url` into shared context (also already publishes `repo_url`, `tandem_dir`, `project_dir`).
- Dashboard: `JoinSteps` (ui.tsx) is now "1. get Tandem, 2. `.\tandem.cmd join "<link>"`" (Mac/Linux `./tandem join`), or "restart so it can share" when `git_url` is empty. Setup page is five steps (GitHub step removed). Team page and Invite box pass `git_url`.

## Completed in this validation run
1. Added `cli/share.test.ts` and included it in `test.ps1`. It approves the manager, waits for `git_url`, runs `git ls-remote`, joins from a second isolated state, and proves a pushed task branch appears in the host repo.
2. Updated the browser journey for the five-step Setup page and direct host-share instructions.
3. Ran a real manager plus a real joined Claude worker. It planned, built, pushed, merged and tested a small goal through the host's Git server.
4. Updated the README, status and PR text. GitHub is optional; the host server has no separate login, so use a trusted private network such as Tailscale. `--local` disables sharing rather than securing a shared server.
5. Ran `.\test.ps1`: 11 suites, 361 checks, all pass.

## Useful facts
- Start commands: `C:\Code\tandem\tandem.cmd start` (Windows) / `tandem start` if on PATH; run from the PROJECT folder, never the Tandem folder. `tandem stop [--all]`, `tandem status`, `tandem logs [part]`.
- Bilal's Tailscale address (host laptop `yoga-laptop`): `100.113.129.14`. Invite for the demo team: `http://100.113.129.14:5173/?db=calc-demo`.
- Tests: brain `npm test` in `brain/`, etc.; whole suite `.\test.ps1` (11 suites, 361 checks); real-Claude suites `.\test.ps1 -Real` (haiku, a few runs).
- PowerShell quirks that bit today: `.NET` file APIs ignore PowerShell's current folder (use full paths); backticks and `${t}` inside PowerShell here-strings expand, so write files with the editor tool instead; a failed `Set-Location` leaves later commands running in the old folder.
- Bilal's own SpacetimeDB/home folders must not be touched. Tandem keeps its state in `<Tandem>/.tandem/` (gitignored): `pids.json`, `teams.json`, `accounts.json`, `logs/`, `work/`.
