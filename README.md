<div align="center">

# Tandem

**Your team's AI coders, working as one.**

Describe what you want built. A manager plans it, every teammate's coding agent picks up work, nobody steps on anyone's files, and you get one tested branch back.

![Node](https://img.shields.io/badge/node-%E2%89%A522.18-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-everywhere-3178C6?logo=typescript&logoColor=white)
![SpacetimeDB](https://img.shields.io/badge/shared%20brain-SpacetimeDB-7c3aed)
![MCP](https://img.shields.io/badge/tools-MCP-1f2937)
![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex-d97757)
![Tests](https://img.shields.io/badge/tests-362%20passing-2ea44f)

![The board while two workers are on it](docs/img/board.png)

</div>

## The problem
When a few people each run an AI coding agent on the same repo:
1. **They collide.** Two agents edit the same file, duplicate work and drift apart.
2. **Quota is wasted.** One person is out of usage while a teammate's sits idle.
3. **Nobody can see what is going on.**

## What Tandem does
| | |
|---|---|
| **One prompt for the whole team** | Type a goal. The manager turns it into small tasks with the exact files each touches and what has to happen first. |
| **No collisions, guaranteed** | Claiming a task locks its files in one atomic step, so two agents can never get the same task or file. A hook stops a Claude that tries to edit a file someone else holds. |
| **Work goes to whoever has room** | Workers pull tasks themselves. One that hits its usage limit hands its task back, waits for the reset and returns. A crashed one gives its files back after two minutes. |
| **Stuck work comes back to you** | A worker that cannot finish gives the task back with a reason and a different worker tries. If two cannot, the board says **needs you** and why, with **Try again**. |
| **One checked branch per goal** | Finished tasks merge into `tandem/<goal>` and your tests run on it. A merge conflict or failing tests become a task a worker fixes. An optional review runs before it is called done. |
| **Claude and Codex, any accounts** | Each worker can run Claude Code or Codex under its own login. The board shows who runs what. |
| **A live board** | One lane per goal, its tasks moving Waiting → To do → In progress → Done. Who is on what, for how long, their last note, what it cost. |

| Start | A task's details |
|---|---|
| ![Host or join](docs/img/start.png) | ![Task details](docs/img/task.png) |

## How to start

### What you need (once per computer)
- [Node.js](https://nodejs.org) **22.18 or newer** (`node --version`), and Git
- [Claude Code](https://claude.com/claude-code), signed in (run `claude` once to check)
- The host also needs the [SpacetimeDB CLI](https://spacetimedb.com/install) (Windows: `iwr https://windows.spacetimedb.com -useb | iex`; macOS and Linux: `curl -sSf https://install.spacetimedb.com | sh`). Teammates do not.
- Get Tandem: `git clone https://github.com/Vibertexs/tandem`

### 1. Start Tandem on your project
Open a terminal **in your project's folder** (any git repo with a first commit) and run Tandem's launcher by its path:
```
& "C:\path\to\tandem\tandem.cmd" start   # Windows PowerShell
/path/to/tandem/tandem start             # macOS and Linux
```
That is the normal first-use command; it does not require changing `PATH` or installing Tandem globally. The browser's **Get started** page repeats it with the real project and Tandem folders on that computer.
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
The board opens on its own. Click **Control this team** (it also approves the manager). The **project host** is the computer where you ran `tandem start`; a **team controller** is an approved browser that can send goals and approve other controllers. Controller access is not a Tandem account or anyone's Claude login.

### 2. Send a goal
On the **Board**, describe what you want built and send it. The manager splits it into tasks, and each task runs as a Claude Code run in its own git worktree and branch. When the goal is done, its work is merged on one branch, `tandem/<goal>`, with your tests run on it.

### Several projects at once
Run the same command in each project's folder. Every project is its own **team** with its own board and workers (`?db=<project folder name>`), all sharing one brain and one page. `tandem status` lists them, and `tandem stop` stops all of them.

### 3. Add a teammate's computer
GitHub is not needed to share the project. Tandem shares the project host directly with the teammate, and their workers push task branches back to the host. Then:
1. Send them the **invite link** (top right of the board, **Invite**, or the `Invite` line in your terminal).
2. They need Node 22.18+, Git, Claude Code signed in, and the invite. On Windows, they paste this one block (the **Invite** box shows it with the real link):
   ```powershell
   git clone https://github.com/Vibertexs/tandem
   Set-Location tandem
   .\tandem.cmd join "<invite>"
   ```
   On macOS or Linux, use `git clone https://github.com/Vibertexs/tandem`, `cd tandem`, then `./tandem join "<invite>"`. This makes a private project copy in Tandem's work folder and starts their workers; it does not change an existing project folder.
3. Their Claude runs under their own login and quota. Their workers push each task branch straight back to the host, and the host manager merges them into the goal branch and runs the tests.

The host's project server has no separate login. Share only with people you trust, ideally through Tailscale; do not expose it on a public or shared network. `tandem start --local` keeps everything on one computer and does not share the project.

If Node is older than 22.18, `tandem` stops with a clear message and where to get a new one (https://nodejs.org, or `winget install OpenJS.NodeJS.LTS` on Windows).

**On public wifi (a hackathon, a cafe), use Tailscale.** Venue wifi often stops devices talking to each other, and anyone on it could reach an open brain. [Tailscale](https://tailscale.com/download) makes a private network between your devices:
1. Everyone installs Tailscale and signs in. The host shares their computer: Tailscale admin, **Machines**, **⋯** next to it, **Share**, and sends the link. Teammates **Accept**.
2. The host runs `tandem start` as usual. If Tailscale is running, the **Invite** is the host's Tailscale address (`100.x.y.z`) instead of the wifi address, and the venue-wifi address is printed as the other way.
3. Teammates use that invite.

If you ever type an address by hand, use the host's Tailscale address (`tailscale ip -4` prints it), not the wifi one.

## Commands
| Command | What it does |
|---|---|
| `tandem start` | Start a team for the Git project you are in, open to your network. The board opens |
| `tandem start --local` | Only this computer can join |
| `tandem start --workers 4` | More workers here (run it again any time; what runs is kept) |
| `tandem start --accounts all` | One worker per saved account (see below) |
| `tandem start --model auto` | Pick the model by task difficulty instead of always haiku |
| `tandem start --review` | A worker reviews each goal's merged branch (read only) before it is done |
| `tandem start --push` | Push each goal's branch to origin, and open a PR if the GitHub CLI is set up |
| `tandem start --notify <url>` | Post "goal done" (branch, tests, cost) to Slack or Discord |
| `tandem join <invite>` | Copy the project host's project into Tandem's private work folder and add this computer's workers |
| `tandem account add <label> [--agent codex]` | A separate Claude Code or Codex login for a worker |
| `tandem` / `tandem status` | What is running, with each team's links |
| `tandem open` / `tandem logs` | Open the board / show the latest log lines |
| `tandem stop` | Stop what this computer started (`--all` stops the brain too) |

For development, `tandem start --simulate` uses workers that fake the coding, so the coding workers need no Claude usage. Run it from a disposable Git project rather than the Tandem source folder.
### Several accounts, Claude and Codex
```
tandem account add work1                  # opens Claude Code: /login, sign in, /exit
tandem account add school --agent codex   # opens codex login
tandem start --accounts all               # one worker per account
```
Each account gets its own login folder inside the Tandem folder (`CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex), so your own login is not touched. The manager plans with Claude (`--manager-account <label>` picks which). Codex workers run `codex exec` in the task's worktree; Claude Code's lock-check hook has no Codex equivalent, so a Codex worker keeps to its files because the rules tell it to.

## How SpacetimeDB is used
[SpacetimeDB](https://spacetimedb.com) is the **brain**: a database that also runs our rules as code, and pushes every change to every connected client live. It is the one thing all the parts share.

| Role | What it gives Tandem |
|---|---|
| **One shared state** | Goals, tasks, file locks, workers, the activity log and shared memory live in one database. The page, the manager, every worker and every agent's tools read and write the same rows. |
| **Atomic rules (reducers)** | Claim a task, take its file locks and mark it claimed happens as **one transaction**. Two workers racing for a task or a file can never both win. That is what makes collisions impossible, not a convention. We test it with 10 clients at once. |
| **Live updates** | The board never polls. Clients subscribe to tables, and a task moving on one computer moves on every screen immediately. |
| **No server to write** | The rules are a TypeScript module (`brain/spacetimedb`) published to the database. There is no separate backend, queue or cache. |
| **Identities** | Every connection has a saved identity. That is how a worker belongs to the computer that registered it, and how a team controller approves another browser's controller access. |
| **One brain per team** | Each team is one database. `tandem start` publishes it, `tandem join` points other computers at it. |

## How it works
```
 You, in the browser       Manager Claude            A worker on each computer
 "Build a login page"      reads goals, splits       claims a task, runs its agent
                           them into tasks           in a git worktree, completes it
        |                         |                           |
        +-------------------------+---------------------------+
                                  v
          The brain: one shared SpacetimeDB database
          goals · tasks · file locks · workers · activity · shared memory
          claim, lock and complete happen as single atomic steps
```
Nothing talks to anything else directly. Every part reads and writes the brain, and the page updates live from it. More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Folder | What is in it |
|---|---|
| `cli/` | The `tandem` command |
| `brain/` | The SpacetimeDB module (TypeScript): tables and the atomic rules |
| `mcp/` | The MCP server: the 17 tools every agent uses (`contract/tools.json`), the worker rules skill, the lock-check hook |
| `manager/` | Plans each new goal, then merges, tests, reviews and finishes it |
| `launcher/` | The worker: claims tasks, runs Claude Code or Codex in a worktree |
| `dashboard/` | The board (React + Vite) |
| `contract/` | The shared contract: tables, tools, result format |
| `docs/` | Architecture, status, roadmap, demo script |

## Tested
`.\test.ps1` runs **11 suites, 362 checks**, none of which call an AI. [docs/STATUS.md](docs/STATUS.md) has the numbers and [docs/ROADMAP.md](docs/ROADMAP.md) what is next.
- **Atomic rules:** 10 clients race for one task and exactly one wins. Lock conflicts leave no partial locks.
- **Tools:** all 17, through the real MCP protocol, plus a mock mode.
- **The board:** the whole first-use journey in Chrome, on desktop and phone, including failures.
- **Failure handling:** a usage limit, a task given back twice, a merge conflict, failing tests.
- **Host sharing:** a second Tandem state copies a host-served project, then pushes a task branch back to it without GitHub.
- **Real Claude runs** (`.\test.ps1 -Real`): a goal planned, built by two Claudes, merged, tests passing; a Claude blocked from a locked file; a real merge conflict resolved; a teammate on another clone merged through a shared origin.

## Limits
- Tested end to end on Windows. Not yet on a Mac or Linux, or on two physical computers.
- Codex workers are tested with a stand-in, not the real Codex CLI.
- Identities are saved tokens, not accounts. Anyone who can reach the brain can watch it and join as a worker, so keep it on your machine or a private network (such as Tailscale) until it has a real login.
- Hosting is local or on your network. Putting the brain on SpacetimeDB's Maincloud needs `spacetime login`.

<div align="center">

Built with [SpacetimeDB](https://spacetimedb.com), the [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/), [Claude Code](https://claude.com/claude-code), React and Vite.

</div>
