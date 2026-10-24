# How Tandem fits together (what is built today)

Plain words. Three parts, one shared notebook.

```
 Claude session A          Claude session B             Browser (a judge, or you)
        |                         |                              |
        | tools                   | tools                        | live view + buttons
        v                         v                              v
 +-------------+           +-------------+             +--------------------+
 | MCP server  |           | MCP server  |             | Dashboard (React)  |
 | 14 tools    |           | 14 tools    |             | + simulated workers|
 +------+------+           +------+------+             +---------+----------+
        |  brain-client.ts        |                              |
        v                         v                              v
 +------------------------------------------------------------------------+
 |  BRAIN: SpacetimeDB database (brain/)                                  |
 |  tables:   workers | tasks | locks | events | context   (+ session_id)  |
 |  rules:    claim_task, take_locks, release_locks, complete_task, ...   |
 |  Rules run one at a time, so two claims can never both win.            |
 +------------------------------------------------------------------------+
```

## The parts
- **Brain** (`brain/`): the shared notebook. Holds tasks, file locks, workers, an event log and shared notes. Its rules are the point: claiming a task, locking its files and unblocking waiting tasks each happen as one indivisible step.
- **MCP server** (`mcp/`): the buttons Claude can press. 14 tools from `contract/tools.json`. One file (`src/brain-client.ts`) talks to the database. `BRAIN_MODE=mock` swaps in an in-memory copy for building without a database.
- **Dashboard** (`dashboard/`): a live page that reads the same tables. In judge mode, simulated workers in the browser press the same buttons so anyone can try it with no setup.
- **Not built yet**: the launcher (starts real Claude runs), the manager (turns a goal into tasks), the lock-check hook, and the team-rules skill.

## One task, start to finish
1. `register_worker`: the worker joins the team.
2. `claim_task`: the brain picks an open task whose files are free, locks those files and writes the worker's name on it, all in one step.
3. The worker edits only those files. `lock_files` adds more files, all or none.
4. `report_progress` writes to the event log. A heartbeat every 30s says the worker is alive.
5. `complete_task`: the task is done, locks are freed, and any task waiting on it opens. A job's merge task opens once, when its last piece finishes.

## When things go wrong
- **Two workers claim at once:** the brain handles one first. The other gets a different task or nothing.
- **A file is already locked:** the task waits (stays `open`) until the lock is freed.
- **A worker crashes:** no heartbeat for 2 minutes, so the brain frees its locks and reopens its task.
- **A worker hits its limit (usage 100):** it is capped and its running task goes back to the queue.

## Sessions
Every row has a `session_id`. The real team uses `live`. Each judge gets their own session, so ten judges never see each other's data, and Reset only clears your own.

## Open design questions
- Who merges branches into `main`, and who resolves conflicts? Suggestion: an integrate task run by a worker Claude, escalating to a human, landing through a reviewed PR.
- Locks are not enforced yet. A Claude can still edit a locked file. That is the hook's job.
- No per-worker authentication. Any client can claim to be any worker.
- Hosting: judges need a public URL (Maincloud or a tunnel). Nothing is deployed.
