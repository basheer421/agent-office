// The one place that picks an issue tracker for a project folder. Everything else sees only IssueTracker.
import { githubRepo, hostKindOf } from '../hosts/index.js';
import { GitHubTracker } from './github/index.js';
import { NoTracker } from './none.js';
import type { IssueTracker } from './types.js';

export type { IssueTracker } from './types.js';
export { Claims } from './claims.js';

export function trackerFor(dir: string, kind: 'github' | 'none' = hostKindOf(dir)): IssueTracker {
  return kind === 'github' ? new GitHubTracker(githubRepo(dir)) : new NoTracker();
}
