// The GitHub code host: pull requests through gh, as the office's account for the repo or as
// someone signed in to their own (see signins.ts).
import type { ChangeRequest, ChangeRequestDetail, CloseOptions, Comment, MergeOptions } from '../../../shared/model/change-request.js';
import type { HostCapabilities, HostVocabulary } from '../../../shared/model/host.js';
import type { Actor, CodeHost, LabelOps } from '../types.js';
import { json, jsonLines } from './cli.js';
import { changeRequest, checkOf, commentsOf, crState, reviewComment } from './map.js';
import { GitHubRepo } from './repo.js';

/** `gh pr create` being run, alone or in a longer line: not one that only names it (a grep for it, a quoted string). */
const CREATES_PR = /(?:^|[\s;&|(])gh\s+pr\s+create\b/;
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;
const PR_FIELDS = 'number,title,state,isDraft,url,author,labels,reviewDecision,headRefName,headRefOid,baseRefName,createdAt,updatedAt,additions,deletions,statusCheckRollup,body,closingIssuesReferences';

/**
 * The pull request a worker opened itself, read off a shell command it ran and what that printed:
 * `gh pr create` prints the new pull request's URL, or the one its branch already had. The last one
 * printed is it.
 */
export function ownPr(command: unknown, output: string): { repo: string; number: number; url: string } | undefined {
  if (typeof command !== 'string' || !CREATES_PR.test(command)) return undefined;
  const last = [...output.matchAll(PR_URL)].pop();
  return last && { repo: last[1], number: Number(last[2]), url: last[0] };
}

export class GitHubHost implements CodeHost {
  readonly kind = 'github' as const;
  readonly caps: HostCapabilities = { labels: true, reviews: true, autoMerge: true, draft: true, lineComments: true, mergeMethods: ['squash', 'merge', 'rebase'] };
  readonly words: HostVocabulary = { crNoun: 'pull request', crShort: 'PR', refPrefix: '#', cli: 'gh' };
  readonly labels: LabelOps;

  constructor(readonly repo: GitHubRepo) {
    this.labels = { list: () => repo.labels(), set: (n, add, remove, as) => repo.setLabels(n, add, remove, as) };
  }

  viewer(): Promise<string> {
    return this.repo.viewer();
  }

  async list(): Promise<ChangeRequest[]> {
    const [open, merged, closed] = await Promise.all([
      this.repo.gh(['pr', 'list', '--state', 'open', '--limit', '150', '--json', PR_FIELDS]),
      this.repo.gh(['pr', 'list', '--state', 'merged', '--limit', '30', '--json', PR_FIELDS]),
      this.repo.gh(['pr', 'list', '--state', 'closed', '--limit', '40', '--json', PR_FIELDS]),
    ]);
    // `--state closed` includes merged PRs; keep only the ones closed without merging.
    const seen = new Set<number>();
    return [...JSON.parse(open), ...JSON.parse(merged), ...JSON.parse(closed)].filter((p: any) => !seen.has(p.number) && seen.add(p.number)).map(changeRequest);
  }

  /** One pull request, by number or URL (a URL reaches one in another repository). */
  async get(n: number | string): Promise<ChangeRequest> {
    return changeRequest(json(await this.repo.gh(['pr', 'view', String(n), '--json', PR_FIELDS])));
  }

  async detail(n: number): Promise<ChangeRequestDetail> {
    const fields = 'number,body,state,isDraft,reviewDecision,headRefName,baseRefName,mergeable,mergeStateStatus,commits,comments,reviews,statusCheckRollup';
    const jq = '.[] | {id, in_reply_to_id, path, line, side, body, user: .user.login, created_at, html_url}';
    const [view, lines, repo, viewer] = await Promise.all([
      this.repo.gh(['pr', 'view', String(n), '--json', fields]),
      this.repo.gh(['api', `repos/{owner}/{repo}/pulls/${n}/comments?per_page=100`, '--paginate', '--jq', jq]),
      this.repo.info(),
      this.repo.viewer(),
    ]);
    const p = json(view);
    return {
      number: p.number,
      body: String(p.body ?? ''),
      state: crState(p.state, Boolean(p.isDraft)),
      reviewDecision: p.reviewDecision ?? '',
      sourceBranch: p.headRefName,
      targetBranch: p.baseRefName,
      mergeable: p.mergeable ?? 'UNKNOWN',
      mergeStatus: p.mergeStateStatus ?? 'UNKNOWN',
      commits: (p.commits ?? []).length,
      comments: commentsOf(p.comments),
      // A line comment also makes an empty COMMENTED review; the comment itself is shown instead.
      reviews: commentsOf(p.reviews).filter((r) => r.body.trim() || r.state !== 'COMMENTED'),
      reviewComments: jsonLines(lines).map(reviewComment),
      checks: (p.statusCheckRollup ?? []).map(checkOf),
      repo,
      viewer,
    };
  }

  /** The PR's unified diff, as `git diff` prints it. */
  diff(n: number): Promise<string> {
    return this.repo.gh(['pr', 'diff', String(n), '--color', 'never'], { timeout: 60_000 });
  }

  /** `gh pr create` for a pushed branch. */
  async create(o: { source: string; target?: string; title: string; body: string }, as?: Actor): Promise<ChangeRequest> {
    const out = await this.repo.gh(['pr', 'create', '--head', o.source, ...(o.target ? ['--base', o.target] : []), '--title', o.title, '--body', o.body], { timeout: 120_000, as });
    const url = out.trim().split('\n').pop() ?? '';
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
    if (!/^https?:\/\//.test(url) || !number) throw new Error(`gh did not return a pull request URL (${out.trim().slice(0, 120)})`);
    const now = new Date().toISOString();
    return {
      number, title: o.title, state: 'open', url, author: '', labels: [], reviewDecision: '', sourceBranch: o.source, targetBranch: o.target ?? '',
      createdAt: now, updatedAt: now, additions: 0, deletions: 0, checks: 'none', body: o.body, closes: [],
    };
  }

  async findForBranch(branch: string): Promise<ChangeRequest | undefined> {
    const found = JSON.parse((await this.repo.gh(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', PR_FIELDS])) || '[]')[0];
    return found ? changeRequest(found) : undefined;
  }

  comment(n: number, body: string, as?: Actor): Promise<Comment> {
    return this.repo.comment(n, body, as);
  }

  /** A review that only comments (the meeting room's review panel): its URL. The body goes over stdin. */
  async review(n: number, body: string, as?: Actor): Promise<string> {
    // -F reads @-'s contents (stdin) as the value; {owner}/{repo} are filled in from the checkout's remote.
    return (await this.repo.gh(['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${n}/reviews`, '-F', 'body=@-', '-f', 'event=COMMENT', '--jq', '.html_url'], { timeout: 60_000, as, input: body })).trim();
  }

  /** Merges a PR, or with `auto` has GitHub merge it once its requirements pass. */
  async merge(n: number, o: MergeOptions, as?: Actor): Promise<void> {
    try {
      const repo = await this.repo.info();
      // --repo keeps gh out of the office's own checkout: without it, --delete-branch also deletes
      // the local branch and switches the project folder over to the base branch.
      const args = ['pr', 'merge', String(n), `--${o.method}`, '--repo', repo.path];
      if (o.deleteBranch) args.push('--delete-branch');
      if (o.auto) args.push('--auto');
      await this.repo.gh(args, { timeout: 90_000, as });
    } catch (err) {
      const msg = (err as Error).message;
      // Name who gh acted as, so a denied merge says which account lacked the rights.
      const login = as ? undefined : ((await this.repo.officeAccount())?.login ?? (await this.repo.viewer()));
      throw new Error(login ? `${msg} (gh acted as @${login})` : msg);
    }
  }

  /** Closes a pull request without merging it, optionally saying why. */
  async close(n: number, o: CloseOptions, as?: Actor): Promise<void> {
    const repo = await this.repo.info();
    // --repo for the same reason as merge: --delete-branch must leave the office's checkout alone.
    const args = ['pr', 'close', String(n), '--repo', repo.path];
    // --flag=value, so a comment starting with "-" isn't read as a flag.
    if (o.comment) args.push(`--comment=${o.comment}`);
    if (o.deleteBranch) args.push('--delete-branch');
    await this.repo.gh(args, { as });
  }

  async body(n: number | string, as?: Actor): Promise<string> {
    return this.repo.gh(['pr', 'view', String(n), '--json', 'body', '--jq', '.body'], { as });
  }

  async setBody(n: number | string, body: string, as?: Actor): Promise<void> {
    await this.repo.gh(['pr', 'edit', String(n), '--body', body], { timeout: 60_000, as });
  }

  createdBy(command: string, output: string): string | undefined {
    return ownPr(command, output)?.url;
  }
}
