// The brain restarts in the middle of work. The page must say it is reconnecting and recover by
// itself; a worker must carry on and finish a task created after the restart.
// RESTARTS the local SpacetimeDB (127.0.0.1:3001). Needs `spacetime` on PATH, the preview on 4173.
import { chromium } from 'playwright-core';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DbConnection, tables } from '../../brain/bindings/index.js';

const DB = 'bilal-reconnect';
const URL_ = `${process.env.UI_URL ?? 'http://localhost:4173'}/?db=${DB}`;
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  reconnect: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ps = (cmd: string) => execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf8', stdio: 'pipe' });
const stopBrain = () => ps("Get-Process | Where-Object { $_.ProcessName -like 'spacetime*' } | Stop-Process -Force");
const startBrain = () => {
  spawn('spacetime start --listen-addr 127.0.0.1:3001', { detached: true, stdio: 'ignore', shell: true }).unref();
};
const up = async () => { for (let i = 0; i < 60; i++) { try { if (ps('[bool](Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)').trim() === 'True') return true; } catch { /* not yet */ } await sleep(500); } return false; };
const connect = () => new Promise<DbConnection>((res, rej) => {
  DbConnection.builder().withUri('ws://127.0.0.1:3001').withDatabaseName(DB)
    .onConnect(c => { c.subscriptionBuilder().onApplied(() => res(c)).subscribe([tables.tasks]); }).onConnectError((_c, e) => rej(e)).build();
});

execSync(`spacetime publish ${DB} --server dev3001 --no-config --module-path ../brain/spacetimedb --delete-data=always --yes`, { stdio: 'pipe' });
const launcher = spawn(process.execPath, ['--import', 'file:///' + fileURLToPath(new URL('../../launcher/node_modules/tsx/dist/esm/index.mjs', import.meta.url)).split('\\').join('/'),
  fileURLToPath(new URL('../../launcher/launcher.ts', import.meta.url)), '--name', 'Sturdy', '--simulate', '--sim-ms', '800', '--poll', '1'],
  { env: { ...process.env, STDB_URI: 'ws://127.0.0.1:3001', STDB_DB: DB, TANDEM_SESSION: 'live' }, stdio: 'ignore' });

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${URL_}&host=1`);
  await page.getByLabel('Describe what you want built').waitFor({ timeout: 10_000 });
  check('setup: the page is connected and the worker is online', await page.getByText('1 worker online').waitFor({ timeout: 15_000 }).then(() => true, () => false));

  stopBrain();
  check('brain stopped: the page says the connection is lost', await page.getByText('Connection lost. Reconnecting…').waitFor({ timeout: 15_000 }).then(() => true, () => false));
  await sleep(3000);
  startBrain();
  check('brain back: it is listening again', await up());
  check('the page reconnects by itself (the banner goes away)', await page.getByText('Connection lost. Reconnecting…').waitFor({ state: 'hidden', timeout: 45_000 }).then(() => true, () => false));

  // work created after the restart is still picked up by the same worker process
  const conn = await connect();
  await conn.reducers.createTask({ sessionId: 'live', kind: 'normal', task: { id: 't-after', title: 'Work after the restart', description: '', files: ['after.txt'], difficulty: 'easy', model: '', effort: 'default', dependsOn: [] } }).catch(() => {});
  // createTask in live needs a controller; if refused, the page adds it instead
  await sleep(500);
  if (![...conn.db.tasks.iter()].some(t => t.id === 't-after')) {
    await page.goto(URL_ + '#/settings');
    await page.getByLabel('Title', { exact: true }).fill('Work after the restart');
    await page.getByLabel('Files it will touch').fill('after.txt');
    await page.getByRole('button', { name: 'Create task' }).click();
    await page.goto(URL_ + '#/board');
  }
  const finished = await (async () => { for (let i = 0; i < 90; i++) { if ([...conn.db.tasks.iter()].some(t => t.title === 'Work after the restart' && t.status === 'done')) return true; await sleep(500); } return false; })();
  check('the worker reconnected by itself and finished a task created after the restart', finished);
  check('the page shows it done without a reload', await page.getByText('1 of 1 tasks done').waitFor({ timeout: 10_000 }).then(() => true, () => false));
  conn.disconnect();
} finally {
  launcher.kill();
  await browser.close();
}
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
