// What happens when every task of a goal is done:
//   1. merge the task branches into tandem/<goal id> (merge.ts);
//   2. run the project's tests on that branch (verify.ts);
//   3. tests pass (or there are none): the goal is done;
//      tests fail: add ONE "fix the failing tests" task to the same goal, and try again when it
//      is done; if they still fail after that, the goal is done with a note saying so.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal, Task, TaskDraft } from '../mcp/src/brain-client.js';
import { mergeGoal, mergeNote, openPullRequest, pushIfRemote } from './merge.js';
import { testBranch, type TestRun } from './verify.js';

export const FIX_TITLE = 'Fix the failing tests';

// The few brain calls this needs (BrainClient has them; tests pass a fake).
export type FinishBrain = {
  finishGoal(goalId: string, branch: string, note: string): Promise<void>;
  markGoal(goalId: string, status: string): Promise<void>;
  assignTask(task: TaskDraft): Promise<string>;
};

export type Outcome = 'done' | 'fixing';

export async function finishGoal(
  brain: FinishBrain, repo: string, goal: Goal, tasks: Task[],
  test: (repo: string, branch: string) => TestRun = testBranch,
  push = false,
): Promise<Outcome> {
  const branches = [...new Set(tasks.map(t => t.branch ?? '').filter(b => b.startsWith('task/')))];
  if (branches.length === 0) {
    const simulated = tasks.some(t => (t.branch ?? '').startsWith('sim/'));
    await brain.finishGoal(goal.id, '', simulated ? '(Simulated workers: there is no code to merge.)' : '');
    return 'done';
  }
  if (!existsSync(join(repo, '.git'))) {
    await brain.finishGoal(goal.id, '', `The task branches are ${branches.join(', ')}; ${repo} is not a git repo, so they were not merged.`);
    return 'done';
  }
  const merged = mergeGoal(repo, goal.id, goal.text, branches);
  let note = mergeNote(merged);
  if (merged.merged.length > 0) {
    const run = test(repo, merged.target);
    if (run.ran && !run.ok) {
      const alreadyFixed = tasks.some(t => t.title === FIX_TITLE);
      if (!alreadyFixed) {
        // one follow-up task, planned into the same goal (the brain links tasks made while planning)
        await brain.markGoal(goal.id, 'planning');
        await brain.assignTask({
          title: FIX_TITLE,
          description: `All of this goal's tasks are merged on ${merged.target}, but \`${run.command}\` fails. ` +
            `Make the tests pass without removing tests or features. End of the output:\n${run.output.slice(-1500)}`,
          files: [...new Set(tasks.flatMap(t => t.files))],
          difficulty: 'normal',
        });
        await brain.markGoal(goal.id, 'planned');
        return 'fixing';
      }
      note = `${note} Tests still fail (${run.command}): check ${merged.target} by hand.`.trim();
    } else if (run.ran) {
      note = `${note} Tests pass (${run.command}).`.trim();
    }
  }
  if (push && merged.merged.length > 0) {
    // With -Push: share the result. Opens a pull request too when the GitHub CLI is set up.
    const pushed = pushIfRemote(repo, merged.target);
    if (pushed === 'pushed') {
      const body = `Planned and built by Tandem.\n\nGoal: ${goal.text}\n\n` +
        tasks.map(t => `- ${t.title}${t.result_summary ? `: ${t.result_summary}` : ''}`).join('\n') + (note ? `\n\n${note}` : '');
      const pr = openPullRequest(repo, merged.target, goal.text, body);
      note = `${note} Pushed to origin.${pr ? ` Pull request: ${pr}` : ''}`.trim();
    } else if (pushed === 'failed') {
      note = `${note} Could not push ${merged.target} to origin.`.trim();
    }
  }
  await brain.finishGoal(goal.id, merged.merged.length ? merged.target : '', note);
  return 'done';
}
