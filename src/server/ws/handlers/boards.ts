// The floor's boards: refreshing them, and merging, commenting on, closing and labeling change
// requests and issues, as whoever asks (see withGitHub). The host's own words ("PR"/"MR") go in the toasts.
import type { BoardsClientMsg } from '../../../shared/protocol.js';
import { COMMENT_MAX, LABEL_MAX } from '../../../shared/protocol.js';
import { NO_TRACKER_CAPS } from '../../../shared/model/tracker.js';
import { issueId, num, str } from '../../office/input.js';
import { here } from './common.js';
import type { GhAs } from '../../signins.js';
import type { Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const issuesView: ViewPieces['issues'] = (_ctx, floor) => floor?.boards.issues ?? { items: [], fetchedAt: 0, loading: false };
export const pullsView: ViewPieces['pulls'] = (_ctx, floor) => floor?.boards.pulls ?? { items: [], fetchedAt: 0, loading: false };
export const hostView: ViewPieces['host'] = (_ctx, floor) =>
  floor?.boards.hostView() ?? { kind: 'none', words: { crNoun: 'pull request', crShort: 'PR', refPrefix: '#', cli: 'gh' }, caps: { labels: false, reviews: false, autoMerge: false, draft: false, lineComments: false, mergeMethods: [] } };
export const trackerView: ViewPieces['tracker'] = (_ctx, floor) => floor?.boards.trackerView() ?? { kind: 'none', caps: NO_TRACKER_CAPS };

/** A change request's number from a message: a positive integer, or undefined. */
const crNumber = (v: unknown) => {
  const n = num(v);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/** Refused rather than cut short: a comment that silently lost its end would read as finished. */
const commentProblem = (body: string) => (!body.trim() ? 'The comment is empty' : body.length > COMMENT_MAX ? `Comments can be up to ${COMMENT_MAX} characters` : '');

export const boardsHandlers = {
  'boards.refresh'(ctx, c) {
    void ctx.floorOf(c)?.boards.refresh();
  },
  'cr.merge'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = crNumber(msg.number);
    const method = (['squash', 'merge', 'rebase'] as const).find((m) => m === msg.method);
    if (!floor || !n || !method) return;
    const { crShort, refPrefix } = floor.boards.host.words;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.boards.merge(n, method, msg.deleteBranch === true, msg.auto === true, as).then((error) => {
          ctx.sendTo(c, { t: 'cr.merged', number: n, error });
          if (error) return;
          ctx.toastFloor(floor, msg.auto ? `${who} set ${crShort} ${refPrefix}${n} to merge once its checks pass` : `🎉 ${who} merged ${crShort} ${refPrefix}${n}`);
          // An auto-merge rings once the host gets round to it and the boards see it merged.
          if (!msg.auto) floor.merged(n, who);
        }),
      (error) => ctx.sendTo(c, { t: 'cr.merged', number: n, error }),
    );
  },
  'cr.comment'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = crNumber(msg.number);
    if (!floor || !n) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    const invalid = commentProblem(body);
    if (invalid) return ctx.sendTo(c, { t: 'cr.commented', number: n, error: invalid });
    const { crShort, refPrefix } = floor.boards.host.words;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.boards.comment('cr', String(n), body, as).then((r) => {
          ctx.sendTo(c, { t: 'cr.commented', number: n, ...r });
          if (r.comment) ctx.toastFloor(floor, `💬 ${who} commented on ${crShort} ${refPrefix}${n}`);
        }),
      (error) => ctx.sendTo(c, { t: 'cr.commented', number: n, error }),
    );
  },
  'issues.comment'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const id = issueId(msg.id);
    if (!floor || !id) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    const invalid = commentProblem(body);
    if (invalid) return ctx.sendTo(c, { t: 'issues.commented', id, error: invalid });
    asTracker(
      ctx,
      c,
      (as) =>
        void floor.boards.comment('issue', id, body, as, who).then((r) => {
          ctx.sendTo(c, { t: 'issues.commented', id, ...r });
          if (r.comment) ctx.toastFloor(floor, `💬 ${who} commented on issue ${issueRef(floor, id)}`);
        }),
      (error) => ctx.sendTo(c, { t: 'issues.commented', id, error }),
    );
  },
  'cr.close'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = crNumber(msg.number);
    if (!floor || !n) return;
    const { crShort, refPrefix } = floor.boards.host.words;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.boards.close('cr', String(n), { comment: str(msg.comment, 20000).trim() || undefined, deleteBranch: msg.deleteBranch === true }, as).then((error) => {
          ctx.sendTo(c, { t: 'cr.closed', number: n, error });
          if (!error) ctx.toastFloor(floor, `${who} closed ${crShort} ${refPrefix}${n} without merging`);
        }),
      (error) => ctx.sendTo(c, { t: 'cr.closed', number: n, error }),
    );
  },
  'issues.close'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const id = issueId(msg.id);
    if (!floor || !id) return;
    const reason = msg.reason === 'not planned' ? 'not planned' : 'completed';
    asTracker(
      ctx,
      c,
      (as) =>
        void floor.boards.close('issue', id, { comment: str(msg.comment, 20000).trim() || undefined, reason }, as, who).then((error) => {
          ctx.sendTo(c, { t: 'issues.closed', id, error });
          if (error) return;
          // Nobody should be seated for an issue that's closed.
          const dropped = floor.queue.dropIssue(id);
          ctx.toastFloor(floor, `${who} closed issue ${issueRef(floor, id)}${reason === 'not planned' ? ' as not planned' : ''}${dropped ? ' and took it off the queue' : ''}`);
        }),
      (error) => ctx.sendTo(c, { t: 'issues.closed', id, error }),
    );
  },
  'labels.set'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const target = msg.target === 'cr' || msg.target === 'issue' ? msg.target : undefined;
    const id = target === 'cr' ? crNumber(Number(msg.id))?.toString() : issueId(msg.id);
    if (!floor || !target || !id) return;
    const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((l) => str(l, LABEL_MAX + 1)).filter((l) => l && l.length <= LABEL_MAX))].slice(0, 100);
    const add = names(msg.add);
    const remove = names(msg.remove).filter((l) => !add.includes(l));
    if (!add.length && !remove.length) return ctx.sendTo(c, { t: 'labels.changed', target, id, error: 'No labels to change' });
    const { crShort, refPrefix } = floor.boards.host.words;
    const what = target === 'cr' ? `${crShort} ${refPrefix}${id}` : `issue ${issueRef(floor, id)}`;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.boards.setLabels(target, id, add, remove, as).then((r) => {
          ctx.sendTo(c, { t: 'labels.changed', target, id, ...r });
          if (r.labels) ctx.toastFloor(floor, `🏷️ ${who} labeled ${what}: ${[...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join(' ')}`);
        }),
      (error) => ctx.sendTo(c, { t: 'labels.changed', target, id, error }),
    );
  },
} satisfies HandlerMap<BoardsClientMsg>;

/**
 * Acts on the floor's issues as whoever asked: GitHub issues need their own sign-in (withGitHub);
 * ClickUp only takes the office's token, so it goes ahead and the write is signed with their name.
 */
export function asTracker(ctx: Ctx, c: Client, go: (as: GhAs | undefined) => void, refused: (why: string) => void) {
  if (ctx.floorOf(c)?.boards.tracker.kind === 'clickup') return go(undefined);
  ctx.withGitHub(c, go, refused);
}

/** How people write an issue: its ref on the board ("#12"), else its id. */
export function issueRef(floor: { boards: { issues: { items: { id: string; ref: string }[] } } }, id: string): string {
  return floor.boards.issues.items.find((i) => i.id === id)?.ref ?? (/^\d+$/.test(id) ? `#${id}` : id);
}
