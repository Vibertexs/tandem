---
name: tandem-worker
description: Team rules for a Claude Code agent working on a shared repo with Tandem. Use when you are one of several agents on this repo and the tandem MCP tools are available - claim a task before editing, only touch that task's files, respect file locks, report progress, and complete the task.
---

# Working as part of a Tandem team

You are one of several agents working on this repo at the same time. A shared brain coordinates you through the `tandem` MCP tools. Follow these rules exactly.

## Start
1. Call `register_worker` once, with the name and plan you were given (`pro` or `max`).
2. Call `get_context` once. It holds the project summary, shared interfaces and decisions. Follow them.

## Each task
3. Call `claim_task`.
   - If it returns a task, that task is yours. Its `files` are already locked for you.
   - If it returns `null`, call `get_status`. If tasks are still waiting or being worked on by others, call `get_status` again, then `claim_task` again. Stop after 8 empty tries in a row, or as soon as every task is `done`.
   - If it says you already have a task, finish that one first (`get_status` shows it).
4. Call `report_progress(task_id, "started")`.
5. Do exactly what `task.description` says. Create or edit **only** the files in `task.files`, using paths relative to the repo root.
6. Need another file? Call `lock_files(task_id, [path])` first.
   - `ok: true`: you may edit it.
   - `ok: false`: another task holds it (`held_by`). Do **not** edit it and do not work around it. Call `report_progress(task_id, "blocked: <path> is held by <held_by>")` and finish the rest of your task without that file.
7. Call `report_progress(task_id, "halfway")` when you are about half done.
8. Never edit shared interfaces from `get_context`. If one is wrong, say so in a `report_progress` message.
9. When finished, call `complete_task` with:
   - `branch`: the git branch you worked on, or `"none"`,
   - `summary`: one line saying what you did,
   - `result`: only for a map task (`task.kind == "map"`): `{"status": "ok" | "failed", "files_touched": [...], "findings": [{"file", "severity": "low|medium|high", "note"}], "notes": ""}` (see `contract/result-format.json`).
10. Can't finish it (the task is impossible as written, or something you need is broken)? Call `give_back_task(task_id, "<what went wrong, in one line>")` instead of `complete_task`. A different worker gets it next. Never mark a task done that isn't.
11. Go back to step 3.

## Merge tasks
If `task.kind == "reduce"`, call `get_job_results(task.job_id)` and combine those results into the task's files. Do not re-read the whole repo.

## Finish
When there is nothing left to claim, finish with one line: the ids of the tasks you completed.
