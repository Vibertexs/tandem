# manager (owner: Sam)

The planner prompt and logic that splits a goal into tasks and assigns them.

## Checklist
- [ ] Finish `PROMPT.md` (fill in the [FILL] parts)
- [ ] Splitting rules: list the files each task touches, no overlapping files between parallel tasks, set difficulty
- [ ] Map-reduce: split a big job into independent map tasks plus one merge task using `create_job`
- [ ] Fixed result format for map tasks (`contract/result-format.json`)
- [ ] Assignment logic: call `get_capacity`, prefer workers with headroom, skip anyone capped or stale
- [ ] Write shared interfaces to context with `set_context` before parallel work starts

## Done when
One goal produces a sensible task list assigned across at least two workers, and one big job produces N map tasks and one blocked merge task.
