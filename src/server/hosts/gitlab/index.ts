// The GitLab code host: merge requests through `glab api` (REST v4), so the server's (or a
// person's own) glab sign-in is the only credential. Project id = the URL-encoded path, MR = iid.
import type { ChangeRequest, ChangeRequestDetail, CloseOptions, Comment, MergeOptions } from '../../../shared/model/change-request.js';
import { HostError, type HostCapabilities, type HostVocabulary } from '../../../shared/model/host.js';
import type { Label } from '../../../shared/model/label.js';
import { cliJson, cliText } from '../../cli/run.js';
import type { Actor, CodeHost, LabelOps } from '../types.js';
import * as map from './map.js';

export interface GitLabTarget {
  /** gitlab.com, gitlab.g137.io, … (glab defaults to gitlab.com outside a repo, so always explicit). */
  host: string;
  /** group/subgroup/project */
  projectPath: string;
  cwd: string;
}

type Fields = Record<string, string | number | boolean | undefined>;

/** `glab api` arguments: method, path, and -f key=value per field (undefined fields dropped). */
export function apiArgs(host: string, method: string, path: string, fields: Fields = {}): string[] {
  const args = ['api', '--hostname', host, path];
  if (method !== 'GET') args.push('-X', method);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) args.push('-f', `${k}=${v}`);
  return args;
}

/** Matches a worker running `glab mr create` and returns the MR URL it printed. */
export function glabCreatedBy(command: string, output: string): string | undefined {
  if (!/\bglab\s+mr\s+(create|new)\b/.test(command)) return undefined;
  return output.match(/https?:\/\/\S+?\/-\/merge_requests\/\d+/)?.[0];
}

export class GitLabHost implements CodeHost {
  readonly kind = 'gitlab' as const;
  readonly caps: HostCapabilities = { labels: true, reviews: true, autoMerge: true, draft: true, lineComments: true, mergeMethods: ['merge', 'squash'] };
  readonly words: HostVocabulary = { crNoun: 'merge request', crShort: 'MR', refPrefix: '!', cli: 'glab' };
  readonly labels: LabelOps;
  private readonly project: string;
  private labelCache?: Map<string, Label>;

  constructor(private readonly t: GitLabTarget) {
    this.project = `projects/${encodeURIComponent(t.projectPath)}`;
    this.labels = {
      list: async () => [...(await this.knownLabels(true)).values()],
      set: async (n, add, remove, as) => {
        await this.call('PUT', this.mr(n), { add_labels: add.join(',') || undefined, remove_labels: remove.join(',') || undefined }, as);
      },
    };
  }

  private mr(n: number): string {
    return `${this.project}/merge_requests/${n}`;
  }

  private opts(as?: Actor) {
    return { cwd: this.t.cwd, env: as?.env };
  }

  private api<T>(path: string, as?: Actor): Promise<T> {
    return cliJson<T>('glab', apiArgs(this.t.host, 'GET', path), this.opts(as));
  }

  private call<T>(method: string, path: string, fields: Fields, as?: Actor): Promise<T> {
    return cliJson<T>('glab', apiArgs(this.t.host, method, path, fields), this.opts(as));
  }

  private async knownLabels(fresh = false): Promise<Map<string, Label>> {
    if (!this.labelCache || fresh) {
      const ls = await this.api<map.GlLabel[]>(`${this.project}/labels?per_page=100`).catch(() => []);
      this.labelCache = new Map(ls.map((l) => [l.name, map.label(l)]));
    }
    return this.labelCache;
  }

  async viewer(): Promise<string> {
    return (await this.api<map.GlUser>('user')).username;
  }

  async list(): Promise<ChangeRequest[]> {
    const q = (state: string, n: number) => this.api<map.GlMergeRequest[]>(`${this.project}/merge_requests?state=${state}&per_page=${n}&order_by=updated_at`);
    const [known, open, merged, closed] = await Promise.all([this.knownLabels(), q('opened', 100), q('merged', 30), q('closed', 20)]);
    return [...open, ...merged, ...closed].map((mr) => map.changeRequest(mr, known));
  }

