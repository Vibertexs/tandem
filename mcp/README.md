# mcp (owner: Bilal; skill and hook: Omar)

MCP server that exposes the brain to every Claude as tools.

## Checklist
- [ ] Pick a language and MCP SDK (check current docs)
- [ ] Server skeleton that registers every tool in `contract/tools.json`
- [ ] Thin brain client module (all database access goes through it)
- [ ] **Mock mode** (`BRAIN_MODE=mock`): tools return canned data from `contract/seed.json`, so Sam and Omar can build without the real brain
- [ ] Register the server with Claude Code (`claude mcp add`, check the docs for the exact syntax)
- [ ] Team-rules skill: `skill/SKILL.md` (Omar, about hour 10)
- [ ] Lock-check hook: `hook/` (Omar, about hour 10)

## Checkpoint (about hour 6)
Every tool is callable from a real Claude Code session against the mock.

## Done when
A Claude Code session can call every tool, and the hook blocks an edit on a locked file.
