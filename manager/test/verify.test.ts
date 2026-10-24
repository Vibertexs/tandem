// Testing a goal branch before calling the goal done. Throwaway git repos, no brain, no Claude.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testBranch, testCommand } from '../verify.js';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  verify: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
function repoWith(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), 'tandem-verify-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  for (const [f, text] of Object.entries(files)) writeFileSync(join(repo, f), text);
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n');
  git('add', '-A'); git('commit', '-q', '-m', 'start');
  git('branch', 'tandem/g1');
  return repo;
}

const calc = 'def add(a, b):\n    return a + b\n';
const good = repoWith({ 'calc.py': calc, 'test_calc.py': 'import unittest\nimport calc\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(calc.add(2, 3), 5)\n' });
const bad = repoWith({ 'calc.py': calc, 'test_calc.py': 'import unittest\nimport calc\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(calc.add(2, 3), 6)\n' });
const none = repoWith({ 'README.md': '# docs only\n' });

check('Python unittest files are recognized', testCommand(good)?.label === 'python -m unittest');
check('a repo with no tests has no test command', testCommand(none) === null);
const g = testBranch(good, 'tandem/g1');
check('passing tests: ran and ok', g.ran && g.ok, g);
const b = testBranch(bad, 'tandem/g1');
check('failing tests: ran, not ok, and the output shows what failed', b.ran && !b.ok && /AssertionError|FAILED/.test(b.output), b.output.slice(-200));
const n = testBranch(none, 'tandem/g1');
check('no tests: nothing ran, so nothing blocks the goal', !n.ran && n.ok);
check('the temporary worktree is cleaned up', execFileSync('git', ['worktree', 'list'], { cwd: bad, encoding: 'utf8' }).trim().split('\n').length === 1);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
