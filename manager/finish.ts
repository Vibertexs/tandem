// What happens when every task of a goal is done:
//   1. merge the task branches into tandem/<goal id> (merge.ts); a branch that conflicts gets ONE
//      "resolve the merge conflict" task in the same goal, and the goal is finished when it is done;
//   2. run the project's tests on that branch (verify.ts);
//   3. tests pass (or there are none): the goal is done;
//      tests fail: add ONE "fix the failing tests" task to the same goal, and try again when it
//      is done; if they still fail after that, the goal is done with a note saying so;
//   4. with review on: before calling it done, ONE review task reads the goal branch (no edits),
//      and its findings go into the goal's note (and the pull request).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal, Task, TaskDraft } from '../mcp/src/brain-client.js';
import { mergeGoal, mergeNote, openPullRequest, pushIfRemote } from './merge.js';
import { testBranch, type TestRun } from './verify.js';

export const FIX_TITLE = 'Fix the failing tests';
// The launcher runs this one with read-only tools and keeps the whole reply as the result.
export const REVIEW_TITLE = 'Review the goal\'s work';
// The launcher reads the branch back out of the title, starts the merge and lets Claude edit
// out the conflict markers.
export const conflictTitle = (branch: string) => `Resolve the merge conflict with ${branch}`;
export const conflictBranch = (title: string) => /^Resolve the merge conflict with (task\/\S+)$/.exec(title)?.[1] ?? null;

// The few brain calls this needs (BrainClient has them; tests pass a fake).
export type FinishBrain = {
  finishGoal(goalId: string, branch: string, note: string): Promise<void>;
  markGoal(goalId: string, status: string): Promise<void>;
  assignTask(task: TaskDraft): Promise<string>;
};

export type Outcome = 'done' | 'fixing';
export type FinishOptions = {
  test?: (repo: string, branch: string) => TestRun; // tests pass a fake
  push?: boolean; // push the goal branch to origin (and open a PR if the GitHub CLI is set up)
  review?: boolean; // one review task before the goal is done
};

// Follow-up tasks are planned into the same goal: the brain links tasks made while it is planning.
async function addToGoal(brain: FinishBrain, goal: Goal, drafts: TaskDraft[]): Promise<Outcome> {
  await brain.markGoal(goal.id, 'planning');
  for (const d of drafts) await brain.assignTask(d);
  await brain.markGoal(goal.id, 'planned');
  return 'fixing';
}

export async function finishGoal(
  brain: FinishBrain, repo: string, goal: Goal, tasks: Task[],
  { test = testBranch, push = false, review = false }: FinishOptions = {},
): Promise<Outcome> {
  // Conflict fixes first: each one already contains the branch it fixed, which then merges as a no-op.
  const ordered = [...tasks.filter(t => conflictBranch(t.title)), ...tasks.filter(t => !conflictBranch(t.title))];
  const branches = [...new Set(ordered.map(t => t.branch ?? '').filter(b => b.startsWith('task/')))];
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
  const toResolve = merged.failed.filter(b => !tasks.some(t => t.title === conflictTitle(b)));
  if (toResolve.length > 0) {
    // one task per conflicting branch; tests run once they are merged
    return addToGoal(brain, goal, toResolve.map(b => {
      const files = merged.conflicts[b]?.length ? merged.conflicts[b] : [...new Set(tasks.filter(t => t.branch === b).flatMap(t => t.files))];
      return {
        title: conflictTitle(b),
        description: `${b} conflicts with the rest of this goal's work on ${merged.target}, in: ${files.join(', ')}. ` +
          'The merge is started for you and the files have conflict markers. Edit each one so both sides\' changes are kept, ' +
          'and remove every <<<<<<<, ======= and >>>>>>> line. Change nothing else.',
        files,
        difficulty: 'normal',
      };
    }));
  }
  let note = mergeNote(merged);
  if (merged.merged.length > 0) {
    const run = test(repo, merged.target);
    if (run.ran && !run.ok) {
      if (!tasks.some(t => t.title === FIX_TITLE)) {
        return addToGoal(brain, goal, [{
          title: FIX_TITLE,
          description: `All of this goal's tasks are merged on ${merged.target}, but \`${run.command}\` fails. ` +
            `Make the tests pass without removing tests or features. End of the output:\n${run.output.slice(-1500)}`,
          files: [...new Set(tasks.flatMap(t => t.files))],
          difficulty: 'normal',
        }]);
      }
      note = `${note} Tests still fail (${run.command}): check ${merged.target} by hand.`.trim();
    } else if (run.ran) {
      note = `${note} Tests pass (${run.command}).`.trim();
    }
    const reviewed = tasks.find(t => t.title === REVIEW_TITLE);
    if (review && !reviewed) {
      return addToGoal(brain, goal, [{
        title: REVIEW_TITLE,
        description: `All of this goal's work is merged on ${merged.target}${run.ran ? ` and \`${run.command}\` ${run.ok ? 'passes' : 'fails'}` : ''}. ` +
          `The goal was: "${goal.text}". Read the files and check the work does what the goal asked, with no obvious bugs. ` +
          'Do not edit anything. Reply with up to 5 findings, one per line, most important first, or just "Looks good".',
        files: [],
        difficulty: 'hard',
      }]);
    }
    if (reviewed?.result_summary) note = `${note} Review: ${reviewed.result_summary}`.trim();
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
