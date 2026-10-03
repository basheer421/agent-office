// A floor's two boards, the change requests and the issues: the lists as last fetched from its code
// host and tracker, kept fresh, and the changes the office makes to them shown at once (labels just
// set, issues just taken) before the next look confirms them. Reaches the host and tracker only
// through their ports; the lists are kept in the wire's Gh* shapes until P1c (see ws/legacy-gh.ts).
import type { ChangeRequest, CloseReason, MergeMethod } from '../shared/model/change-request.js';
import type { Label } from '../shared/model/label.js';
import type { GhComment, GhIssue, GhIssueDetail, GhLabel, GhPull, GhPullDetail, GhState } from '../shared/protocol.js';
import type { Actor, CodeHost } from './hosts/index.js';
import { Claims, type IssueTracker } from './trackers/index.js';
import { ghIssue, ghIssueDetail, ghPull, ghPullDetail } from './ws/legacy-gh.js';

const REFRESH_MS = 90_000;
type Kind = 'issue' | 'pull';

export class Boards {
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: false };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: false };
  /** The change requests of the last good look, in the model's shape (for MergeWatch). */
  changeRequests: ChangeRequest[] = [];
  private timer?: NodeJS.Timeout;
  /** Labels just changed from the office, by "issue:N" or "pull:N", and when. */
  private relabeled = new Map<string, { labels: GhLabel[]; at: number }>();
  private claims = new Claims();
  /** The look at the issues that's under way, if one is. */
  private listing?: Promise<void>;

  constructor(
    readonly host: CodeHost,
    readonly tracker: IssueTracker,
    private onIssues: (s: GhState<GhIssue>) => void,
    private onPulls: (s: GhState<GhPull>) => void,
  ) {}

  start() {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async refresh() {
    await Promise.all([this.refreshIssues(), this.refreshPulls()]);
  }

  /**
   * A PR's description, conversation, line comments, checks and whether it can merge. `me` is the
   * login of whoever asked, when they're signed in to their own; else it's the office's.
   */
  async pullDetail(n: number, me?: string): Promise<GhPullDetail> {
    const d = await this.host.detail(n);
    return ghPullDetail(me ? { ...d, viewer: me } : d);
  }

  pullDiff(n: number): Promise<string> {
    return this.host.diff(n);
  }

  async issueDetail(n: number, me?: string): Promise<GhIssueDetail> {
    const d = await this.tracker.detail(String(n));
    return ghIssueDetail(me ? { ...d, viewer: me } : d);
  }

  /** Comments on an issue or a PR's conversation, as `as` or else the office: the comment as saved, or why it couldn't. */
  async comment(kind: Kind, n: number, body: string, as?: Actor): Promise<{ comment?: GhComment; error?: string }> {
    let comment: GhComment;
    try {
      if (kind === 'pull') comment = await this.host.comment(n, body, as);
      else if (this.tracker.comment) comment = await this.tracker.comment(String(n), body, as);
      else return { error: "This project's issue tracker doesn't take comments from the office" };
    } catch (err) {
      return { error: (err as Error).message };
    }
    // The issue board counts comments; a PR's card shows when it was last updated.
    void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    return { comment };
  }

  /** A review that only comments (the meeting room's review panel): its URL. */
  async review(n: number, body: string, as?: Actor): Promise<string> {
    const url = await this.host.review(n, body, as);
    void this.refreshPulls();
    return url;
  }

  /** Merges a PR, or with `auto` has the host merge it once its requirements pass. Returns an error. */
  async merge(n: number, method: MergeMethod, deleteBranch: boolean, auto: boolean, as?: Actor): Promise<string | undefined> {
    try {
      await this.host.merge(n, { method, deleteBranch, auto }, as);
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshPulls();
    return undefined;
  }

  /** Closes an issue, or a pull request without merging it, optionally saying why. Returns an error. */
  async close(kind: Kind, n: number, opts: { comment?: string; reason?: CloseReason; deleteBranch?: boolean }, as?: Actor): Promise<string | undefined> {
    try {
      if (kind === 'pull') await this.host.close(n, { comment: opts.comment, deleteBranch: opts.deleteBranch }, as);
      else if (this.tracker.close) await this.tracker.close(String(n), { comment: opts.comment, reason: opts.reason }, as);
      else return "This project's issue tracker doesn't let the office close issues";
    } catch (err) {
      return (err as Error).message;
    }
    const refresh = () => (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    // A refresh already in flight was asked before it closed and can still list it as open, so look again shortly after.
    void refresh().then(() => {
      if ((kind === 'issue' ? this.issues : this.pulls).items.some((i) => i.number === n && i.state === 'OPEN')) setTimeout(() => void refresh(), 3000);
    });
    return undefined;
  }

  /** Every label the repository has, for the label picker. */
  repoLabels(): Promise<Label[]> {
    const ops = this.host.labels ?? this.tracker.labels;
    return ops ? ops.list() : Promise.resolve([]);
  }

  /** Puts labels on an issue or PR and takes others off, as `as` or else the office: the labels it has now, or why they didn't change. */
  async setLabels(kind: Kind, n: number, add: string[], remove: string[], as?: Actor): Promise<{ labels?: GhLabel[]; error?: string }> {
    let now: GhLabel[];
    try {
      const got = kind === 'pull' ? await this.host.labels?.set(n, add, remove, as) : await this.tracker.labels?.set(String(n), add, remove, as);
      if (!got) return { error: kind === 'pull' ? "This project's code host doesn't take labels from the office" : "This project's issue tracker doesn't take labels from the office" };
      now = got;
    } catch (err) {
      // Some may have changed before it failed.
      void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look (see relabel).
    const at = Date.now();
    this.relabeled.set(`${kind}:${n}`, { labels: now, at });
    if (kind === 'issue') {
      this.issues = { ...this.issues, items: this.relabel('issue', this.issues.items, at) };
      this.onIssues(this.issues);
      void this.refreshIssues();
    } else {
      this.pulls = { ...this.pulls, items: this.relabel('pull', this.pulls.items, at) };
      this.onPulls(this.pulls);
      void this.refreshPulls();
    }
    return { labels: now };
  }

  /**
   * A list asked for before a label change made here still has the old labels, so the new ones are
   * kept over it; a list asked for after the change is believed, and the change forgotten.
   */
  private relabel<T extends GhIssue | GhPull>(kind: Kind, items: T[], asked: number): T[] {
    return items.map((it) => {
      const key = `${kind}:${it.number}`;
      const r = this.relabeled.get(key);
      if (!r) return it;
      if (r.at < asked) {
        this.relabeled.delete(key);
        return it;
      }
      return { ...it, labels: r.labels };
    });
  }

  /**
   * A worker took the issue: it moves to In progress on the board at once, and is assigned on the
   * tracker to `as` (else the office), which is what keeps it there. Returns an error when the tracker
   * wouldn't assign it, and the card goes back to where it was.
   */
  async claim(issue: number, as?: Actor): Promise<string | undefined> {
    if (!this.tracker.assignSelf) return undefined;
    const answered = this.claims.take(issue);
    this.showClaims();
    try {
      await this.tracker.assignSelf(String(issue), as);
    } catch (err) {
      answered(false);
      this.showClaims();
      return (err as Error).message;
    }
    answered(true);
    // For its assignee's name. A look already under way was asked before it was assigned, so look again after it.
    void this.refreshIssues().then(() => (this.claims.has(issue) ? this.refreshIssues() : undefined));
    return undefined;
  }

  /** Puts the issues workers have taken (or no longer have) on the board, ahead of the next look. */
  private showClaims() {
    this.issues = { ...this.issues, items: this.claims.mark(this.issues.items) };
    this.onIssues(this.issues);
  }

  /** Asks the tracker for the issues. With a look already under way it's that one, which may have been asked before whatever just changed. */
  private refreshIssues(): Promise<void> {
    this.listing ??= this.listIssues().finally(() => (this.listing = undefined));
    return this.listing;
  }

  private async listIssues() {
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    const asked = Date.now();
    try {
      const fetched = (await this.tracker.list()).map(ghIssue);
      const items = this.claims.mark(this.relabel('issue', fetched, asked), asked);
      this.issues = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.issues = { ...this.issues, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onIssues(this.issues);
  }

  private async refreshPulls() {
    if (this.pulls.loading) return;
    this.pulls = { ...this.pulls, loading: true };
    this.onPulls(this.pulls);
    const asked = Date.now();
    try {
      const crs = await this.host.list();
      const items = this.relabel('pull', crs.map(ghPull), asked);
      this.changeRequests = crs;
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
