# dashboard

The web page for Tandem. Vite, React, TypeScript. It reads the brain live through the generated bindings in `../brain/bindings`. There is one mode: the real team.

## The flow
1. **Not connected:** the start screen explains **Start a team for a project** (run `tandem start` in the Git project) or **Open a teammate's team** (paste the invite link). The browser is a dashboard; it does not host or copy the project.
   - A wrong address shows "Can't reach" with Try again.
   - A team running an older version shows "needs an update" with the command to run.
2. **A team with no controller:** **Control this team** (or Watch only). Controller access is a saved browser permission to send goals and approve people; it is not a Tandem account or Claude login.
3. **The app.** A sidebar with six pages, and **Invite** at the top right of every page (a link to watch plus a whole clone-and-join block for a teammate's workers):
   - **Board:**
     - One next step at a time: approve the manager, start workers, and so on.
     - The prompt ("Describe what you want built").
     - A progress summary.
     - One swimlane per goal: what you asked for, its status, progress, cost, branch and note, then its tasks in Waiting → To do → In progress → Done. Finished goals move down and start folded. Work added by hand is in "Other tasks". Cards show the worker's avatar, elapsed time, a moving strip and their last note.
     - Click a card for its details: assignee, files, what to do, why it is here, result and a timeline.
   - **Team:** worker cards (online, usage, current task, held files), and **Add a teammate's computer** with the exact commands.
   - **Shared memory:** project summary, interfaces and decisions. Every Claude reads these.
   - **Activity:** the full log.
   - **Settings:**
     - Control requests (Approve or Dismiss), and people who control the team.
     - Add work by hand.
     - This team's address, link and QR code.
     - **Start over** (clears the board, keeps the team).
4. **Anyone else** can watch. **Request control** sends a request a current controller approves with one click. No identities to copy.

The page remembers the last team you opened. URL options:
- `?db=<team>&uri=ws://host:3001` opens a team.
- `?view=present` shows the board only, in big type.
- `?mock=1` shows sample data with no brain.

## Run it
`tandem start` starts the page for you. By hand:
```
cd brain && npm install && cd ../dashboard && npm install
npm run dev                       # http://localhost:5173
npm run build && npm run preview  # production build
```

## Tests
- `npx tsx test/ui.test.ts`: the whole first-use journey in Chrome (playwright-core), desktop and phone. It covers project host/invite, controller access, approving the manager, a goal, work by hand, simulated workers moving cards, the details panel, shared memory, a second controller request, remembered team, start over, sample data and present view. It needs `npm run build && npm run preview -- --port 4173`, the local brain, Chrome and `spacetime` on PATH. It publishes a fresh `bilal-ux` database.
- `npx tsx test/start-flow.ts`: the product end to end. It runs `tandem start` in a test project (with the tests-only switch that fakes the coding), takes browser control, approves the manager, types a goal, and checks the real manager plans it (1 haiku run) and the workers finish it. Then it runs `tandem stop`.
- `test/loop-ui.ts`: the last step of `mcp/test/e2e/loop.ps1`.
