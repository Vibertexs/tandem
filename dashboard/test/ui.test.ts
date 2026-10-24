// Drives the real page in Chrome. Needs: the local brain with bilal-dev published, and
//   npm run build && npm run preview -- --port 4173
// Env: UI_URL (default http://localhost:4173), CHROME (path), SHOTS (folder for screenshots)
import { chromium, type Page } from 'playwright-core';
import { mkdirSync } from 'node:fs';
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
    check('live: scenario buttons are off', await live.getByRole('button', { name: 'Run map-reduce' }).first().isDisabled());
    await live.waitForTimeout(3000);
    check('live: nothing is simulated (no work appears by itself)', await live.locator('.task').count() === 0);
    await Promise.all([a.context().close(), b.context().close(), live.context().close()]);
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