  async detail(n: number): Promise<ChangeRequestDetail> {
    const [mr, notes, discussions, commits, viewer, approvals] = await Promise.all([
      this.api<map.GlMergeRequest>(this.mr(n)),
      this.api<map.GlNote[]>(`${this.mr(n)}/notes?per_page=100&sort=asc`),
      this.api<map.GlDiscussion[]>(`${this.mr(n)}/discussions?per_page=100`),
      this.api<unknown[]>(`${this.mr(n)}/commits?per_page=100`).catch(() => []),
      this.viewer().catch(() => ''),
      // Approval rules are a paid tier on some instances: no approvals then, not an error.
      this.api<{ approved_by?: { user: map.GlUser }[] }>(`${this.mr(n)}/approvals`).catch(() => undefined),
    ]);
    const approvedBy = approvals?.approved_by ?? [];
    return {
      number: mr.iid,
      body: mr.description ?? '',
      state: map.crState(mr),
      reviewDecision: approvedBy.length ? 'APPROVED' : '',
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      mergeable: map.mergeable(mr),
      mergeStatus: (mr.detailed_merge_status ?? mr.merge_status ?? '').toUpperCase(),
      commits: commits.length,
      comments: notes.filter((x) => !x.system && !x.position).map(map.comment),
      reviews: approvedBy.map((a) => ({ id: `approval-${a.user.username}`, author: a.user.username, body: '', createdAt: mr.updated_at, state: 'APPROVED' })),
      reviewComments: map.reviewComments(discussions, mr.web_url),
      checks: map.pipelineCheck(mr.head_pipeline),
      repo: { path: this.t.projectPath, methods: this.caps.mergeMethods },
      viewer,
    };
  }

  async diff(n: number): Promise<string> {
    const files = await this.api<map.GlDiff[]>(`${this.mr(n)}/diffs?per_page=100`)
      .catch(async () => (await this.api<{ changes: map.GlDiff[] }>(`${this.mr(n)}/changes`)).changes);
    return map.unifiedDiff(files);
  }

  /** One merge request, by iid or its URL. */
  async get(n: number | string): Promise<ChangeRequest> {
    const iid = typeof n === 'number' ? n : Number(/\/merge_requests\/(\d+)/.exec(n)?.[1] ?? n);
    if (!Number.isSafeInteger(iid) || iid <= 0) throw new HostError('not-found', `No merge request ${n}`);
    return map.changeRequest(await this.api<map.GlMergeRequest>(this.mr(iid)), await this.knownLabels());
  }

  async create(o: { source: string; target?: string; title: string; body: string }, as?: Actor): Promise<ChangeRequest> {
    // GitLab needs a target; without one it's the project's default branch.
    const target = o.target ?? (await this.api<{ default_branch: string }>(this.project)).default_branch;
    const mr = await this.call<map.GlMergeRequest>('POST', `${this.project}/merge_requests`, {
      source_branch: o.source, target_branch: target, title: o.title, description: o.body, remove_source_branch: true,
    }, as);
    return map.changeRequest(mr, await this.knownLabels());
  }

  async findForBranch(branch: string): Promise<ChangeRequest | undefined> {
    const mrs = await this.api<map.GlMergeRequest[]>(`${this.project}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`);
    return mrs[0] && map.changeRequest(mrs[0], await this.knownLabels());
  }

  async comment(n: number, body: string, as?: Actor): Promise<Comment> {
    return map.comment(await this.call<map.GlNote>('POST', `${this.mr(n)}/notes`, { body }, as));
  }

  /** A review on GitLab is a note; returns its URL. */
  async review(n: number, body: string, as?: Actor): Promise<string> {
    const note = await this.call<map.GlNote>('POST', `${this.mr(n)}/notes`, { body }, as);
    const mr = await this.api<map.GlMergeRequest>(this.mr(n));
    return `${mr.web_url}#note_${note.id}`;
  }

  async merge(n: number, o: MergeOptions, as?: Actor): Promise<void> {
    if (o.method === 'rebase') throw new HostError('unsupported', 'GitLab picks rebase/fast-forward in the project settings', 'Use merge or squash');
    await this.call('PUT', `${this.mr(n)}/merge`, {
      squash: o.method === 'squash',
      should_remove_source_branch: o.deleteBranch ?? undefined,
      merge_when_pipeline_succeeds: o.auto || undefined,
    }, as);
  }

  async close(n: number, o: CloseOptions, as?: Actor): Promise<void> {
    if (o.comment) await this.comment(n, o.comment, as);
    const mr = await this.call<map.GlMergeRequest>('PUT', this.mr(n), { state_event: 'close' }, as);
    if (o.deleteBranch) {
      await cliText('glab', apiArgs(this.t.host, 'DELETE', `${this.project}/repository/branches/${encodeURIComponent(mr.source_branch)}`), this.opts(as));
    }
  }

  createdBy(command: string, output: string): string | undefined {
    return glabCreatedBy(command, output);
  }
}

/** What to tell a worker about GitLab, for the prompt. */
export function gitlabPromptHints(base: string): string {
  return [
    'This project is on GitLab: use `glab`, not `gh`. Merge requests are `!<n>`.',
    '- read one: `glab mr view <n> --comments`, its diff: `glab mr diff <n>`, check it out: `glab mr checkout <n>`',
    `- open one: \`glab mr create --fill --target-branch ${base}\``,
    '- merge one: `glab mr merge <n>`',
  ].join('\n');
}
