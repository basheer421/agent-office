// The port every issue tracker (GitHub issues, ClickUp, none) implements.
import type { Issue, IssueDetail, IssueReference } from '../../shared/model/issue.js';
import type { CloseReason, Comment } from '../../shared/model/change-request.js';
import type { Label } from '../../shared/model/label.js';
import type { TrackerCapabilities, TrackerKind } from '../../shared/model/tracker.js';
import type { Actor } from '../hosts/types.js';

export interface IssueTracker {
  readonly kind: TrackerKind;
  /** ClickUp starts read-only: everything false. */
  readonly caps: TrackerCapabilities;
  list(): Promise<Issue[]>;
  detail(id: string): Promise<IssueDetail>;
  /** The line a worker's prompt and the change request's body use. */
  reference(issue: Issue): IssueReference;
  /** Who the tracker sees the office as ('' if unknown): "you" on comments. */
  viewer?(): Promise<string>;
  /** Present when caps.comment. */
  comment?(id: string, body: string, as?: Actor): Promise<Comment>;
  /** Present when caps.close. */
  close?(id: string, o: { comment?: string; reason?: CloseReason }, as?: Actor): Promise<void>;
  /** Present when caps.assign: assigns it to whoever acts (`as`, else the office). */
  assignSelf?(id: string, as?: Actor): Promise<void>;
  /** Present when caps.labels. `set` resolves to the labels it has now. */
  labels?: {
    list(): Promise<Label[]>;
    set(id: string, add: string[], remove: string[], as?: Actor): Promise<Label[]>;
  };
}
