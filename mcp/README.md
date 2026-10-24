# mcp (owner: Bilal; skill and hook: Omar)

MCP server that exposes the brain to every Claude as tools. TypeScript, stdio, MCP SDK v2. Source: `src/`.

## Checklist
- [x] Pick a language and MCP SDK (check current docs): TypeScript, `@modelcontextprotocol/server` v2 (see NOTES.md)
- [x] Server skeleton that registers every tool in `contract/tools.json` (all 14, `src/server.ts`)
- [x] Thin brain client module (all database access goes through it): `src/brain-client.ts`
- [x] **Mock mode** (`BRAIN_MODE=mock`): in-memory brain loaded from `contract/seed.json`, no database needed (`src/mock-brain.ts`)
- [ ] Register the server with Claude Code (`claude mcp add`, check the docs for the exact syntax). The real-Claude test uses `--mcp-config` instead; `claude mcp add` itself is not tested yet
- [ ] Team-rules skill: `skill/SKILL.md` (Omar, about hour 10)
- [ ] Lock-check hook: `hook/` (Omar, about hour 10)

## Checkpoint (about hour 6)
Every tool is callable from a real Claude Code session against the mock. The mock is tested through the MCP protocol (`npm run test:mock`). Real headless Claude runs are tested against the real brain, not the mock (`test/e2e`).

## Done when
A Claude Code session can call every tool, and the hook blocks an edit on a locked file. The hook is not built.

## Manager tools in the live session
`assign_task`, `create_job` and `set_context` only work in the `live` session for an operator. Run `npm run whoami` here, then paste the identity into the dashboard (live mode, "Authorize another identity"). Until then those tools return a plain error that says so. Worker tools need no authorization.

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
| `TANDEM_SESSION` | `live` | session id (judges use their own) |
| `TANDEM_WORKER_ID` | (none) | skip `register_worker` |
| `HEARTBEAT_MS` | `30000` | |
| `TANDEM_TOKEN_FILE` | `mcp/.tandem/token-<db>` | where the server saves its login, so its identity stays the same |

Real-Claude test: `powershell -File mcp/test/e2e/run.ps1` (two headless `claude -p` haiku runs, uses a little quota, edits only a throwaway repo). Passed 3 times: two workers, three tasks, two sharing a file, no overlap.

Register with Claude Code for interactive use (not tested): `claude mcp add tandem -- node --import tsx <repo>/mcp/src/server.ts` (check `claude mcp add --help` for scope and env flags).
