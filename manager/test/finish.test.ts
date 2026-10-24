// The whole "goal finished" decision on real git repos, with a fake brain. No Claude.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Goal, Task, TaskDraft } from '../../mcp/src/brain-client.js';
import { FIX_TITLE, finishGoal, type FinishBrain } from '../finish.js';

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
const goal: Goal = { id: 'g1', text: 'Build the calculator', status: 'planned', created_at: '', branch: '' };
const task = (id: string, branch: string, files: string[], title = id): Task => ({
  id, job_id: null, kind: 'normal', title, description: '', files, difficulty: 'easy', model: '', effort: 'default',
  status: 'done', assignee: 'w-a', branch, depends_on: [], result: null, result_summary: null, goal_id: 'g1',
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
  const { brain, calls } = fakeBrain();
  const out = await finishGoal(brain, tmpdir(), goal, [task('a', 'sim/a', ['calc.py'])]);
  check('simulated workers: done, nothing to merge', out === 'done' && calls.finish?.branch === '' && /Simulated/.test(calls.finish.note), calls);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
