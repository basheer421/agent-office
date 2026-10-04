// A floor's two boards, the change requests and the issues: the lists as last fetched from its code
// host and tracker, kept fresh, and the changes the office makes to them shown at once (labels just
// set, issues just taken) before the next look confirms them. Reaches the host and tracker only
// through their ports, and keeps the lists in the model's shapes, which is what the wire carries.
import type { ChangeRequest, ChangeRequestDetail, CloseReason, Comment, MergeMethod } from '../shared/model/change-request.js';
import type { Issue, IssueDetail } from '../shared/model/issue.js';
import type { Label } from '../shared/model/label.js';
import type { BoardState, HostView, TrackerView } from '../shared/protocol.js';
import type { Actor, CodeHost } from './hosts/index.js';
import { Claims, type IssueTracker } from './trackers/index.js';

const REFRESH_MS = 90_000;
type Kind = 'issue' | 'cr';
/** How the boards know an item: an issue by its id, a change request by its number. */
const keyOf = (it: Issue | ChangeRequest) => ('id' in it ? it.id : String(it.number));

export class Boards {
  issues: BoardState<Issue> = { items: [], fetchedAt: 0, loading: false };
  pulls: BoardState<ChangeRequest> = { items: [], fetchedAt: 0, loading: false };
  /** The change requests of the last good look, without labels set since (for MergeWatch). */
  changeRequests: ChangeRequest[] = [];
  private timer?: NodeJS.Timeout;
  /** Labels just changed from the office, by "issue:<id>" or "cr:<number>", and when. */
  private relabeled = new Map<string, { labels: Label[]; at: number }>();
  private claims = new Claims();
  /** The look at the issues that's under way, if one is. */
  private listing?: Promise<void>;

  constructor(
    readonly host: CodeHost,
    readonly tracker: IssueTracker,
    private onIssues: (s: BoardState<Issue>) => void,
    private onPulls: (s: BoardState<ChangeRequest>) => void,
  ) {}

  /** What the board UI needs to know about the host: its words, and which buttons to show. */
  hostView(): HostView {
    return { kind: this.host.kind, words: this.host.words, caps: this.host.caps };
  }

  trackerView(): TrackerView {
    return { kind: this.tracker.kind, caps: this.tracker.caps };
  }

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
  async pullDetail(n: number, me?: string): Promise<ChangeRequestDetail> {
    const d = await this.host.detail(n);
    return me ? { ...d, viewer: me } : d;
  }

  pullDiff(n: number): Promise<string> {
    return this.host.diff(n);
  }

  async issueDetail(id: string, me?: string): Promise<IssueDetail> {
    const d = await this.tracker.detail(id);
    return me ? { ...d, viewer: me } : d;
  }

