# mcp (owner: Bilal; skill and hook: Omar)

> Normally you don't run this yourself: `tandem start` in your project starts the manager and workers, and they start this server for each Claude run.

MCP server that exposes the brain to every Claude as tools. TypeScript, stdio, MCP SDK v2. Source: `src/`.

## Checklist
- [x] Pick a language and MCP SDK (check current docs): TypeScript, `@modelcontextprotocol/server` v2 (see NOTES.md)
- [x] Server skeleton that registers every tool in `contract/tools.json` (all 17, `src/server.ts`)
- [x] Thin brain client module (all database access goes through it): `src/brain-client.ts`
- [x] **Mock mode** (`BRAIN_MODE=mock`): in-memory brain loaded from `contract/seed.json`, no database needed (`src/mock-brain.ts`)
- [ ] Register the server with Claude Code (`claude mcp add`, check the docs for the exact syntax). The real-Claude test uses `--mcp-config` instead; `claude mcp add` itself is not tested yet
- [x] Team-rules skill: `skill/SKILL.md` (written by Bilal while solo). Copy it to `.claude/skills/tandem-worker/SKILL.md` in the repo a worker works on; headless runs get it in their prompt. Used by the real full-loop test
- [x] Lock-check hook: `hook/check-lock.mjs` (built by Bilal while solo). Blocks a real Claude editing a locked file (`test/e2e/hook-real.ps1`); unit test `npm run test:hook`

## Checkpoint (about hour 6)
Every tool is callable from a real Claude Code session against the mock. The mock is tested through the MCP protocol (`npm run test:mock`). Real headless Claude runs are tested against the real brain, not the mock (`test/e2e`).

## Done when
A Claude Code session can call every tool, and the hook blocks an edit on a locked file. Both done.

## Manager tools in the live session
`assign_task`, `create_job`, `set_context` and `mark_goal` only work in the `live` session for an operator. A manager asks for that itself: the page shows "Manager Claude wants to help manage this team", and the owner clicks **Approve** (the first time, "Make me the owner" does it in the same click). Until then those tools return a plain error that says so.

Worker tools need no approval, but a worker belongs to the identity that registered it: only that identity (or an operator) may claim, lock, complete, give back or report for it.

## Run it
```
cd brain && npm install && cd ../mcp && npm install
npm run test:mock   # no database needed
npm test            # needs the local server and bilal-dev published, see brain/README.md
npm start           # stdio server
npm run whoami      # prints this machine's identity
npm run test:operator  # publishes a fresh bilal-auth DB itself
```
Env for `npm start`:

| Var | Default | |
|---|---|---|
| `BRAIN_MODE` | (real) | `mock` = in-memory, no database |
| `STDB_URI` | `ws://127.0.0.1:3001` | |
| `STDB_DB` | `bilal-dev` | database name |
| `TANDEM_SESSION` | `live` | session id (the page shows `live`; tests use their own) |
| `TANDEM_WORKER_ID` | (none) | skip `register_worker` |
| `HEARTBEAT_MS` | `30000` | |
| `TANDEM_TOKEN_FILE` | `mcp/.tandem/token-<db>` | where the server saves its login, so its identity stays the same |

**Full loop** (the headline test): `powershell -File mcp/test/e2e/loop.ps1`. Posts a goal, runs the real manager, runs two real workers, checks nothing collided and their tests pass, then checks the dashboard (needs `npm run dev` in `dashboard/`). 3 haiku runs. Passed on the first try.

Two-worker test: `powershell -File mcp/test/e2e/run.ps1` (two headless `claude -p` haiku runs, uses a little quota, edits only a throwaway repo). Passed 3 times: two workers, three tasks, two sharing a file, no overlap.

Register with Claude Code for interactive use (not tested): `claude mcp add tandem -- node --import tsx <repo>/mcp/src/server.ts` (check `claude mcp add --help` for scope and env flags).
