---
name: team-brain
description: Use when working as one of several Claude Code agents on this shared repo. Claim tasks, respect file locks, and report progress through the team-brain tools.
---

# Team rules

You are one of several agents working on this repo at the same time. Follow these rules:

1. At the start of a task, call `get_context` to read the shared summary and interfaces.
2. Only work on the task you were assigned. Do not edit files outside that task's file list.
3. Call `lock_files` for every file before you edit it. If a lock fails, stop, call `report_progress` saying you are blocked and by whom, and wait. Do not work around it.
4. Work only on your task's branch or worktree.
5. Call `report_progress` at each milestone (started, halfway, tests running, done).
6. Do not change shared interfaces (the `interfaces` entry in the context). If one needs to change, report it and let the manager decide.
7. When finished, call `complete_task` with the branch, a short summary, and (for map tasks) a `result` that follows `contract/result-format.json`. Then call `release_files`.
8. If you are the merge task, call `get_job_results` and combine the results into one output. Do not re-read the whole repo.

TODO(Omar): confirm where Claude Code expects skills to live (for example `.claude/skills/`) and move this file there.
