// Drives the real page in Chrome. Needs: the local brain with bilal-dev published, and
//   npm run build && npm run preview -- --port 4173
// Env: UI_URL (default http://localhost:4173), CHROME (path), SHOTS (folder for screenshots)
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const URL_ = process.env.UI_URL ?? 'http://localhost:4173';
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + '.png') }); };
const visible = async (page: Page, text: string, ms = 8000) =>
  page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  // ---- desktop, judge mode ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL_);
    check('desktop: empty state with the Run the demo button', await visible(page, 'Your team\'s AI coders, working as one.'));
    check('desktop: "Simulated workers" badge is visible', await visible(page, 'Simulated workers', 2000));
    check('desktop: connected', await visible(page, 'Connected', 3000));
    await shot(page, '1-empty');

    await page.getByRole('button', { name: 'Run map-reduce' }).first().click();
    check('mapreduce: board shows the big job', await visible(page, 'pieces done', 5000));
    check('mapreduce: merge card is in Blocked', await page.locator('.column', { hasText: 'Blocked' }).getByText('Merge review findings').isVisible());
    await page.waitForTimeout(6000);
    await shot(page, '2-mapreduce-running');
    check('mapreduce: a teammate shows as Working', await visible(page, 'Working', 2000));
    check('mapreduce: a lock is listed', await page.locator('.lock-row').count() > 0);
    check('mapreduce: log has plain-English lines', await visible(page, 'claimed:', 2000));
    await page.locator('.task').first().click();
    check('mapreduce: clicking a task explains it (Why this assignment?)', await page.locator('.why p').first().innerText().then(t => t.length > 10));
    const finished = await visible(page, '12/12 pieces done', 60_000);
    check('mapreduce: the bar reaches 12/12', finished);
    check('mapreduce: merge task finishes and lands in Done', await page.locator('.column', { hasText: 'Done' }).getByText('Merge review findings').waitFor({ timeout: 30_000 }).then(() => true, () => false));
    await shot(page, '3-mapreduce-done');

    await page.getByRole('button', { name: 'Reset' }).click();
    check('reset: back to the empty state', await visible(page, 'Your team\'s AI coders, working as one.', 5000));

    await page.getByRole('button', { name: 'Run the demo' }).first().click();
    check('demo: tasks appear', await visible(page, 'Define auth API spec', 4000));
    await page.getByRole('button', { name: 'Make Sam hit a limit' }).first().click();
    check('limit: Sam shows as Capped (icon plus text)', await page.locator('.worker', { hasText: 'Sam' }).getByText('Capped').waitFor({ timeout: 4000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Make two agents edit the same file' }).first().click();
    check('samefile: a task shows "waiting for lock"', await visible(page, 'waiting for lock', 8000));
    await shot(page, '4-lock-wait');
    await page.getByRole('button', { name: 'Teammate goes idle' }).first().click();
    check('idle: an urgent task appears', await visible(page, 'Urgent hotfix', 4000));
    const slider = page.locator('.worker input[type=range]').first();
    check('poke: capacity sliders are there', await slider.isVisible());

    check('desktop: no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ---- phone ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(URL_);
    check('phone: first screen shows', await page.getByRole('button', { name: 'Run the demo' }).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Run the demo' }).first().click();
    await visible(page, 'Define auth API spec', 4000);
    check('phone: tabs Team | Tasks | Locks | Log', (await page.locator('.tabs button').allInnerTexts()).join('|') === 'Team|Tasks|Locks|Log');
    const bar = await page.locator('.bottom-bar').boundingBox();
    check('phone: sticky scenario bar sits at the bottom', !!bar && bar.y + bar.height >= 840, bar);
    const small = await page.locator('.bottom-bar .btn, .tabs button').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetHeight < 44).length);
    check('phone: tap targets are at least 44px tall', small === 0, small);
    check('phone: no horizontal page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    check('phone: only the Tasks panel shows on the Tasks tab', await page.locator('.panel.tasks').isVisible() && !(await page.locator('.panel.team').isVisible()) && !(await page.locator('.panel.locks').isVisible()) && !(await page.locator('.panel.log').isVisible()));
    await shot(page, '5-phone-tasks');
    await page.locator('.tabs button', { hasText: 'Team' }).click();
    check('phone: Team tab shows teammates and hides tasks', await visible(page, 'Alex', 2000) && !(await page.locator('.panel.tasks').isVisible()));
    await shot(page, '6-phone-team');
    await page.locator('.tabs button', { hasText: 'Log' }).click();
    check('phone: Log tab shows events', await visible(page, 'What just happened', 2000));
    await ctx.close();
  }

  // ---- two judges at once, share dialog, live mode ----
  {
    const a = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    const b = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await Promise.all([a.goto(URL_), b.goto(URL_)]);
    await Promise.all([visible(a, 'Connected', 8000), visible(b, 'Connected', 8000)]);
    await a.getByRole('button', { name: 'Run map-reduce' }).first().click();
    await b.getByRole('button', { name: 'Run the demo' }).first().click();
    await a.waitForTimeout(1500);
    const tasksA = await a.locator('.task').count();
    const tasksB = await b.locator('.task').count();
    check('judges: each browser has its own sandbox (13 vs 4 tasks)', tasksA === 13 && tasksB === 4, [tasksA, tasksB]);
    await a.getByRole('button', { name: 'Reset' }).click();
    await a.waitForTimeout(1500);
    check('judges: Reset in one browser does not touch the other', await a.locator('.task').count() === 0 && await b.locator('.task').count() === 4);

    await b.getByRole('button', { name: 'Share' }).click();
    check('share: a QR code dialog opens', await b.locator('.modal-card img').isVisible());
    await b.getByRole('button', { name: 'Close' }).click();

    const live = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    await live.goto(URL_ + '/?mode=live');
    await visible(live, 'Connected', 8000);
    check('live: shows the Live badge, not Simulated workers', await visible(live, 'Live', 2000) && !(await live.getByText('Simulated workers').isVisible()));
    check('live: no Reset button', await live.getByRole('button', { name: 'Reset' }).count() === 0);
    check('live: judge scenario buttons are not there', await live.getByRole('button', { name: 'Run map-reduce' }).count() === 0);
    await live.waitForTimeout(3000);
    check('live: nothing is simulated (no work appears by itself)', await live.locator('.task').count() === 0);
    await Promise.all([a.context().close(), b.context().close(), live.context().close()]);
  }

  // ---- operator control of the live session (fresh database, so the first visitor can claim it) ----
  {
    execSync('spacetime publish bilal-auth --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes', { stdio: 'pipe' });
    const LIVE = URL_ + '/?mode=live&db=bilal-auth';
    const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const A = await ctxA.newPage();
    const errs: string[] = [];
    A.on('pageerror', e => errs.push(String(e)));
    await A.goto(LIVE);
    check('control: a new visitor is view-only and the forms are disabled', await visible(A, 'View only', 8000) && await A.getByLabel('Title', { exact: true }).isDisabled());
    await shot(A, '8-control-viewonly');
    await A.getByRole('button', { name: 'Become the operator' }).click();
    check('control: claiming the empty database makes you the operator', await visible(A, 'You are an operator', 5000) && await A.getByLabel('Title', { exact: true }).isEnabled());

    await A.getByLabel('Title', { exact: true }).fill('Add the login endpoint');
    await A.getByLabel('Files it will touch').fill('src/api/login.py, tests/test_login.py');
    await A.getByRole('button', { name: 'Create task' }).click();
    check('control: a new task shows up on the board', await visible(A, 'Add the login endpoint', 5000) && await visible(A, 'Task created.', 3000));

    await A.getByLabel('Goal').fill('Review every module');
    await A.getByLabel(/Pieces, one per line/).fill('Review module a | src/a.py\nReview module b | src/b.py');
    await A.getByRole('button', { name: 'Create job' }).click();
    check('control: a big job shows its progress bar (0/2) and a blocked merge task', await visible(A, '0/2 pieces done', 5000) && await A.locator('.column', { hasText: 'Blocked' }).getByText('Merge the results').isVisible());

    await A.getByLabel(/Text \(keep it short/).fill('Use TypeScript everywhere.');
    await A.getByRole('button', { name: 'Save notes' }).click();
    check('control: notes are saved', await visible(A, 'Notes saved.', 4000));
    await shot(A, '9-control-operator');

    await A.reload();
    check('control: the browser keeps its identity after a reload (still an operator)', await visible(A, 'You are an operator', 8000));
    check('control: the saved notes are still there', await A.getByLabel(/Text \(keep it short/).inputValue() === 'Use TypeScript everywhere.');

    // a second browser is a different identity
    const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const B = await ctxB.newPage();
    await B.goto(LIVE);
    check('control: a second browser is view-only and cannot claim', await visible(B, 'View only', 8000) && await B.getByRole('button', { name: 'Become the operator' }).count() === 0);
    check('control: it can see the tasks the operator made', await visible(B, 'Add the login endpoint', 3000));
    const bHex = await B.locator('.who-am-i code').first().getAttribute('title');
    check('control: its identity is shown so it can be authorized', /^[0-9a-f]{64}$/i.test(bHex ?? ''), bHex);

    await A.getByLabel(/Identity \(64 hex/).fill('not-an-identity');
    await A.getByRole('button', { name: 'Authorize' }).click();
    check('control: a bad identity is refused with a plain message', await visible(A, 'An identity is 64 hex characters.', 3000));
    await A.getByLabel(/Identity \(64 hex/).fill(bHex!);
    await A.getByRole('button', { name: 'Authorize' }).click();
    check('control: after authorizing, the second browser becomes an operator without reloading', await visible(B, 'You are an operator', 6000) && await B.getByLabel('Title', { exact: true }).isEnabled());

    await A.getByRole('button', { name: 'remove' }).first().click();
    check('control: removing it takes the access away again', await visible(B, 'View only', 6000) && await B.getByLabel('Title', { exact: true }).isDisabled());
    check('control: no page errors', errs.length === 0, errs);
    await ctxA.close();
    await ctxB.close();

    // phone: the Control tab exists and works
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const P = await ctxP.newPage();
    await P.goto(LIVE);
    await visible(P, 'View only', 8000);
    await P.locator('.tabs button', { hasText: 'Control' }).click();
    check('phone: the Control tab shows the forms', await P.getByLabel('Title', { exact: true }).isVisible());
    check('phone: control inputs are at least 44px tall', await P.locator('.form input, .form select, .form .btn').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent && (e as HTMLElement).offsetHeight < 44).length === 0));
    await shot(P, '10-phone-control');
    await ctxP.close();
  }

  // ---- present view, mock, offline ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL_ + '/?view=present');
    await visible(page, 'Connected', 8000);
    check('present: no scenario buttons, no share, no reset', await page.getByRole('button', { name: /Run the demo|Reset|Share|hit a limit/ }).count() === 0);

    await page.goto(URL_ + '/?mock=1');
    check('mock: shows the seed data without a brain', await visible(page, 'Define auth API spec', 4000));
    check('mock: controls are off', await page.getByRole('button', { name: 'Make Sam hit a limit' }).first().isDisabled());
    await shot(page, '7-mock');

    await page.goto(URL_ + '/?uri=ws://127.0.0.1:9&db=nothing');
    check('offline: a banner says the brain is unreachable', await visible(page, 'Can\'t reach the brain', 12_000));
    check('offline: still shows a picture of the demo', await visible(page, 'Define auth API spec', 2000));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
