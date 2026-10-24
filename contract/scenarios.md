# Judge-mode scenarios (historical)

> These were the demo buttons in the original plan. The page no longer has them: the product itself is the demo (`.\start.ps1 -Simulate`, see `docs/DEMO.md`). Each scenario still happens for real: a usage limit caps a worker and requeues its task, a locked file makes a task wait, and so on. The brain still has `reset_session` and `seed_tasks`, which the tests and the `?mock=1` sample board use.

Each button is a few writes to the brain using existing tools. No special scenario reducers are needed except `reset_session`.
Simulated workers (launcher `--simulate`) do the "work" with timed progress.

| Button | What it writes | What the judge sees |
|---|---|---|
| **Run the demo** | Manager creates the login goal tasks from seed (`t-login-*`) | Tasks appear, flow out to workers, dependent tasks unlock in order |
| **Run map-reduce** | `create_job` with the 12 review tasks and one merge task | Progress bar 0/12 to 12/12, then the merge card unlocks and a combined report appears |
| **Make Sam hit a limit** | `report_capacity` for Sam with usage 100 and status capped; running task requeued | Sam's bar fills, status flips to capped, the task moves to someone with headroom |
| **Make two agents edit the same file** | Two open tasks listing the same file, claimed by two workers | One gets the lock, the other shows Blocked; locks panel and log say why |
| **Teammate goes idle** | Set a worker to idle with low usage | The next open task routes to them immediately |
| **Reset** | `reset_session(session_id)` reloads `seed.json` for this session only | Everything returns to the start in under a second |

Every action must show a visible reaction within 1 second and a plain-English log line.