  /** Comments on an issue (by id) or a change request's conversation (by number), as `as` or else the office (signed `by` on ClickUp): the comment as saved, or why it couldn't. */
  async comment(kind: Kind, id: string, body: string, as?: Actor, by?: string): Promise<{ comment?: Comment; error?: string }> {
    let comment: Comment;
    try {
      if (kind === 'cr') comment = await this.host.comment(Number(id), body, as);
      else if (this.tracker.comment) comment = await this.tracker.comment(id, body, as, by);
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
  async close(kind: Kind, id: string, opts: { comment?: string; reason?: CloseReason; deleteBranch?: boolean }, as?: Actor, by?: string): Promise<string | undefined> {
    try {
      if (kind === 'cr') await this.host.close(Number(id), { comment: opts.comment, deleteBranch: opts.deleteBranch }, as);
      else if (this.tracker.close) await this.tracker.close(id, { comment: opts.comment, reason: opts.reason }, as, by);
      else return "This project's issue tracker doesn't let the office close issues";
    } catch (err) {
      return (err as Error).message;
    }
    const refresh = () => (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
    // A refresh already in flight was asked before it closed and can still list it as open, so look again shortly after.
    void refresh().then(() => {
      const still = kind === 'issue' ? this.issues.items.some((i) => i.id === id && i.state === 'OPEN') : this.pulls.items.some((p) => String(p.number) === id && (p.state === 'open' || p.state === 'draft'));
      if (still) setTimeout(() => void refresh(), 3000);
    });
    return undefined;
  }

  /** Something else changed the issues (a status, a new task): look again, twice, since a look under way was asked before it. */
  issuesChanged(): Promise<void> {
    return this.refreshIssues().then(() => this.refreshIssues());
  }

  /** Every label the repository has, for the label picker. */
  repoLabels(): Promise<Label[]> {
    const ops = this.host.labels ?? this.tracker.labels;
    return ops ? ops.list() : Promise.resolve([]);
  }

  /** Puts labels on an issue or PR and takes others off, as `as` or else the office: the labels it has now, or why they didn't change. */
  async setLabels(kind: Kind, id: string, add: string[], remove: string[], as?: Actor): Promise<{ labels?: Label[]; error?: string }> {
    let now: Label[];
    try {
      if (!(kind === 'cr' ? this.host.labels : this.tracker.labels)) return { error: kind === 'cr' ? "This project's code host doesn't take labels from the office" : "This project's issue tracker doesn't take labels from the office" };
      const got = kind === 'cr' ? await this.host.labels!.set(Number(id), add, remove, as) : await this.tracker.labels!.set(id, add, remove, as);
      if (!got) {
        // The host changed them but didn't say what they are now: look again (after the change) and read them off the list.
        await (kind === 'issue' ? this.refreshIssues().then(() => this.refreshIssues()) : this.refreshPulls(true));
        const items: (Issue | ChangeRequest)[] = kind === 'issue' ? this.issues.items : this.pulls.items;
        return { labels: items.find((i) => keyOf(i) === id)?.labels ?? [] };
      }
      now = got;
    } catch (err) {
      // Some may have changed before it failed.
      void (kind === 'issue' ? this.refreshIssues() : this.refreshPulls());
      return { error: (err as Error).message };
    }
    // The board shows them at once, before the next look (see relabel).
    const at = Date.now();
    this.relabeled.set(`${kind}:${id}`, { labels: now, at });
    if (kind === 'issue') {
      this.issues = { ...this.issues, items: this.relabel('issue', this.issues.items, at) };
      this.onIssues(this.issues);
      void this.refreshIssues();
    } else {
      this.pulls = { ...this.pulls, items: this.relabel('cr', this.pulls.items, at) };
      this.onPulls(this.pulls);
      void this.refreshPulls();
    }
    return { labels: now };
  }

  /**
   * A list asked for before a label change made here still has the old labels, so the new ones are
   * kept over it; a list asked for after the change is believed, and the change forgotten.
   */
  private relabel<T extends Issue | ChangeRequest>(kind: Kind, items: T[], asked: number): T[] {
    return items.map((it) => {
      const key = `${kind}:${keyOf(it)}`;
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
  async claim(issue: string, as?: Actor): Promise<string | undefined> {
    if (!this.tracker.assignSelf) return undefined;
    const answered = this.claims.take(issue);
    this.showClaims();
    try {
      await this.tracker.assignSelf(issue, as);
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
      const fetched = await this.tracker.list();
      const items = this.claims.mark(this.relabel('issue', fetched, asked), asked);
      this.issues = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.issues = { ...this.issues, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onIssues(this.issues);
  }

  /** `force` looks again even with a look under way (that one may have been asked before a change). */
  private async refreshPulls(force = false) {
    if (this.pulls.loading && !force) return;
    this.pulls = { ...this.pulls, loading: true };
    this.onPulls(this.pulls);
    const asked = Date.now();
    try {
      const crs = await this.host.list();
      const items = this.relabel('cr', crs, asked);
      this.changeRequests = crs;
      this.pulls = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.pulls = { ...this.pulls, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onPulls(this.pulls);
  }
}
