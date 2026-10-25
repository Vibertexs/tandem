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
  check('start: with nothing connected, the page explains that starting makes this computer the conductor, and offers an invite',
    await seen(A, 'Start a team for a project') && await seen(A, "Open a teammate's team", 1000) && await A.getByText('tandem --start', { exact: true }).first().isVisible() && await seen(A, 'That makes this computer the conductor', 1000));
  await shot(A, '01-start');
  await A.getByLabel('Invite link').fill('not an invite');
  await A.getByRole('button', { name: 'Open team' }).click();
  check('start: something that is not an invite says what one looks like', await seen(A, "That doesn't look like an invite", 3000));
  await A.getByLabel('Invite link').fill(`127.0.0.1:9/${DB}`);
  await A.getByRole('button', { name: 'Open team' }).click();
  check('start: an invite nobody answers says it cannot reach the team, with Try again', await seen(A, `Can't reach "${DB}"`, 12_000) && await A.getByRole('button', { name: 'Try again' }).isVisible());
  await A.getByRole('button', { name: 'Choose another team' }).click();
  check('start: "Choose another team" goes back to the start', await seen(A, 'Start a team for a project', 4000));
  // ---- 2. a teammate opening the invite before the conductor has taken control only watches ----
  const V = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await V.goto(`${URL_}/?db=${DB}`);
  check('viewer: an invite to a team nobody controls yet says it is waiting for the conductor, with no way to take control',
    await seen(V, 'Waiting for the conductor to take control', 8000) && await V.getByRole('button', { name: 'Request control' }).count() === 0 && await V.getByRole('button', { name: 'Control this team' }).count() === 0);
  await V.context().close();

  // ---- 3. the page `tandem --start` opens (host=1) takes control by itself: that browser is the conductor ----
  await A.goto(`${URL_}/?db=${DB}&host=1`);
  check('control: no claim-or-watch question; the conductor page takes control by itself and the prompt is on', await until(() => prompt(A).isEnabled()) && await A.getByText('Watch only').count() === 0);
  await shot(A, '02-owner');
  check('control: the dock has Board, Team, Shared memory, Usage, Activity, Help, Settings (no Overview: the Board and Usage cover it)',
    (await A.locator('.nav-label').allInnerTexts()).join('|') === 'Board|Team|Shared memory|Usage|Activity|Help|Settings');
  {
    // the top bar: every item on its right has the same shape and height (the team pill's)
    const shapes = await A.locator('.topbar .top-item').evaluateAll(els => els.map(e => { const c = getComputedStyle(e); return `${c.borderTopLeftRadius}|${Math.round(e.getBoundingClientRect().height)}|${c.borderTopWidth}`; }));
    check('top bar: the team pill, "You are the conductor" and "This computer only" are one shape: same radius, height and border',
      shapes.length >= 3 && new Set(shapes).size === 1, shapes);
  }
  await A.goto(`${URL_}/?db=${DB}&host=1#/overview`);
  check('control: an old #/overview link opens the Board', await until(async () => (await A.locator('.topbar h1').innerText()) === 'Board', 4000));
  check('control: a team only this computer can reach says so at the top, instead of an invite', await seen(A, 'This computer only', 2000));
  check('control: it shows one next step: the conductor is not connected yet', await seen(A, 'The conductor is not connected yet', 3000));
  check('control: the top bar says this browser is the conductor', await seen(A, 'You are the conductor', 2000));
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

  // ---- 4. the conductor's Claude requests control, and the conductor page approves it by itself ----
  const manager = await new Promise<DbConnection>((res, rej) => {
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(DB)
      .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.goals]); }).onConnectError((_c, e) => rej(e)).build();
  });
  await manager.reducers.requestOperator({ name: 'Conductor Claude' });
  check('approve: the conductor page approves its Claude without a click, and the next step is "No workers are online"', await seen(A, 'No workers are online.', 8000) && await A.getByRole('button', { name: 'Approve' }).count() === 0);
  await shot(A, '03-approve-manager');

  // ---- 4. send a goal ----
  check('goal: the prompt is empty and there are no suggested goals', await A.locator('.chip.example').count() === 0 && await prompt(A).inputValue() === '' && await A.getByText('Try one').count() === 0);
  await A.locator('body').click({ position: { x: 5, y: 5 } });
  await A.keyboard.press('/');
  check('goal: "/" jumps to the prompt', await prompt(A).evaluate(el => el === document.activeElement));
  check('effort: the prompt offers Low, Medium and High, Medium picked, with what it means',
    (await A.getByRole('radiogroup', { name: 'Effort' }).getByRole('radio').allInnerTexts()).join('|') === 'Low|Medium|High' &&
    await A.getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked') === 'true' && await seen(A, 'sonnet plans it', 1000));
  await A.getByRole('radio', { name: 'High' }).click();
  check('effort: picking High says opus plans it', await seen(A, 'opus plans it', 2000));
  await prompt(A).fill('Build a tiny calculator with tests');
  await A.getByRole('button', { name: /^Send/ }).click();
  check('goal: the goal gets its own lane on the board, waiting for the conductor, with the effort it was sent with',
    await until(async () => { const t = await lane(A, 'Build a tiny calculator with tests').innerText().catch(() => ''); return /Waiting for the conductor/.test(t) && t.includes('High effort'); }, 4000));
  check('effort: the goal is saved with the effort picked (high)', await until(async () => [...manager.db.goals.iter()].find(g => g.sessionId === 'live')?.effort === 'high', 4000));
  check('effort: after sending, the picker keeps the choice for the next goal', await A.getByRole('radio', { name: 'High' }).getAttribute('aria-checked') === 'true');
  check('conductor: approved but not running, with a goal waiting, the next step says the conductor is offline', await seen(A, 'The conductor is offline, so new goals are waiting.', 4000) && await seen(A, 'Conductor offline', 1000));
  await manager.reducers.ping({ sessionId: 'live', name: 'Conductor Claude', kind: 'manager' });
  check('conductor: once it pings, the top bar says Conductor online and the offline step goes away',
    await seen(A, 'Conductor online', 4000) && await until(() => A.getByText('The conductor is offline').count().then(n => n === 0), 4000));
  // play the conductor: plan the goal into two tasks that belong to it
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
  await calc.locator('.column[aria-label="To do"] .task', { hasText: 'Write calc.py' }).click();
  const easyHigh = await A.getByRole('dialog').innerText().catch(() => '');
  check('effort: an easy task of a high-effort goal runs on sonnet with medium effort (from routing.json)', easyHigh.includes('sonnet · medium effort · easy task'), easyHigh);
  await A.keyboard.press('Escape');

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
  // what the runs used (a real launcher and the conductor report this)
  await manager.reducers.addGoalCost({ sessionId: 'live', id: goalId, usd: 0.01, tokens: 1500 });
  await manager.reducers.finishGoal({ sessionId: 'live', id: goalId, branch: `tandem/${goalId}`, note: 'Tests pass (python -m unittest).' });
  const fin = A.getByRole('region', { name: 'Finished goals' });
  check('goal done: the finished goal leaves the board, and a "Finished" strip says where its work is',
    await until(async () => await A.locator('.goal-lane', { hasText: 'Build a tiny calculator with tests' }).count() === 0 && (await fin.innerText().catch(() => '')).includes(`tandem/${goalId}`), 5000), await fin.innerText().catch(() => ''));
  check('goal done: the board counts only the work still going, and its lanes are just that work',
    await seen(A, '5 of 5 tasks done', 3000) && (await A.locator('.goal-lane .goal-text').allInnerTexts()).join('|') === 'Other tasks');
  await shot(A, '06-board-done', true);
  // the full result is in Activity: how it went, how long it took, what it cost
  await nav(A, 'Activity');
  const finishedCard = A.getByRole('article', { name: /^Result: Build a tiny calculator/ });
  check('goal done: Activity shows its result: how it went, how long it took, what it cost and its branch',
    await until(() => finishedCard.isVisible(), 3000) && await (async () => { const t = await finishedCard.innerText(); return t.includes('Tests pass') && /built in \d/.test(t) && t.includes('~$0.01 used') && t.includes('high effort') && t.includes(`tandem/${goalId}`); })(), await finishedCard.innerText().catch(() => 'no card'));
  await nav(A, 'Board');

  // "Merge into my project": the page asks, the conductor answers (here the answers are played by the test)
  const mergeBtn = fin.getByRole('button', { name: 'Merge into my project' });
  check('merge: a finished goal with a branch offers "Merge into my project"', await until(() => mergeBtn.isVisible(), 3000));
  await mergeBtn.click();
  const asked = await until(async () => {
    const r = await fetch(`http://127.0.0.1:3001/v1/database/${DB}/sql`, { method: 'POST', body: `SELECT value FROM context WHERE key = 'apply_${goalId}'` });
    return JSON.stringify(((await r.json()) as { rows: unknown[][] }[])[0]?.rows ?? []).includes('requested');
  }, 4000);
  check('merge: pressing it asks the conductor, and the lane says it is merging', asked && await seen(A, 'Merging into your project', 3000));
  await manager.reducers.setContext({ sessionId: 'live', key: `apply_${goalId}`, value: 'failed: You have uncommitted changes in the project (1 file). Commit or stash them, then try again.' });
  check('merge: when the conductor says it failed, the lane shows why and offers the button again', await seen(A, 'uncommitted changes in the project', 3000) && await mergeBtn.isVisible());
  await manager.reducers.setContext({ sessionId: 'live', key: `apply_${goalId}`, value: 'done: Merged tandem/x into main: 2 files (cli.py, test_cli.py).' });
  check('merge: when it is done, the lane says what was merged and the button is gone', await seen(A, 'Merged tandem/x into main', 3000) && await mergeBtn.count() === 0);

  // ---- 5b. Get started: the two roles (conductor and teammate) and one complete start command ----
  await manager.reducers.ping({ sessionId: 'live', name: 'Conductor Claude', kind: 'manager' });
  await manager.reducers.setContext({ sessionId: 'live', key: 'tandem_dir', value: 'C:\\Code\\tandem' });
  await manager.reducers.setContext({ sessionId: 'live', key: 'project_dir', value: 'C:\\Code\\calc-demo' });
  await nav(A, 'Team');
  const steps = A.locator('.step');
  check('team: the workers come first, then getting started, which is adding a teammate', await until(async () => await steps.count() === 3) &&
    await A.locator('.page > section').first().evaluate(e => e.getAttribute('aria-labelledby') === 'workers-h') && await seen(A, 'Get started: add a teammate', 1000));
  check('get started: three steps, and the two roles: the conductor (you) and teammates', await until(async () => await steps.count() === 3) &&
    (await A.locator('.setup').innerText()).includes('A teammate is another computer') && (await steps.first().innerText()).includes('Start the conductor (your computer)') && (await steps.nth(1).innerText()).includes('Add a teammate') && (await steps.last().innerText()).includes('Send a goal'));
  check('get started: one whole PowerShell block carries this computer\'s real folders without a PATH edit', await until(async () => {
    const s = (await A.locator('.setup').textContent()) ?? ''; // once started, the command is folded away
    return s.includes("Set-Location -LiteralPath 'C:\\Code\\calc-demo'") && s.includes("& 'C:\\Code\\tandem\\tandem.cmd' start") && !s.includes('$env:Path');
  }, 4000));
  check('get started: the order is conductor, then connect a teammate, then send a goal; the conductor and goal steps tick while adding a teammate stays optional',
    await steps.nth(0).evaluate(e => e.classList.contains('done')) && !(await steps.nth(1).evaluate(e => e.classList.contains('done'))) && await steps.nth(2).evaluate(e => e.classList.contains('done')));
  check('get started: a local-only team explains that an invite needs a conductor started without --local',
    await steps.nth(1).innerText().then(t => t.includes('Right now only this computer can join') && t.includes('without --local')));
  await shot(A, '06a-setup');

  // ---- 6. team, shared memory, activity ----
  await nav(A, 'Team');
  check('team: each worker card says how many tasks it finished', await until(async () => /\d+ tasks? done/.test(await A.locator('.worker').first().innerText())));
  check('team: both workers are listed as online cards', await until(async () => await A.locator('.worker').count() === 2) && await seen(A, 'Alex', 2000) && await seen(A, 'Sam', 1000));
  const connect = await A.locator('.connect').innerText();
  check('team: a team only this computer can reach says so, with the restart command but no join command that cannot work',
    connect.includes('Right now only this computer can join') && connect.includes('stop --all') && /tandem(\.cmd')? start/.test(connect) && !/tandem(\.cmd')? join/.test(connect), connect.slice(0, 300));
  {
    // tandem --start opens the page with &lan=<ip> when the brain is open to the network
    const L = await (await browser.newContext({ viewport: desktop })).newPage();
    await L.goto(`${URL_}/?db=${DB}&lan=10.1.2.3`);
    const invite = `http://10.1.2.3:${new URL(URL_).port}/?db=${DB}`;
    await L.getByRole('button', { name: 'Invite' }).click();
    const pop = await L.getByRole('dialog', { name: 'Invite' }).innerText().catch(() => '');
    check('invite: on the network, every page has an Invite button with the link, and without a shared project it says what is missing', pop.includes(invite) && pop.includes('project is not ready to share yet'), pop);
    await L.keyboard.press('Escape');
    await nav(L, 'Team');
    const lan = await L.locator('.connect').innerText().catch(() => '');
    check('team: without a shared project it says what is missing, and shows no join command that could not work', lan.includes('project is not ready to share yet') && !/tandem(\.cmd)? join/.test(lan), lan.slice(0, 400));
    // the conductor publishes its Git address: then the steps are get Tandem (once) and one join command
    await manager.reducers.setContext({ sessionId: 'live', key: 'git_url', value: 'http://10.1.2.3:9418/bilal-ux' });
    const withShare = await until(async () => (await L.locator('.connect').innerText()).includes('git clone https://github.com/Vibertexs/tandem'), 4000);
    const lan2 = await L.locator('.connect').innerText();
    const blocks = await L.locator('.connect pre').allInnerTexts();
    check('team: with a shared project, getting Tandem (clone and install, first time only) and joining (one command, any folder) are two blocks',
      withShare && blocks.some(b => b.includes('git clone https://github.com/Vibertexs/tandem') && b.includes('.\\tandem.cmd install') && !b.includes('join')) &&
      blocks.some(b => b.trim() === `tandem join "${invite}"`) &&
      /first time only/i.test(lan2) && lan2.includes("private copy of the conductor's project"), [blocks, lan2.slice(0, 300)]);
    await manager.reducers.setContext({ sessionId: 'live', key: 'git_url', value: '' });
    await L.context().close();
  }
  await shot(A, '07-team');
  await nav(A, 'Shared memory');
  await A.getByLabel('Project summary').fill('A tiny calculator. Python 3, unittest.');
  await A.locator('.memory-note', { hasText: 'Project summary' }).getByRole('button', { name: /^Save/ }).click();
  check('memory: saving a note says so', await seen(A, 'Project summary saved.', 4000));
  const summaryNote = A.locator('.memory-note', { hasText: 'Project summary' });
  check('memory: a note says who wrote it (the conductor) and that no worker has read it yet',
    await until(async () => { const t = await summaryNote.innerText(); return t.includes('Written by Conductor') && t.includes('No worker has read it yet'); }, 4000), await summaryNote.innerText().catch(() => ''));
  await shot(A, '08-memory');
  {
    // developer info: the agents, what each is doing, holding and read; locks; every other shared value
    await manager.reducers.setContext({ sessionId: 'live', key: 'host_computer', value: 'Alex' });
    check('memory: no explaining the database; it shows the files locked now and every other shared value',
      await A.getByText('The code is not stored here.').count() === 0 && await seen(A, 'Files locked now', 2000) &&
      await until(async () => { const t = await A.locator('section[aria-labelledby="values-h"]').innerText(); return t.includes('host_computer') && t.includes('project_dir') && t.includes('C:\\Code\\calc-demo'); }, 3000),
      await A.locator('section[aria-labelledby="values-h"]').innerText().catch(() => ''));
    const alex = A.getByRole('article', { name: 'Agent Alex' });
    check('memory: each agent has a card: what it is working on, the files it holds, and the notes it read',
      await alex.isVisible() && /Working on/.test(await alex.innerText()) && /Holding/.test(await alex.innerText()) && /No notes read yet/.test(await alex.innerText()), await alex.innerText().catch(() => ''));
    check('memory: a worker on the conductor\'s computer says "Conductor"; the others are teammates',
      await until(async () => (await alex.innerText()).includes('Simulated · Conductor'), 3000) && (await A.getByRole('article', { name: 'Agent Sam' }).innerText()).includes('Teammate'));
    check('memory: the conductor has a card too', await A.getByRole('article', { name: 'Conductor' }).isVisible());
    await A.locator('.under-hood > summary').click(); // the raw tables are folded away
  }
  {
    // the live database: every SpacetimeDB table, with its row count, updating as the database changes
    const rowsIn = async (table: string) => Number(await A.getByRole('article', { name: `Table ${table}` }).locator('.db-count strong').innerText());
    check('memory: the page lists the nine SpacetimeDB tables, and says it is the database', await A.locator('.db-card').count() === 9 && await seen(A, 'Live database', 1000) && await seen(A, 'SpacetimeDB', 1000) && await rowsIn('tasks') > 0 && await rowsIn('workers') === 2, await A.locator('.live-db').innerText().catch(() => ''));
    const before = await rowsIn('context');
    await manager.reducers.setContext({ sessionId: 'live', key: 'db_probe', value: 'hello from the test' });
    check('memory: a change in the database shows up in its table the moment it happens', await until(async () => (await rowsIn('context')) === before + 1, 4000), [before, await rowsIn('context')]);
    await A.getByRole('article', { name: 'Table context' }).locator('summary').click();
    check('memory: "Show rows" shows the actual rows', await until(async () => (await A.getByRole('article', { name: 'Table context' }).locator('pre').innerText()).includes('db_probe'), 2000));
    // the workers' heartbeats (last seen) refresh every few seconds: that must not make the table blink
    await sleep(1500); // let the probe's own highlight fade
    const workersCard = A.getByRole('article', { name: 'Table workers' });
    let blinks = 0;
    for (const end = Date.now() + 5000; Date.now() < end; await sleep(150)) if (/\blit\b/.test((await workersCard.getAttribute('class')) ?? '')) blinks++;
    check('memory: the workers table does not light up on heartbeats, only when something real changes', blinks === 0, blinks);
  }

  // ---- Usage: dollars (estimated) or tokens ----
  await nav(A, 'Usage');
  check('usage: the total, each computer and each goal, estimated in dollars and marked as estimated',
    await seen(A, 'Used in total', 2000) && await A.getByRole('article', { name: 'Usage Alex' }).isVisible() && (await A.locator('.page').innerText()).includes('~$0.01') && await seen(A, 'estimated at Claude API prices', 1000), await A.locator('.page').innerText().catch(() => ''));
  check('usage: a computer that reports no quota shows no empty bars, it says so instead',
    await until(async () => (await A.getByRole('article', { name: 'Usage Alex' }).innerText()).includes('Quota not reported'), 2000) && await A.getByRole('article', { name: 'Usage Alex' }).locator('.bar').count() === 0);
  await A.getByRole('group', { name: 'Show usage as' }).getByRole('button', { name: 'Tokens' }).click();
  check('usage: switched to tokens, the same numbers show as tokens',
    await until(async () => { const t = await A.locator('.page').innerText(); return t.includes('1.5k tokens') && !t.includes('~$0.01'); }, 2000), await A.locator('.page').innerText().catch(() => ''));
  await shot(A, '08d-usage');
  await nav(A, 'Activity');
  check('usage: the choice holds on other pages (Activity shows tokens too)', await until(async () => (await finishedCard.innerText()).includes('1.5k tokens used'), 2000));
  await nav(A, 'Settings');
  await A.getByRole('group', { name: 'Show usage as' }).getByRole('button', { name: 'Dollars' }).click();
  check('settings: the same switch is in Settings, and switches back to dollars', await A.getByRole('group', { name: 'Show usage as' }).getByRole('button', { name: 'Dollars' }).getAttribute('aria-pressed') === 'true');
  check('settings: it links the projector view', (await A.getByRole('link', { name: 'the big-type board' }).getAttribute('href'))?.includes('view=present') === true);
  {
    // Light / Dark / System, remembered in this browser
    const theme = A.getByRole('group', { name: 'Theme' });
    const bg = () => A.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('theme: it follows the system by default', await theme.getByRole('button', { name: 'System' }).getAttribute('aria-pressed') === 'true');
    const light = await bg();
    await theme.getByRole('button', { name: 'Dark' }).click();
    check('theme: Dark turns the page dark', await A.evaluate(() => document.documentElement.dataset.theme) === 'dark' && await bg() !== light, [light, await bg()]);
    await A.reload();
    check('theme: the choice survives a reload, with no flash (set before the page draws)', await A.evaluate(() => document.documentElement.dataset.theme) === 'dark');
    await shot(A, '08e-dark');
    await A.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click();
    check('theme: System goes back to the operating system\'s', await A.evaluate(() => document.documentElement.dataset.theme === undefined) && await bg() === light);
  }
  // ---- Help: the commands, with copy buttons ----
  await nav(A, 'Help');
  {
    const help = await A.locator('.help').innerText();
    check('help: the commands to run (start, join, stop, status, logs, install, doctor), the options and the words',
      ['tandem --start', 'tandem join "<invite link>"', 'tandem stop --all', 'tandem status', 'tandem logs conductor', 'tandem.cmd install', 'tandem doctor', '--fresh', '--conductor-model', 'Conductor', 'Teammate'].every(x => help.includes(x)), help.slice(0, 600));
    check('help: which model does what, read from routing.json', (await A.locator('.help-table').innerText()).includes('opus, xhigh') && (await A.locator('.help-table tbody tr').count()) === 6);
    check('help: each command has a copy button', await A.locator('.help .copy-btn').count() >= 11);
    await shot(A, '08f-help', true);
  }
  await nav(A, 'Activity');
  check('activity: it also holds the finished goals: branch, who built it, its files, and what the merge said',
    await until(() => finishedCard.isVisible(), 3000) && await (async () => { const t = await finishedCard.innerText(); return /Built by/.test(t) && /Files/.test(t) && t.includes('Merged tandem/x into main'); })(), await finishedCard.innerText().catch(() => ''));
  await shot(A, '08b-activity');
  check('activity: the log has plain-English lines', await until(async () => await A.locator('.log li').count() > 5) && await seen(A, /claimed:/, 2000), await A.locator('.log li').count());
  await A.getByRole('button', { name: /^Finished/ }).click();
  check('activity: "Finished" shows only what got done', await until(async () => (await A.locator('.log li').allInnerTexts()).every(t => /Done:|Goal done|Job progress|Merge task/.test(t))), await A.locator('.log li').allInnerTexts());
  await A.getByRole('button', { name: /^All/ }).click();

  // ---- 7. a second person requests controller access ----
  const ctxB = await browser.newContext({ viewport: desktop });
  const B = await ctxB.newPage();
  await B.goto(`${URL_}/?db=${DB}`);
  check('viewer: a teammate sees the board but cannot send', await until(() => prompt(B).isDisabled(), 10_000) && await seen(B, 'Teammate · watching', 2000));
  await B.getByRole('button', { name: 'Request control' }).click();
  await B.getByLabel('Your name').fill('Omar');
  await B.getByRole('button', { name: /^Request$/ }).click();
  check('viewer: after asking, it says it is waiting for the conductor', await seen(B, 'Waiting for the conductor to approve you', 4000));
  await nav(A, 'Board');
  check('viewer: the conductor sees "Omar wants to control this team"', await seen(A, 'Omar wants to control this team.', 5000));
  await A.getByRole('button', { name: 'Approve' }).click();
  check('viewer: once approved, Omar can send goals without reloading', await until(() => prompt(B).isEnabled(), 6000));
  await ctxB.close();

  // ---- 7b. the conductor can always take control back (its page link carries the conductor's key) ----
  const hostKey = 'ab'.repeat(16);
  await manager.reducers.setHostKey({ sessionId: 'live', key: hostKey });
  {
    const W = await (await browser.newContext({ viewport: desktop })).newPage();
    await W.goto(`${URL_}/?db=${DB}&host=1&key=${'cd'.repeat(16)}`);
    await until(() => prompt(W).isVisible(), 10_000);
    await sleep(1500);
    check('reclaim: a wrong key does not give control', await prompt(W).isDisabled());
    await W.context().close();
    const H = await (await browser.newContext({ viewport: desktop })).newPage(); // a browser that never had control
    await H.goto(`${URL_}/?db=${DB}&host=1&key=${hostKey}`);
    check("reclaim: the conductor's page takes control back with its key, though others already have it",
      await until(() => prompt(H).isEnabled(), 10_000) && await seen(H, 'You are the conductor', 2000));
    check('reclaim: the key is taken out of the address bar', !H.url().includes('key=') && H.url().includes('host=1'), H.url());
    await H.context().close();
  }

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
  // the launcher gives the shared notes to the worker's Claude and logs it: the note and the agent card say so
  await x1.reducers.noteRead({ sessionId: 'live', workerId: 'w-kim', taskId: 't-hard', keys: ['project_summary'] });
  await nav(A, 'Shared memory');
  check('memory: a note says which workers read it', await until(async () => (await A.locator('.memory-note', { hasText: 'Project summary' }).innerText()).includes('Read by Kim'), 4000), await A.locator('.memory-note', { hasText: 'Project summary' }).innerText().catch(() => ''));
  check("memory: the worker's card says which notes it read", await until(async () => /Read\s*Project summary/.test(await A.getByRole('article', { name: 'Agent Kim' }).innerText()), 3000), await A.getByRole('article', { name: 'Agent Kim' }).innerText().catch(() => ''));
  await nav(A, 'Board');
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
  // a goal the conductor could not plan says why, and Try again sends it back
  await manager.reducers.postGoal({ sessionId: 'live', id: 'g-bad', text: 'Something the conductor cannot plan', effort: 'medium' });
  await manager.reducers.failGoal({ sessionId: 'live', id: 'g-bad', note: 'The conductor could not plan this: Invalid API key · Please run /login' });
  check('could not plan: the board says so, with the reason', await seen(A, 'The conductor could not plan "Something the conductor cannot plan".', 5000) && await seen(A, 'Invalid API key', 1000));
  await A.locator('.next').getByRole('button', { name: 'Try again' }).click();
  check('could not plan: Try again sends it to the conductor again', await seen(A, 'Sent to the conductor again.', 4000) &&
    await until(async () => [...manager.db.goals.iter()].find(g => g.id === 'g-bad')?.status === 'new', 4000));
  // cancelling that goal (it never got tasks, so its lane goes away)
  const bad = lane(A, 'Something the conductor cannot plan');
  check('could not plan: back to waiting, its lane says so', await until(async () => /Waiting for the conductor/.test(await bad.innerText()), 4000));
  await bad.getByRole('button', { name: 'Cancel goal' }).click();
  await bad.getByRole('button', { name: 'Yes, cancel it' }).click();
  check('cancel: the owner can cancel a goal (with a confirm); with no work done, it leaves the board', await seen(A, 'Goal cancelled.', 4000) &&
    await until(() => A.locator('.goal-lane', { hasText: 'Something the conductor cannot plan' }).count().then(n => n === 0), 4000));
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
  check('phone: the sections become a tab bar at the bottom', !!bar && bar.y + bar.height >= 820 && await P.locator('.nav a').count() === 7, bar);
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
