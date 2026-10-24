# mcp (owner: Bilal; skill and hook: Omar)

MCP server that exposes the brain to every Claude as tools.

## Checklist
- [x] Pick a language and MCP SDK (check current docs): TypeScript, `@modelcontextprotocol/server` v2 (see NOTES.md)
- [ ] Server skeleton that registers every tool in `contract/tools.json` (6 of 14 done: register_worker, claim_task, lock_files, release_files, complete_task, get_status)
- [x] Thin brain client module (all database access goes through it): `src/brain-client.ts`
- [ ] **Mock mode** (`BRAIN_MODE=mock`): tools return canned data from `contract/seed.json`, so Sam and Omar can build without the real brain
- [ ] Register the server with Claude Code (`claude mcp add`, check the docs for the exact syntax)
- [ ] Team-rules skill: `skill/SKILL.md` (Omar, about hour 10)
- [ ] Lock-check hook: `hook/` (Omar, about hour 10)

## Run it
```
cd brain && npm install && cd ../mcp && npm install
npm test        # needs the local server and an empty bilal-dev DB, see test/mcp.test.ts
npm start       # stdio server; env STDB_URI, STDB_DB, TANDEM_WORKER_ID
```
Real-Claude test (two headless `claude -p` haiku runs, uses a little quota, edits only a throwaway repo): `powershell -File mcp/test/e2e/run.ps1` on an empty `bilal-dev`. It passed once: two workers, three tasks, two of them on the same file, no overlap. `claude mcp add` was not needed for it.

Register with Claude Code for interactive use (not done or tested yet): `claude mcp add tandem -- node --import tsx <repo>/mcp/src/server.ts` (check `claude mcp add --help` for scope and env flags).

## Checkpoint (about hour 6)
Every tool is callable from a real Claude Code session against the mock.

## Done when
A Claude Code session can call every tool, and the hook blocks an edit on a locked file.
