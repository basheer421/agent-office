// A floor with no issue tracker: an empty board.
import { HostError } from '../../shared/model/host.js';
import type { Issue, IssueDetail, IssueReference } from '../../shared/model/issue.js';
import type { TrackerCapabilities } from '../../shared/model/tracker.js';
import type { IssueTracker } from './types.js';

export class NoTracker implements IssueTracker {
  readonly kind = 'none' as const;
  readonly caps: TrackerCapabilities = { comment: false, close: false, assign: false, labels: false };

  async list(): Promise<Issue[]> { return []; }
  async detail(): Promise<IssueDetail> {
    throw new HostError('unsupported', 'This project has no issue tracker connected');
  }
  reference(issue: Issue): IssueReference {
    return { text: issue.ref, closing: issue.url ? `${issue.ref} (${issue.url})` : issue.ref, url: issue.url };
  }
}
