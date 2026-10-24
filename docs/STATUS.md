# Status (2026-10-24, branch `bilal/git-share`)

## In one line
**You run `tandem start` in your project, and the board opens with an invite link others can join.**
1. In your project's folder: `tandem start`. It starts the brain, the board, the manager and two workers, open to your network, and prints the invite link.
2. On the board, click **Control this team**. That gives this browser controller permission and also approves the manager.
3. Type a goal. It gets its own lane on the board, and the manager splits it into tasks with exact file lists.
4. The workers (real Claude runs, or simulated) do them without colliding. Teammates who opened the invite watch live. To add their computer's workers, they paste the Invite box's full clone-and-join block; `tandem join <invite>` copies the project host's project and starts their workers.
5. The goal's work is merged into one `tandem/<goal>` branch, your tests run on it, and the lane shows the result and what it cost.

## Try this first (about 2 minutes, one small Claude run for planning)
Make or open a small disposable Git project:
```
mkdir tandem-try
cd tandem-try
git init
git -c user.name=Tandem -c user.email=tandem@localhost commit --allow-empty -m "Start"
```
Then, while still in that project, run Tandem by its path (no PATH setup is needed):
```powershell
& "C:\path\to\tandem\tandem.cmd" start --simulate
```
It uses that project, and the workers fake the coding. On the board:
1. Click **Control this team**.
2. Type a small goal, then click **Send**.
3. Watch the goal's lane fill up. Click a card to see why it went to that worker.

For real work, go to your own project's folder and run `tandem start`. `tandem stop` stops it. `tandem` shows what is running. `.\test.ps1` runs every test.

## What changed today
| Area | What |
|---|---|
| Starting | `tandem start` in your project, not in the Tandem folder. Run its launcher by path on first use—no PATH setup needed. Open to your network by default (`--local` keeps it on this computer). One line per piece, then Open, Invite, Stop. Safe to run twice: what runs is kept. `tandem join <invite>`, `tandem stop`, `tandem status`, `tandem open`, `tandem logs`. One cross-platform TypeScript file (`cli/tandem.ts`, Node 22.18+); `start.ps1`, `start.sh`, `stop.ps1` and `stop.sh` are gone. |
| One board | Each goal is a swimlane: what you asked for, its status and progress, cost, time, branch and note, then its tasks in Waiting, To do, In progress and Done. Finished goals move down and start folded; done cards take one line. Work added by hand gets an "Other tasks" lane. The Goals tab is gone. |
| Invite | Top right of every page: **Invite** shows the board link plus one complete clone-and-join block for a teammate's computer, or "This computer only" says why there is none. The start page takes a pasted invite. |
| Accounts and agents | `tandem account add <label> [--agent codex]` gives a worker its own Claude Code or Codex login (a folder inside the Tandem folder; your own login is untouched). `tandem start --accounts all` runs one worker per account. The brain knows each worker's agent and account, and the Team page shows them. Codex workers run `codex exec`. Tested with a stand-in for Codex; real Codex is untried (the CLI is not installed here). |
| Joining | The project host serves its project through Git's HTTP backend. `tandem join <invite>` checks the host, copies that project into Tandem's private work folder, and starts workers that push task branches back to the host. GitHub is optional (`--push` only). |

Everything from the night before still holds: failure handling (giving back, conflicts as tasks, usage limits, goals that could not be planned), costs, worker ownership, `--review`, `--notify`, dependent tasks starting from their dependencies' work.

## Tested
`.\test.ps1` on the final code: **11 suites, 362 checks, all pass** (no Claude calls).

| Suite | Checks |
|---|---|
| brain (atomic rules, sessions, goals, presence, costs, giving back, limits, cancel, agents) | 79 |
| brain: who may do what (controller access, requests, worker ownership) | 33 |
| mcp: mock mode | 17 |
| mcp: 17 tools, real brain | 32 |
| mcp: manager identity | 13 |
| mcp: lock-check hook | 13 |
| launcher: routing, limit parsing, simulate (a limit, a restart while capped), a Codex worker with a stand-in | 38 |
| manager: merge, conflicts, dependencies, test, finish, push, notify, planning failures, review | 48 |
| page in Chrome (the start page, the board's lanes, invite, failures, desktop and phone) | 69 |
| the tandem command: accounts, start with accounts, status, stop | 13 |
| the tandem command: host project sharing, join and branch push | 7 |

Also passing:
- The product end to end through the new command (`dashboard/test/start-flow.ts`): `tandem start --simulate` run in a test project, take control in the browser, a goal planned by the real manager (1 haiku run), simulated workers finish it on the board's lane, `tandem stop` leaves nothing running.
- Earlier real Claude runs (haiku, each capped at $0.50), on the same manager and launcher code:
  - Real workers, five times: the goal planned, built by two Claudes, merged into `tandem/<goal>`, its tests passing. One run with `--review`: "Tests pass. Review: Looks good. The only note is cosmetic: the README's title is generic rather than describing the calculator."
  - A real merge conflict resolved by a worker Claude, with the merged code running.
  - A teammate on another computer, through a shared origin: every task done on the teammate's clone, merged by the host.
- The new direct host-share path: a real manager planned two tasks, a real joined Claude worker copied the host project through its Git HTTP address, completed both tasks, pushed both task branches back, and the host merged them into `tandem/g-live`. `npm test` passed; the recorded cost was $0.0051. This was two isolated Tandem states on one Windows computer, using its Tailscale address.
- About 40 real runs in total, all haiku.

## Not done, or not proven
- `tandem` has not been tried on a Mac or Linux, nor with a real worker from a second physical computer. The direct host-share flow has been proven with isolated host and joiner states on one Windows computer. Windows may ask to allow node and spacetime on private networks.
- The direct launcher command has been tested on Windows; Mac and Linux remain untried. It avoids needing `npm install -g .` or a PATH change.
- Not tried: `gh pr create` (no GitHub CLI here), a real Slack or Discord webhook, a real usage limit, and a real failing-tests fix round (each is tested without Claude).
- Identities are saved tokens on each computer, not accounts. Anyone who can reach the brain can watch and add a worker. The host project server also has no separate login, so share only over a trusted private network such as Tailscale.
- Nothing is hosted on Maincloud (it needs `spacetime login` in a browser).

## Branches
`bilal/git-share` is on top of `bilal/join-quotes`, which carries every earlier branch. Nothing from this final stack is on `main`. The PR text is in `docs/PR.md`. Open it at https://github.com/Vibertexs/tandem/pull/new/bilal/git-share
