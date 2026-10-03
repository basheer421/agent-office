// A change request: a GitHub pull request or a GitLab merge request, in words neither owns.
import type { Label } from './label.js';

export type CrState = 'draft' | 'open' | 'merged' | 'closed';
export type ChecksSummary = 'pass' | 'fail' | 'pending' | 'none';
export type MergeMethod = 'squash' | 'merge' | 'rebase';
/** Why an issue was closed. */
export type CloseReason = 'completed' | 'not planned';

export interface ChangeRequest {
  /** GitHub's PR number, GitLab's MR iid. */
  number: number;
  title: string;
  state: CrState;
  url: string;
  author: string;
  labels: Label[];
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or '' (none needed / not supported). */
  reviewDecision: string;
  sourceBranch: string;
  /** The commit its branch is at (for a merged one, the last one merged). */
  sourceSha?: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  checks: ChecksSummary;
  body: string;
  /** Issues it closes, as the host links them (ids as strings). */
  closes: string[];
}

export interface Check {
  name: string;
  state: 'pass' | 'fail' | 'pending' | 'skip';
  url?: string;
}

/** A comment on a conversation, or a submitted review (then `state` is set). */
export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** Reviews only: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  state?: string;
}
export type Review = Comment;

/** A comment on a line of the diff. */
export interface ReviewComment {
  id: number;
  replyTo?: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  path: string;
  /** null when the code under it changed since (outdated). */
  line: number | null;
  /** LEFT is the old file's line numbers, RIGHT the new file's. */
  side: 'LEFT' | 'RIGHT';
}

export interface RepoInfo {
  /** owner/name on GitHub, group/project on GitLab. */
  path: string;
  methods: MergeMethod[];
}

export interface ChangeRequestDetail {
  number: number;
  body: string;
  state: CrState;
  reviewDecision: string;
  sourceBranch: string;
  targetBranch: string;
  /** MERGEABLE, CONFLICTING or UNKNOWN. */
  mergeable: string;
  /** Host-specific merge state (GitHub: CLEAN, BLOCKED, BEHIND, DIRTY, …). */
  mergeStatus: string;
  commits: number;
  comments: Comment[];
  reviews: Review[];
  reviewComments: ReviewComment[];
  checks: Check[];
  repo: RepoInfo;
  /** Who the CLI is signed in as on the server ('' if unknown). */
  viewer: string;
}

export interface MergeOptions {
  method: MergeMethod;
  /** Merge once checks pass (GitHub auto-merge, GitLab merge when pipeline succeeds). */
  auto?: boolean;
  deleteBranch?: boolean;
}

export interface CloseOptions {
  comment?: string;
  deleteBranch?: boolean;
}
