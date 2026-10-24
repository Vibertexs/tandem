# Tables (PROPOSED)

Every table has `session_id` (string). Judge mode uses one session per judge. Live mode uses `live`.

## workers
| Column | Type | Notes |
|---|---|---|
| id | string | |
| name | string | |
| plan | `pro` or `max` | declared at registration |
| status | `idle`, `busy`, `capped` | |
| usage_5h_pct | number 0-100 or null | null = unknown |
| usage_week_pct | number 0-100 or null | |
| reset_at | timestamp or null | when the cap lifts |
| last_seen | timestamp | treat old values as unknown |

## tasks
| Column | Type | Notes |
|---|---|---|
| id | string | |
| job_id | string or null | set for map and reduce tasks |
| kind | `normal`, `map`, `reduce` | reduce = the merge task |
| title | string | |
| description | string | |
| files | string[] | files this task will touch (used for locks) |
| difficulty | `easy`, `normal`, `hard` | PROPOSED values |
| model | string | alias like `haiku`, `sonnet`, `opus` |
| effort | string | `default` or a level; check `/effort` on each machine |
| status | `open`, `blocked`, `claimed`, `done`, `failed` | blocked = waiting on depends_on |
| assignee | worker id or null | |
| branch | string or null | |
| depends_on | task id[] | |
| result | JSON or null | map tasks: see result-format.json |
| result_summary | string or null | |

## locks
| Column | Type |
|---|---|
| path | string |
| task_id | string |
| worker_id | string |
| created_at | timestamp |

## context
| Column | Type | Notes |
|---|---|---|
| key | string | e.g. `project_summary`, `interfaces`, `decisions` |
| value | string | keep short; every map task reads it |

## events
| Column | Type | Notes |
|---|---|---|
| id | string | |
| timestamp | timestamp | |
| worker_id | string or null | |
| type | string | PROPOSED: task_created, task_assigned, task_claimed, progress, task_done, task_failed, lock_taken, lock_blocked, lock_released, worker_capped, worker_idle, job_progress, merge_unblocked |
| message | string | plain English; shown in the dashboard log |

## goals
| Column | Type | Notes |
|---|---|---|
| id | string | |
| text | string | what the operator asked for, in plain words |
| status | `new`, `planning`, `planned` | the manager moves it along |
| created_at | timestamp | |

## Rules
- Claiming a task and taking locks are atomic: one winner, no partial locks.
- Completing a task unblocks anything whose `depends_on` is now all done. For a job, the merge task opens when every map task is done, exactly once.
- Reducers do not return data. Callers read results from the tables.
