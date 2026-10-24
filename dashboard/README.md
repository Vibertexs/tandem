# dashboard

The web page for Tandem. Vite, React, TypeScript. It reads the brain live through the generated bindings in `../brain/bindings`. There is one mode: the real team. For a demo with no Claude usage, start the team with `.\start.ps1 -Simulate` (workers that fake the coding).

## The flow
1. **Not connected:** the start screen offers **Host a team** (run `.\start.ps1`) or **Join a team** (host address + team name).
   - A wrong address shows "Can't reach" with Try again.
   - A team running an older version shows "needs an update" with the command to run.
2. **A team with no owner:** **Make me the owner** (or Just watch).
3. **The app.** A Jira-style sidebar with six pages:
   - **Board:**
     - One next step at a time: approve the manager, start workers, and so on.
     - The prompt ("Describe what you want built"), with the latest goal's status.
     - A progress summary.
     - Waiting → To do → In progress → Done. Cards show the worker's avatar, elapsed time, a moving strip and their last note.
     - Click a card for its details: assignee, files, what to do, why it is here, result and a timeline.
   - **Goals:** everything you asked for, with status.
   - **Team:** worker cards (online, usage, current task, held files), and **Connect a computer** with the exact command.
   - **Shared memory:** project summary, interfaces and decisions. Every Claude reads these.
   - **Activity:** the full log.
   - **Settings:**
     - Requests to manage (Approve or Dismiss), and who can manage.
     - Add work by hand.
     - This team's address, link and QR code.
     - **Start over** (clears the board, keeps the team).
4. **Anyone else** can watch. **Ask to make changes** sends a request the owner approves with one click. No identities to copy.

The page remembers the last team you opened. URL options:
- `?db=<team>&uri=ws://host:3001` opens a team.
- `?view=present` shows the board only, in big type.
- `?mock=1` shows sample data with no brain.

## Run it
`.\start.ps1` in the repo root starts the page for you. By hand:
```
cd brain && npm install && cd ../dashboard && npm install
npm run dev                       # http://localhost:5173
npm run build && npm run preview  # production build
```

## Tests
- `npx tsx test/ui.test.ts`: the whole first-use journey in Chrome (playwright-core), desktop and phone. It covers host/join, owner, approving the manager, a goal, work by hand, simulated workers moving cards, the details panel, shared memory, a second person asking to manage, remembered team, start over, sample data and present view. It needs `npm run build && npm run preview -- --port 4173`, the local brain, Chrome and `spacetime` on PATH. It publishes a fresh `bilal-ux` database.
- `npx tsx test/start-flow.ts`: the product end to end. It runs `.\start.ps1 -Simulate`, makes you the owner, approves the manager, types a goal, and checks the real manager plans it (1 haiku run) and the workers finish it. Then it runs `.\stop.ps1`.
- `test/loop-ui.ts`: the last step of `mcp/test/e2e/loop.ps1`.
