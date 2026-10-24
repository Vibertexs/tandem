# brain (owner: Bilal)

SpacetimeDB module: the shared database and its atomic operations.

## Checklist
- [ ] Hello world module published; client bindings generated and shared with `/mcp`
- [ ] Tables from `contract/tables.md`
- [ ] Reducers: register_worker, update_capacity, create_task, create_job, claim_task (atomic), take_locks (all or none), release_locks, add_event, complete_task, set_context, reset_session
- [ ] `complete_task` unblocks dependents, and opens a job's merge task when its last map task finishes, exactly once
- [ ] Seed loader from `contract/seed.json`; `reset_session` restores it for one session only
- [ ] Every table filtered by `session_id`

## Checkpoint (about hour 6)
Hello world published, and two clients claiming one task gives exactly one winner.

## Done when
- Two clients claiming the same task at once: one winner
- A lock conflict is rejected with no partial locks
- Finishing the last map task opens the merge task exactly once

## Notes
- Reducers do not return data. Callers read results from the tables.
- Reducers are deterministic: no network, no file access.
- Keep all database access behind one thin client module in `/mcp` so the database can be swapped if SpacetimeDB blocks the team by hour 6.
- Post a stub of the tables and tools in hours 0-2. Sam and Omar depend on it.

## Progress (POC, local only)
Built and tested on a local server (`bilal-dev`). Not published to `tandem` yet.
- Tables: workers, tasks, locks, events. Still missing: `context`, `session_id`.
- Reducers: register_worker, create_task, claim_task, complete_task. Still missing: take_locks, release_locks, update_capacity, create_job, add_event, set_context, reset_session, seed loader.
- `claim_task` picks a task, takes its file locks and marks it claimed in one transaction. A task whose files are locked stays `open`.
- `complete_task` releases locks and opens blocked tasks whose `depends_on` are all done.
- Tests (`brain/test/brain.test.ts`): 10 clients race for one task (one winner), overlapping files wait, merge task opens exactly once.
- Column names are snake_case in the database (as in the contract). Generated client rows are camelCase.
- Bindings are generated into `bindings/`. Regenerate with `spacetime generate --lang typescript --out-dir ./bindings --module-path ./spacetimedb --yes`.

## Run it locally
Port 3000 may be taken, so use 3001. Always pass `--server` and `--no-config`.
```
spacetime start --listen-addr 127.0.0.1:3001
spacetime server add dev3001 --url http://127.0.0.1:3001 --no-fingerprint
cd brain/spacetimedb && npm install && cd .. && npm install
spacetime publish bilal-dev --server dev3001 --no-config --module-path ./spacetimedb --delete-data=always --yes
npm test
```
