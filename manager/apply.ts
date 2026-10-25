// "Merge into my project": brings a finished goal's branch into the branch the project is on, so
// the code shows up in the project's folder. It never forces anything: it refuses when you have
// uncommitted changes, and a merge that conflicts is undone and reported.
import { execFileSync } from 'node:child_process';

export type ApplyResult = { ok: boolean; message: string };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Tandem', '-c', 'user.email=tandem@localhost', ...args], { cwd, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();
const firstLine = (e: unknown) => String((e as { stderr?: string; message?: string }).stderr || (e as Error).message || e).trim().split('\n').find(Boolean) ?? '';
const list = (files: string[]) => `${files.length} file${files.length === 1 ? '' : 's'} (${files.slice(0, 6).join(', ')}${files.length > 6 ? ', …' : ''})`;

export function applyBranch(repo: string, branch: string): ApplyResult {
  try { git(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); }
  catch { return { ok: false, message: `The branch ${branch} is not in this project any more.` }; }

  let current: string;
  try { current = git(repo, 'symbolic-ref', '--short', 'HEAD'); }
  catch { return { ok: false, message: 'The project is not on a branch right now. Switch to a branch (git switch main), then try again.' }; }
  if (current === branch) return { ok: true, message: `The project is already on ${branch}.` };

  const dirty = git(repo, 'status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean);
  if (dirty.length > 0) return { ok: false, message: `You have uncommitted changes in the project (${dirty.length} file${dirty.length === 1 ? '' : 's'}). Commit or stash them, then try again.` };

  try { git(repo, 'merge-base', '--is-ancestor', branch, 'HEAD'); return { ok: true, message: `${current} already has everything from ${branch}.` }; } catch { /* not merged yet */ }

  const before = git(repo, 'rev-parse', 'HEAD');
  try {
    git(repo, 'merge', '--no-edit', branch);
  } catch (e) {
    let conflicted: string[] = [];
    try { conflicted = git(repo, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean); } catch { /* none */ }
    try { git(repo, 'merge', '--abort'); } catch { /* nothing was started */ }
    return {
      ok: false,
      message: conflicted.length > 0
        ? `It conflicts with ${current} in ${conflicted.join(', ')}. Nothing was changed. Merge by hand: git merge ${branch}`
        : `Git could not merge it: ${firstLine(e)} Nothing was changed.`,
    };
  }
  const changed = git(repo, 'diff', '--name-only', before, 'HEAD').split('\n').filter(Boolean);
  return { ok: true, message: `Merged ${branch} into ${current}: ${list(changed)}.` };
}
