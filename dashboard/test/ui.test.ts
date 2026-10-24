// The real first-use journey in Chrome, end to end. Publishes a FRESH database (bilal-ux) and
// starts two simulated launchers (no Claude calls) so cards really move.
// Needs: the local brain on 3001, `npm run build && npm run preview -- --port 4173`, Chrome,
// and `spacetime` on PATH. Env: UI_URL (default http://localhost:4173), SHOTS (screenshot folder).
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const URL_ = process.env.UI_URL ?? 'http://localhost:4173';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = process.env.SHOTS;
const DB = 'bilal-ux';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn: () => Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch { /* keep waiting */ } await sleep(150); }
  return false;
};
const shot = async (page: Page, name: string, full = false) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: full }); };
const seen = (page: Page, text: string | RegExp, ms = 8000) =>
  page.getByText(text).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
const col = (page: Page, name: string) => page.locator('.column', { has: page.locator('h3', { hasText: name }) });
const prompt = (page: Page) => page.getByLabel('Describe what you want built');
const nav = (page: Page, label: string) => page.locator('.nav a', { hasText: label }).click();
const desktop = { width: 1440, height: 960 };

execSync(`spacetime publish ${DB} --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes`, { stdio: 'pipe' });
const launchers: ChildProcess[] = [];
const launcherTs = fileURLToPath(new URL('../../launcher/launcher.ts', import.meta.url));
const launcherTsx = 'file:///' + fileURLToPath(new URL('../../launcher/node_modules/tsx/dist/esm/index.mjs', import.meta.url)).split('\\').join('/');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctxA = await browser.newContext({ viewport: desktop });
  const A = await ctxA.newPage();
  const errs: string[] = [];
  A.on('pageerror', e => errs.push(String(e)));

  // ---- 1. nothing connected: host or join ----
  await A.goto(URL_);
  check('start: with nothing connected, the page offers Host a team and Join a team',
    await seen(A, 'Host a team') && await seen(A, 'Join a team', 1000) && await A.getByText('.\\start.ps1').first().isVisible());
  await shot(A, '01-start');
  await A.getByLabel('Host address').fill('127.0.0.1:9');
  await A.getByLabel('Team name', { exact: true }).last().fill(DB);
  await A.getByRole('button', { name: 'Join' }).click();
  check('start: a wrong address says it cannot reach the team, with Try again', await seen(A, `Can't reach "${DB}"`, 12_000) && await A.getByRole('button', { name: 'Try again' }).isVisible());
  await A.getByRole('button', { name: 'Choose another team' }).click();
  check('start: "Choose another team" goes back to the start', await seen(A, 'Host a team', 4000));
  await A.getByLabel('Team name', { exact: true }).last().fill(DB);
  await A.getByRole('button', { name: 'Join' }).click();

  // ---- 2. first visitor becomes the owner ----
  check('owner: a team with no owner asks "Make me the owner" (or just watch)', await seen(A, 'has no owner yet') && await A.getByRole('button', { name: 'Just watch' }).isVisible());
  await shot(A, '02-owner');
  await A.getByRole('button', { name: 'Make me the owner' }).click();
  check('owner: then the board opens, with the prompt on', await until(() => prompt(A).isEnabled()));
  check('owner: the sidebar has Board, Goals, Team, Shared memory, Activity, Settings',
    (await A.locator('.nav-label').allInnerTexts()).join('|') === 'Board|Goals|Team|Shared memory|Activity|Settings');
  check('owner: it shows one next step: the manager is not connected yet', await seen(A, 'The manager is not connected yet', 3000));
  check('owner: the sidebar says you manage the team', await seen(A, 'You manage this team', 2000));

  // ---- 3. the manager asks, the owner approves with one click ----
  const manager = await new Promise<DbConnection>((res, rej) => {
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(DB)
      .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.goals]); }).onConnectError((_c, e) => rej(e)).build();
  });
  await manager.reducers.requestOperator({ name: 'Manager Claude' });
  check('approve: the board shows "Manager Claude wants to help" with Approve', await seen(A, 'Manager Claude wants to help manage this team.', 5000));
  check('approve: Settings shows a badge for the request', await A.locator('.nav a', { hasText: 'Settings' }).locator('.badge-count').innerText().then(t => t === '1'));
  await shot(A, '03-approve-manager');
  await A.getByRole('button', { name: 'Approve' }).click();
  check('approve: after approving, the next step is "No workers are online"', await seen(A, 'No workers are online.', 5000));

  // ---- 4. send a goal ----
  await prompt(A).fill('Build a tiny calculator with tests');
  await A.getByRole('button', { name: /^Send/ }).click();
  check('goal: the latest goal shows "Waiting for the manager"', await seen(A, 'Waiting for the manager', 4000) && await seen(A, 'Build a tiny calculator with tests', 1000));
  check('goal: the Goals tab shows a count of 1 waiting', await A.locator('.nav a', { hasText: 'Goals' }).locator('.badge-count').innerText().then(t => t === '1'));
  check('manager: approved but not running, with a goal waiting, the next step says the manager is offline', await seen(A, 'The manager is offline, so new goals are waiting.', 4000) && await seen(A, 'Manager offline', 1000));
  await manager.reducers.ping({ sessionId: 'live', name: 'Manager Claude', kind: 'manager' });
  check('manager: once it pings, the sidebar says Manager online and the offline step goes away',
    await seen(A, 'Manager online', 4000) && await until(() => A.getByText('The manager is offline').count().then(n => n === 0), 4000));
  // play the manager: plan the goal into two tasks that belong to it
  const goalId = [...manager.db.goals.iter()].find(g => g.sessionId === 'live')!.id;
  await manager.reducers.setGoalStatus({ sessionId: 'live', id: goalId, status: 'planning' });
  for (const [id, title, file] of [['t-calc', 'Write calc.py', 'calc.py'], ['t-test', 'Test calc.py', 'test_calc.py']]) {
    await manager.reducers.createTask({ sessionId: 'live', kind: 'normal', task: { id, title, description: '', files: [file], difficulty: 'easy', model: '', effort: 'default', dependsOn: id === 't-test' ? ['t-calc'] : [] } });
  }
  await manager.reducers.setGoalStatus({ sessionId: 'live', id: goalId, status: 'planned' });
  check('goal: the board shows the goal with its own progress (0/2, Planned)',
    await until(async () => (await A.locator('.goal-row').first().innerText()).includes('0/2') && (await A.locator('.goal-row').first().innerText()).includes('Planned'), 6000), await A.locator('.goal-row').first().innerText().catch(() => ''));
  await nav(A, 'Goals');
  check('goal: the Goals page shows it as one card with its 2 planned tasks', await seen(A, 'Everything you asked for') && await A.locator('.goal-card').count() === 1 && await seen(A, '0 of 2 tasks done', 2000));
  await nav(A, 'Board');

  // ---- 5. add work by hand, then simulated workers pick it up ----
  await nav(A, 'Settings');
  await A.getByLabel('Title', { exact: true }).fill('Write the API spec');
  await A.getByLabel('Files it will touch').fill('docs/api.md');
  await A.getByRole('button', { name: 'Create task' }).click();
  await seen(A, 'Task created.', 4000);
  await A.getByLabel('Goal', { exact: true }).fill('Review every module');
  await A.getByLabel(/Pieces, one per line/).fill('Review module a | src/a.py\nReview module b | src/b.py\nReview module c | src/c.py');
  await A.getByRole('button', { name: 'Create job' }).click();
  await seen(A, 'Big job created', 4000);
  await nav(A, 'Board');
  check('board: tasks land in To do, the merge task and the dependent test in Waiting', await until(async () => await col(A, 'To do').locator('.task').count() === 5 && await col(A, 'Waiting').locator('.task').count() === 2));
  await A.locator('.goal-pick').first().click();
  check('goal filter: picking a goal shows only its tasks', await until(async () => await A.locator('.columns .task').count() === 2) && await seen(A, 'Showing one goal.', 1000));
  await A.getByRole('button', { name: 'Show all tasks' }).click();
  check('goal filter: Show all tasks brings every task back', await until(async () => await A.locator('.columns .task').count() === 7));
  for (const name of ['Alex', 'Sam']) {
    launchers.push(spawn(process.execPath, ['--import', launcherTsx, launcherTs, '--name', name, '--simulate', '--sim-ms', '2500', '--poll', '1'], {
      env: { ...process.env, STDB_URI: 'ws://127.0.0.1:3001', STDB_DB: DB, TANDEM_SESSION: 'live' }, stdio: 'ignore',
    }));
  }
  check('board: when workers join, the "no workers" step goes away', await until(() => A.getByText('No workers are online.').count().then(n => n === 0), 15_000));
  check('board: In progress cards show a moving strip, a worker avatar and elapsed time',
    await until(async () => (await col(A, 'In progress').locator('.task .work-bar').count()) > 0 && (await col(A, 'In progress').locator('.task .avatar').count()) > 0, 15_000));
  await shot(A, '04-board-working');
  await col(A, 'In progress').locator('.task').first().click();
  const drawer = A.getByRole('dialog');
  check('details: clicking a card opens a details panel with assignee, files, why and a timeline',
    await drawer.isVisible() && /Assignee/.test(await drawer.innerText()) && /why it is here/i.test(await drawer.innerText()) && /timeline/i.test(await drawer.innerText()), await drawer.innerText().catch(() => 'no dialog'));
  await shot(A, '05-drawer');
  await A.keyboard.press('Escape');
  check('details: Escape closes it', await until(() => drawer.count().then(n => n === 0), 2000));
  check('board: everything finishes (7 of 7) and the big job reaches 3/3', await seen(A, '7 of 7 tasks done', 90_000) && await seen(A, 'Big job: 3/3 pieces done', 1000));
  // what the runs cost (a real launcher and the manager report this)
  await manager.reducers.addGoalCost({ sessionId: 'live', id: goalId, usd: 0.01 });
  await manager.reducers.finishGoal({ sessionId: 'live', id: goalId, branch: `tandem/${goalId}`, note: 'Tests pass (python -m unittest).' });
  check('goal done: the goal row says Done and shows its branch', await until(async () => {
    const row = await A.locator('.goal-row').first().innerText();
    return row.includes('2/2') && row.includes('Done') && row.includes(`tandem/${goalId}`);
  }, 5000), await A.locator('.goal-row').first().innerText().catch(() => ''));
  await shot(A, '06-board-done', true);

  // ---- 6. team, shared memory, activity ----
  await nav(A, 'Goals');
  const card = await A.locator('.goal-card').first().innerText();
  check('goals page: the finished goal lists its tasks and where its work is', card.includes('Write calc.py') && card.includes('Test calc.py') && card.includes(`tandem/${goalId}`) && card.includes('2 of 2 tasks done'), card);
  check('goals page: it shows how it went and what it cost', card.includes('Tests pass') && card.includes('$0.01 of Claude usage'), card);
  await shot(A, '06b-goals');
  await nav(A, 'Team');
  check('team: each worker card says how many tasks it finished', await until(async () => /\d+ tasks? done/.test(await A.locator('.worker').first().innerText())));
  check('team: both workers are listed as online cards', await until(async () => await A.locator('.worker').count() === 2) && await seen(A, 'Alex', 2000) && await seen(A, 'Sam', 1000));
  const connect = await A.locator('.connect').innerText();
  check('team: "Connect a computer" gives the exact join command for this team', connect.includes(`-Join ws://127.0.0.1:3001 -Db ${DB}`), connect.slice(0, 160));
  check('team: a team only this computer can reach says how to open it to the network', connect.includes('Right now only this computer can reach this team') && connect.includes('.\\start.ps1 -Lan'), connect.slice(0, 200));
  {
    // start.ps1 -Lan opens the page with &lan=<ip>: the join command and the link use that address.
    const L = await (await browser.newContext({ viewport: desktop })).newPage();
    await L.goto(`${URL_}/?db=${DB}&lan=10.1.2.3`);
    await nav(L, 'Team');
    const lan = await L.locator('.connect').innerText().catch(() => '');
    check('team: opened with the network address, it gives that address to share', lan.includes(`-Join ws://10.1.2.3:3001 -Db ${DB}`) && lan.includes(`http://10.1.2.3:`) && !lan.includes('Right now only'), lan.slice(0, 300));
    await L.context().close();
  }
  await shot(A, '07-team');
  await nav(A, 'Shared memory');
  await A.getByLabel('Project summary').fill('A tiny calculator. Python 3, unittest.');
  await A.locator('.memory-note', { hasText: 'Project summary' }).getByRole('button', { name: /^Save/ }).click();
  check('memory: saving a note says so', await seen(A, 'Project summary saved.', 4000));
  await shot(A, '08-memory');
  await nav(A, 'Activity');
  check('activity: the log has plain-English lines', await until(async () => await A.locator('.log li').count() > 5) && await seen(A, /claimed:/, 2000), await A.locator('.log li').count());

  // ---- 7. a second person asks to make changes ----
  const ctxB = await browser.newContext({ viewport: desktop });
  const B = await ctxB.newPage();
  await B.goto(`${URL_}/?db=${DB}`);
  check('viewer: someone else sees the board but cannot send', await until(() => prompt(B).isDisabled(), 10_000) && await seen(B, 'Viewing', 2000));
  await B.getByRole('button', { name: 'Ask to make changes' }).click();
  await B.getByLabel('Your name').fill('Omar');
  await B.getByRole('button', { name: /^Ask$/ }).click();
  check('viewer: after asking, it says it is waiting for the owner', await seen(B, 'Waiting for the owner to approve you', 4000));
  await nav(A, 'Board');
  check('viewer: the owner sees "Omar wants to help manage this team"', await seen(A, 'Omar wants to help manage this team.', 5000));
  await A.getByRole('button', { name: 'Approve' }).click();
  check('viewer: once approved, Omar can send goals without reloading', await until(() => prompt(B).isEnabled(), 6000));
  await ctxB.close();

  // ---- 8. remembered team, then start over ----
  await A.goto(URL_);
  check('remember: opening the page again goes straight to your team', await until(() => prompt(A).isEnabled(), 10_000));
  await nav(A, 'Settings');
  await A.getByRole('button', { name: 'Clear the board…' }).click();
  await A.getByRole('button', { name: 'Yes, clear everything' }).click();
  await nav(A, 'Board');
  check('start over: the board is empty again, the team stays', await seen(A, 'No tasks yet.', 5000) && !(await A.getByText('No workers are online.').isVisible()));

  // ---- 8b. a task two workers cannot finish ----
  for (const l of launchers) l.kill(); // so only the two test workers below can take it
  const worker = () => new Promise<DbConnection>((res, rej) => {
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(DB)
      .onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build();
  });
  const [x1, x2] = await Promise.all([worker(), worker()]);
  await x1.reducers.registerWorker({ sessionId: 'live', id: 'w-kim', name: 'Kim', plan: 'pro' });
  await x2.reducers.registerWorker({ sessionId: 'live', id: 'w-lee', name: 'Lee', plan: 'pro' });
  await manager.reducers.createTask({ sessionId: 'live', kind: 'normal', assignee: 'w-kim', task: { id: 't-hard', title: 'Port it to COBOL', description: '', files: ['calc.cob'], difficulty: 'hard', model: '', effort: 'default', dependsOn: [] } });
  await x1.reducers.claimTask({ sessionId: 'live', workerId: 'w-kim' });
  await x1.reducers.giveBackTask({ sessionId: 'live', workerId: 'w-kim', taskId: 't-hard', reason: 'no COBOL compiler here' });
  check('give back: the card stays in To do, marked "given back"', await until(async () => (await col(A, 'To do').locator('.task', { hasText: 'Port it to COBOL' }).innerText().catch(() => '')).includes('given back'), 5000));
  await x2.reducers.claimTask({ sessionId: 'live', workerId: 'w-lee' });
  await x2.reducers.giveBackTask({ sessionId: 'live', workerId: 'w-lee', taskId: 't-hard', reason: 'no COBOL compiler here either' });
  check('failed: after two workers, the next step says the task needs you, with the reason',
    await seen(A, '"Port it to COBOL" needs you.', 5000) && await seen(A, 'no COBOL compiler here either', 1000));
  check('failed: the card says "needs you"', (await col(A, 'To do').locator('.task.is-failed').innerText().catch(() => '')).includes('needs you'));
  await A.waitForTimeout(600); // let the card's colour transition finish
  await shot(A, '10-needs-you');
  await A.getByRole('button', { name: 'Open it' }).click();
  const why2 = await A.getByRole('dialog').innerText().catch(() => '');
  check('failed: the details say who could not finish it and why', why2.includes('Kim and Lee could not finish it: no COBOL compiler here either'), why2);
  await A.getByRole('dialog').getByRole('button', { name: /^Try again/ }).click();
  check('retry: Try again puts it back for any worker', await seen(A, 'Back on the board for any worker.', 4000) &&
    await until(() => A.getByText('needs you').count().then(n => n === 0), 4000));
  await A.keyboard.press('Escape');
  x1.disconnect(); x2.disconnect();
  check('no page errors', errs.length === 0, errs);
  manager.disconnect();
  await ctxA.close();

  // ---- 9. phone ----
  const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const P = await ctxP.newPage();
  await P.goto(`${URL_}/?db=${DB}`);
  await until(() => prompt(P).isVisible(), 10_000);
  const bar = await P.locator('.sidebar').boundingBox();
  check('phone: the sections become a tab bar at the bottom', !!bar && bar.y + bar.height >= 840 && await P.locator('.nav a').count() === 6, bar);
  const small = await P.locator('.nav a, .btn').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent && (e as HTMLElement).offsetHeight < 44).length);
  check('phone: tap targets are at least 44px tall', small === 0, small);
  check('phone: no sideways scrolling', await P.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(P, '09-phone');
  await ctxP.close();

  // ---- 10. sample data and present view ----
  const ctxM = await browser.newContext({ viewport: desktop });
  const M = await ctxM.newPage();
  await M.goto(`${URL_}/?mock=1`);
  check('sample: ?mock=1 shows sample data, clearly labeled, read only', await seen(M, 'Sample data, not connected to a team.', 5000) && await prompt(M).isDisabled());
  await M.goto(`${URL_}/?db=${DB}&view=present`);
  check('present: ?view=present shows the board with no sidebar and no prompt', await until(() => M.locator('.columns, .empty-board').first().isVisible(), 10_000) && await M.locator('.sidebar').count() === 0 && await M.locator('.prompt').count() === 0);
  await ctxM.close();
} finally {
  for (const l of launchers) l.kill();
  await browser.close();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
