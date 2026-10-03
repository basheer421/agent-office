// The floor's two boards: the change requests (GitHub pull requests, GitLab merge requests) and the
// issues, and what the office does to them. Payloads are the model's shapes (shared/model/), so the
// wire says nothing about which code host or tracker the floor's project uses.
import type { ChangeRequest, CloseReason, Comment, MergeMethod } from '../model/change-request.js';
import type { HostCapabilities, HostKind, HostVocabulary } from '../model/host.js';
import type { Issue } from '../model/issue.js';
import type { Label } from '../model/label.js';
import type { TrackerCapabilities, TrackerKind } from '../model/tracker.js';

export type * from '../model/index.js';

/** A board's list as last fetched. */
export interface BoardState<T> {
  items: T[];
  error?: string;
  fetchedAt: number;
  loading: boolean;
}

/** The floor's code host, as the board UI needs it: its words ("PR"/"MR") and what it can do. */
export interface HostView {
  kind: HostKind;
  words: HostVocabulary;
  caps: HostCapabilities;
}

export interface TrackerView {
  kind: TrackerKind;
  caps: TrackerCapabilities;
}

/** What a labels message is about. */
export type LabelTarget = 'cr' | 'issue';

/** Hosts turn away comments longer than this (GitHub's limit; GitLab's is larger). */
export const COMMENT_MAX = 65536;
/** Longer than any label name: GitHub stops at 50 characters, and JS counts an emoji as two. */
export const LABEL_MAX = 100;
/** Longest issue id the office takes (ClickUp custom ids are short; GitHub's are numbers). */
export const ISSUE_ID_MAX = 64;

export type BoardsClientMsg =
  | { t: 'boards.refresh' }
  /** Merge a change request; the answer comes back as cr.merged. */
  | { t: 'cr.merge'; number: number; method: MergeMethod; deleteBranch: boolean; auto?: boolean }
  /** Comment on a change request's conversation, as the server's account; answered with cr.commented. */
  | { t: 'cr.comment'; number: number; body: string }
  /** Comment on an issue; answered with issues.commented. */
  | { t: 'issues.comment'; id: string; body: string }
  /** Close a change request without merging it; answered with cr.closed. */
  | { t: 'cr.close'; number: number; comment?: string; deleteBranch?: boolean }
  /** Close an issue; answered with issues.closed. */
  | { t: 'issues.close'; id: string; comment?: string; reason?: CloseReason }
  /** Put labels on an issue or change request (`id` is its id, or the CR's number) and take others off; answered with labels.changed. */
  | { t: 'labels.set'; target: LabelTarget; id: string; add: string[]; remove: string[] };

export type BoardsServerMsg =
  | { t: 'issues.list'; state: BoardState<Issue> }
  | { t: 'cr.list'; state: BoardState<ChangeRequest> }
  /** Sent to whoever asked for the merge. */
  | { t: 'cr.merged'; number: number; error?: string }
  /** Sent to whoever commented: the comment as the host saved it, or why it wasn't. */
  | { t: 'cr.commented'; number: number; comment?: Comment; error?: string }
  | { t: 'issues.commented'; id: string; comment?: Comment; error?: string }
  /** Sent to whoever asked to close it. */
  | { t: 'cr.closed'; number: number; error?: string }
  | { t: 'issues.closed'; id: string; error?: string }
  /** Sent to whoever changed them: the labels it has now, or why they didn't change. */
  | { t: 'labels.changed'; target: LabelTarget; id: string; labels?: Label[]; error?: string };
