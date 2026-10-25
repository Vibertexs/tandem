// Merging a finished goal's task branches, on a throwaway git repo. No brain, no Claude.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { goalBranch, ignoreWorktrees, knownGoalBranch, mergeGoal, mergeNote, nameWords, pushIfRemote, startFromBranches, worktreesDir } from '../merge.js';

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
check('the result is one branch named tandem/<goal>', r.target === 'tandem/build-calculator' && git('rev-parse', '--verify', '--quiet', 'refs/heads/tandem/build-calculator').length > 0);
const files = git('ls-tree', '--name-only', 'tandem/build-calculator').split('\n');
check('the goal branch has the work from every merged task', ['calc.py', 'test_calc.py', 'README.md'].every(f => files.includes(f)), files);
check('the goal branch has task/c\'s README, untouched by the failed merge', git('show', 'tandem/build-calculator:README.md') === 'from c');
check('main is untouched', git('rev-parse', 'main') === mainBefore && !git('ls-tree', '--name-only', 'main').split('\n').includes('calc.py'));
check('your uncommitted work in the repo is untouched', readFileSync(join(repo, 'notes.txt'), 'utf8') === 'my open work\n' && git('branch', '--show-current') === 'main');
check('the temporary worktree is cleaned up', !existsSync(join(repo, '.worktrees', 'merge-g1')));
check('the note tells you what to do', /task\/d/.test(mergeNote(r)) && /by hand/.test(mergeNote(r)) && /task\/gone/.test(mergeNote(r)), mergeNote(r));

// running it again (say, after new task branches) adds to the same goal branch
mkdirSync(join(repo, 'docs'), { recursive: true });
branch('task/e', 'docs/usage.md', 'how to\n');
const again = mergeGoal(repo, 'g1', 'Build the calculator', ['task/e']);
check('merging again adds to the existing goal branch', again.merged.join() === 'task/e' && git('ls-tree', '-r', '--name-only', 'tandem/build-calculator').includes('docs/usage.md'));

// pushing: nothing happens without a remote; with one, the branch arrives there
check('push: with no origin remote, nothing is pushed', pushIfRemote(repo, 'tandem/build-calculator') === 'no-remote');
const bare = mkdtempSync(join(tmpdir(), 'tandem-origin-'));
execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'pipe' });
git('remote', 'add', 'origin', bare);
check('push: with an origin remote, the goal branch is pushed', pushIfRemote(repo, 'tandem/build-calculator') === 'pushed' &&
  execFileSync('git', ['--git-dir', bare, 'rev-parse', '--verify', '--quiet', 'refs/heads/tandem/build-calculator'], { encoding: 'utf8' }).trim() === git('rev-parse', 'tandem/build-calculator'));
check('push: a branch that does not exist fails without throwing', pushIfRemote(repo, 'nope/branch') === 'failed');

// a task that depends on task/a and task/b starts with both of their work in its worktree
{
  const tree = join(repo, '.worktrees', 'dep');
  git('worktree', 'add', '-q', '-b', 'task/dep', tree, 'main');
  const from = startFromBranches(tree, ['task/a', 'task/b', 'task/missing']);
  check('a dependent task starts from its dependencies\' branches (a missing one is skipped)', from.join() === 'task/a,task/b' &&
    existsSync(join(tree, 'calc.py')) && existsSync(join(tree, 'test_calc.py')), from);
  git('worktree', 'remove', '--force', tree);
}

