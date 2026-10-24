// Last step of mcp/test/e2e/loop.ps1: the dashboard (My team view) shows the goal planned and
// every task done. Env: UI_URL (default http://localhost:5173), STDB_DB, SHOTS (optional folder)
import { chromium } from 'playwright-core';
import { join } from 'node:path';

const URL_ = (process.env.UI_URL ?? 'http://localhost:5173') + `/?mode=team&db=${process.env.STDB_DB}`;
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  dashboard: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await page.goto(URL_);
  const shown = await page.getByText('Connected').first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  check('the My team view connects to the loop database', shown);
  check('the goal shows as planned', await page.getByText('✓ Planned').first().waitFor({ timeout: 5000 }).then(() => true, () => false));
  const summary = await page.locator('.summary-top strong').innerText().catch(() => '');
  const m = summary.match(/^(\d+) of (\d+) tasks done$/);
  check('the summary says every task is done', !!m && m[1] === m[2] && Number(m[2]) >= 2, summary);
  const doneCards = await page.locator('.column', { has: page.locator('h3', { hasText: 'Done' }) }).locator('.task').count();
  check('every task card is in the Done column', !!m && doneCards === Number(m[2]), doneCards);
  check('the team panel lists both workers', await page.locator('.worker', { hasText: 'Alice' }).count() === 1 && await page.locator('.worker', { hasText: 'Bob' }).count() === 1);
  if (process.env.SHOTS) await page.screenshot({ path: join(process.env.SHOTS, 'loop-dashboard.png'), fullPage: true });
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nDASHBOARD PASSED' : `\nDASHBOARD: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
