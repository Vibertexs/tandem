# dashboard (owner: Omar)

Live web page and judge mode. Spec: root README sections 11 and 12.

## Checklist
- [ ] Pick a stack (anything you can ship fast, as long as it works on a phone)
- [ ] Mock mode (`?mock=1`) that loads `contract/seed.json` so you can build before the brain exists
- [ ] Team panel: name, plan badge, 5-hour and weekly bars, status chip (icon + text), current task, "updated Xs ago"
- [ ] Task board: Open / Running / Blocked / Done, with model and effort chips, assignee, job progress bar
- [ ] Locks panel and "Why this assignment?" panel
- [ ] Event log in plain English, newest first
- [ ] Scenario buttons and stepper (see `contract/scenarios.md`), plus Reset
- [ ] Judge mode (simulated workers) with a visible "Simulated workers" badge, and Live mode (`?mode=live`)
- [ ] Per-judge sessions (`session_id`)
- [ ] Mobile layout: tabs Team | Tasks | Locks | Log, sticky bottom scenario bar, tap targets of at least 44px
- [ ] `?view=present` for big type and no controls
- [ ] Fallback: if the brain is unreachable, show a banner and play a prerecorded run
- [ ] QR code for the public URL
- [ ] After the base works (about hour 10): team-rules skill and lock-check hook in `/mcp`

## Checkpoint (about hour 6)
A static dashboard with fake data that works on a phone.

## Done when
A stranger completes the judge flow on their phone with no help, and the page updates in real time with no refresh.
