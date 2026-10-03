// GitHub issues as the floor's tracker, through the same gh (and account) as its pull requests.
import type { CloseReason, Comment } from '../../../shared/model/change-request.js';
import type { Issue, IssueDetail, IssueReference } from '../../../shared/model/issue.js';
import type { Label } from '../../../shared/model/label.js';
import type { TrackerCapabilities } from '../../../shared/model/tracker.js';
import { json } from '../../hosts/github/cli.js';
import { commentsOf, issue } from '../../hosts/github/map.js';
import type { GitHubRepo } from '../../hosts/github/repo.js';
import type { Actor } from '../../hosts/types.js';
import type { IssueTracker } from '../types.js';

const FIELDS = 'number,title,state,url,author,labels,assignees,createdAt,updatedAt,body,comments';

export class GitHubTracker implements IssueTracker {
  readonly kind = 'github' as const;
  readonly caps: TrackerCapabilities = { comment: true, close: true, assign: true, labels: true };
  readonly labels: { list(): Promise<Label[]>; set(id: string, add: string[], remove: string[], as?: Actor): Promise<Label[]> };

  constructor(private readonly repo: GitHubRepo) {
    this.labels = { list: () => repo.labels(), set: (id, add, remove, as) => repo.setLabels(Number(id), add, remove, as) };
  }

  viewer(): Promise<string> {
    return this.repo.viewer();
  }

  async list(): Promise<Issue[]> {
    // Open and closed separately, so old open issues are never crowded out by recent closed ones.
    const [open, closed] = await Promise.all([
      this.repo.gh(['issue', 'list', '--state', 'open', '--limit', '300', '--json', FIELDS]),
      this.repo.gh(['issue', 'list', '--state', 'closed', '--limit', '40', '--json', FIELDS]),
    ]);
    return [...JSON.parse(open), ...JSON.parse(closed)].map(issue);
  }

  async detail(id: string): Promise<IssueDetail> {
    const [view, viewer] = await Promise.all([this.repo.gh(['issue', 'view', id, '--json', 'number,state,body,comments']), this.repo.viewer()]);
    const i = json(view);
    return { id: String(i.number), state: i.state, body: String(i.body ?? ''), comments: commentsOf(i.comments), viewer };
  }

  reference(i: Issue): IssueReference {
    return { text: `GitHub issue ${i.ref}`, closing: `Closes ${i.ref}`, url: i.url };
  }

  comment(id: string, body: string, as?: Actor): Promise<Comment> {
    return this.repo.comment(Number(id), body, as);
  }

  async close(id: string, o: { comment?: string; reason?: CloseReason }, as?: Actor): Promise<void> {
    const repo = await this.repo.info();
    const args = ['issue', 'close', id, '--repo', repo.path];
    // --flag=value, so a comment starting with "-" isn't read as a flag.
    if (o.comment) args.push(`--comment=${o.comment}`);
    if (o.reason) args.push(`--reason=${o.reason}`);
    await this.repo.gh(args, { as });
  }

  async assignSelf(id: string, as?: Actor): Promise<void> {
    await this.repo.gh(['issue', 'edit', id, '--add-assignee', '@me'], { as });
  }
}
