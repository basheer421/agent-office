// GitLab REST v4 JSON → the neutral model. Pure functions, so the contract tests can pin them.
import type { ChangeRequest, Check, ChecksSummary, Comment, CrState, ReviewComment } from '../../../shared/model/change-request.js';
import type { Label } from '../../../shared/model/label.js';

export interface GlUser { username: string }
export interface GlPipeline { id: number; status: string; web_url?: string }
export interface GlMergeRequest {
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'merged' | 'closed' | 'locked';
  draft?: boolean;
  work_in_progress?: boolean;
  web_url: string;
  author: GlUser | null;
  labels: string[];
  source_branch: string;
  target_branch: string;
  sha?: string;
  merge_commit_sha?: string | null;
  created_at: string;
  updated_at: string;
  head_pipeline?: GlPipeline | null;
  detailed_merge_status?: string;
  merge_status?: string;
  has_conflicts?: boolean;
  changes_count?: string | null;
  diverged_commits_count?: number;
}
export interface GlLabel { name: string; color: string; description?: string | null }
export interface GlNote {
  id: number;
  body: string;
  author: GlUser;
  created_at: string;
  system: boolean;
  type?: string | null;
  position?: { new_path: string; old_path: string; new_line: number | null; old_line: number | null } | null;
}
export interface GlDiscussion { id: string; notes: GlNote[] }
export interface GlDiff {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
}

export function crState(mr: Pick<GlMergeRequest, 'state' | 'draft' | 'work_in_progress'>): CrState {
  if (mr.state === 'merged') return 'merged';
  if (mr.state === 'closed') return 'closed';
  return mr.draft || mr.work_in_progress ? 'draft' : 'open';
}

/** A pipeline status as the board's one-word summary. */
export function checksSummary(p: GlPipeline | null | undefined): ChecksSummary {
  if (!p) return 'none';
  if (p.status === 'success') return 'pass';
  if (p.status === 'failed' || p.status === 'canceled') return 'fail';
  if (p.status === 'skipped' || p.status === 'manual') return 'none';
  return 'pending';
}

export function pipelineCheck(p: GlPipeline | null | undefined): Check[] {
  if (!p) return [];
  const s = checksSummary(p);
  return [{ name: `pipeline #${p.id}`, state: s === 'none' ? 'skip' : s, url: p.web_url }];
}

/** GitLab labels on an MR are bare names; colors come from the project's label list. */
export function labelsOf(names: string[], known: Map<string, Label>): Label[] {
  return names.map((n) => known.get(n) ?? { name: n, color: '#6699cc' });
}

export function label(l: GlLabel): Label {
  return { name: l.name, color: l.color, ...(l.description ? { description: l.description } : {}) };
}

export function changeRequest(mr: GlMergeRequest, known = new Map<string, Label>()): ChangeRequest {
  const body = mr.description ?? '';
  return {
    number: mr.iid,
    title: mr.title,
    state: crState(mr),
    url: mr.web_url,
    author: mr.author?.username ?? '',
    labels: labelsOf(mr.labels ?? [], known),
    reviewDecision: '',
    sourceBranch: mr.source_branch,
    sourceSha: mr.sha,
    targetBranch: mr.target_branch,
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    additions: 0,
    deletions: 0,
    checks: checksSummary(mr.head_pipeline),
    body,
    closes: closesIn(body),
  };
}

/** Issues the description closes, the way GitLab's default closing pattern links them. */
export function closesIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\b(?:close[sd]?|closing|fix(?:e[sd])?|fixing|resolve[sd]?|resolving|implement(?:s|ed)?|implementing)\b:?\s+((?:#\d+(?:\s*,\s*|\s+and\s+)?)+)/gi)) {
    for (const n of m[1].matchAll(/#(\d+)/g)) out.add(n[1]);
  }
  return [...out];
}

export function mergeable(mr: GlMergeRequest): string {
  if (mr.has_conflicts) return 'CONFLICTING';
  const s = mr.detailed_merge_status ?? mr.merge_status ?? '';
  if (s === 'mergeable' || s === 'can_be_merged') return 'MERGEABLE';
  return 'UNKNOWN';
}

export function comment(n: GlNote): Comment {
  return { id: String(n.id), author: n.author.username, body: n.body, createdAt: n.created_at };
}

/** Line comments: the diff notes of every discussion, threaded by the discussion's first note. */
export function reviewComments(ds: GlDiscussion[], mrUrl: string): ReviewComment[] {
  const out: ReviewComment[] = [];
  for (const d of ds) {
    const first = d.notes[0];
    for (const n of d.notes) {
      if (n.system || !n.position) continue;
      const right = n.position.new_line != null;
      out.push({
        id: n.id,
        ...(n !== first ? { replyTo: first.id } : {}),
        author: n.author.username,
        body: n.body,
        createdAt: n.created_at,
        url: `${mrUrl}#note_${n.id}`,
        path: right ? n.position.new_path : n.position.old_path,
        line: right ? n.position.new_line : n.position.old_line,
        side: right ? 'RIGHT' : 'LEFT',
      });
    }
  }
  return out;
}

/** GitLab's per-file hunks rebuilt as one unified diff `git apply` and the diff viewer read. */
export function unifiedDiff(files: GlDiff[]): string {
  return files.map((f) => {
    const a = f.new_file ? '/dev/null' : `a/${f.old_path}`;
    const b = f.deleted_file ? '/dev/null' : `b/${f.new_path}`;
    const head = [`diff --git a/${f.old_path} b/${f.new_path}`];
    if (f.new_file) head.push('new file mode 100644');
    if (f.deleted_file) head.push('deleted file mode 100644');
    if (f.renamed_file) head.push(`rename from ${f.old_path}`, `rename to ${f.new_path}`);
    if (f.diff) head.push(`--- ${a}`, `+++ ${b}`);
    const body = f.diff.endsWith('\n') || !f.diff ? f.diff : `${f.diff}\n`;
    return `${head.join('\n')}\n${body}`;
  }).join('');
}

/** Lines added and removed, counted from a unified diff. */
export function diffStat(diff: string): { additions: number; deletions: number } {
  let additions = 0, deletions = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---')) continue;
    if (l.startsWith('+')) additions++;
    else if (l.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}
