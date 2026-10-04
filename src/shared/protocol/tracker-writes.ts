// Writes to the floor's issue tracker beyond commenting and closing (boards.ts): moving a task to
// another status and making a new one (ClickUp, P4b). Only ever sent by a person clicking on the
// board, never by a worker; the server signs them with that person's name.
import type { Issue } from '../model/issue.js';
import type { IssueStatus } from '../model/tracker.js';

/** Longest task title the office sends (ClickUp's own limit is far above it). */
export const TASK_TITLE_MAX = 500;

export type TrackerWritesClientMsg =
  /** The statuses an issue can move to; answered with issues.statusList. */
  | { t: 'issues.statuses'; id: string }
  /** Moves an issue to one of them; answered with issues.statusSet. */
  | { t: 'issues.setStatus'; id: string; status: string }
  /** A new issue (ClickUp: a task in the floor's default list); answered with issues.created. */
  | { t: 'issues.create'; title: string; body: string };

export type TrackerWritesServerMsg =
  | { t: 'issues.statusList'; id: string; statuses?: IssueStatus[]; error?: string }
  | { t: 'issues.statusSet'; id: string; status?: string; error?: string }
  | { t: 'issues.created'; issue?: Issue; error?: string };
