// Runs a goal branch's tests in a throwaway worktree, so the result of a goal is checked, not just
// merged. Knows two kinds of project: an npm "test" script, or Python unittest files.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type TestRun = { ran: boolean; ok: boolean; command: string; output: string };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Tandem', '-c', 'user.email=tandem@localhost', ...args], { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();

// What to run to test the project in `dir`, or null if there is no test we know how to run.
export function testCommand(dir: string): { file: string; args: string[]; label: string } | null {
  const pkg = join(dir, 'package.json');
  if (existsSync(pkg)) {
    try {
      const scripts = JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {};
      if (scripts.test && !/no test specified/.test(scripts.test)) return { file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test', '--silent'], label: 'npm test' };
    } catch { /* not a usable package.json */ }
  }
  const hasPyTests = (d: string, depth = 0): boolean => {
    if (depth > 2 || !existsSync(d)) return false;
    return readdirSync(d, { withFileTypes: true }).some(e =>
      (e.isFile() && /^test.*\.py$/.test(e.name)) || (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && hasPyTests(join(d, e.name), depth + 1)));
  };
  if (hasPyTests(dir)) return { file: 'python', args: ['-I', '-m', 'unittest', 'discover'], label: 'python -m unittest' };
  return null;
}

export function testBranch(repo: string, branch: string, timeoutMs = 300_000): TestRun {
  const tree = join(repo, '.worktrees', `verify-${branch.replace(/[^a-z0-9-]/gi, '-')}`);
  try {
    git(repo, 'worktree', 'prune');
    if (existsSync(tree)) git(repo, 'worktree', 'remove', '--force', tree);
    git(repo, 'worktree', 'add', '-q', '--detach', tree, branch);
    const cmd = testCommand(tree);
    if (!cmd) return { ran: false, ok: true, command: '', output: '' };
    if (cmd.label === 'npm test' && existsSync(join(tree, 'package.json'))) {
      spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--silent', '--no-audit', '--no-fund'], { cwd: tree, timeout: timeoutMs, shell: process.platform === 'win32', windowsHide: true });
    }
    const r = spawnSync(cmd.file, cmd.args, { cwd: tree, encoding: 'utf8', timeout: timeoutMs, shell: process.platform === 'win32' && cmd.file.endsWith('.cmd'), windowsHide: true });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return { ran: true, ok: r.status === 0, command: cmd.label, output: output.slice(-3000) };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', tree); } catch { /* already gone */ }
  }
}
