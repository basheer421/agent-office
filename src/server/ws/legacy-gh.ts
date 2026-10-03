// The neutral model → the Gh* shapes the wire still carries, so the client is untouched until P1c
// renames the protocol (and deletes this file).
import type { ChangeRequest, ChangeRequestDetail, Comment, CrState, RepoInfo } from '../../shared/model/change-request.js';
import type { Issue, IssueDetail } from '../../shared/model/issue.js';
import type { GhComment, GhIssue, GhIssueDetail, GhPull, GhPullDetail, GhRepoInfo } from '../../shared/protocol.js';

/** GitHub's word for a state: OPEN (a draft is an open one with isDraft), MERGED or CLOSED. */
export function ghState(s: CrState): string {
  return s === 'merged' ? 'MERGED' : s === 'closed' ? 'CLOSED' : 'OPEN';
}

export function ghPull(p: ChangeRequest): GhPull {
  return {
    number: p.number,
    title: p.title,
    state: ghState(p.state),
    isDraft: p.state === 'draft',
    url: p.url,
    author: p.author,
    labels: p.labels,
    reviewDecision: p.reviewDecision,
    headRefName: p.sourceBranch,
    headRefOid: p.sourceSha,
    baseRefName: p.targetBranch,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    additions: p.additions,
    deletions: p.deletions,
    checks: p.checks,
    body: p.body,
    closes: p.closes.map(Number).filter((n) => Number.isInteger(n) && n > 0),
  };
}

export function ghIssue(i: Issue): GhIssue {
  const { id, ref: _ref, ...rest } = i;
  return { ...rest, number: Number(id) };
}

export function ghComment(c: Comment): GhComment {
  return c;
}

export function ghRepo(r: RepoInfo): GhRepoInfo {
  return { nameWithOwner: r.path, methods: r.methods };
}

export function ghPullDetail(d: ChangeRequestDetail): GhPullDetail {
  return {
    number: d.number,
    body: d.body,
    state: ghState(d.state),
    isDraft: d.state === 'draft',
    reviewDecision: d.reviewDecision,
    headRefName: d.sourceBranch,
    baseRefName: d.targetBranch,
    mergeable: d.mergeable,
    mergeStateStatus: d.mergeStatus,
    commits: d.commits,
    comments: d.comments,
    reviews: d.reviews,
    reviewComments: d.reviewComments,
    checks: d.checks,
    repo: ghRepo(d.repo),
    viewer: d.viewer,
  };
}

export function ghIssueDetail(d: IssueDetail): GhIssueDetail {
  return { number: Number(d.id), state: d.state, body: d.body, comments: d.comments, viewer: d.viewer };
}
