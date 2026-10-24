# Status (2026-10-24, branch `bilal/one-view`)

## In one line
**You run `tandem start` in your project, and the board opens with an invite link others can join.**
1. In your project's folder: `tandem start`. It starts the brain, the board, the manager and two workers, open to your network, and prints the invite link.
2. On the board, click **Make me the owner**. That one click also approves the manager.
3. Type a goal. It gets its own lane on the board, and the manager splits it into tasks with exact file lists.
4. The workers (real Claude runs, or simulated) do them without colliding. Teammates who opened the invite watch live. With `tandem join <invite>` in their clone of the repo, their computer's workers help.
5. The goal's work is merged into one `tandem/<goal>` branch, your tests run on it, and the lane shows the result and what it cost.

## Try this first (about 2 minutes, one small Claude run for planning)
Once, in the Tandem folder: `npm install -g .` (puts `tandem` on your PATH). Then:
```
tandem start --demo --simulate
```
It uses a sample project next to the Tandem folder, and the workers fake the coding. On the board:
1. Click **Make me the owner**.
2. Click one of the example goals, then **Send**.
3. Watch the goal's lane fill up. Click a card to see why it went to that worker.

For real work, go to your own project's folder and run `tandem start`. `tandem stop` stops it. `tandem` shows what is running. `.\test.ps1` runs every test.

## What changed today
| Area | What |
|---|---|
| Starting | `tandem start` in your project, not in the Tandem folder. Open to your network by default (`--local` keeps it on this computer). One line per piece, then Open, Invite, Stop. Safe to run twice: what runs is kept. `tandem join <invite>`, `tandem stop`, `tandem status`, `tandem open`, `tandem logs`. One cross-platform TypeScript file (`cli/tandem.ts`, Node 22.18+); `start.ps1`, `start.sh`, `stop.ps1` and `stop.sh` are gone. |
| One board | Each goal is a swimlane: what you asked for, its status and progress, cost, time, branch and note, then its tasks in Waiting, To do, In progress and Done. Finished goals move down and start folded; done cards take one line. Work added by hand gets an "Other tasks" lane. The Goals tab is gone. |
| Invite | Top right of every page: **Invite** shows the link and the `tandem join` line, or "This computer only" says why there is none. The start page takes a pasted invite. |
| Accounts and agents | `tandem account add <label> [--agent codex]` gives a worker its own Claude Code or Codex login (a folder inside the Tandem folder; your own login is untouched). `tandem start --accounts all` runs one worker per account. The brain knows each worker's agent and account, and the Team page shows them. Codex workers run `codex exec`. Tested with a stand-in for Codex; real Codex is untried (the CLI is not installed here). |
| Joining | `tandem join <invite>` checks the host is reachable, finds the team's repo (the manager publishes its origin), says what to clone if you are not in it, and starts workers that push their branches. |

Everything from the night before still holds: failure handling (giving back, conflicts as tasks, usage limits, goals that could not be planned), costs, worker ownership, `--review`, `--notify`, dependent tasks starting from their dependencies' work.

## Tested
`.\test.ps1` on the final code: **10 suites, 343 checks, all pass** (no Claude calls).

| Suite | Checks |
|---|---|
| brain (atomic rules, sessions, goals, presence, costs, giving back, limits, cancel, agents) | 78 |
| brain: who may do what (owner, requests, worker ownership) | 33 |
| mcp: mock mode | 17 |
| mcp: 17 tools, real brain | 32 |
| mcp: manager identity | 13 |
| mcp: lock-check hook | 13 |
| launcher: routing, limit parsing, simulate (a limit, a restart while capped), a Codex worker with a stand-in | 38 |
| manager: merge, conflicts, dependencies, test, finish, push, notify, planning failures, review | 47 |
| page in Chrome (the start page, the board's lanes, invite, failures, desktop and phone) | 63 |
| the tandem command: accounts, start with accounts, status, stop | 9 |

Also passing:
- The product end to end through the new command (`dashboard/test/start-flow.ts`): `tandem start --simulate` run in a test project, make me the owner, a goal planned by the real manager (1 haiku run), simulated workers finish it on the board's lane, `tandem stop` leaves nothing running.
- Earlier real Claude runs (haiku, each capped at $0.50), on the same manager and launcher code:
  - Real workers, five times: the goal planned, built by two Claudes, merged into `tandem/<goal>`, its tests passing. One run with `--review`: "Tests pass. Review: Looks good. The only note is cosmetic: the README's title says Tandem playground rather than describing the calculator."
  - A real merge conflict resolved by a worker Claude, with the merged code running.
  - A teammate on another computer, through a shared origin: every task done on the teammate's clone, merged by the host.
- About 40 real runs in total, all haiku.

## Not done, or not proven
- `tandem` has not been tried on a Mac or Linux, nor from a second physical computer. The address detection, the invite links and the whole push/fetch/merge path (two clones and an origin on one machine) are tested. Windows may ask to allow node and spacetime on private networks.
- `npm install -g .` was not run here (it changes your global npm folder). `tandem.cmd` in the Tandem folder runs the same command without it.
- Not tried: `gh pr create` (no GitHub CLI here), a real Slack or Discord webhook, a real usage limit, and a real failing-tests fix round (each is tested without Claude).
- Identities are saved tokens on each computer, not accounts. Anyone who can reach the brain can watch and add a worker. Keep it on your network until there is a real login.
- Nothing is hosted on Maincloud (it needs `spacetime login` in a browser).

## Branches
`bilal/one-view` (today) is on top of `bilal/polish` (the night before), which carries every earlier branch. Nothing is on `main`. The PR text is in `docs/PR.md`. Open it at https://github.com/Vibertexs/tandem/pull/new/bilal/one-view
