// "Merge into my project", on throwaway git repos. No brain, no Claude.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyBranch } from '../apply.js';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  apply: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

// a project on main with calc.py, and a goal branch that adds cli.py and test_cli.py
function project() {
  const repo = mkdtempSync(join(tmpdir(), 'tandem-apply-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n');
  git('add', '-A'); git('commit', '-q', '-m', 'start');
  git('checkout', '-q', '-b', 'tandem/add-cli');
  writeFileSync(join(repo, 'cli.py'), 'import calc\n'); writeFileSync(join(repo, 'test_cli.py'), 'import cli\n');
  git('add', '-A'); git('commit', '-q', '-m', 'Add the CLI');
  git('checkout', '-q', 'main');
  return { repo, git };
}

{
  const { repo, git } = project();
  check('before: the project folder has only calc.py (the work is on the branch)', !existsSync(join(repo, 'cli.py')));
  const r = applyBranch(repo, 'tandem/add-cli');
  check('a clean merge puts the work in the project folder and says which files', r.ok && existsSync(join(repo, 'cli.py')) && existsSync(join(repo, 'test_cli.py')) && /Merged tandem\/add-cli into main: 2 files \(cli\.py, test_cli\.py\)/.test(r.message), r);
  check('the project is still on main, with a clean status', git('branch', '--show-current') === 'main' && git('status', '--porcelain') === '', git('status', '--porcelain'));
  const again = applyBranch(repo, 'tandem/add-cli');
  check('applying again changes nothing and says it already has it', again.ok && /already has everything/.test(again.message), again);
}
{
  const { repo, git } = project();
  writeFileSync(join(repo, 'calc.py'), 'def add(a, b):\n    return a + b + 0\n'); // an uncommitted edit
  const head = git('rev-parse', 'HEAD');
  const r = applyBranch(repo, 'tandem/add-cli');
  check('uncommitted changes: refused, with what to do, and nothing touched', !r.ok && /uncommitted changes/.test(r.message) && /Commit or stash/.test(r.message) && git('rev-parse', 'HEAD') === head && !existsSync(join(repo, 'cli.py')) && readFileSync(join(repo, 'calc.py'), 'utf8').includes('+ 0'), r);
}
{
  const { repo, git } = project();
  writeFileSync(join(repo, 'notes.txt'), 'my own untracked notes\n'); // untracked files do not block a merge
  const r = applyBranch(repo, 'tandem/add-cli');
  check('an untracked file of yours that does not clash is left alone', r.ok && readFileSync(join(repo, 'notes.txt'), 'utf8') === 'my own untracked notes\n', r);
  void git;
}
{
  const { repo, git } = project();
  writeFileSync(join(repo, 'cli.py'), 'my own cli.py, not committed\n'); // untracked, and the merge would overwrite it
  const head = git('rev-parse', 'HEAD');
  const r = applyBranch(repo, 'tandem/add-cli');
  check('an untracked file the merge would overwrite: refused, repo and file intact', !r.ok && /could not merge/i.test(r.message) && git('rev-parse', 'HEAD') === head && readFileSync(join(repo, 'cli.py'), 'utf8').startsWith('my own cli.py'), r);
}
{
  const { repo, git } = project();
  writeFileSync(join(repo, 'cli.py'), 'main wrote cli.py first\n'); git('add', '-A'); git('commit', '-q', '-m', 'cli on main');
  const head = git('rev-parse', 'HEAD');
  const r = applyBranch(repo, 'tandem/add-cli');
  check('a conflict: undone, reported with the file and how to do it by hand, status clean', !r.ok && /conflicts with main in cli\.py/.test(r.message) && /git merge tandem\/add-cli/.test(r.message) && git('rev-parse', 'HEAD') === head && git('status', '--porcelain') === '' && readFileSync(join(repo, 'cli.py'), 'utf8').replace(/\r\n/g, '\n') === 'main wrote cli.py first\n', [r, git('status', '--porcelain'), readFileSync(join(repo, 'cli.py'), 'utf8')]);
}
{
  const { repo, git } = project();
  writeFileSync(join(repo, 'extra.py'), 'x = 1\n'); git('add', '-A'); git('commit', '-q', '-m', 'main moved on');
  const r = applyBranch(repo, 'tandem/add-cli');
  check('when main has moved on, it makes a merge commit and keeps both sides', r.ok && existsSync(join(repo, 'cli.py')) && existsSync(join(repo, 'extra.py')), r);
}
{
  const { repo, git } = project();
  git('checkout', '-q', '--detach');
  check('a detached HEAD is refused with what to do', /not on a branch/.test(applyBranch(repo, 'tandem/add-cli').message));
  git('checkout', '-q', 'main');
  check('a branch that is gone is said so', /not in this project any more/.test(applyBranch(repo, 'tandem/nope').message));
  git('checkout', '-q', 'tandem/add-cli');
  check('when the project is already on that branch, it says so', /already on tandem\/add-cli/.test(applyBranch(repo, 'tandem/add-cli').message));
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
