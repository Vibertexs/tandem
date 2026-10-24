# Handoff: where the work stopped (2026-10-24, branch `bilal/git-share`)

Read this first. It says what is done, what is half done, and what to do next.

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
- Whole product on one computer, plus simulated and real Claude runs, accounts/agents (Claude + Codex stand-in), failure handling, review, notify, one swimlane board, Invite button, Setup page. `.\test.ps1` was 10 suites / 343 checks green before today's later changes (see "Unverified").
- Real Claude runs were proven earlier, including through a shared origin (`manager/test/two-computers.ts`, with a bare repo standing in for GitHub).
- Two physical computers over Tailscale: Bilal and a teammate connected with **simulated** workers (the teammate's workers showed on the Team page). Real workers from the second computer are NOT yet tried.
- Prototype of the no-GitHub transport works on Windows: serve the host's repo over HTTP through `git http-backend`, clone it, push a `task/...` branch back, host's checked-out branch untouched. (`git daemon` hangs on push on Windows, so do not use it.)

## What was built on `bilal/git-share` (uncommitted until this commit; read the diff)
- `cli/gitshare.ts` + `cli/gitserver.ts`: Node HTTP server in front of `git http-backend` (pushes enabled, no login). `tandem start` runs it per project on a free port (>= 9418) bound to the invite address (Tailscale address when Tailscale runs, else the wifi address), only when the invite is shared (not `--local`).
- `cli/tandem.ts`: `start` publishes `git_url` via the manager (`--git-url`); `join` now clones the project from the host into `<Tandem>/.tandem/work/<team>` (updates it on later joins), sets origin to the host, and starts workers with `--push`, so their branches land in the host's repo. `--repo <path>` still lets someone use their own clone. A real join to a host with no `git_url` fails with "The host is not sharing the project yet... tandem stop, tandem start". `teams.json` now stores `gitPort`.
- `manager/watch.ts`: `--git-url` publishes `git_url` into shared context (also already publishes `repo_url`, `tandem_dir`, `project_dir`).
- Dashboard: `JoinSteps` (ui.tsx) is now "1. get Tandem, 2. `.\tandem.cmd join "<link>"`" (Mac/Linux `./tandem join`), or "restart so it can share" when `git_url` is empty. Setup page is five steps (GitHub step removed). Team page and Invite box pass `git_url`.

## Unverified / to do next, in this order
1. **Run the end to end for real.** Host: `tandem stop --all; tandem start --fresh` in a project (e.g. `C:\Code\calc-demo`, already a git repo with one commit, no remote needed). Check the output has a line `✓ project  shared from this computer`, and that `git ls-remote <git_url>` works (`git_url` is in the shared context: `SELECT value FROM context WHERE key='git_url'` via `http://127.0.0.1:3001/v1/database/<team>/sql`). Then on another computer (or a second state dir on the same one, `TANDEM_STATE=<tmp>`): `tandem join "<invite>"` with no `--simulate`; confirm `<Tandem>/.tandem/work/<team>` exists, workers show on the Team page, send a goal, tasks split, branches `task/*` appear in the host repo, goal merges and tests run.
2. **Add an automated test** for the share path, `cli/share.test.ts`: start a team (not `--local`; needs a shared address), approve the manager (see `manager/test/watch.test.ts` for how), wait for `git_url`, `git ls-remote` it, `tandem join` in a second `TANDEM_STATE` (real mode, one worker; no Claude call happens until a task exists), assert the work clone's origin equals `git_url`, push a branch from it and see it in the host repo, `tandem stop` both. Add it to `test.ps1`.
3. **Fix the page test** `dashboard/test/ui.test.ts` for the changes: the Setup page now has FIVE steps (the test expects six; indexes after step 3 shift), step "4. The project is on GitHub" is gone, `JoinSteps`/Invite/Team text changed (no `--simulate`, no "no GitHub remote" message, now "not sharing the project yet" and, when `git_url` is set, `git clone https://github.com/Vibertexs/tandem` + `.\tandem.cmd join "<link>"`). Set `git_url` through `manager.reducers.setContext` to test the shared case. Run `npm run build` first; the preview server must be on port 4173 (`npx vite preview --port 4173 --strictPort` in `dashboard/`); the brain must be on 3001.
4. Update `README.md` ("How to start", step 3: teammates need only Node, Git, Claude Code and the invite; `tandem join "<invite>"` copies the project from the host; GitHub is optional and only for `--push`), `docs/STATUS.md`, `docs/PR.md`. Mention the limit: the host's project server has **no login**, so use Tailscale or `--local`.
5. Run the full `.\test.ps1`, commit under Bilal's name (no trailer), push `bilal/git-share`, and give Bilal the PR link.
6. Optional polish: Windows Firewall may prompt for `node` on first share; the Setup page could show the join progress live; a Tailscale-not-running hint.

## Useful facts
- Start commands: `C:\Code\tandem\tandem.cmd start` (Windows) / `tandem start` if on PATH; run from the PROJECT folder, never the Tandem folder. `tandem stop [--all]`, `tandem status`, `tandem logs [part]`.
- Bilal's Tailscale address (host laptop `yoga-laptop`): `100.113.129.14`. Invite for the demo team: `http://100.113.129.14:5173/?db=calc-demo`.
- Tests: brain `npm test` in `brain/`, etc.; whole suite `.\test.ps1` (about 6 minutes); real-Claude suites `.\test.ps1 -Real` (haiku, a few runs).
- PowerShell quirks that bit today: `.NET` file APIs ignore PowerShell's current folder (use full paths); backticks and `${t}` inside PowerShell here-strings expand, so write files with the editor tool instead; a failed `Set-Location` leaves later commands running in the old folder.
- Bilal's own SpacetimeDB/home folders must not be touched. Tandem keeps its state in `<Tandem>/.tandem/` (gitignored): `pids.json`, `teams.json`, `accounts.json`, `logs/`, `work/`.
