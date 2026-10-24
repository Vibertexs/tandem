// THE PRODUCT, END TO END, the way a person uses it:
//   .\start.ps1 -Simulate  ->  open the page  ->  Make me the owner  ->  Approve "Manager Claude"
//   ->  type a goal  ->  the manager plans it (1 real haiku run)  ->  simulated workers do it
//   ->  the board shows every task done  ->  .\stop.ps1
// Needs: Chrome, claude on PATH. Uses a fresh team (bilal-start) and a throwaway repo.
// FLOW_REAL=1: real workers instead of simulated ones (each task is a haiku run, about 4 runs in
// total). Then it also checks the goal's work was merged into one tandem/<goal> branch.
import { chromium, type Page } from 'playwright-core';
import { execSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REAL = process.env.FLOW_REAL === '1';
const DB = REAL ? 'bilal-real' : 'bilal-start';
const REPO = REAL ? 'C:\\Code\\scratch\\real-repo' : 'C:\\Code\\scratch\\start-repo';
const URL_ = `http://localhost:5173/?db=${DB}`;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  start-flow: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const seen = (page: Page, text: string | RegExp, ms: number) =>
  page.getByText(text).first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);
// Output goes to a file, not a pipe: start.ps1's background processes inherit the handle, so a
// pipe would never close and execSync would wait forever.
const ps = (script: string, args: string) => {
  const log = join(tmpdir(), `tandem-${script}-${Date.now()}.log`);
  const fd = openSync(log, 'w');
  try {
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${join(ROOT, script)}" ${args}`, { cwd: ROOT, stdio: ['ignore', fd, fd] });
  } catch { /* the output says what went wrong */ } finally { closeSync(fd); }
  return readFileSync(log, 'utf8');
};

const started = ps('start.ps1', `-Db ${DB} ${REAL ? '' : '-Simulate'} -Fresh -NoBrowser -Repo ${REPO}`);
console.log(started.split('\n').filter(l => /==|started|ready|worker|Open/i.test(l)).join('\n'));
check('start.ps1 finishes and says Ready', /== Ready/.test(started), started.slice(-400));

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
  await page.goto(URL_);
  check('the page asks to make me the owner of the new team', await seen(page, 'has no owner yet', 15_000));
  await page.getByRole('button', { name: 'Make me the owner' }).click();
  check('the manager asks to help, and I approve it with one click', await seen(page, 'Manager Claude wants to help manage this team.', 30_000));
  await page.getByRole('button', { name: 'Approve' }).click();
  check('the workers are online (no "No workers" step)', await page.getByText('No workers are online.').waitFor({ state: 'hidden', timeout: 15_000 }).then(() => true, () => false));
  await page.getByLabel('Describe what you want built').fill('Create a tiny Python calculator: calc.py with add(a, b) and sub(a, b), test_calc.py with unittest tests, and a README.md.');
  await page.getByRole('button', { name: /^Send/ }).click();
  check('the goal is sent and waits for the manager', await seen(page, /Waiting for the manager|Being planned/, 5000));
  check('the manager plans it within 3 minutes', await page.locator('.latest').getByText(/Planned|Done/).waitFor({ timeout: 180_000 }).then(() => true, () => false));
  const total = await page.locator('.summary-top strong').innerText().catch(() => '');
  check('the plan has at least 2 tasks', Number(total.match(/of (\d+)/)?.[1] ?? 0) >= 2, total);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'flow-planned.png') });
  const allDone = await page.waitForFunction(() => {
    const t = document.querySelector('.summary-top strong')?.textContent ?? '';
    const m = t.match(/^(\d+) of (\d+) tasks done$/);
    return !!m && m[1] === m[2];
  }, undefined, { timeout: REAL ? 600_000 : 180_000 }).then(() => true, () => false);
  check(`the ${REAL ? 'real' : 'simulated'} workers finish every task`, allDone, await page.locator('.summary-top strong').innerText().catch(() => ''));
  check('the manager marks the goal done', await page.locator('.latest').getByText('✓ Done').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  if (REAL) {
    const branch = (await page.locator('.goal-row .link.mono').first().innerText().catch(() => '')).trim();
    check('the goal shows the branch with all of its work', /^tandem\/g-/.test(branch), branch);
    let files: string[] = [];
    try { files = execSync(`git -C ${REPO} ls-tree -r --name-only ${branch}`, { encoding: 'utf8' }).trim().split('\n'); } catch { /* no branch */ }
    check('that branch really has the calculator, its tests and the README', ['calc.py', 'test_calc.py', 'README.md'].every(f => files.includes(f)), files);
    let ok = false; let out = '';
    try {
      execSync(`git -C ${REPO} worktree add -q ${REPO}\\.worktrees\\verify ${branch}`, { stdio: 'pipe' });
      out = execSync('python -I -m unittest discover', { cwd: `${REPO}\\.worktrees\\verify`, encoding: 'utf8', stdio: 'pipe' }); ok = true;
    } catch (e) { out = String((e as { stderr?: string }).stderr ?? e); ok = /OK\s*$/.test(out); }
    finally { try { execSync(`git -C ${REPO} worktree remove --force ${REPO}\\.worktrees\\verify`, { stdio: 'pipe' }); } catch { /* gone */ } }
    check("the workers' tests pass on the goal branch", ok, out.slice(-300));
  }
  check('the board shows the goal at 100%', await page.locator('.goal-row').first().innerText().then(t => /(\d+)\/\1/.test(t)).catch(() => false));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'flow-done.png'), fullPage: true });
  await page.locator('.nav a', { hasText: 'Shared memory' }).click();
  const interfaces = await page.getByLabel('Interfaces').inputValue().catch(() => '');
  console.log(`  (the manager wrote to Interfaces: ${interfaces ? JSON.stringify(interfaces.slice(0, 100)) : 'nothing'})`);
  await page.locator('.nav a', { hasText: 'Team' }).click();
  check('the Team page shows the two workers', await page.locator('.worker').nth(1).waitFor({ timeout: 5000 }).then(async () => await page.locator('.worker').count() === 2, () => false));
} finally {
  await browser.close();
  const stopped = ps('stop.ps1', '');
  console.log(stopped.trim());
  await new Promise(r => setTimeout(r, 1500));
  const left = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'watch.ts|launcher.ts\' } | Measure-Object).Count"', { encoding: 'utf8' }).trim();
  check('stop.ps1 stops the manager and both workers, and none are left running',
    /stopped manager/.test(stopped) && (stopped.match(/stopped worker/g) ?? []).length === 2 && left === '0', { stopped, left });
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
