// The one place that picks a code host for a project folder. Everything else sees only CodeHost.
import { GitHubHost } from './github/index.js';
import { GitHubRepo } from './github/repo.js';
import { GitLabHost } from './gitlab/index.js';
import { gitlabHosts } from '../projects/detect.js';
import { effective } from '../projects/store.js';
import { NoHost } from './none.js';
import type { CodeHost } from './types.js';

export type { CodeHost, Actor } from './types.js';
export { MergeWatch } from './merge-watch.js';
// The office's own GitHub account (setup, cloning, the repo picker) and gh's account picking.
export { authLoginHere, ghUser, parseRemote, pickAccount, repoView, spawnClone, userRepoLines, type GhAccount } from './github/account.js';
export { ownPr } from './github/index.js';
// The office's GitLab account (⬇️ Clone from GitLab).
export { cloneGitlab, gitlabProject, gitlabProjects, type GitLabProject } from './gitlab/projects.js';

/** One GitHubRepo per folder, so a floor's host and tracker share gh's account pick and caches. */
const repos = new Map<string, GitHubRepo>();
export function githubRepo(dir: string): GitHubRepo {
  let r = repos.get(dir);
  if (!r) repos.set(dir, (r = new GitHubRepo(dir)));
  return r;
}

/**
 * Which host a folder's push remote points at: GitLab when its hostname is one of ⚙️'s GitLab
 * hosts, else GitHub (no remote at all stays GitHub, whose boards then say how to add one).
 */
export function hostKindOf(dir: string): 'github' | 'gitlab' {
  return effective(dir, gitlabHosts()).host === 'gitlab' ? 'gitlab' : 'github';
}

export function hostFor(dir: string, kind = hostKindOf(dir)): CodeHost {
  if (kind === 'gitlab') {
    const cfg = effective(dir, gitlabHosts());
    if (cfg.hostname && cfg.projectPath) return new GitLabHost({ host: cfg.hostname, projectPath: cfg.projectPath, cwd: dir });
    return new NoHost("This folder's GitLab remote isn't one the office can read");
  }
  return new GitHubHost(githubRepo(dir));
}
