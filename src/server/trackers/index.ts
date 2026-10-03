// The one place that picks an issue tracker for a project folder. Everything else sees only IssueTracker.
import { githubRepo, hostKindOf } from '../hosts/index.js';
import { GitHubTracker } from './github/index.js';
import { NoTracker } from './none.js';
import type { IssueTracker } from './types.js';

export type { IssueTracker } from './types.js';
export { Claims } from './claims.js';

/** GitLab projects keep their issues elsewhere (ClickUp, P4): no issues board on them yet. */
export const GITLAB_NO_ISSUES = "GitLab projects don't have an issues board in the office yet (ClickUp tasks come with issue #15)";

export function trackerFor(dir: string, kind: 'github' | 'gitlab' | 'none' = hostKindOf(dir)): IssueTracker {
  return kind === 'github' ? new GitHubTracker(githubRepo(dir)) : new NoTracker(GITLAB_NO_ISSUES);
}
