# dashboard (owner: Omar; first version built by Bilal while solo)

Live web page and judge mode. Spec: root README sections 11 and 12. Vite, React, TypeScript. It reads the brain directly through the generated bindings in `../brain/bindings`.

## Checklist
- [x] Pick a stack: Vite + React + TypeScript, plain CSS, light and dark
- [x] Mock mode (`?mock=1`) that loads `contract/seed.json` so you can build before the brain exists
- [x] Team panel: name, plan badge, 5-hour and weekly bars, status chip (icon + text), current task, "updated Xs ago"
- [x] Task board: Open / Running / Blocked / Done, with model and effort chips, assignee, job progress bar
- [x] Locks panel and "Why this assignment?" panel
- [x] Event log in plain English, newest first
- [x] Scenario buttons and stepper (see `contract/scenarios.md`), plus Reset
- [x] Judge mode (simulated workers) with a visible "Simulated workers" badge, and Live mode (`?mode=live`, read-only view of session `live`, nothing simulated). Live mode was not tried with real Claude workers feeding the page yet
- [x] Per-judge sessions (`session_id`): each browser tab gets its own session and sandbox
- [x] Mobile layout: tabs Team | Tasks | Locks | Log, sticky bottom scenario bar, tap targets of at least 44px
- [x] `?view=present` for big type and no controls
- [ ] Fallback: if the brain is unreachable, show a banner and play a prerecorded run. Done so far: the banner, and a still picture of the seed data. No prerecorded run plays
- [x] QR code for the public URL (the Share button makes one for the current page URL)
- [ ] After the base works (about hour 10): team-rules skill and lock-check hook in `/mcp`

## Checkpoint (about hour 6)
A static dashboard with fake data that works on a phone. Done (`?mock=1`), and it also runs live against the brain.

## Done when
A stranger completes the judge flow on their phone with no help, and the page updates in real time with no refresh. Real-time updates and the flow are tested with a scripted browser. The "stranger on a phone with no help" part has not been tried with a real person.

## How it works
- Judge mode: a new tab gets a session id, the brain loads the seed teammates (Alex, Sam, Jordan), and simulated workers run in the browser. They claim, "work" for a few seconds and complete tasks through the real brain, so locks, queueing and unblocking are all real. Only the coding is faked.
- The scenario buttons are a few brain calls each (`src/scenarios.ts`). "Run the demo" and "Run map-reduce" add the seed tasks. "Make Sam hit a limit" sets usage to 100, which caps Sam and requeues their task. "Same file" adds two tasks on one file. "Goes idle" frees the busiest teammate and reserves an urgent task for them.
- Reset only wipes your own session.
- Never a dead end: if the brain does not answer in 6 seconds, a banner appears and the seed data is shown with controls off.

## Run it
```
cd brain && npm install && cd ../dashboard && npm install
# brain running locally with bilal-dev published (see brain/README.md)
npm run dev                       # http://localhost:5173
npm run build && npm run preview  # production build
```
URL options: `?mode=live`, `?view=present`, `?mock=1`, `?uri=ws://host:3000&db=name`. Defaults can also be set with `VITE_STDB_URI` and `VITE_STDB_DB`.

## Tests
- `npm test`: every scenario against the real brain, using the same simulator as the browser (24 checks).
- `npm run test:ui`: the real page in Chrome via playwright-core, desktop and phone size (38 checks). Needs `npm run build && npm run preview -- --port 4173`, and Chrome. Set `SHOTS=<folder>` to save screenshots.

## Known limits
- The simulator runs in the page. If a judge closes the tab mid-run, their sandbox stops moving until they come back.
- Anyone can point `?uri=` at any server. Harmless, but not locked down.
- Nothing is deployed. Judges need a public URL, so the brain and this page still need hosting.
