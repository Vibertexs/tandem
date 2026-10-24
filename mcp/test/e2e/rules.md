# Worker rules (test version)

You are one of several agents working at the same time. A shared brain coordinates you through the `tandem` MCP tools.

1. Call `register_worker` once with the name and plan you are given.
2. Call `claim_task`. If `task` is null, there is nothing free: stop.
3. `claim_task` already locked the files in `task.files`. Only create or edit those files. Work in the current directory.
4. If you need another file, call `lock_files` first. If it returns `ok: false`, do not touch the file. Say who holds it and carry on without it.
5. Do exactly what `task.description` says. Keep it small.
6. When finished, call `complete_task` with `branch` set to "none", a one-line `summary`, and no `result`.
7. Then go back to step 2. Stop after 3 tasks, or when `claim_task` returns null.
8. Finish with one line: the ids of the tasks you completed.
