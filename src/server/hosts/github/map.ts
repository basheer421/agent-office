// gh's JSON → the neutral model. Pure, so tests can pin it.
import type { ChangeRequest, Check, ChecksSummary, Comment, CrState, ReviewComment } from '../../../shared/model/change-request.js';
import type { Issue } from '../../../shared/model/issue.js';
import type { Label } from '../../../shared/model/label.js';

/** How much of a description the boards keep. */
const BODY_MAX = 4000;
const FAILED = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];

export function labels(raw: any[]): Label[] {
  return (raw ?? []).map((l) => ({ name: String(l.name), color: `#${l.color ?? '888888'}` }));
}

export function labelWithDescription(l: any): Label {
  return { name: String(l.name), color: `#${l.color ?? '888888'}`, description: l.description || undefined };
}

export function checksOf(rollup: any[]): ChecksSummary {
  if (!rollup?.length) return 'none';
  let pending = false;
  for (const c of rollup) {
    const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
    const status = String(c.status ?? '').toUpperCase();
    if (FAILED.includes(concl)) return 'fail';
    if (status && status !== 'COMPLETED') pending = true;
    if (concl === 'PENDING' || concl === 'EXPECTED') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

/** One entry of statusCheckRollup: a CheckRun (Actions) or a StatusContext (other CI). */
export function checkOf(c: any): Check {
  const concl = String(c.conclusion ?? c.state ?? '').toUpperCase();
  const status = String(c.status ?? '').toUpperCase();
  let state: Check['state'] = 'pass';
  if (FAILED.includes(concl)) state = 'fail';
  else if ((status && status !== 'COMPLETED') || !concl || concl === 'PENDING' || concl === 'EXPECTED') state = 'pending';
  else if (['SKIPPED', 'NEUTRAL', 'STALE'].includes(concl)) state = 'skip';
  const name = String(c.name ?? c.context ?? 'check');
  return { name: c.workflowName ? `${c.workflowName} / ${name}` : name, state, url: c.detailsUrl ?? c.targetUrl ?? undefined };
}

export function commentsOf(raw: any[]): Comment[] {
  return (raw ?? []).map((c: any) => ({
    id: String(c.id),
    author: c.author?.login ?? 'ghost',
    body: String(c.body ?? ''),
    createdAt: c.createdAt ?? c.submittedAt ?? '',
    url: c.url,
    state: c.state,
  }));
}

export function reviewComment(c: any): ReviewComment {
  return {
    id: c.id,
    replyTo: c.in_reply_to_id ?? undefined,
    author: c.user ?? 'ghost',
    body: String(c.body ?? ''),
    createdAt: c.created_at,
    url: c.html_url,
    path: c.path,
    line: c.line ?? null,
    side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
  };
}

export function crState(state: string, isDraft: boolean): CrState {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return isDraft ? 'draft' : 'open';
}

export function changeRequest(p: any): ChangeRequest {
  return {
    number: p.number,
    title: p.title,
    state: crState(p.state, Boolean(p.isDraft)),
    url: p.url,
    author: p.author?.login ?? '',
    labels: labels(p.labels),
    reviewDecision: p.reviewDecision ?? '',
    sourceBranch: p.headRefName,
    sourceSha: typeof p.headRefOid === 'string' ? p.headRefOid : undefined,
    targetBranch: p.baseRefName,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    additions: p.additions ?? 0,
    deletions: p.deletions ?? 0,
    checks: checksOf(p.statusCheckRollup),
    body: String(p.body ?? '').slice(0, BODY_MAX),
    closes: (p.closingIssuesReferences ?? []).map((r: any) => Number(r.number)).filter((n: number) => Number.isInteger(n) && n > 0).map(String),
  };
}

export function issue(i: any): Issue {
  return {
    id: String(i.number),
    ref: `#${i.number}`,
    title: i.title,
    state: i.state,
    url: i.url,
    author: i.author?.login ?? '',
    labels: labels(i.labels),
    assignees: (i.assignees ?? []).map((a: any) => a.login),
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    body: String(i.body ?? '').slice(0, BODY_MAX),
    comments: Array.isArray(i.comments) ? i.comments.length : Number(i.comments ?? 0),
  };
}
