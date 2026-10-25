// Starting Claude Code when it is a .cmd shim (an npm install) and when it is a .exe, on Windows.
// A stand-in claude.cmd just prints the arguments it was given. No Claude calls.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCommand, spawnClaude } from '../../manager/claude.js';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  claude-bin: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const run = (args: string[], pathVar: string) => new Promise<{ out: string; error: string }>(done => {
  let out = ''; let error = '';
  const c = spawnClaude(args, { windowsHide: true }, pathVar);
  c.stdout?.on('data', d => { out += d; });
  c.on('error', e => { error = String(e); });
  c.on('close', () => done({ out, error }));
  c.stdin?.end();
});

check('on macOS and Linux it is plain claude, no shell', JSON.stringify(claudeCommand('/usr/bin', 'linux')) === JSON.stringify({ file: 'claude', shell: false }));

if (process.platform !== 'win32') {
  console.log('(the .cmd checks run on Windows only)');
} else {
  const sys = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const npmDir = mkdtempSync(join(tmpdir(), 'tandem-npm-claude-'));
  writeFileSync(join(npmDir, 'claude.cmd'), '@echo off\r\necho ARGS: %*\r\n');
  const exeDir = mkdtempSync(join(tmpdir(), 'tandem-exe-claude-'));
  writeFileSync(join(exeDir, 'claude.exe'), 'not a real program');

  check('a claude.cmd on PATH is found, and run through a shell', JSON.stringify(claudeCommand(`${npmDir};${sys}`)) === JSON.stringify({ file: join(npmDir, 'claude.cmd'), shell: true }), claudeCommand(`${npmDir};${sys}`));
  check('a claude.exe is preferred, and run directly', JSON.stringify(claudeCommand(`${npmDir};${exeDir}`)) === JSON.stringify({ file: join(exeDir, 'claude.exe'), shell: false }), claudeCommand(`${npmDir};${exeDir}`));
  check('with no claude on PATH it falls back to the plain name (and spawn reports ENOENT)', claudeCommand(sys).file === 'claude');

  const r = await run(['-p', '--model', 'haiku', '--mcp-config', 'C:\\a folder\\x.json', '--allowedTools', 'mcp__tandem', 'Read'], `${npmDir};${sys}`);
  check('a claude.cmd really runs (this was "spawn claude ENOENT" before)', r.error === '' && /ARGS: -p --model haiku/.test(r.out), r);
  check('an argument with a space reaches it as one piece', r.out.includes('"C:\\a folder\\x.json"'), r.out);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
