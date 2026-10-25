// Merges a finished goal's task branches into one branch, tandem/<goal id>, in a separate
// worktree, so the files you have open in the repo are never touched. A branch that conflicts
// is skipped (the merge is aborted) and reported; nothing is ever forced.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

// failed: branches that conflicted; conflicts: the files each one conflicted in.
export type MergeResult = { target: string; merged: string[]; failed: string[]; missing: string[]; conflicts: Record<string, string[]> };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Tandem', '-c', 'user.email=tandem@localhost', ...args], { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();

const STOP_WORDS = new Set(['an', 'the', 'to', 'and', 'or', 'of', 'for', 'in', 'on', 'with', 'that', 'it', 'is', 'be', 'this', 'my', 'our', 'by', 'from', 'as', 'at', 'into', 'then', 'also', 'so']);

// A few readable words from a sentence, for a branch or folder name:
// "Add multiply(a, b) and divide(a, b) to calc.py" -> "add-multiply-divide-calc-py".
export function nameWords(text: string, maxWords = 5, maxLength = 32): string {
  const out: string[] = [];
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length < 2 || STOP_WORDS.has(w)) continue;
    if (out.length >= maxWords || [...out, w].join('-').length > maxLength) break;
    out.push(w);
  }
  return out.join('-');
}

const refExists = (repo: string, name: string) => {
  try { git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`); return true; } catch { return false; }
};
const goalNamesFile = (repo: string) => join(worktreesDir(repo), 'goal-branches.json');
const readGoalNames = (repo: string): Record<string, string> => {
  try { return JSON.parse(readFileSync(goalNamesFile(repo), 'utf8')); } catch { return {}; }
};

// The branch a goal's work was (or is being) merged on, or null if it has none yet. Goals made
// before names were readable used tandem/<goal id>.
export function knownGoalBranch(repo: string, goalId: string): string | null {
  const named = readGoalNames(repo)[goalId];
  if (named && refExists(repo, named)) return named;
  return refExists(repo, `tandem/${goalId}`) ? `tandem/${goalId}` : null;
}

// The goal's branch: named after what was asked (tandem/add-multiply-divide-calc-py), the same
// every time for the same goal, and never one that another goal already has.
export function goalBranch(repo: string, goalId: string, goalText: string): string {
  const names = readGoalNames(repo);
  if (names[goalId]) return names[goalId];
  const known = knownGoalBranch(repo, goalId);
  if (known) return known;
  const taken = (n: string) => Object.values(names).includes(n) || refExists(repo, n);
  const base = `tandem/${nameWords(goalText, 5, 36) || 'goal'}`;
  let name = base;
  for (let i = 2; taken(name); i++) name = `${base}-${i}`;
  names[goalId] = name;
  mkdirSync(dirname(goalNamesFile(repo)), { recursive: true });
  writeFileSync(goalNamesFile(repo), JSON.stringify(names, null, 2));
  return name;
}

// The one-line message of a branch's last commit: what to call that work in a merge message.
const subjectOf = (cwd: string, ref: string) => { try { return git(cwd, 'log', '-1', '--format=%s', ref) || ref; } catch { return ref; } };

export function mergeGoal(repo: string, goalId: string, goalText: string, branches: string[]): MergeResult {
  const hasBranch = (b: string) => refExists(repo, b);
  const target = goalBranch(repo, goalId, goalText);
  const tree = join(worktreesDir(repo), `merge-${goalId}`);
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
        git(tree, 'merge', '--no-ff', '--no-edit', '-m', `Merge: ${subjectOf(tree, b)}`, b);
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

// Where a project's task folders live. `tandem start` sets TANDEM_WORKTREES to a folder inside
// Tandem's own state, so nothing is added to your project. Without it (the tests, a launcher run by
// hand) it is .worktrees/ in the repo.
export function worktreesDir(repo: string): string {
  const base = process.env.TANDEM_WORKTREES;
  if (!base) return join(repo, '.worktrees');
  const full = resolve(repo);
  const name = basename(full).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  return join(base, `${name}-${createHash('sha1').update(full.toLowerCase()).digest('hex').slice(0, 6)}`);
}

// Keeps .worktrees/ out of `git status` in the user's repo: a local-only ignore rule in
// .git/info/exclude (never committed, so the repo itself is not changed). Not needed when the
// task folders live outside the repo.
export function ignoreWorktrees(repo: string) {
  if (process.env.TANDEM_WORKTREES) return;
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

// For a task that depends on others: merges their branches into its new worktree, so its Claude
// sees the code it builds on (fetched from origin if a worker on another computer made it).
// A branch that cannot be merged is skipped. Returns the branches merged.
export function startFromBranches(tree: string, branches: string[]): string[] {
  const merged: string[] = [];
  for (const b of branches) {
    try { git(tree, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`); } catch {
      try { git(tree, 'fetch', '-q', 'origin', `${b}:${b}`); } catch { continue; }
    }
    try { git(tree, 'merge', '--no-ff', '--no-edit', '-m', `Build on: ${subjectOf(tree, b)}`, b); merged.push(b); } catch {
      try { git(tree, 'merge', '--abort'); } catch { /* nothing to abort */ }
    }
  }
  return merged;
}

// For a "resolve the conflict" task: starts merging `branch` into the worktree's branch and
// leaves the conflict markers in place for Claude to edit out. Returns the conflicted files
// ([] if it merged cleanly, so there is nothing left to do). Committing the worktree afterwards
// concludes the merge. Throws if the branch cannot be merged at all (for example, it is missing).
export function startConflictMerge(tree: string, branch: string): string[] {
  try { git(tree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); } catch {
    try { git(tree, 'fetch', '-q', 'origin', `${branch}:${branch}`); } catch { throw new Error(`${branch} is not on this computer`); }
  }
  try { git(tree, 'merge', '--no-ff', '--no-edit', '-m', `Merge: ${subjectOf(tree, branch)}`, branch); return []; } catch {
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
    const url = execFileSync('gh', ['pr', 'create', '--head', branch, '--title', title.slice(0, 120), '--body', body], { cwd: repo, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
    return url.split('\n').pop() ?? null;
  } catch { return null; }
}
