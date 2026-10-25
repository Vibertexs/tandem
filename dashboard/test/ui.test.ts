// The real first-use journey in Chrome, end to end. Publishes a FRESH database (bilal-ux) and
// starts two simulated launchers (no Claude calls) so cards really move.
// Needs: the local brain on 3001, `npm run build && npm run preview -- --port 4173`, Chrome,
// and `spacetime` on PATH. Env: UI_URL (default http://localhost:4173), SHOTS (screenshot folder).
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timestamp } from 'spacetimedb';
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
// a stage's cards, in every goal's lane
const col = (page: Page, name: string) => page.locator(`.lane-body .column[aria-label="${name}"]`);
const lane = (page: Page, text: string) => page.locator('.goal-lane', { hasText: text }).first();
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

  // ---- 1. nothing connected: start a project or open an invite ----
  await A.goto(URL_);
  check('start: with nothing connected, the page explains project host versus dashboard and offers an invite',
    await seen(A, 'Start a team for a project') && await seen(A, "Open a teammate's team", 1000) && await A.getByText('tandem start', { exact: true }).first().isVisible() && await seen(A, 'does not host or copy the project', 1000));
  await shot(A, '01-start');
  await A.getByLabel('Invite link').fill('not an invite');
  await A.getByRole('button', { name: 'Open team' }).click();
  check('start: something that is not an invite says what one looks like', await seen(A, "That doesn't look like an invite", 3000));
  await A.getByLabel('Invite link').fill(`127.0.0.1:9/${DB}`);
  await A.getByRole('button', { name: 'Open team' }).click();
  check('start: an invite nobody answers says it cannot reach the team, with Try again', await seen(A, `Can't reach "${DB}"`, 12_000) && await A.getByRole('button', { name: 'Try again' }).isVisible());
  await A.getByRole('button', { name: 'Choose another team' }).click();
  check('start: "Choose another team" goes back to the start', await seen(A, 'Start a team for a project', 4000));
  // ---- 2. a teammate opening the invite before the host has taken control only watches ----
  const V = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await V.goto(`${URL_}/?db=${DB}`);
  check('viewer: an invite to a team nobody controls yet says it is waiting for the host, with no way to take control',
    await seen(V, 'Waiting for the host to take control', 8000) && await V.getByRole('button', { name: 'Request control' }).count() === 0 && await V.getByRole('button', { name: 'Control this team' }).count() === 0);
  await V.context().close();

  // ---- 3. the page `tandem start` opens (host=1) takes control by itself ----
  await A.goto(`${URL_}/?db=${DB}&host=1`);
  check('control: no claim-or-watch question; the host page takes control by itself and the prompt is on', await until(() => prompt(A).isEnabled()) && await A.getByText('Watch only').count() === 0);
  await shot(A, '02-owner');
  check('control: the sidebar has Get started, Board, Team, Shared memory, Activity, Settings (goals live on the Board)',
    (await A.locator('.nav-label').allInnerTexts()).join('|') === 'Get started|Board|Team|Shared memory|Activity|Settings');
  check('control: a team only this computer can reach says so at the top, instead of an invite', await seen(A, 'This computer only', 2000));
  check('control: it shows one next step: the manager is not connected yet', await seen(A, 'The manager is not connected yet', 3000));
  check('control: the sidebar says this browser controls the team', await seen(A, 'You control this team', 2000));
  {
    // the dock: the icon under the pointer grows and pushes its neighbour away, and it shrinks back
    const link = (i: number) => A.locator('.nav li a').nth(i);
    const before = (await link(2).boundingBox())!;
    const nextBefore = (await link(3).boundingBox())!;
    await A.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    const dockBefore = (await A.locator('.dock').boundingBox())!;
    const grew = await until(async () => { const b = await link(2).boundingBox(); return !!b && b.width > before.width + 6; }, 3000);
    const nextAfter = (await link(3).boundingBox())!;
    const dockAfter = (await A.locator('.dock').boundingBox())!;
    check('dock: the icon under the pointer grows, and pushes the next icon away', grew && nextAfter.y > nextBefore.y + 2, [before, nextBefore, nextAfter]);
    check('dock: the dock itself keeps its width and its icons never get wider than it', dockAfter.width === dockBefore.width && (await link(2).boundingBox())!.width <= dockAfter.width, [dockBefore, dockAfter]);
    await shot(A, '02b-dock-hover');
    await A.mouse.move(700, 500);
    check('dock: it shrinks back when the pointer leaves', await until(async () => (await link(2).boundingBox())!.width === before.width, 3000));
  }

  // ---- 4. the manager requests control, and the host page approves it by itself ----
  const manager = await new Promise<DbConnection>((res, rej) => {
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(DB)
      .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.goals]); }).onConnectError((_c, e) => rej(e)).build();
  });
  await manager.reducers.requestOperator({ name: 'Manager Claude' });
  check('approve: the host page approves the manager without a click, and the next step is "No workers are online"', await seen(A, 'No workers are online.', 8000) && await A.getByRole('button', { name: 'Approve' }).count() === 0);
  await shot(A, '03-approve-manager');

  // ---- 4. send a goal ----
  check('goal: the prompt is empty and there are no suggested goals', await A.locator('.chip.example').count() === 0 && await prompt(A).inputValue() === '' && await A.getByText('Try one').count() === 0);
  await A.locator('body').click({ position: { x: 5, y: 5 } });
  await A.keyboard.press('/');
  check('goal: "/" jumps to the prompt', await prompt(A).evaluate(el => el === document.activeElement));
  await prompt(A).fill('Build a tiny calculator with tests');
  await A.getByRole('button', { name: /^Send/ }).click();
  check('goal: the goal gets its own lane on the board, waiting for the manager',
    await until(async () => /Waiting for the manager/.test(await lane(A, 'Build a tiny calculator with tests').innerText().catch(() => '')), 4000));
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
  const calc = lane(A, 'Build a tiny calculator with tests');
  check('goal: its lane shows its progress (0/2, Planned) and its 2 tasks in their stages',
    await until(async () => { const t = await calc.innerText(); return t.includes('0/2') && t.includes('Planned'); }, 6000) &&
    await calc.locator('.column[aria-label="To do"] .task', { hasText: 'Write calc.py' }).count() === 1 &&
    await calc.locator('.column[aria-label="Waiting"] .task', { hasText: 'Test calc.py' }).count() === 1, await calc.innerText().catch(() => ''));

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
  check('board: work added by hand gets an "Other tasks" lane, after the goal still going', await until(async () =>
    (await A.locator('.goal-lane .goal-text').allInnerTexts()).join('|') === 'Build a tiny calculator with tests|Other tasks') &&
    await lane(A, 'Other tasks').locator('.task').count() === 5);
  await calc.getByRole('button', { name: 'Fold' }).click();
  check('board: a lane folds to one line and unfolds again', await calc.locator('.task').count() === 0 &&
    await calc.getByRole('button', { name: 'Unfold' }).click().then(() => calc.locator('.task').count()) === 2);
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
  check('goal done: its lane says Done, 2/2, and where the work is', await until(async () => {
    const row = await calc.innerText();
    return row.includes('2/2') && row.includes('Done') && row.includes(`tandem/${goalId}`);
  }, 5000), await calc.innerText().catch(() => ''));
  const doneLane = await calc.innerText();
  check('goal done: the lane says how it went, how long it took and what it cost', doneLane.includes('Tests pass') && /done in \d/.test(doneLane) && doneLane.includes('$0.01 of Claude usage'), doneLane);
  check('goal done: a finished goal moves below the work still going', (await A.locator('.goal-lane .goal-text').allInnerTexts()).join('|') === 'Other tasks|Build a tiny calculator with tests');
  await shot(A, '06-board-done', true);

  // ---- 5b. Get started: host/controller distinction and one complete host command ----
  await manager.reducers.ping({ sessionId: 'live', name: 'Manager Claude', kind: 'manager' });
  await manager.reducers.setContext({ sessionId: 'live', key: 'tandem_dir', value: 'C:\\Code\\tandem' });
  await manager.reducers.setContext({ sessionId: 'live', key: 'project_dir', value: 'C:\\Code\\calc-demo' });
  await nav(A, 'Get started');
  const steps = A.locator('.step');
  check('get started: three steps distinguish the project host from the team controller', await until(async () => await steps.count() === 3) &&
    await seen(A, 'project host', 1000) && await seen(A, 'team controller', 1000) && (await steps.first().innerText()).includes('Start the project host') && (await steps.last().innerText()).includes('Add a teammate'));
  check('get started: one whole PowerShell block carries this computer\'s real folders without a PATH edit', await until(async () => {
    const s = await A.locator('.setup').innerText();
    return s.includes("Set-Location -LiteralPath 'C:\\Code\\calc-demo'") && s.includes("& 'C:\\Code\\tandem\\tandem.cmd' start") && !s.includes('$env:Path');
  }, 4000));
  check('get started: the host and goal steps tick, while adding a teammate stays optional',
    await steps.nth(0).evaluate(e => e.classList.contains('done')) && await steps.nth(1).evaluate(e => e.classList.contains('done')) && !(await steps.nth(2).evaluate(e => e.classList.contains('done'))));
  check('get started: a local-only team explains that an invite needs a non-local host',
    await steps.nth(2).innerText().then(t => t.includes('only available on this computer') && t.includes('without --local')));
  await shot(A, '06a-setup');

  // ---- 6. team, shared memory, activity ----
  await nav(A, 'Team');
  check('team: each worker card says how many tasks it finished', await until(async () => /\d+ tasks? done/.test(await A.locator('.worker').first().innerText())));
  check('team: both workers are listed as online cards', await until(async () => await A.locator('.worker').count() === 2) && await seen(A, 'Alex', 2000) && await seen(A, 'Sam', 1000));
  const connect = await A.locator('.connect').innerText();
  check('team: a team only this computer can reach says so, with the restart command but no join command that cannot work',
    connect.includes('Right now only this computer can join') && connect.includes('stop --all') && /tandem(\.cmd')? start/.test(connect) && !/tandem(\.cmd')? join/.test(connect), connect.slice(0, 300));
  {
    // tandem start opens the page with &lan=<ip> when the brain is open to the network
    const L = await (await browser.newContext({ viewport: desktop })).newPage();
    await L.goto(`${URL_}/?db=${DB}&lan=10.1.2.3`);
    const invite = `http://10.1.2.3:${new URL(URL_).port}/?db=${DB}`;
    await L.getByRole('button', { name: 'Invite' }).click();
    const pop = await L.getByRole('dialog', { name: 'Invite' }).innerText().catch(() => '');
    check('invite: on the network, every page has an Invite button with the link, and without a shared project it says what is missing', pop.includes(invite) && pop.includes('project is not ready to share yet'), pop);
    await L.keyboard.press('Escape');
    await nav(L, 'Team');
    const lan = await L.locator('.connect').innerText().catch(() => '');
    check('team: without a shared project it says what is missing, and shows no join command that could not work', lan.includes('project is not ready to share yet') && !lan.includes('tandem.cmd join'), lan.slice(0, 400));
    // the manager publishes the host's Git address: then the steps are one bulk get-Tandem + join block
    await manager.reducers.setContext({ sessionId: 'live', key: 'git_url', value: 'http://10.1.2.3:9418/bilal-ux' });
    const withShare = await until(async () => (await L.locator('.connect').innerText()).includes('git clone https://github.com/Vibertexs/tandem'), 4000);
    const lan2 = await L.locator('.connect').innerText();
    const blocks = await L.locator('.connect pre').allInnerTexts();
    check('team: with a host-shared project, getting Tandem (git clone, first time only) and joining are two separate blocks',
      withShare && blocks.some(b => b.trim() === 'git clone https://github.com/Vibertexs/tandem') &&
      blocks.some(b => b.includes('cd tandem') && b.includes(`.\\tandem.cmd join "${invite}"`) && !b.includes('git clone')) &&
      lan2.includes('first time only') && lan2.includes('private copy of the host project'), [blocks, lan2.slice(0, 300)]);
    await manager.reducers.setContext({ sessionId: 'live', key: 'git_url', value: '' });
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
  await A.getByRole('button', { name: /^Finished/ }).click();
  check('activity: "Finished" shows only what got done', await until(async () => (await A.locator('.log li').allInnerTexts()).every(t => /Done:|Goal done|Job progress|Merge task/.test(t))), await A.locator('.log li').allInnerTexts());
  await A.getByRole('button', { name: /^All/ }).click();

  // ---- 7. a second person requests controller access ----
  const ctxB = await browser.newContext({ viewport: desktop });
  const B = await ctxB.newPage();
  await B.goto(`${URL_}/?db=${DB}`);
  check('viewer: someone else sees the board but cannot send', await until(() => prompt(B).isDisabled(), 10_000) && await seen(B, 'Watching', 2000));
  await B.getByRole('button', { name: 'Request control' }).click();
  await B.getByLabel('Your name').fill('Omar');
  await B.getByRole('button', { name: /^Request$/ }).click();
  check('viewer: after asking, it says it is waiting for a controller', await seen(B, 'Waiting for a controller to approve you', 4000));
  await nav(A, 'Board');
  check('viewer: a controller sees "Omar wants to control this team"', await seen(A, 'Omar wants to control this team.', 5000));
  await A.getByRole('button', { name: 'Approve' }).click();
  check('viewer: once approved, Omar can send goals without reloading', await until(() => prompt(B).isEnabled(), 6000));
  await ctxB.close();

  // ---- 8. remembered team, then start over ----
  await A.goto(URL_);
  check('remember: opening the page again goes straight to your team', await until(() => prompt(A).isEnabled(), 10_000));
  await nav(A, 'Settings');
  await A.getByRole('button', { name: 'Show QR code' }).click();
  check('settings: Show QR code shows a QR code for the team\'s page', await A.locator('img.qr').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await A.getByRole('button', { name: 'Clear the board…' }).click();
  await A.getByRole('button', { name: 'Yes, clear everything' }).click();
  await nav(A, 'Board');
  check('start over: the board is empty again, the team stays', await seen(A, 'Nothing yet.', 5000) && !(await A.getByText('No workers are online.').isVisible()));

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
  check('give back: the card stays in To do, marked "given back"', await until(async () => (await col(A, 'To do').locator('.task', { hasText: 'Port it to COBOL' }).innerText().catch(() => '')).includes('Given back'), 5000));
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
  // a goal the manager could not plan says why, and Try again sends it back
  await manager.reducers.postGoal({ sessionId: 'live', id: 'g-bad', text: 'Something the manager cannot plan' });
  await manager.reducers.failGoal({ sessionId: 'live', id: 'g-bad', note: 'The manager could not plan this: Invalid API key · Please run /login' });
  check('could not plan: the board says so, with the reason', await seen(A, 'The manager could not plan "Something the manager cannot plan".', 5000) && await seen(A, 'Invalid API key', 1000));
  await A.locator('.next').getByRole('button', { name: 'Try again' }).click();
  check('could not plan: Try again sends it to the manager again', await seen(A, 'Sent to the manager again.', 4000) &&
    await until(async () => [...manager.db.goals.iter()].find(g => g.id === 'g-bad')?.status === 'new', 4000));
  // cancelling that goal (it never got tasks, so its lane goes away)
  const bad = lane(A, 'Something the manager cannot plan');
  check('could not plan: back to waiting, its lane says so', await until(async () => /Waiting for the manager/.test(await bad.innerText()), 4000));
  await bad.getByRole('button', { name: 'Cancel goal' }).click();
  await bad.getByRole('button', { name: 'Yes, cancel it' }).click();
  check('cancel: the owner can cancel a goal (with a confirm); with no work done, it leaves the board', await seen(A, 'Goal cancelled.', 4000) &&
    await until(() => A.locator('.goal-lane', { hasText: 'Something the manager cannot plan' }).count().then(n => n === 0), 4000));
  // a worker that hit its usage limit says until when
  await x1.reducers.updateCapacity({ sessionId: 'live', workerId: 'w-kim', usage5H: 100, usageWeek: undefined, resetAt: Timestamp.fromDate(new Date(Date.now() + 3600_000)), status: undefined });
  await nav(A, 'Team');
  check('limit: a worker out of quota says until when', await seen(A, /Out of quota until \d/, 4000));
  // which agent and login each worker runs
  await x2.reducers.describeWorker({ sessionId: 'live', workerId: 'w-lee', agent: 'codex', account: 'school' });
  check('team: the simulated workers started for this test say "Simulated", not Claude',
    (await A.locator('.worker', { hasText: 'Alex' }).innerText()).includes('Simulated') || (await A.locator('.worker', { hasText: 'Sam' }).count()) === 0);
  check('team: each worker says which agent and login it runs (Claude, or Codex · school)',
    await until(async () => (await A.locator('.worker', { hasText: 'Lee' }).innerText()).includes('Codex · school'), 4000) &&
    (await A.locator('.worker', { hasText: 'Kim' }).innerText()).includes('Claude'));
  await nav(A, 'Board');
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
  check('phone: the sections become a tab bar at the bottom', !!bar && bar.y + bar.height >= 820 && await P.locator('.nav a').count() === 6, bar);
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
  check('present: ?view=present shows the board with no sidebar and no prompt', await until(() => M.locator('.lanes, .empty-board').first().isVisible(), 10_000) && await M.locator('.sidebar').count() === 0 && await M.locator('.prompt').count() === 0);
  await ctxM.close();
} finally {
  for (const l of launchers) l.kill();
  await browser.close();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
