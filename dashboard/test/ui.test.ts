// The real first-use journey in Chrome, end to end. Publishes a FRESH database (bilal-ux) and
// starts two simulated launchers (no Claude calls) so cards really move.
// Needs: the local brain on 3001, `npm run build && npm run preview -- --port 4173`, Chrome,
// and `spacetime` on PATH. Env: UI_URL (default http://localhost:4173), SHOTS (screenshot folder).
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DbConnection } from '../../brain/bindings/index.js';

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
    DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(DB).onConnect(c => res(c)).onConnectError((_c, e) => rej(e)).build();
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
  await nav(A, 'Goals');
  check('goal: the Goals page lists it', await seen(A, 'Everything you asked for') && await A.locator('.rows .row').count() === 1);

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
  check('board: tasks land in To do, the merge task in Waiting', await until(async () => await col(A, 'To do').locator('.task').count() === 4 && await col(A, 'Waiting').getByText('Merge the results').isVisible()));
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
  check('board: everything finishes (5 of 5) and the big job reaches 3/3', await seen(A, '5 of 5 tasks done', 60_000) && await seen(A, 'Big job: 3/3 pieces done', 1000));
  await shot(A, '06-board-done', true);

  // ---- 6. team, shared memory, activity ----
  await nav(A, 'Team');
  check('team: both workers are listed as online cards', await A.locator('.worker').count() === 2 && await seen(A, 'Alex', 2000) && await seen(A, 'Sam', 1000));
  const connect = await A.locator('.connect').innerText();
  check('team: "Connect a computer" gives the exact join command for this team', connect.includes(`-Join ws://127.0.0.1:3001 -Db ${DB}`), connect.slice(0, 160));
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
