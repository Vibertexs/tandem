// Merging a finished goal's task branches, on a throwaway git repo. No brain, no Claude.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeGoal, mergeNote } from '../merge.js';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  merge: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};
const repo = mkdtempSync(join(tmpdir(), 'tandem-merge-'));
const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
const branch = (name: string, file: string, text: string) => {
  git('checkout', '-q', '-b', name, 'main');
  writeFileSync(join(repo, file), text);
  git('add', '-A'); git('commit', '-q', '-m', name);
  git('checkout', '-q', 'main');
};

git('init', '-q', '-b', 'main');
writeFileSync(join(repo, 'README.md'), 'start\n');
writeFileSync(join(repo, '.gitignore'), '.worktrees/\n');
git('add', '-A'); git('commit', '-q', '-m', 'start');
branch('task/a', 'calc.py', 'def add(a, b): return a + b\n');
branch('task/b', 'test_calc.py', 'import calc\n');
branch('task/c', 'README.md', 'from c\n');
branch('task/d', 'README.md', 'from d\n'); // conflicts with task/c
writeFileSync(join(repo, 'notes.txt'), 'my open work\n'); // uncommitted work in the main checkout

const mainBefore = git('rev-parse', 'main');
const r = mergeGoal(repo, 'g1', 'Build the calculator', ['task/a', 'task/b', 'task/c', 'task/d', 'task/gone']);
check('clean branches are merged, in order', r.merged.join() === 'task/a,task/b,task/c', r);
check('a conflicting branch is skipped and reported, not forced', r.failed.join() === 'task/d', r);
check('a branch that does not exist is reported as missing', r.missing.join() === 'task/gone', r);
check('the result is one branch named tandem/<goal>', r.target === 'tandem/g1' && git('rev-parse', '--verify', '--quiet', 'refs/heads/tandem/g1').length > 0);
const files = git('ls-tree', '--name-only', 'tandem/g1').split('\n');
check('the goal branch has the work from every merged task', ['calc.py', 'test_calc.py', 'README.md'].every(f => files.includes(f)), files);
check('the goal branch has task/c\'s README, untouched by the failed merge', git('show', 'tandem/g1:README.md') === 'from c');
check('main is untouched', git('rev-parse', 'main') === mainBefore && !git('ls-tree', '--name-only', 'main').split('\n').includes('calc.py'));
check('your uncommitted work in the repo is untouched', readFileSync(join(repo, 'notes.txt'), 'utf8') === 'my open work\n' && git('branch', '--show-current') === 'main');
check('the temporary worktree is cleaned up', !existsSync(join(repo, '.worktrees', 'merge-g1')));
check('the note tells you what to do', /task\/d/.test(mergeNote(r)) && /by hand/.test(mergeNote(r)) && /task\/gone/.test(mergeNote(r)), mergeNote(r));

// running it again (say, after new task branches) adds to the same goal branch
mkdirSync(join(repo, 'docs'), { recursive: true });
branch('task/e', 'docs/usage.md', 'how to\n');
const again = mergeGoal(repo, 'g1', 'Build the calculator', ['task/e']);
check('merging again adds to the existing goal branch', again.merged.join() === 'task/e' && git('ls-tree', '-r', '--name-only', 'tandem/g1').includes('docs/usage.md'));

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
