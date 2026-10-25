# Help & troubleshooting

Use the dashboard’s **Help** page when you want a copy button. Use this page when you want the short explanation beside the command.

## Commands

| Command | What it does |
|---|---|
| `tandem --start` | Start a team in the current Git project. This computer becomes the conductor. |
| `tandem join "<invite>"` | Join a conductor’s team and add workers from this computer. |
| `tandem` or `tandem -d` | Open the dashboard. |
| `tandem status` | List the teams running on this computer and their links. |
| `tandem logs [part]` | Show recent logs for everything or one part, such as `conductor` or a worker name. |
| `tandem stop` | Stop services this computer started; the shared service stays available. |
| `tandem stop --all` | Also stop the shared service. |
| `tandem doctor` | Check for missing prerequisites without changing anything. |
| `tandem install` / `tandem uninstall` | Add or remove Tandem from this user’s PATH. |
| `tandem account add <label>` | Add a separate Claude Code login for workers. |
| `tandem account list` / `tandem account remove <label>` | Inspect or remove saved worker logins. |
| `tandem --help` | Print the command list. |

`tandem start` and `tandem --start` mean the same thing.

## Start options

| Option | Use it when… |
|---|---|
| `--workers N` | This computer should run a different number of workers. |
| `--local` | The team must stay on this computer. |
| `--team NAME` | You want to name the team explicitly. |
| `--fresh` | You want to clear the board, goals, tasks, and shared notes. Your project and branches are not touched; teammates must join again. |
| `--push` | Tandem should push task and goal branches to `origin` and create a GitHub pull request when the GitHub CLI is available. |
| `--review` | A worker should review the completed goal before it finishes. |
| `--model NAME` | Every task should use one specific model. |
| `--conductor-model NAME` | The planning Claude should use one specific model. |
| `--notify URL` | A completed goal should post to a Slack or Discord webhook. |
| `--accounts all\|a,b` | Run one worker per named saved account instead of `--workers`. |
| `--conductor-account A` | Choose the saved account used by the conductor. |
| `--no-browser` | Start without opening the dashboard. |

`tandem join` also accepts `--workers N`, `--accounts`, and `--repo <path>`. The last option uses your own existing clone instead of Tandem’s private copy.

## Separate worker accounts

By default, a worker uses the computer owner’s Claude Code login. To make workers use separate sign-ins:

~~~powershell
tandem account add work1
tandem account add personal
tandem --start --accounts all
~~~

Each saved login has its own Tandem-owned configuration folder; your usual Claude Code login is left alone.

`tandem account add school --agent codex` creates an experimental Codex worker. Claude Code is the supported agent today; Codex has only been tested with a stand-in.

## Common fixes

| What you see | What to do |
|---|---|
| The dashboard at `localhost:5173` does not load | Start the team in the project with `tandem --start`. |
| “Tandem needs Node.js 22.18 or newer” | Install the current Node LTS, then open a new terminal. |
| `tandem` is not recognized | Open a new terminal after `tandem install`, or run `& 'C:\path\to\tandem\tandem.cmd' --start`. |
| The folder is not a Git project, or has no commit | Run Tandem inside a Git repository after making its first commit. |
| A teammate cannot reach the conductor | Confirm both computers share a network or Tailscale, and that the conductor did not use `--local`. |
| The conductor is not sharing the project | On the conductor’s computer, run `tandem stop`, then `tandem --start` without `--local`. |
| Setup fails after an update | Run `tandem --start --fresh`. This clears Tandem’s board, not the project. |
| You are unsure what failed | Run `tandem doctor`, then `tandem logs`. |

## Safety and access

Tandem is for a trusted home network or Tailscale. Do not expose its dashboard or project-sharing service directly to the public internet. The conductor chooses who gets the invite; every worker uses its own local Claude Code login. More detail is in [Architecture](ARCHITECTURE.md#how-teammates-join).
