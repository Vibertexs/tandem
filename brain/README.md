# brain (owner: Bilal)

SpacetimeDB module: the shared database and its atomic operations. TypeScript. Source: `spacetimedb/src/index.ts`.

## Checklist
- [x] Hello world module published; client bindings generated and shared with `/mcp` (`bindings/`)
- [x] Tables from `contract/tables.md` (workers, tasks, locks, events, context), each with `session_id`
- [x] Reducers: register_worker, update_capacity, create_task, create_job, claim_task (atomic), take_locks (all or none), release_locks, report_progress (the `add_event` item), complete_task, set_context, reset_session, plus heartbeat, reap_stale, seed_tasks
- [x] `complete_task` unblocks dependents, and opens a job's merge task when its last map task finishes, exactly once
- [x] Seed loader from `contract/seed.json` (imported at build time, no copy); `reset_session` restores the seed workers and context for one session only. Tasks come from `seed_tasks` (see below)
- [x] Every table carries `session_id` and every reducer is scoped to one session. Clients filter their subscriptions by it

## Checkpoint (about hour 6)
Hello world published, and two clients claiming one task gives exactly one winner. Done (local only).

## How it behaves
- `claim_task` picks a task, takes its file locks and marks it claimed in one transaction. A task reserved for another worker (`assign_task` with an assignee) or with locked files is skipped and stays `open`.
- `take_locks` is all or none. A conflict rolls everything back.
- `update_capacity` caps a worker at usage 100 (or when `status: capped` is passed) and puts their running task back to `open`. Passing `status: idle` un-caps them.
- Stale workers: the MCP server sends a heartbeat every 30s. A worker silent for 2 minutes loses its locks and its task goes back to `open`. Cleanup runs whenever a live worker claims, locks or sends a heartbeat.
- `reset_session(session_id)` wipes that session and loads the seed workers (Alex, Sam, Jordan) and context. It does not load tasks: `seed_tasks(session_id, 'demo' | 'review')` adds the login tasks or the 12-piece review job. This matches `contract/scenarios.md`, where the buttons create the tasks.
- Rows are keyed `pk = "<session_id>/<id>"`, so ids and file paths only need to be unique inside one session.
- Column names are snake_case in the database (as in the contract). Generated client rows are camelCase (`usage5HPct`, `dependsOn`).

## Known limits
- `reap_stale` can be called by anyone (TODO: restrict before the database is shared).
- Any client can call any reducer and pass any `worker_id`. There is no per-worker auth yet.
- Enum-like fields are strings, only some are validated.
- Nothing is published to `tandem` or Maincloud.

## Tests
`npm test` (45 checks): 10-client race, locks, map-reduce, stale workers, session isolation, create_job, reservations, capacity, context, reset and seed.

## Run it locally
Port 3000 may be taken, so use 3001. Always pass `--server` and `--no-config`.
```
spacetime start --listen-addr 127.0.0.1:3001
spacetime server add dev3001 --url http://127.0.0.1:3001 --no-fingerprint
cd brain/spacetimedb && npm install && cd .. && npm install
spacetime publish bilal-dev --server dev3001 --no-config --module-path ./spacetimedb --yes
npm test
```
After a schema change, republish with `--delete-data=always` (dev only) and regenerate bindings:
`spacetime generate --lang typescript --out-dir ./bindings --module-path ./spacetimedb --yes`