// your own repo, with no .gitignore for .worktrees: it stays out of `git status`, nothing is committed
{
  const own = mkdtempSync(join(tmpdir(), 'tandem-own-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: own, encoding: 'utf8', stdio: 'pipe' }).trim();
  g('init', '-q', '-b', 'main'); writeFileSync(join(own, 'app.py'), 'x = 1\n'); g('add', '-A'); g('commit', '-q', '-m', 'start');
  mkdirSync(join(own, '.worktrees', 'task-1'), { recursive: true }); writeFileSync(join(own, '.worktrees', 'task-1', 'f'), 'x');
  ignoreWorktrees(own); ignoreWorktrees(own); // twice: added once
  const exclude = readFileSync(join(own, '.git', 'info', 'exclude'), 'utf8');
  check('your repo: .worktrees/ is ignored locally (git status stays clean), once, with nothing committed',
    g('status', '--porcelain') === '' && (exclude.match(/^\.worktrees\/$/gm) ?? []).length === 1 && !existsSync(join(own, '.gitignore')), [g('status', '--porcelain'), exclude]);
}

// readable names
check('nameWords: a sentence becomes a few readable words, cut at a word, not mid-word',
  nameWords('Add multiply(a, b) and divide(a, b) to calc.py (divide raises ValueError on zero)') === 'add-multiply-divide-calc-py' &&
  nameWords('Update README for multiply, divide and the CLI') === 'update-readme-multiply-divide' &&
  nameWords('Create a tiny Python calculator: calc.py with add(a, b) and sub(a, b)', 5, 36) === 'create-tiny-python-calculator-calc' &&
  nameWords('???') === '' && nameWords('a b c') === '' && nameWords('x'.repeat(50) + ' ok', 5, 32) === '', nameWords('Add multiply(a, b) and divide(a, b) to calc.py'));
{
  const own = mkdtempSync(join(tmpdir(), 'tandem-names-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: own, encoding: 'utf8', stdio: 'pipe' }).trim();
  g('init', '-q', '-b', 'main'); writeFileSync(join(own, 'app.py'), 'x = 1\n'); g('add', '-A'); g('commit', '-q', '-m', 'start');
  const one = goalBranch(own, 'g-aaa111', 'Add a login page with tests');
  check('goalBranch: named after what was asked, not after the id', one === 'tandem/add-login-page-tests', one);
  check('goalBranch: the same goal always gets the same branch', goalBranch(own, 'g-aaa111', 'Add a login page with tests') === one);
  const two = goalBranch(own, 'g-bbb222', 'Add a login page with tests');
  check('goalBranch: a second goal with the same words gets -2, never the first one\'s branch', two === `${one}-2`, two);
  g('checkout', '-q', '-b', 'task/x-1'); writeFileSync(join(own, 'login.py'), 'ok = 1\n'); g('add', '-A'); g('commit', '-q', '-m', 'Write the login page'); g('checkout', '-q', 'main');
  const r2 = mergeGoal(own, 'g-aaa111', 'Add a login page with tests', ['task/x-1']);
  check('mergeGoal: merges on the readable branch, and the merge message uses the work\'s title (no ids, no branch names)',
    r2.target === one && g('log', '-1', '--format=%s', one) === 'Merge: Write the login page', [r2.target, g('log', '-1', '--format=%s', one)]);
  check('knownGoalBranch: finds it later (for a follow-up task), and knows nothing about a goal with no branch',
    knownGoalBranch(own, 'g-aaa111') === one && knownGoalBranch(own, 'g-nope') === null);
}

// with TANDEM_WORKTREES (what `tandem start` sets), the task folders live outside the project
{
  const own = mkdtempSync(join(tmpdir(), 'tandem-outside-'));
  const store = mkdtempSync(join(tmpdir(), 'tandem-trees-'));
  const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: own, encoding: 'utf8', stdio: 'pipe' }).trim();
  g('init', '-q', '-b', 'main'); writeFileSync(join(own, 'app.py'), 'x = 1\n'); g('add', '-A'); g('commit', '-q', '-m', 'start');
  g('checkout', '-q', '-b', 'task/z'); writeFileSync(join(own, 'z.py'), 'z = 1\n'); g('add', '-A'); g('commit', '-q', '-m', 'z'); g('checkout', '-q', 'main');
  check('worktreesDir: without TANDEM_WORKTREES it is .worktrees/ in the repo', worktreesDir(own) === join(own, '.worktrees'));
  process.env.TANDEM_WORKTREES = store;
  const dir = worktreesDir(own);
  check('worktreesDir: with it, the folder is inside that store, named after the project, and not in the repo',
    dir.startsWith(store) && dir !== store && !dir.startsWith(own) && dir === worktreesDir(own), dir);
  const m = mergeGoal(own, 'gx', 'Outside', ['task/z']);
  check('a goal is merged with nothing created in the project: no .worktrees, git status clean, no exclude rule',
    m.merged.join() === 'task/z' && !existsSync(join(own, '.worktrees')) && g('status', '--porcelain') === '' &&
    !/worktrees/.test(existsSync(join(own, '.git', 'info', 'exclude')) ? readFileSync(join(own, '.git', 'info', 'exclude'), 'utf8') : ''), [m, g('status', '--porcelain')]);
  delete process.env.TANDEM_WORKTREES;
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
