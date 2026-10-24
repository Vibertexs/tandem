// The whole "goal finished" decision on real git repos, with a fake brain. No Claude.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Goal, Task, TaskDraft } from '../../mcp/src/brain-client.js';
import { FIX_TITLE, conflictBranch, conflictTitle, finishGoal, type FinishBrain } from '../finish.js';
import { filesWithMarkers, mergeInProgress, startConflictMerge } from '../merge.js';

let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  finish: ${name}${ok ? '' : '  ' + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

function fakeBrain() {
  const calls: { finish?: { branch: string; note: string }; marks: string[]; tasks: TaskDraft[] } = { marks: [], tasks: [] };
  const brain: FinishBrain = {
    async finishGoal(_id, branch, note) { calls.finish = { branch, note }; },
    async markGoal(_id, status) { calls.marks.push(status); },
    async assignTask(t) { calls.tasks.push(t); return 't-fix'; },
  };
  return { brain, calls };
}
const goal: Goal = { id: 'g1', text: 'Build the calculator', status: 'planned', created_at: '', branch: '', cost_usd: 0 };
const task = (id: string, branch: string, files: string[], title = id): Task => ({
  id, job_id: null, kind: 'normal', title, description: '', files, difficulty: 'easy', model: '', effort: 'default',
  status: 'done', assignee: 'w-a', branch, depends_on: [], result: null, result_summary: null, goal_id: 'g1', cost_usd: 0,
});

// a repo where task/a adds calc.py and task/b adds a test that passes or fails
function repoWith(testExpect: number) {
  const repo = mkdtempSync(join(tmpdir(), 'tandem-finish-'));
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n');
  git('add', '-A'); git('commit', '-q', '-m', 'start');
  git('checkout', '-q', '-b', 'task/a'); writeFileSync(join(repo, 'calc.py'), 'def add(a, b):\n    return a + b\n'); git('add', '-A'); git('commit', '-q', '-m', 'a');
  git('checkout', '-q', '-b', 'task/b', 'main');
  writeFileSync(join(repo, 'test_calc.py'), `import unittest\nimport calc\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(calc.add(2, 3), ${testExpect})\n`);
  git('add', '-A'); git('commit', '-q', '-m', 'b'); git('checkout', '-q', 'main');
  return repo;
}

{
  const repo = repoWith(5);
  const { brain, calls } = fakeBrain();
  const out = await finishGoal(brain, repo, goal, [task('a', 'task/a', ['calc.py']), task('b', 'task/b', ['test_calc.py'])]);
  check('tests pass: the goal is done on tandem/g1, and the note says the tests pass', out === 'done' && calls.finish?.branch === 'tandem/g1' && /Tests pass/.test(calls.finish.note), calls);
}
{
  const repo = repoWith(6); // wrong expectation: the merged tests fail
  const { brain, calls } = fakeBrain();
  const tasks = [task('a', 'task/a', ['calc.py']), task('b', 'task/b', ['test_calc.py'])];
  const out = await finishGoal(brain, repo, goal, tasks);
  check('tests fail: not done yet; one fix task is added to the same goal', out === 'fixing' && !calls.finish && calls.tasks.length === 1 && calls.tasks[0].title === FIX_TITLE, calls);
  check('the fix task is planned into the goal (planning, then planned)', calls.marks.join() === 'planning,planned', calls.marks);
  check('the fix task may touch every file of the goal, and says what failed', ['calc.py', 'test_calc.py'].every(f => calls.tasks[0].files.includes(f)) && /AssertionError|FAILED/.test(calls.tasks[0].description ?? ''), calls.tasks[0]);
  const second = fakeBrain();
  const out2 = await finishGoal(second.brain, repo, goal, [...tasks, task('fix', 'task/fix-missing', ['calc.py'], FIX_TITLE)]);
  check('still failing after one fix: the goal is done with a note, no second fix task', out2 === 'done' && second.calls.tasks.length === 0 && /Tests still fail/.test(second.calls.finish?.note ?? ''), second.calls);
}
{
  // with push: the finished goal branch goes to origin, and the note says so
  const repo = repoWith(5);
  const bare = mkdtempSync(join(tmpdir(), 'tandem-origin-'));
  execFileSync('git', ['init', '-q', '--bare', bare], { stdio: 'pipe' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: repo, stdio: 'pipe' });
  const { brain, calls } = fakeBrain();
  const out = await finishGoal(brain, repo, goal, [task('a', 'task/a', ['calc.py']), task('b', 'task/b', ['test_calc.py'])], undefined, true);
  const onOrigin = execFileSync('git', ['--git-dir', bare, 'branch', '--list', 'tandem/g1'], { encoding: 'utf8' }).trim();
  check('with push: the goal branch is on origin and the note says "Pushed to origin"', out === 'done' && onOrigin.includes('tandem/g1') && /Pushed to origin/.test(calls.finish?.note ?? ''), calls.finish);
}
{
  // two tasks changed the same line: the second branch conflicts
  const repo = mkdtempSync(join(tmpdir(), 'tandem-conflict-'));
  const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', ...a], { cwd, encoding: 'utf8', stdio: 'pipe' });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n');
  writeFileSync(join(repo, 'calc.py'), 'GREETING = "hi"\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'start');
  for (const [b, text] of [['task/a', 'GREETING = "hello"\n'], ['task/b', 'GREETING = "hey"\nNAME = "b"\n']]) {
    git(repo, 'checkout', '-q', '-b', b, 'main'); writeFileSync(join(repo, 'calc.py'), text); git(repo, 'commit', '-q', '-am', b);
  }
  git(repo, 'checkout', '-q', 'main');
  const tasks = [task('a', 'task/a', ['calc.py']), task('b', 'task/b', ['calc.py'])];
  const { brain, calls } = fakeBrain();
  const out = await finishGoal(brain, repo, goal, tasks);
  check('conflict: not done yet; one "resolve the merge conflict" task for the branch that conflicts',
    out === 'fixing' && !calls.finish && calls.tasks.length === 1 && calls.tasks[0].title === conflictTitle('task/b') && conflictBranch(calls.tasks[0].title) === 'task/b', calls);
  check('conflict: the task locks exactly the conflicted file, and is planned into the goal', calls.tasks[0].files.join() === 'calc.py' && calls.marks.join() === 'planning,planned', calls);

  // what the launcher does for that task: start the merge on top of the goal branch, let Claude edit, commit
  const tree = join(repo, '.worktrees', 'c');
  git(repo, 'worktree', 'add', '-q', '-b', 'task/c', tree, 'tandem/g1');
  const conflicted = startConflictMerge(tree, 'task/b');
  check('launcher: the merge is started and the conflicted file has markers', conflicted.join() === 'calc.py' && mergeInProgress(tree) && filesWithMarkers(tree, conflicted).join() === 'calc.py', conflicted);
  writeFileSync(join(tree, 'calc.py'), 'GREETING = "hello"\nNAME = "b"\n'); // "Claude" keeps both sides
  check('launcher: once the markers are gone, nothing is left to resolve', filesWithMarkers(tree, conflicted).length === 0);
  git(tree, 'add', '-A'); git(tree, 'commit', '-q', '-m', 'resolve');
  git(repo, 'worktree', 'remove', '--force', tree);

  const second = fakeBrain();
  const out2 = await finishGoal(second.brain, repo, goal, [...tasks, task('c', 'task/c', ['calc.py'], conflictTitle('task/b'))]);
  const merged = git(repo, 'show', 'tandem/g1:calc.py');
  check('conflict resolved: the goal is done, every branch merged, with both changes', out2 === 'done' && second.calls.tasks.length === 0 &&
    !/Could not merge/.test(second.calls.finish?.note ?? '') && merged === 'GREETING = "hello"\nNAME = "b"\n', { calls: second.calls, merged });
  const third = fakeBrain();
  const out3 = await finishGoal(third.brain, repo, { ...goal, id: 'g2' }, [...tasks, task('c', 'task/missing', ['calc.py'], conflictTitle('task/b'))]);
  check('conflict still there after its fix task: done with "merge by hand", no second fix task', out3 === 'done' && third.calls.tasks.length === 0 && /merge by hand/.test(third.calls.finish?.note ?? ''), third.calls);
}
{
  const { brain, calls } = fakeBrain();
  const out = await finishGoal(brain, tmpdir(), goal, [task('a', 'sim/a', ['calc.py'])]);
  check('simulated workers: done, nothing to merge', out === 'done' && calls.finish?.branch === '' && /Simulated/.test(calls.finish.note), calls);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
