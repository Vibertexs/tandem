<div align="center">

# Tandem

**Your team's Claude Codes, working as one.**

Give Tandem one outcome. It splits the work across your team's agents, keeps their files from colliding, and returns one tested branch when the goal is finished.

[![Node.js 22.18 or newer](https://img.shields.io/badge/node-%E2%89%A5%2022.18-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6?style=flat&logo=typescript&logoColor=white)](docs/ARCHITECTURE.md)
[![SpacetimeDB](https://img.shields.io/badge/brain-SpacetimeDB-7c3aed?style=flat)](https://spacetimedb.com)
[![Claude Code](https://img.shields.io/badge/agents-Claude%20Code-d97757?style=flat&logo=claude&logoColor=white)](https://claude.com/claude-code)

[Get started](docs/GETTING_STARTED.md) · [Dashboard tour](docs/DASHBOARD_TOUR.md) · [Help & troubleshooting](docs/HELP.md) · [Architecture](docs/ARCHITECTURE.md) · [Project status](docs/STATUS.md)

<img src="docs/img/board.png" alt="The Tandem Board: a goal lane with tasks in Waiting, To do, In progress and Done" width="900">

</div>

## What it does

- **Plans one goal into safe, parallel tasks.** The conductor gives every task a file list and dependencies.
- **Stops agents from touching the same file.** Claiming a task and locking its files is one database transaction; a Claude Code hook checks edits too.
- **Shows the team’s work live.** See each goal, worker, locked file, progress note, usage, and result in one shared dashboard.
- **Hands back a tested branch.** Work happens in separate git worktrees, merges into `tandem/<goal>`, then runs the project’s tests before you merge it into your branch.

## Start in three steps

1. Follow the one-time setup in [Getting started](docs/GETTING_STARTED.md).
2. In any Git project with a commit, run:

   ~~~powershell
   tandem --start
   ~~~

3. Send a goal from the Board. Share the printed invite when a teammate is ready to add workers.

The conductor runs the project, the planning Claude, and the shared coordination service. Teammates join from another computer and lend their own Claude Code workers. GitHub is optional: Tandem shares task branches directly between the team’s computers.

## Find what you need

| If you want to… | Start here |
|---|---|
| Install Tandem, start a team, join one, or try it safely | [Getting started](docs/GETTING_STARTED.md) |
| See what every dashboard page looks like | [Dashboard tour](docs/DASHBOARD_TOUR.md) |
| Look up commands, options, accounts, or common fixes | [Help & troubleshooting](docs/HELP.md) |
| Understand the locks, workers, model routing, and merge flow | [Architecture](docs/ARCHITECTURE.md) |
| Present the project or check its current evidence and limits | [Demo script](docs/DEMO.md) · [Status](docs/STATUS.md) |
| See future work | [Roadmap](docs/ROADMAP.md) |

## A quick mental model

`You send a goal → Conductor Claude plans it → workers claim non-overlapping tasks → Tandem merges and tests the result.`

The Board is only for active work. Finished goals move to **Activity**, where the result, branch, cost, files, and **Merge into my project** action stay together. The [dashboard tour](docs/DASHBOARD_TOUR.md) walks through that flow with screenshots.

## Before you invite people

Tandem is designed for a home network or Tailscale, not the public internet. Everyone uses their own Claude Code login; Tandem never shares those logins. Read the [network and access details](docs/ARCHITECTURE.md#how-teammates-join) before opening a team beyond your local computer.

## Verification

Run the full automated suite with:

~~~powershell
.\test.ps1
~~~

Current validation, known limits, and real-run notes live in [Status](docs/STATUS.md). The project was built at Cal Hacks by Bilal ([@Vibertexs](https://github.com/Vibertexs)).
