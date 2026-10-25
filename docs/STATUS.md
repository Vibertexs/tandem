# Status (2026-10-25)

**Supported agent: Claude Code.** Workers and the conductor run Claude Code. Codex support is experimental (stand-in tested only) and is used only if you add a Codex account.

## Words
- **Conductor**: you, and your computer. You run `tandem --start` in the project. Your computer holds the project, runs the brain, the planning Claude ("Conductor Claude") and workers, and merges the work. (The words "host" and "manager" are gone from the page.)
- **Teammate**: any other computer that joins with the invite and lends its Claude workers. Teammates watch; the conductor can approve one to send goals too.

## In one line
**You run `tandem --start` in your project, and the board opens with an invite link others can join.**
1. In your project's folder: `tandem --start`. It starts the brain, the board, the conductor and a Claude worker, open to your network, and prints the invite link.
2. The board opens with you as the conductor: the page `tandem --start` opens takes control by itself and approves Conductor Claude. It can always take control back (see Control).
3. Type a goal and pick an effort (Low, Medium, High). It gets its own lane on the board, and the conductor splits it into tasks with exact file lists.
4. The workers (real Claude Code runs) do them without colliding. Teammates who opened the invite watch live. To add their computer's workers: once, clone Tandem and run `tandem install`; then `tandem join "<invite>"` from any folder copies the conductor's project and starts their workers.
5. The goal's work is merged into one `tandem/<goal>` branch, your tests run on it, and the lane shows the result and what it used.

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
& "C:\path\to\tandem\tandem.cmd" --start
```
It uses that project, and your Claude Code does the work. On the board:
1. Type a small goal, pick **Low** effort (haiku, cheapest), then click **Send**.
2. Watch the goal's lane fill up. Click a card to see why it went to that worker and which model it ran.

For real work, go to your own project's folder and run `tandem --start` (after `tandem install` once). `tandem stop` stops it. `tandem` shows what is running. `.\test.ps1` runs every test.

## What changed today
| Area | What |
|---|---|
| Effort | Each goal is sent with an effort: **Low**, **Medium** (default) or **High**. It picks every model (`launcher/routing.json`, `by_goal_effort`), shown in the table below. The drawer shows each task's model and effort; the lane shows the goal's effort. Near a usage limit (over 80%) a worker still steps down a model; a retried task gets at least `high` effort. `--conductor-model <name>` forces the planning model. |
| Tokens or dollars | Every Claude run now records its tokens (input, output and cache) as well as its cost. Usage, the Board, Activity and Team show either one: a **Dollars / Tokens** switch on Usage and in Settings, remembered per browser. Dollars carry a "~": they are estimated at API prices, and on a Pro or Max plan nothing is billed per run. |
| Control | The conductor can always take control back. `tandem --start` makes a key for each team, gives it to Conductor Claude (stored in a private table), and opens the conductor's page with it. That page takes control even when other browsers already have it (another browser, cleared storage). The key is removed from the address bar once read; a wrong key does nothing. |
| Shared memory | Each note says who wrote it and when ("Written by Conductor · 2m ago") and which workers read it. The launcher gives a worker's Claude the notes before every task and logs it ("bilal-pc read the shared notes (Interfaces, Decisions) before "Add login""); each agent card has a **Read** row and says whether it is the conductor's computer or a teammate's. |
| Pages | Six pages: Board, Team, Shared memory, Usage, Activity, Settings. Overview is gone (the Board and Usage cover it); an old `#/overview` link opens the Board. Usage hides quota bars a computer does not report ("Quota not reported"). Settings links the projector view (`view=present`). |
| Joining | One command after a one-time setup: `git clone` Tandem, `.\tandem.cmd install`, open a new terminal; then `tandem join "<invite>"` from any folder. |

| Goal effort | Plans it | Easy task | Normal task | Hard task | Map piece | Merge (reduce) |
|---|---|---|---|---|---|---|
| Low | haiku | haiku | haiku | sonnet, medium | haiku | sonnet, medium |
| Medium | sonnet, medium | haiku | sonnet | opus, high | sonnet | opus, high |
| High | opus, high | sonnet, medium | opus, medium | opus, xhigh | opus, medium | opus, xhigh |

