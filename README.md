# Tandem

**Your team's AI coders, working as one.** Tell Tandem what you want built. A manager Claude splits it into tasks, every teammate's Claude Code picks up work by itself, and nobody steps on anyone else's files. You watch it all happen on one board.

![The board while two workers are on it](docs/img/board.png)

## The problem
When a few people each run an AI coding agent on the same repo:
1. **They collide.** Two agents edit the same file, duplicate work, and drift apart.
2. **Quota is wasted.** One person is out of Claude usage while a teammate's sits unused.
3. **Nobody can see what's going on.**

## What Tandem does
- **One prompt for the whole team.** Type a goal. The manager Claude turns it into small tasks, with the exact files each one touches and what has to happen first.
- **No collisions, guaranteed.** Claiming a task locks its files in one atomic step, so two agents can never get the same task or the same file. A hook stops a Claude that tries to edit a file someone else holds.
- **Work goes to whoever has room.** Workers pull tasks themselves. A worker that hits its usage limit hands its task back, waits for the limit to reset, and comes back. A crashed one gives its files back after two minutes.
- **Stuck work comes back to you, not lost.** A worker that can't finish a task gives it back with a reason, and a different worker tries. If two can't, the board says "needs you" and why, with a **Try again** button.
- **One checked branch per goal.** When a goal's tasks are done, the manager merges them into one branch, `tandem/<goal>`, and runs your tests on it. If two tasks' changes conflict, a worker Claude resolves the conflict. If the tests fail, a worker fixes them before the goal is called done.
- **What it cost.** Every Claude run's cost is recorded, per task and per goal.
- **A live board.** Waiting → To do → In progress → Done, per goal or all together. You see who is on what, for how long, their latest note, and why each task is where it is.

| Start | A task's details |
|---|---|
| ![Host or join](docs/img/start.png) | ![Task details](docs/img/task.png) |

