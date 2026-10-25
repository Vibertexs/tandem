// THE PRODUCT, END TO END, the way a person uses it:
//   in the project: tandem start  ->  open the page (it takes control by itself)
//   ->  type a goal  ->  the manager plans it (1 real haiku run)  ->  simulated workers do it
//   ->  the board shows every task done  ->  tandem stop
// Needs: Chrome, claude on PATH. Uses a fresh team (bilal-start) and a throwaway repo.
// FLOW_REAL=1: real workers instead of simulated ones (each task is a haiku run, about 4 runs in
// total). Then it also checks the goal's work was merged into one tandem/<goal> branch.
import { chromium, type Page } from 'playwright-core';
import { execFileSync, execSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const REAL = process.env.FLOW_REAL === '1';
const REVIEW = REAL && process.env.FLOW_REVIEW === '1'; // also --review: one more run per goal
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
// Runs the tandem command in `cwd`, the way a person would. Output goes to a file so a stray
// handle in a background process can never keep this test waiting.
// Its own state folder: `tandem stop` in this test then stops only what this test started, never a
// real session running on the same computer.
const TEST_STATE = mkdtempSync(join(tmpdir(), 'tandem-flow-state-'));
const tandem = (args: string[], cwd: string) => {
  const log = join(tmpdir(), `tandem-${args[0]}-${Date.now()}.log`);
  const fd = openSync(log, 'w');
  // (the fake-coding switch is for tests only: it is an environment variable, not an option)
  try { execFileSync(process.execPath, [join(ROOT, 'cli', 'tandem.ts'), ...args], { cwd, stdio: ['ignore', fd, fd], env: { ...process.env, TANDEM_STATE: TEST_STATE, ...(REAL ? {} : { TANDEM_SIMULATE: '1' }) } }); }
  catch { /* the output says what went wrong */ } finally { closeSync(fd); }
  return readFileSync(log, 'utf8');
};
// the project the team works on: a git repo with a first commit
if (!existsSync(join(REPO, '.git'))) {
  mkdirSync(REPO, { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: REPO, stdio: 'pipe' });
  g('init', '-q'); writeFileSync(join(REPO, 'README.md'), '# test project\n'); writeFileSync(join(REPO, '.gitignore'), '.worktrees/\n');
  g('add', '-A'); g('commit', '-q', '-m', 'start');
}

const started = tandem(['start', '--team', DB, '--workers', '2', ...(REVIEW ? ['--review'] : []), '--fresh', '--local', '--no-browser'], REPO);
console.log(started.split('\n').filter(l => /==|started|ready|Open|workers/i.test(l)).join('\n'));
check('tandem start, run in the project, finishes and says it is running for that project', started.includes(`Tandem is running for ${REPO}`), started.slice(-400));

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
  // the page `tandem start` opens (host=1): control and the manager's approval happen by themselves
  await page.goto(`${URL_}&host=1`);
  check('the host page takes control by itself: the prompt is on, no question asked', await page.getByLabel('Describe what you want built').waitFor({ timeout: 15_000 }).then(() => true, () => false) && await page.getByText('Watch only').count() === 0);
  check('the manager is approved without a click and online', await seen(page, 'Manager online', 40_000));
  check('the workers are online (no "No workers" step)', await page.getByText('No workers are online.').waitFor({ state: 'hidden', timeout: 15_000 }).then(() => true, () => false));
  await page.getByLabel('Describe what you want built').fill('Create a tiny Python calculator: calc.py with add(a, b) and sub(a, b), test_calc.py with unittest tests, and a README.md.');
  await page.getByRole('button', { name: /^Send/ }).click();
  const goalLane = page.locator('.goal-lane').first();
  check('the goal is sent and gets its lane, waiting for the manager', await seen(page, /Waiting for the manager|Being planned/, 5000));
  check('the manager plans it within 3 minutes', await goalLane.locator('.lane-head').getByText(/Planned|Done/).waitFor({ timeout: 180_000 }).then(() => true, () => false));
  const total = await page.locator('.summary-top strong').innerText().catch(() => '');
  check('the plan has at least 2 tasks', Number(total.match(/of (\d+)/)?.[1] ?? 0) >= 2, total);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'flow-planned.png') });
  const allDone = await page.waitForFunction(() => {
    const t = document.querySelector('.summary-top strong')?.textContent ?? '';
    const m = t.match(/^(\d+) of (\d+) tasks done$/);
    return !!m && m[1] === m[2];
  }, undefined, { timeout: REAL ? 600_000 : 180_000 }).then(() => true, () => false);
  check(`the ${REAL ? 'real' : 'simulated'} workers finish every task`, allDone, await page.locator('.summary-top strong').innerText().catch(() => ''));
  check('the manager marks the goal done', await goalLane.locator('.lane-head').getByText('✓ Done').waitFor({ timeout: 30_000 }).then(() => true, () => false));
  if (REAL) {
    const branch = (await goalLane.locator('.branch code').innerText().catch(() => '')).trim();
    check('the goal shows the branch with all of its work', /^tandem\/[a-z0-9-]+$/.test(branch) && !/\/g-/.test(branch), branch);
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
    const card = await goalLane.innerText().catch(() => '');
    check("the goal's lane says the tests passed and what it cost", /Tests pass/.test(card) && /\$\d+\.\d+ of Claude usage/.test(card), card);
    if (REVIEW) check("with --review, a worker reviewed the branch and its findings are on the goal's lane", /Review the goal's work/.test(card) && /Review: \S/.test(card), card);
  }
  check('the board shows the goal at 100%', await goalLane.innerText().then(t => /(\d+)\/\1/.test(t)).catch(() => false));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'flow-done.png'), fullPage: true });
  await page.locator('.nav a', { hasText: 'Shared memory' }).click();
  const interfaces = await page.getByLabel('Interfaces').inputValue().catch(() => '');
  console.log(`  (the manager wrote to Interfaces: ${interfaces ? JSON.stringify(interfaces.slice(0, 100)) : 'nothing'})`);
  await page.locator('.nav a', { hasText: 'Team' }).click();
  check('the Team page shows the two workers', await page.locator('.worker').nth(1).waitFor({ timeout: 5000 }).then(async () => await page.locator('.worker').count() === 2, () => false));
} finally {
  await browser.close();
  const stopped = tandem(['stop'], REPO);
  console.log(stopped.trim());
  await new Promise(r => setTimeout(r, 1500));
  const left = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'watch.ts|launcher.ts\' -and $_.CommandLine.Contains(\'' + REPO.replace(/\\/g, '\\\\') + '\') } | Measure-Object).Count"', { encoding: 'utf8' }).trim();
  check('tandem stop stops the manager and both workers, and none are left running',
    /stopped manager/.test(stopped) && (stopped.match(/stopped worker/g) ?? []).length === 2 && left === '0', { stopped, left });
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
