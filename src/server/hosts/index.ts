// The one place that picks a code host for a project folder. Everything else sees only CodeHost.
import { execFileSync } from 'node:child_process';
import { GitHubHost } from './github/index.js';
import { GitHubRepo } from './github/repo.js';
import { NoHost } from './none.js';
import type { CodeHost } from './types.js';

export type { CodeHost, Actor } from './types.js';
export { MergeWatch } from './merge-watch.js';
// The office's own GitHub account (setup, cloning, the repo picker) and gh's account picking.
export { authLoginHere, ghUser, parseRemote, pickAccount, repoView, spawnClone, userRepoLines, type GhAccount } from './github/account.js';
export { ownPr } from './github/index.js';

/** One GitHubRepo per folder, so a floor's host and tracker share gh's account pick and caches. */
const repos = new Map<string, GitHubRepo>();
export function githubRepo(dir: string): GitHubRepo {
  let r = repos.get(dir);
  if (!r) repos.set(dir, (r = new GitHubRepo(dir)));
  return r;
}

/**
 * Which host a folder's remotes point at. P1b knows GitHub only: a GitLab remote gets no host
 * (P3 adds it); no remote at all stays GitHub, whose boards then say how to add one.
 */
export function hostKindOf(dir: string): 'github' | 'none' {
  try {
    const remotes = execFileSync('git', ['remote', '-v'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    if (remotes.trim() && !/github/i.test(remotes) && /gitlab/i.test(remotes)) return 'none';
  } catch {
    // not a checkout (yet): GitHub's own messages explain
  }
  return 'github';
}

export function hostFor(dir: string, kind = hostKindOf(dir)): CodeHost {
  return kind === 'github' ? new GitHubHost(githubRepo(dir)) : new NoHost();
}
