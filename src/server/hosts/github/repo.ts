// One GitHub repository as the office reaches it: the project folder gh runs in, which of the
// office's gh accounts acts on it, and what's asked once (its merge methods, the viewer, labels).
// The code host (pull requests) and the tracker (issues) of a floor share one.
import type { Comment, RepoInfo } from '../../../shared/model/change-request.js';
import type { Label } from '../../../shared/model/label.js';
import type { Actor } from '../types.js';
import { pickAccount, type GhAccount } from './account.js';
import { gh, jsonLines, json } from './cli.js';
import { commentsOf, labels, labelWithDescription } from './map.js';

/** How long the repo's list of labels is kept before the label picker asks GitHub again. */
const LABELS_MS = 60_000;
/** How long the account picked for the repo is kept before gh's sign-ins are looked at again. */
const ACCOUNT_MS = 5 * 60_000;

export class GitHubRepo {
  private repo?: Promise<RepoInfo>;
  private login?: Promise<string>;
  private labelList?: { at: number; list: Promise<Label[]> };
  /** Which of the office's gh accounts acts on this repo (see account.ts), and when it was picked. */
  private account?: { at: number; pick: Promise<GhAccount | undefined> };

  constructor(readonly dir: string) {}

  /** The office's gh account for this repo when it isn't gh's active one; undefined to run gh as it is. */
  officeAccount(): Promise<GhAccount | undefined> {
    if (!this.account || Date.now() - this.account.at > ACCOUNT_MS) this.account = { at: Date.now(), pick: pickAccount(this.dir).catch(() => undefined) };
    return this.account.pick;
  }

  /** gh in the project folder: as `as` (someone's own sign-in) when given, else as the office's account for this repo. */
  async gh(args: string[], o: { timeout?: number; as?: Actor; input?: string } = {}): Promise<string> {
    if (o.as) return gh(args, this.dir, o.timeout, o.as.env, true, o.input);
    return gh(args, this.dir, o.timeout, (await this.officeAccount())?.env, false, o.input);
  }

  /** The repository's full name and how it lets PRs merge. Asked once (again after a failure). */
  info(): Promise<RepoInfo> {
    this.repo ??= this.gh(['repo', 'view', '--json', 'nameWithOwner,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed']).then((out) => {
      const r = json(out);
      const methods = (['squash', 'merge', 'rebase'] as const).filter((m) => r[{ squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }[m]]);
      return { path: String(r.nameWithOwner), methods: methods.length ? methods : ['squash', 'merge', 'rebase'] };
    });
    this.repo.catch(() => (this.repo = undefined));
    return this.repo;
  }

  /** Who the office's own gh is signed in as, which is who it comments as for everyone without their own. Asked once; '' when gh can't say. */
  viewer(): Promise<string> {
    this.login ??= this.gh(['api', 'user', '--jq', '.login']).then((out) => out.trim());
    this.login.catch(() => (this.login = undefined));
    return this.login.catch(() => '');
  }

  /** Every label the repository has, for the label picker. Asked again after a minute (or a failure). */
  labels(): Promise<Label[]> {
    if (!this.labelList || Date.now() - this.labelList.at > LABELS_MS) {
      const list = this.gh(['api', 'repos/{owner}/{repo}/labels?per_page=100', '--paginate', '--jq', '.[] | {name, color, description}']).then((out) => jsonLines(out).map(labelWithDescription));
      this.labelList = { at: Date.now(), list };
      list.catch(() => this.labelList?.list === list && (this.labelList = undefined));
    }
    return this.labelList.list;
  }

  /** Comments on an issue or a PR's conversation (to GitHub a PR is an issue too): the comment as GitHub saved it. */
  async comment(n: number, body: string, as?: Actor): Promise<Comment> {
    // -f sends the body as a plain string: no @file reading, no {owner} filling in.
    const jq = '{id: .node_id, author: {login: .user.login}, body, createdAt: .created_at, url: .html_url}';
    const out = await this.gh(['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${n}/comments`, '-f', `body=${body}`, '--jq', jq], { as });
    return commentsOf([json(out)])[0];
  }

  /** Puts labels on an issue or PR and takes others off: the labels it has now. */
  async setLabels(n: number, add: string[], remove: string[], as?: Actor): Promise<Label[]> {
    const path = `repos/{owner}/{repo}/issues/${n}/labels`;
    const jq = '[.[] | {name, color}]';
    let now: Label[] | undefined;
    // -f labels[]=… sends a JSON array of plain strings: no @file reading, no {owner} filling in.
    if (add.length) now = labels(json(await this.gh(['api', '--method', 'POST', path, ...add.flatMap((l) => ['-f', `labels[]=${l}`]), '--jq', jq], { as })));
    for (const l of remove) {
      try {
        now = labels(json(await this.gh(['api', '--method', 'DELETE', `${path}/${encodeURIComponent(l)}`, '--jq', jq], { as })));
      } catch (err) {
        // Someone took it off already, which is what was asked for.
        if (!/label does not exist/i.test((err as Error).message)) throw err;
      }
    }
    return now ?? labels(json(await this.gh(['api', `${path}?per_page=100`, '--jq', jq], { as })));
  }
}
