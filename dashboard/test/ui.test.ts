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
const col = (page: Page, name: string) => page.locator('.column', { has: page.locator('h3', { hasText: name }) });
const prompt = (page: Page) => page.getByLabel('What should your team build?');
const send = (page: Page) => page.getByRole('button', { name: /^Send/ });
const desktop = { width: 1400, height: 1000 };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// isEnabled() does not wait, so poll.
const until = async (fn: () => Promise<boolean>, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch { /* keep waiting */ } await sleep(150); }
  return false;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  // ================= Demo, desktop =================
  {
    const ctx = await browser.newContext({ viewport: desktop });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL_);
    check('demo: one prompt box is the first thing you see', await prompt(page).waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false));
    check('demo: connected, with the "Simulated workers" badge', await visible(page, 'Connected', 4000) && await visible(page, 'Simulated workers', 2000));
    check('demo: the mode switch shows Demo as current', await page.locator('.seg a[aria-current="page"]').innerText() === 'Demo');
    check('demo: the three teammates are there', await visible(page, 'Alex', 5000) && await visible(page, 'Jordan', 2000));
    await shot(page, '1-demo-empty');

    // an example goal: the 12-piece job
    await page.getByRole('button', { name: 'Review all 12 modules' }).click();
    check('progress: the summary says 0 of 13 tasks done', await visible(page, '0 of 13 tasks done', 5000));
    check('progress: the merge task is in Waiting, not Ready', await col(page, 'Waiting').getByText('Merge review findings').isVisible());
    await page.waitForTimeout(6000);
    const working = col(page, 'Working');
    check('progress: tasks in Working show who is on them and for how long', await working.locator('.task').first().innerText().then(t => /· \d+s/.test(t) && /Alex|Sam|Jordan/.test(t)));
    check('progress: a working card has a moving progress strip', await working.locator('.work-bar').count() > 0);
    check('progress: the summary counts working tasks', await page.locator('.stage-chip.stage-working').innerText().then(t => parseInt(t) > 0));
    check('progress: a teammate card says what they are on and for how long', await page.locator('.worker', { hasText: 'Working on:' }).first().innerText().then(t => /· \d+s/.test(t)));
    check('progress: locks are listed', await page.locator('.lock-row').count() > 0);
    check('progress: the log has plain-English lines', await visible(page, 'claimed:', 2000));
    await shot(page, '2-demo-working');
    await page.locator('.task').first().click();
    check('details: clicking a task explains it', await page.locator('.why p').first().innerText().then(t => t.length > 10));
    check('progress: the big job bar reaches 12/12', await visible(page, '12/12 pieces done', 60_000));
    check('progress: everything finishes (13 of 13) and the merge task is in Done', await visible(page, '13 of 13 tasks done', 30_000) && await col(page, 'Done').getByText('Merge review findings').isVisible());
    check('progress: finished cards say who did them', await col(page, 'Done').locator('.done-line').first().innerText().then(t => /Finished by/.test(t)));
    await shot(page, '3-demo-done');

    // reset, then type your own goal
    await page.getByRole('button', { name: 'Reset' }).click();
    check('reset: back to an empty board', await visible(page, 'No tasks yet', 5000));
    await prompt(page).fill('Write a README');
    await send(page).click();
    check('prompt: a typed goal becomes a task that appears', await visible(page, 'Write a README', 4000));
    check('prompt: a simulated teammate finishes it', await col(page, 'Done').getByText('Write a README').waitFor({ timeout: 30_000 }).then(() => true, () => false));

    // break it
    await page.getByRole('button', { name: 'Reset' }).click();
    await visible(page, 'No tasks yet', 5000);
    await page.getByRole('button', { name: 'Build a login page with an API' }).click();
    check('demo: the login goal creates tasks', await visible(page, 'Define auth API spec', 4000));
    check('demo: later tasks wait for the earlier ones', await col(page, 'Waiting').locator('.task').count() === 3);
    await page.getByRole('button', { name: 'Make Sam hit a limit' }).click();
    check('limit: Sam shows as Capped (icon plus text)', await page.locator('.worker', { hasText: 'Sam' }).getByText('Capped').waitFor({ timeout: 4000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Make two agents edit the same file' }).click();
    check('same file: a task shows "waiting for lock"', await visible(page, 'waiting for lock', 8000));
    await page.getByRole('button', { name: 'Teammate goes idle' }).click();
    check('idle: an urgent task appears', await visible(page, 'Urgent hotfix', 4000));
    check('poke: usage sliders are there', await page.locator('.worker input[type=range]').first().isVisible());
    check('demo: no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  // ================= Demo, phone =================
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(URL_);
    check('phone: the prompt box is on the first screen', await prompt(page).waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false));
    await page.getByRole('button', { name: 'Build a login page with an API' }).click();
    await visible(page, 'Define auth API spec', 4000);
    check('phone: tabs Tasks | Team | Locks | Log', (await page.locator('.tabs button').allInnerTexts()).join('|') === 'Tasks|Team|Locks|Log');
    check('phone: only the Tasks panel shows on the Tasks tab', await page.locator('.panel.tasks').isVisible() && !(await page.locator('.panel.team').isVisible()) && !(await page.locator('.panel.locks').isVisible()) && !(await page.locator('.panel.log').isVisible()));
    const small = await page.locator('.tabs button, .chip-btn, .prompt .btn, .scenarios .btn').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent && (e as HTMLElement).offsetHeight < 44).length);
    check('phone: tap targets are at least 44px tall', small === 0, small);
    check('phone: no horizontal page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(page, '4-phone-tasks');
    await page.locator('.tabs button', { hasText: 'Team' }).click();
    check('phone: Team tab shows teammates and hides tasks', await visible(page, 'Alex', 2000) && !(await page.locator('.panel.tasks').isVisible()));
    await page.locator('.tabs button', { hasText: 'Log' }).click();
    check('phone: Log tab shows events', await visible(page, 'What just happened', 2000));
    await ctx.close();
  }

  // ================= Two people at once, share =================
  {
    const a = await (await browser.newContext({ viewport: desktop })).newPage();
    const b = await (await browser.newContext({ viewport: desktop })).newPage();
    await Promise.all([a.goto(URL_), b.goto(URL_)]);
    await Promise.all([visible(a, 'Alex', 8000), visible(b, 'Alex', 8000)]);
    await a.getByRole('button', { name: 'Review all 12 modules' }).click();
    await b.getByRole('button', { name: 'Build a login page with an API' }).click();
    await a.waitForTimeout(1500);
    const tasksA = await a.locator('.task').count();
    const tasksB = await b.locator('.task').count();
    check('sandboxes: each browser has its own (13 vs 4 tasks)', tasksA === 13 && tasksB === 4, [tasksA, tasksB]);
    await a.getByRole('button', { name: 'Reset' }).click();
    await a.waitForTimeout(1500);
    check('sandboxes: Reset in one browser does not touch the other', await a.locator('.task').count() === 0 && await b.locator('.task').count() === 4);
    await b.getByRole('button', { name: 'Share' }).click();
    check('share: a QR code dialog opens', await b.locator('.modal-card img').isVisible());
    await b.getByRole('button', { name: 'Close' }).click();
    await Promise.all([a.context().close(), b.context().close()]);
  }

  // ================= My team: claim, goals, manage, join, approve (fresh database) =================
  {
    execSync('spacetime publish bilal-auth --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes', { stdio: 'pipe' });
    const TEAM = URL_ + '/?mode=team&db=bilal-auth';
    const ctxA = await browser.newContext({ viewport: desktop });
    const A = await ctxA.newPage();
    const errs: string[] = [];
    A.on('pageerror', e => errs.push(String(e)));
    await A.goto(TEAM);
    check('team: the mode switch shows My team as current', await A.locator('.seg a[aria-current="page"]').innerText().then(t => t === 'My team', () => false));
    check('team: a first visitor is invited to claim the team, and the prompt is off', await visible(A, "You're first here", 8000) && await prompt(A).isDisabled());
    check('team: no demo chrome (no simulated badge, no example chips, no scenario buttons)',
      await A.getByText('Simulated workers').count() === 0 && await A.getByRole('button', { name: 'Review all 12 modules' }).count() === 0 && await A.getByRole('button', { name: 'Make Sam hit a limit' }).count() === 0);
    await shot(A, '5-team-claim');
    await A.getByRole('button', { name: 'Claim this team' }).click();
    check('team: claiming makes you the operator and turns the prompt on', await until(() => prompt(A).isEnabled()) && await A.getByText("You're first here").count() === 0);

    await prompt(A).fill('Add a login page with an API');
    await send(A).click();
    check('team: a goal is saved and waits for the manager', await visible(A, 'Waiting for the manager', 5000) && await visible(A, 'Add a login page with an API', 1000));

    // by hand, under Manage
    await A.locator('.manage-panel summary').click();
    await A.getByLabel('Title', { exact: true }).fill('Add the login endpoint');
    await A.getByLabel('Files it will touch').fill('src/api/login.py, tests/test_login.py');
    await A.getByRole('button', { name: 'Create task' }).click();
    check('manage: a task made by hand lands in Ready', await col(A, 'Ready').getByText('Add the login endpoint').waitFor({ timeout: 5000 }).then(() => true, () => false));
    await A.getByLabel('Goal', { exact: true }).fill('Review every module');
    await A.getByLabel(/Pieces, one per line/).fill('Review module a | src/a.py\nReview module b | src/b.py');
    await A.getByRole('button', { name: 'Create job' }).click();
    check('manage: a big job shows 0/2 and a merge task in Waiting', await visible(A, '0/2 pieces done', 5000) && await col(A, 'Waiting').getByText('Merge the results').isVisible());
    check('progress: the summary counts them (0 of 4 done)', await visible(A, '0 of 4 tasks done', 3000));
    await A.getByLabel(/Text \(keep it short/).fill('Use TypeScript everywhere.');
    await A.getByRole('button', { name: 'Save notes' }).click();
    check('manage: notes are saved', await visible(A, 'Notes saved.', 4000));
    await shot(A, '6-team-operator');

    await A.reload();
    check('team: after a reload the browser is still the operator (no claim banner, prompt on)', await until(() => prompt(A).isEnabled(), 10_000) && await A.getByText("You're first here").count() === 0);
    check('team: goals and tasks persist', await visible(A, 'Add a login page with an API', 4000) && await visible(A, 'Add the login endpoint', 2000));

    // add a teammate
    await A.getByRole('button', { name: 'Add a teammate' }).click();
    const dialog = await A.locator('.join').innerText();
    check('join: the dialog gives the exact command with this team in it', /claude mcp add tandem/.test(dialog) && /TANDEM_SESSION=live/.test(dialog) && /STDB_DB=bilal-auth/.test(dialog), dialog.slice(0, 200));
    check('join: it says what to tell Claude', /Register with the tandem tools/.test(dialog));
    await shot(A, '7-join');
    await A.getByRole('button', { name: 'Close' }).click();
    await A.locator('.manage-panel summary').click(); // Manage closes again after a reload

    // a second browser is a different identity
    const ctxB = await browser.newContext({ viewport: desktop });
    const B = await ctxB.newPage();
    await B.goto(TEAM);
    check('team: a second browser is view-only, cannot claim, and the prompt is off', await visible(B, 'View only', 8000) && await B.getByRole('button', { name: 'Claim this team' }).count() === 0 && await prompt(B).isDisabled());
    check('team: it can still watch everything the operator made', await visible(B, 'Add the login endpoint', 3000) && await visible(B, '0 of 4 tasks done', 2000));
    const bHex = await B.locator('button[data-identity]').getAttribute('data-identity');
    check('team: it can copy its identity to hand to the operator', /^[0-9a-f]{64}$/i.test(bHex ?? ''), bHex);

    await A.getByLabel(/Identity \(64 hex/).fill('not-an-identity');
    await A.getByRole('button', { name: 'Authorize' }).click();
    check('approve: a bad identity is refused with a plain message', await visible(A, 'An identity is 64 hex characters.', 3000));
    await A.getByLabel(/Identity \(64 hex/).fill(bHex!);
    await A.getByRole('button', { name: 'Authorize' }).click();
    check('approve: the second browser becomes an operator without reloading', await until(() => prompt(B).isEnabled()) && await B.getByText('View only').count() === 0);
    await A.getByRole('button', { name: 'remove' }).first().click();
    check('approve: removing it takes the access away again', await visible(B, 'View only', 6000) && await until(() => prompt(B).isDisabled()));
    check('team: no page errors', errs.length === 0, errs);
    await ctxA.close();
    await ctxB.close();

    // phone, team
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const P = await ctxP.newPage();
    await P.goto(TEAM);
    await visible(P, 'View only', 8000);
    check('phone team: tabs include Manage', (await P.locator('.tabs button').allInnerTexts()).join('|') === 'Tasks|Team|Locks|Log|Manage');
    await P.locator('.tabs button', { hasText: 'Manage' }).click();
    check('phone team: the Manage tab shows the forms, with 44px inputs', await P.getByLabel('Title', { exact: true }).isVisible() &&
      await P.locator('.form input, .form select, .form .btn').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent && (e as HTMLElement).offsetHeight < 44).length === 0));
    await shot(P, '8-phone-manage');
    await ctxP.close();

    // the old URL still works
    const ctxL = await browser.newContext({ viewport: desktop });
    const L = await ctxL.newPage();
    await L.goto(URL_ + '/?mode=live&db=bilal-auth');
    check('team: the old ?mode=live link still opens My team', await L.locator('.seg a[aria-current="page"]').innerText().then(t => t === 'My team', () => false));
    await ctxL.close();
  }

  // ================= present, mock, offline =================
  {
    const ctx = await browser.newContext({ viewport: desktop });
    const page = await ctx.newPage();
    await page.goto(URL_ + '/?view=present');
    await visible(page, 'Connected', 8000);
    check('present: no prompt, no buttons, no mode switch', await page.locator('.prompt').count() === 0 && await page.getByRole('button').count() === 0 && await page.locator('.seg').count() === 0);

    await page.goto(URL_ + '/?mock=1');
    check('mock: shows the seed data without a brain', await visible(page, 'Define auth API spec', 4000));
    check('mock: controls are off', await prompt(page).isDisabled() && await page.getByRole('button', { name: 'Review all 12 modules' }).isDisabled());
    await shot(page, '9-mock');

    await page.goto(URL_ + '/?uri=ws://127.0.0.1:9&db=nothing');
    check('offline: a banner says the brain is unreachable', await visible(page, "Can't reach the brain", 12_000));
    check('offline: still shows a picture of the demo', await visible(page, 'Define auth API spec', 2000));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
