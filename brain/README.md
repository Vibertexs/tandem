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
