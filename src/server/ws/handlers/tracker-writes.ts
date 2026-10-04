// Moving a floor's issue to another status and making a new one (ClickUp, P4b): only from a person's
// click, signed with their name (ClickUp knows only the office's token), and told to the floor in a toast.
import type { TrackerWritesClientMsg } from '../../../shared/protocol.js';
import { COMMENT_MAX, TASK_TITLE_MAX } from '../../../shared/protocol.js';
import { issueId, str } from '../../office/input.js';
import { asTracker, issueRef } from './boards.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';

const NO_STATUS = "This project's issue tracker doesn't let the office change statuses";

export const trackerWritesHandlers = {
  'issues.statuses'(ctx, c, msg) {
    const floor = here(ctx, c);
    const id = issueId(msg.id);
    if (!floor || !id) return;
    const { tracker } = floor.boards;
    if (!tracker.statuses) return ctx.sendTo(c, { t: 'issues.statusList', id, error: NO_STATUS });
    tracker.statuses(id).then(
      (statuses) => ctx.sendTo(c, { t: 'issues.statusList', id, statuses }),
      (err: Error) => ctx.sendTo(c, { t: 'issues.statusList', id, error: err.message }),
    );
  },
  'issues.setStatus'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const id = issueId(msg.id);
    const status = str(msg.status, 101).trim();
    if (!floor || !id) return;
    if (!status || status.length > 100) return ctx.sendTo(c, { t: 'issues.statusSet', id, error: 'No such status' });
    const { boards } = floor;
    asTracker(
      ctx,
      c,
      () => {
        const { tracker } = boards;
        if (!tracker.setStatus || !tracker.statuses) return ctx.sendTo(c, { t: 'issues.statusSet', id, error: NO_STATUS });
        const statuses = tracker.statuses.bind(tracker);
        tracker.setStatus(id, status, who).then(
          async () => {
            ctx.sendTo(c, { t: 'issues.statusSet', id, status });
            // Done or closed: nobody should be seated for it any more.
            const kind = (await statuses(id).catch(() => [])).find((s) => s.name === status)?.type;
            const dropped = kind === 'closed' || kind === 'done' ? floor.queue.dropIssue(id) : false;
            ctx.toastFloor(floor, `🔀 ${who} moved ${issueRef(floor, id)} to “${status}”${dropped ? ' and took it off the queue' : ''}`);
            void boards.issuesChanged();
          },
          (err: Error) => ctx.sendTo(c, { t: 'issues.statusSet', id, error: err.message }),
        );
      },
      (error) => ctx.sendTo(c, { t: 'issues.statusSet', id, error }),
    );
  },
  'issues.create'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const title = str(msg.title, TASK_TITLE_MAX + 1).trim();
    const body = typeof msg.body === 'string' ? msg.body : '';
    const invalid = !title ? 'A new task needs a title' : title.length > TASK_TITLE_MAX ? `Titles can be up to ${TASK_TITLE_MAX} characters` : body.length > COMMENT_MAX ? `Descriptions can be up to ${COMMENT_MAX} characters` : '';
    if (invalid) return ctx.sendTo(c, { t: 'issues.created', error: invalid });
    const { boards } = floor;
    asTracker(
      ctx,
      c,
      () => {
        const { tracker } = boards;
        if (!tracker.create) return ctx.sendTo(c, { t: 'issues.created', error: "This project's issue tracker doesn't take new issues from the office" });
        tracker.create({ title, body }, who).then(
          (issue) => {
            ctx.sendTo(c, { t: 'issues.created', issue });
            ctx.toastFloor(floor, `🆕 ${who} added ${issue.ref}: ${issue.title}`);
            void boards.issuesChanged();
          },
          (err: Error) => ctx.sendTo(c, { t: 'issues.created', error: err.message }),
        );
      },
      (error) => ctx.sendTo(c, { t: 'issues.created', error }),
    );
  },
} satisfies HandlerMap<TrackerWritesClientMsg>;
