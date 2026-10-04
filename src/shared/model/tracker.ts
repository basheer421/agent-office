// What an issue tracker (GitHub issues, ClickUp, none) can do.

export type TrackerKind = 'github' | 'clickup' | 'none';

export interface TrackerCapabilities {
  comment: boolean;
  close: boolean;
  assign: boolean;
  labels: boolean;
  /** Moves an issue to one of its statuses (ClickUp's workflow statuses). */
  status: boolean;
  /** Makes a new issue (ClickUp: a task in the floor's default list). */
  create: boolean;
}

/** One of the statuses a ClickUp task can be in (its list's workflow). */
export interface IssueStatus {
  name: string;
  color: string;
  /** ClickUp's kind of status: open, custom, done or closed. */
  type: string;
}

export const NO_TRACKER_CAPS: TrackerCapabilities = { comment: false, close: false, assign: false, labels: false, status: false, create: false };
