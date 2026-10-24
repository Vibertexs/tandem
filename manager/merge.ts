// Merges a finished goal's task branches into one branch, tandem/<goal id>, in a separate
// worktree, so the files you have open in the repo are never touched. A branch that conflicts
// is skipped (the merge is aborted) and reported; nothing is ever forced.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type MergeResult = { target: string; merged: string[]; failed: string[]; missing: string[] };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Tandem', '-c', 'user.email=tandem@localhost', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

export function mergeGoal(repo: string, goalId: string, goalText: string, branches: string[]): MergeResult {
  const hasBranch = (b: string) => { try { git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`); return true; } catch { return false; } };
  const target = `tandem/${goalId}`;
  const tree = join(repo, '.worktrees', `merge-${goalId}`);
  const result: MergeResult = { target, merged: [], failed: [], missing: [] };
  try {
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
        try { git(tree, 'merge', '--abort'); } catch { /* nothing to abort */ }
        result.failed.push(b);
      }
    }
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', tree); } catch { /* already gone */ }
  }
  return result;
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
