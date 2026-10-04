// A floor with no issue tracker: an empty board.
import { HostError } from '../../shared/model/host.js';
import type { Issue, IssueDetail, IssueReference } from '../../shared/model/issue.js';
import { NO_TRACKER_CAPS, type TrackerCapabilities } from '../../shared/model/tracker.js';
import type { IssueTracker } from './types.js';

export class NoTracker implements IssueTracker {
  readonly kind = 'none' as const;
  readonly caps: TrackerCapabilities = NO_TRACKER_CAPS;
  /** `why`, when given, is shown on the board in place of an empty list. */
  constructor(private why?: string) {}

  async list(): Promise<Issue[]> {
    if (this.why) throw new HostError('unsupported', this.why);
    return [];
  }
  async detail(): Promise<IssueDetail> {
    throw new HostError('unsupported', 'This project has no issue tracker connected');
  }
  reference(issue: Issue): IssueReference {
    return { text: issue.ref, closing: issue.url ? `${issue.ref} (${issue.url})` : issue.ref, url: issue.url };
  }
}