| Area | Earlier today |
|---|---|
| Verified on two computers | A real run with a teammate's computer over Tailscale: the conductor split goals, both computers' Claude workers built tasks in parallel (the conductor's computer did most, the teammate's did the CLI and a stylesheet), the work merged on a readable `tandem/<goal>` branch, and **Merge into my project** put it in the conductor's project folder. |
| Getting the code | A finished goal has **Merge into my project**: the conductor merges its branch into the branch the project is on (refuses with uncommitted changes, undoes a conflicting merge). New goals then start from the merged work. |
| Commands | `tandem --start` and every other command also work as flags. Plain `tandem` opens the page. Unknown commands say to use `tandem --help`. `tandem install` puts the Tandem folder on your user PATH (`uninstall` undoes it). `tandem doctor` checks this computer has Node, Git, npm, Claude Code, SpacetimeDB and Tailscale. |
| Pages | **Board** (only the work still going; finished goals become a one-line strip with the merge button), Team (Get started at the top: conductor, connect a teammate, send a goal), Shared memory, **Usage** (per computer and goal), **Activity** (finished goals with branch, who built it, files and the merge button, then the log), Settings (a gear). |
| Shared memory | Explains that the code lives in git and SpacetimeDB holds what agents must agree on (goals, tasks, locks, notes, presence), then shows one card per agent (what it is working on, which files it holds, which notes it sees). The raw SpacetimeDB tables, with live row counts, are under "Under the hood". |
| Control | Whoever runs `tandem --start` is the conductor: the page it opens (`host=1`) takes control and approves Conductor Claude by itself. The claim-or-watch screen is gone. Teammates opening the invite only watch. |
| Names | Workers are named after the computer (`bilal-pc`, `bilal-pc-2`, or `bilal-pc-work1` with accounts), not Alex or Sam. The Board no longer suggests goals. |
| Task folders | Each task runs in its own git worktree (so parallel Claudes never touch the same files). `tandem start` puts them in Tandem's own folder, `.tandem/worktrees/<project>-<id>/<task words>-<id>`, not in your project, so your project gets no `.worktrees` folder and no `.git/info/exclude` entry. Run by hand without `tandem start`, they are in `.worktrees/` in the repo. |
| Models | By task difficulty (now also by the goal's effort, above). `--model <name>` forces one. |
| Windows | Background workers and the conductor no longer open console windows on Windows. |
| Starting | `tandem start` in your project, not in the Tandem folder. Run its launcher by path on first use—no PATH setup needed. Open to your network by default (`--local` keeps it on this computer). One line per piece, then Open, Invite, Stop. Safe to run twice: what runs is kept. `tandem join <invite>`, `tandem stop`, `tandem status`, `tandem open`, `tandem logs`. One cross-platform TypeScript file (`cli/tandem.ts`, Node 22.18+); `start.ps1`, `start.sh`, `stop.ps1` and `stop.sh` are gone. |
| One board | Each goal is a swimlane: what you asked for, its status and progress, cost, time, branch and note, then its tasks in Waiting, To do, In progress and Done. Finished goals move down and start folded; done cards take one line. Work added by hand gets an "Other tasks" lane. The Goals tab is gone. |
| Invite | Top right of every page: **Invite** shows the board link plus one complete clone-and-join block for a teammate's computer, or "This computer only" says why there is none. The start page takes a pasted invite. |
| Accounts and agents | `tandem account add <label> [--agent codex]` gives a worker its own Claude Code login (a folder inside the Tandem folder; your own login is untouched). `tandem start --accounts all` runs one worker per account. The brain knows each worker's agent and account, and the Team page shows them. **Codex is experimental**: `--agent codex` workers run `codex exec`, tested only with a stand-in; real Codex is untried (the CLI is not installed here). |
| Sharing the project | The conductor serves its project through Git's HTTP backend. `tandem join <invite>` checks the conductor, copies that project into Tandem's private work folder, and starts workers that push task branches back to the conductor. GitHub is optional (`--push` only). |

Everything from the night before still holds: failure handling (giving back, conflicts as tasks, usage limits, goals that could not be planned), costs, worker ownership, `--review`, `--notify`, dependent tasks starting from their dependencies' work.

## Tested
`.\test.ps1` on the final code: **12 suites, 469 checks, all pass** (no Claude calls).

| Suite | Checks |
|---|---|
| brain (atomic rules, sessions, goals and their effort, presence, costs and tokens, notes read, giving back, limits, cancel, agents) | 85 |
| brain: who may do what (operator access, requests, worker ownership, the conductor's key) | 38 |
| mcp: mock mode | 17 |
| mcp: 17 tools, real brain | 32 |
| mcp: conductor identity | 13 |
| mcp: lock-check hook | 13 |
| launcher: routing by goal effort, limit parsing, simulate (a limit, a restart while capped), a Codex worker with a stand-in | 54 |
| manager (the conductor): merge, conflicts, dependencies, test, finish, push, notify, planning failures, review | 72 |
| dashboard: the dock | 7 |
| page in Chrome (the start page, effort, tokens or dollars, taking control back, notes written and read, the board's lanes, invite, failures, desktop and phone) | 100 |
| the tandem command: accounts, start with accounts, status, stop, doctor | 29 |
| the tandem command: project sharing, join and branch push | 9 |

Also passing:
- The product end to end through the new command (`dashboard/test/start-flow.ts`, before the effort change): `tandem start` run in a test project (fake-coding workers, tests only), take control in the browser, a goal planned by the real conductor (1 haiku run), the workers finish it on the board's lane, `tandem stop` leaves nothing running.
- Earlier real Claude runs (haiku, each capped at $0.50), on the same manager and launcher code:
  - Real workers, five times: the goal planned, built by two Claudes, merged into `tandem/<goal>`, its tests passing. One run with `--review`: "Tests pass. Review: Looks good. The only note is cosmetic: the README's title is generic rather than describing the calculator."
  - A real merge conflict resolved by a worker Claude, with the merged code running.
  - A teammate on another computer, through a shared origin: every task done on the teammate's clone, merged by the host.
- The new direct host-share path: a real manager planned two tasks, a real joined Claude worker copied the host project through its Git HTTP address, completed both tasks, pushed both task branches back, and the host merged them into `tandem/g-live`. `npm test` passed; the recorded cost was $0.0051. This was two isolated Tandem states on one Windows computer, using its Tailscale address.
- About 40 real runs in total, all haiku.

## Not done, or not proven
- `tandem` has not been tried on a Mac or Linux (untested). It has run with a real second Windows computer over Tailscale. Windows may ask to allow node and spacetime on private networks.
- The direct launcher command has been tested on Windows; Mac and Linux remain untried. It avoids needing `npm install -g .` or a PATH change.
- Not tried: `gh pr create` (no GitHub CLI here), a real Slack or Discord webhook, a real usage limit, and a real failing-tests fix round (each is tested without Claude).
- Identities are saved tokens on each computer, not accounts. Anyone who can reach the brain can watch and add a worker. The conductor's project server also has no separate login. That is by design for home networks and Tailscale: the network is private, and you hand out the link yourself. The conductor's key only decides who controls the board.
- Nothing is hosted on Maincloud (it needs `spacetime login` in a browser).

## Later (ideas, not built)
- **Spec-first team mode.** A team of four has a spec and splits the idea into four parts. Each person prompts their own Claude Code on their part, as they do today. Tandem then adds: each person says which stage they are on, shared memory tells every Claude who is on what ("Sam is on login, so you take the API"), and at the end `tandem push` submits a person's branch for testing and the manager rebases and merges them. This builds on what exists (shared memory, locks, presence); it needs a one-command way to connect a person's own Claude to the brain, stages in the shared context, and `tandem push`. Do it after the current flow passes on two real computers.
- **Normal names in the result.** Task folders may carry descriptive names while they are being worked on, but what lands in the project should look hand-made: readable branch names (not `g-0fv9rd`) and plain commit messages without task ids.

## Branches
`bilal/git-share` is on top of `bilal/join-quotes`, which carries every earlier branch. Nothing from this final stack is on `main`. The PR text is in `docs/PR.md`. Open it at https://github.com/Vibertexs/tandem/pull/new/bilal/git-share
