// The port every issue tracker (GitHub issues, ClickUp, none) implements.
import type { Issue, IssueDetail, IssueReference } from '../../shared/model/issue.js';
import type { TrackerCapabilities, TrackerKind } from '../../shared/model/tracker.js';

export interface IssueTracker {
  readonly kind: TrackerKind;
  /** ClickUp starts read-only: everything false. */
  readonly caps: TrackerCapabilities;
  list(): Promise<Issue[]>;
  detail(id: string): Promise<IssueDetail>;
  /** The line a worker's prompt and the change request's body use. */
  reference(issue: Issue): IssueReference;
}
