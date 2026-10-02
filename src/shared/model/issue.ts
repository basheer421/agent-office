// An issue or task, from GitHub issues or ClickUp. Ids are strings: ClickUp's aren't numbers.
import type { Comment } from './change-request.js';
import type { Label } from './label.js';

export interface Issue {
  id: string;
  /** How people write it: "#12" on GitHub, "86c1x2" (or a custom id) on ClickUp. */
  ref: string;
  title: string;
  state: string;
  url: string;
  author: string;
  labels: Label[];
  assignees: string[];
  /** A worker in the office just took it. */
  taken?: boolean;
  createdAt: string;
  updatedAt: string;
  body: string;
  comments: number;
}

export interface IssueDetail {
  id: string;
  state: string;
  body: string;
  comments: Comment[];
  viewer: string;
}

/** The line a worker's prompt and the change request's body use. */
export interface IssueReference {
  /** "issue #12", "ClickUp task 86c1x2". */
  text: string;
  /** "Closes #12" when the host closes it on merge, else a plain mention with the link. */
  closing: string;
  url: string;
}