## Quick start
You need [Node.js](https://nodejs.org) 22.18 or newer, Git, [Claude Code](https://claude.com/claude-code), and the [SpacetimeDB CLI](https://spacetimedb.com/install) (Windows: `iwr https://windows.spacetimedb.com -useb | iex`; macOS and Linux: `curl -sSf https://install.spacetimedb.com | sh`).

Once, in the Tandem folder, put the `tandem` command on your PATH:
```
npm install -g .
```
(Or run it as `C:\path\to\tandem\tandem.cmd`, or `/path/to/tandem/tandem` on macOS and Linux.)

Then, in **your project's folder** (any git repo with a first commit):
```
tandem start
```
It starts everything for that project and opens the board. It also prints an **invite link** that other computers on your network can open:
```
  ✓ brain    started
  ✓ team     "shop"
  ✓ page     started
  ✓ manager  started: it plans every goal you type
  ✓ workers  Alex, Sam (Claude, haiku)

  Open     http://localhost:5173/?db=shop
  Invite   http://192.168.1.20:5173/?db=shop
  Stop     tandem stop
```
On the board, click **Make me the owner** (it also approves the manager), then describe what you want built. Each task becomes a headless Claude Code run in its own git worktree and branch. When the goal is done, its work is merged on one branch, `tandem/<goal>`, with your tests run on it.

Just trying it out? `tandem start --demo --simulate` uses a sample project, and the workers fake the coding (no Claude usage except one small planning run per goal).

| Command | What it does |
|---|---|
| `tandem start` | Host a team for the project you are in, open to your network. The board opens |
| `tandem start --simulate` | Same, with workers that fake the coding |
| `tandem start --local` | Only this computer can join |
| `tandem start --workers 4` | More workers on this computer (run it again any time; what runs is kept) |
| `tandem start --model auto` | Workers pick the model by task difficulty (`launcher/routing.json`) instead of always using haiku |
| `tandem start --review` | Before a goal is done, a worker Claude reviews its merged branch (read only); the findings go on the board and in the PR |
| `tandem start --push` | Push each goal's branch to origin, and open a PR if the GitHub CLI is set up |
| `tandem start --notify <webhook url>` | Post "goal done" (branch, test result, cost) to a Slack or Discord channel |
| `tandem start --accounts all` | One worker per saved account (see below) |
| `tandem join <invite>` | In your clone of the project: add this computer's workers to that team |
| `tandem account add <label> [--agent codex]` | A separate Claude Code or Codex login for a worker |
| `tandem` or `tandem status` | What is running, with each team's links |
| `tandem open` / `tandem logs` | Open this project's board / show the latest log lines |
| `tandem stop` | Stop what this computer started (`--all` stops the brain too) |

The board also works on a phone.

### Several accounts, Claude and Codex
Each worker can run under its own login, Claude Code or Codex:
```
tandem account add work1                  # opens Claude Code: /login, sign in, /exit
tandem account add school --agent codex   # opens codex login
tandem start --accounts all               # one worker per account (or --accounts work1,school)
```
Each account gets its own login folder inside the Tandem folder (`CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex), so your own login is not touched. The Team page shows which agent and account each worker runs. `tandem account list` and `tandem account remove <label>` manage them. The manager plans with Claude (`--manager-account <label>` picks which).

Codex workers run `codex exec` in the task's worktree with the tandem tools. Claude Code's lock-check hook has no Codex equivalent, so a Codex worker keeps to its files because the rules tell it to. Use each account the way its plan allows: a work account belongs to work.

### Teammates on other computers
1. The host runs `tandem start` in the project (a clone of your GitHub repo) and sends the **invite link** (it is also under **Invite**, top right of the board).
2. A teammate opens the link to watch. To add their computer's workers: `git clone` the repo, then in that folder `tandem join <invite>`. The **Team** page shows both commands.
3. Their workers push each task branch to the repo's origin. The host's manager fetches and merges them into the goal branch and runs the tests.

Everyone's Claude Code runs under their own login and quota. Without a shared repo (no origin remote), teammates can still add simulated workers or just watch.
## How it works
```
 You, in the browser       Manager Claude            A worker on each computer
 "Build a login page"      reads goals, splits       claims a task, runs Claude Code
                           them into tasks           in a git worktree, completes it
        |                         |                           |
        +-------------------------+---------------------------+
                                  v
          The brain: one shared SpacetimeDB database
          goals · tasks · file locks · workers · activity · shared memory
          claim, lock and complete happen as single atomic steps
```
Nothing talks to anything else directly. Every part reads and writes the brain, and the page updates live from it. The full picture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Folder | What is in it |
|---|---|
| `brain/` | The SpacetimeDB module (TypeScript): tables and the atomic rules |
| `mcp/` | The MCP server: the 17 tools every Claude uses (`contract/tools.json`), the worker rules skill, the lock-check hook |
| `manager/` | The manager's prompt, the watcher that plans each new goal, and the merge-and-test step that finishes it |
| `launcher/` | The worker: claims tasks, runs `claude -p` in a worktree, routes model and effort by difficulty |
| `dashboard/` | The web page (React) |
| `contract/` | The shared contract: tables, tools, result format |
| `docs/` | Architecture, status, the original spec |

## Tested
Every suite passes on the final commit. See [docs/STATUS.md](docs/STATUS.md) for the latest numbers and commands, and [docs/ROADMAP.md](docs/ROADMAP.md) for where this goes next.
- **Atomic rules:** 10 clients race for one task and exactly one wins. Lock conflicts leave no partial locks. A merge task opens exactly once.
- **MCP tools:** all 17, through the real MCP protocol, plus a mock mode.
- **The page:** the whole first-use journey in Chrome, on desktop and phone, including a task two workers give back and a worker out of quota.
- **Failure handling without Claude:** a usage limit (capped, requeued, waits, resumes), a task given back twice, a merge conflict turned into a task, failing tests turned into a task.
- **Real Claude runs:**
  - Goal → manager → two workers → done, and the workers' own tests pass.
  - A Claude blocked from editing a locked file.
  - The launcher committing work on its task branch.
  - A Claude resolving a real merge conflict, with the merged code running.
  - `tandem start` with real workers: a goal typed on the page, planned, built by two Claudes, merged into one branch, and its tests passing.

## Limits
- `tandem` is one cross-platform TypeScript file, tested end to end on Windows. It has not been tried on a Mac or Linux yet.
- Identities are saved logins on each computer (SpacetimeDB tokens), not accounts. A worker belongs to the computer that registered it, and managing the team is restricted to approved people. But anyone who can reach the brain can watch it and join as a new worker. Keep it on your machine or your network until it is hosted with a real login.
- Hosting is local or on your network. Putting the brain on SpacetimeDB's hosted Maincloud needs `spacetime login`.

Built with [SpacetimeDB](https://spacetimedb.com), the [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/), [Claude Code](https://claude.com/claude-code), React and Vite.
