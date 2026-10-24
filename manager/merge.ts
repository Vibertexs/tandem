// Merges a finished goal's task branches into one branch, tandem/<goal id>, in a separate
// worktree, so the files you have open in the repo are never touched. A branch that conflicts
// is skipped (the merge is aborted) and reported; nothing is ever forced.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// failed: branches that conflicted; conflicts: the files each one conflicted in.
export type MergeResult = { target: string; merged: string[]; failed: string[]; missing: string[]; conflicts: Record<string, string[]> };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Tandem', '-c', 'user.email=tandem@localhost', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

export function mergeGoal(repo: string, goalId: string, goalText: string, branches: string[]): MergeResult {
  const hasBranch = (b: string) => { try { git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch { return false; } };
  const target = `tandem/${goalId}`;
  const tree = join(repo, '.worktrees', `merge-${goalId}`);
  const result: MergeResult = { target, merged: [], failed: [], missing: [], conflicts: {} };
  try {
    ignoreWorktrees(repo);
    git(repo, 'worktree', 'prune');
    if (existsSync(tree)) git(repo, 'worktree', 'remove', '--force', tree);
    if (hasBranch(target)) git(repo, 'worktree', 'add', '-q', tree, target);
    else git(repo, 'worktree', 'add', '-q', '-b', target, tree, 'HEAD');
    for (const b of branches) {
      if (!hasBranch(b)) {
        // a worker on another computer may have pushed it
        try { git(repo, 'fetch', '-q', 'origin', `${b}:${b}`); } catch { result.missing.push(b); continue; }
      }
      try {
        git(tree, 'merge', '--no-ff', '--no-edit', '-m', `Merge ${b} (${goalText.slice(0, 50)})`, b);
        result.merged.push(b);
      } catch {
        result.conflicts[b] = conflictedFiles(tree);
        try { git(tree, 'merge', '--abort'); } catch { /* nothing to abort */ }
        result.failed.push(b);
      }
    }
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', tree); } catch { /* already gone */ }
  }
  return result;
}

// Keeps .worktrees/ out of `git status` in the user's repo: a local-only ignore rule in
// .git/info/exclude (never committed, so the repo itself is not changed).
export function ignoreWorktrees(repo: string) {
  try {
    const exclude = resolve(repo, git(repo, 'rev-parse', '--git-common-dir'), 'info', 'exclude');
    const now = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (/^\/?\.worktrees\/?\s*$/m.test(now)) return;
    mkdirSync(dirname(exclude), { recursive: true });
    appendFileSync(exclude, `${now && !now.endsWith('\n') ? '\n' : ''}# Tandem's task worktrees\n.worktrees/\n`);
  } catch { /* not a repo, or read-only: only cosmetic */ }
}

const conflictedFiles = (tree: string) => {
  try { return git(tree, 'diff', '--name-only', '--diff-filter=U').split('\n').map(f => f.trim()).filter(Boolean); } catch { return []; }
};

// For a "resolve the conflict" task: starts merging `branch` into the worktree's branch and
// leaves the conflict markers in place for Claude to edit out. Returns the conflicted files
// ([] if it merged cleanly, so there is nothing left to do). Committing the worktree afterwards
// concludes the merge. Throws if the branch cannot be merged at all (for example, it is missing).
export function startConflictMerge(tree: string, branch: string): string[] {
  try { git(tree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); } catch {
    try { git(tree, 'fetch', '-q', 'origin', `${branch}:${branch}`); } catch { throw new Error(`${branch} is not on this computer`); }
  }
  try { git(tree, 'merge', '--no-ff', '--no-edit', '-m', `Merge ${branch}`, branch); return []; } catch {
    const files = conflictedFiles(tree);
    if (files.length === 0) throw new Error(`could not merge ${branch}`);
    return files;
  }
}

export const mergeInProgress = (tree: string) => {
  try { git(tree, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD'); return true; } catch { return false; }
};

// The files that still have conflict markers in them.
export function filesWithMarkers(tree: string, files: string[]): string[] {
  return files.filter(f => {
    try { return /^(<{7}|>{7}) /m.test(readFileSync(join(tree, f), 'utf8')); } catch { return false; }
  });
}

export function mergeNote(r: MergeResult): string {
  return [
    r.failed.length ? `Could not merge ${r.failed.join(', ')} automatically: merge by hand.` : '',
    r.missing.length ? `Not on this computer: ${r.missing.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

// Pushes `branch` to `origin` if the repo has one. Returns what happened, never throws.
export function pushIfRemote(repo: string, branch: string): 'pushed' | 'no-remote' | 'failed' {
  try { git(repo, 'remote', 'get-url', 'origin'); } catch { return 'no-remote'; }
  try { git(repo, 'push', '-q', 'origin', `${branch}:${branch}`); return 'pushed'; } catch { return 'failed'; }
}

// Opens a pull request for `branch` with the GitHub CLI, if it is installed and logged in.
export function openPullRequest(repo: string, branch: string, title: string, body: string): string | null {
  try {
    const url = execFileSync('gh', ['pr', 'create', '--head', branch, '--title', title.slice(0, 120), '--body', body], { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
    return url.split('\n').pop() ?? null;
  } catch { return null; }
}
