# dashboard (owner: Omar; first version built by Bilal while solo)

One web page for Tandem. Spec: root README sections 11 and 12. Vite, React, TypeScript. It reads the brain directly through the generated bindings in `../brain/bindings`.

## How it works
One page, one flow: **say what you want, then watch it happen.**

1. **Prompt box** at the top: "What should your team build?"
2. **Progress summary**: "3 of 13 tasks done", a bar, and counts for waiting / ready / working / done.
3. **Task board** in four stages, left to right: **Waiting** (needs other tasks first) → **Ready** (free) → **Working** (a teammate is on it: who, how long, a moving strip, their last progress note) → **Done** (finished by whom).
4. Team (usage bars, current task), locked files, "Why this assignment?", and a plain-English log.

A switch in the header chooses the session:
- **Demo** (default): your own private sandbox with simulated workers, so anyone can try it with no setup. The coordination is real, only the coding is faked. Typing a goal makes one task; the example chips start a login build or a 12-piece review. "Make Sam hit a limit", "same file", "goes idle" and Reset are here.
- **My team** (`?mode=team`): the real session. No simulation. The first visitor presses **Claim this team** and becomes the operator. Operators type goals into the prompt box; a goal is saved and waits for the manager Claude to plan it. **Add a teammate** shows the exact command for a teammate's Claude to join. **Manage** (collapsed) has the by-hand forms, shared notes and who can operate. Everyone else can watch but not change anything; the brain enforces that.

## Checklist
- [x] Pick a stack: Vite + React + TypeScript, plain CSS, light and dark
- [x] Mock mode (`?mock=1`) that loads `contract/seed.json` so you can build before the brain exists
- [x] Team panel: name, plan badge, 5-hour and weekly bars, status chip (icon + text), current task with elapsed time, "updated Xs ago"
- [x] Task board in stages, with model chips, assignee, live progress strip and note, and a job progress bar
- [x] Locks panel and "Why this assignment?" panel
- [x] Event log in plain English, newest first
- [x] Prompt box, progress summary, scenario buttons and stepper (Demo), Reset
- [x] Demo (simulated workers, visible badge) and My team (real session) in one page
- [x] Per-sandbox sessions (`session_id`): each browser tab gets its own demo sandbox
- [x] Operator flow: claim, send goals, manage by hand, approve and remove other identities
- [x] "Add a teammate": the exact `claude mcp add` command and the prompt to give their Claude
- [x] Mobile layout: tabs, 44px tap targets, no sideways scroll
- [x] `?view=present` for big type and no controls
- [x] QR code for the page URL (the Share button)
- [ ] Fallback: if the brain is unreachable, show a banner and play a prerecorded run. Done so far: the banner, and a still picture of the seed data
- [ ] After the base works: team-rules skill and lock-check hook in `/mcp`

## Not done yet
- **Nothing reads goals yet.** The manager Claude that plans a goal into tasks is not built. Until it is, a goal stays "Waiting for the manager". Use Manage to add tasks by hand.
- No real Claude workers have fed this page yet.
- No stranger has tried it on a phone with no help.
- Nothing is deployed. "Add a teammate" shows `127.0.0.1` for now, so only this machine can join.

## Run it
```
cd brain && npm install && cd ../dashboard && npm install
# brain running locally with bilal-dev published (see brain/README.md)
npm run dev                       # http://localhost:5173
npm run build && npm run preview  # production build
```
URL options: `?mode=team` (alias `?mode=live`), `?view=present`, `?mock=1`, `?uri=ws://host:3000&db=name`. Defaults can also be set with `VITE_STDB_URI` and `VITE_STDB_DB`.

## Tests
- `npm test`: every Demo scenario against the real brain, using the same simulator as the browser.
- `npm run test:ui`: the real page in Chrome via playwright-core, desktop and phone size, Demo and My team. Needs `npm run build && npm run preview -- --port 4173`, Chrome, and `spacetime` on PATH (it publishes a fresh `bilal-auth` database for the My team checks). Set `SHOTS=<folder>` to save screenshots.

## Known limits
- The simulator runs in the page. If someone closes the tab mid-run, their sandbox stops moving until they come back.
- Anyone can point `?uri=` at any server. Harmless, but not locked down.
- Worker actions have no login (see `brain/README.md`).
