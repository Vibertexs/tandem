# Getting started

Tandem has two roles:

- **Conductor:** the person and computer that run `tandem --start` in the project. This computer holds the project, plans goals, and merges completed work.
- **Teammate:** another computer that joins with an invite and contributes its own Claude Code workers.

Windows is verified. macOS and Linux should use the same steps with `./tandem install` and `./tandem --start`, but have not yet been tested.

## What you need

| You need | Who needs it |
|---|---|
| Node.js 22.18+ and Git | Everyone |
| Claude Code, signed in | Everyone who runs workers |
| SpacetimeDB CLI | The conductor |
| Tailscale | Only teammates on a different network |

Install Node from [nodejs.org](https://nodejs.org), Git from [git-scm.com](https://git-scm.com/downloads), Claude Code from [claude.com/claude-code](https://claude.com/claude-code), and SpacetimeDB from [spacetimedb.com/install](https://spacetimedb.com/install). Run `claude` once and sign in before starting a team.

## One-time Tandem setup

On each computer that will run Tandem:

~~~powershell
git clone https://github.com/Vibertexs/tandem
cd tandem
.\tandem.cmd install
~~~

Open a new terminal so it sees the updated PATH, then check the computer:

~~~powershell
tandem doctor
~~~

The first `tandem --start` or `tandem join` installs Tandem’s own packages and can take a few minutes. To update Tandem later, run `git pull` in this folder.

## Start a new project

For a clean test project, use one Tandem command:

~~~powershell
tandem init C:\Code\tandem-try
~~~

It creates the folder, initializes Git, makes the first empty commit, and starts Tandem. It also works in a folder you already made, as long as that folder is empty. It refuses a folder with files in it, so it cannot accidentally add Git files to another project.

Already made an empty folder? Open it and run `tandem --start`. Tandem sees that it is empty and makes it a Git project for you.

## Start a team for an existing project

Tandem needs a Git project. Move to one with at least one commit, then run:

~~~powershell
cd C:\path\to\your-project
tandem --start
~~~

Tandem starts the shared service, dashboard, conductor, and one worker; then opens the Board and prints an invite link. Send a goal, choose Low, Medium, or High effort, and press **Send**.

Each task works in its own git worktree. Your project is unchanged while work is running. When a goal finishes, Tandem creates `tandem/<goal>`, runs your tests, and the dashboard offers **Merge into my project**.

## Add a teammate

Give the teammate the invite from the dashboard’s **Invite** button or the startup output. After their one-time setup, they run:

~~~powershell
tandem join "http://100.x.y.z:5173/?db=your-project"
~~~

Tandem makes a private copy of the conductor’s project on their computer and starts their workers. No GitHub repository is required.

If you are on separate networks, both people need Tailscale. Share the conductor’s computer through Tailscale, then start Tandem normally (without `--local`) so its `100.x.y.z` invite is available.

## Day to day

~~~powershell
tandem                   # open the dashboard
tandem status            # see active teams and links
tandem logs conductor    # inspect one component's latest logs
tandem stop              # stop this computer's local services
tandem stop --all        # also stop the shared service
~~~

For every command, option, account workflow, and common fix, see [Help & troubleshooting](HELP.md).

## Try it safely

Use `tandem init C:\Code\tandem-try` above, then use a small Low-effort goal:

On the Board, choose **Low** and send:

> Create a tiny Python calculator: calc.py with add and sub, test_calc.py with unittest tests, and a README.md.

Watch its lane populate, open a task card to see its files and worker, then use `tandem stop` when you are done. The [dashboard tour](DASHBOARD_TOUR.md) explains what to look for.
