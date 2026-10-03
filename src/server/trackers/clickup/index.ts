// A ClickUp space as the floor's tracker, read-only: the open tasks of the space picked in ⚙️ Project
// settings, each task's list as a label (so the board's label filter filters by list), and its tags.
// No status, assignee, comment or create writes: those stay drafts for a person to send.
import type { Comment } from '../../../shared/model/change-request.js';
import type { Issue, IssueDetail, IssueReference } from '../../../shared/model/issue.js';
import type { Label } from '../../../shared/model/label.js';
import type { TrackerCapabilities } from '../../../shared/model/tracker.js';
import type { IssueTracker } from '../types.js';
import { ClickUpApi, type ClickUpComment, type ClickUpTask } from './api.js';

export { ClickUpApi, NO_TOKEN, clickUpEnv, type ClickUpSpace } from './api.js';

const LIST_COLOR = '#7b68ee';
/** A label that is a task's ClickUp list, not one of its tags. */
export const LIST_PREFIX = '🗂 ';

const iso = (ms?: string | null) => (ms && /^\d+$/.test(ms) ? new Date(Number(ms)).toISOString() : new Date(0).toISOString());
const closed = (t: ClickUpTask) => t.status?.type === 'closed' || t.status?.type === 'done';

export function taskIssue(t: ClickUpTask): Issue {
  const labels: Label[] = [];
  if (t.list?.name) labels.push({ name: `${LIST_PREFIX}${t.list.name}`, color: LIST_COLOR, description: 'ClickUp list' });
  for (const tag of t.tags ?? []) labels.push({ name: tag.name, color: tag.tag_bg || '#888888' });
  return {
    id: String(t.id),
    ref: t.custom_id || String(t.id),
    title: t.name,
    state: closed(t) ? 'CLOSED' : 'OPEN',
    url: t.url,
    author: t.creator?.username ?? '',
    labels,
    assignees: (t.assignees ?? []).map((a) => a.username ?? '').filter(Boolean),
    createdAt: iso(t.date_created),
    updatedAt: iso(t.date_updated ?? t.date_created),
    body: t.text_content || t.description || '',
    comments: 0,
  };
}

const comment = (c: ClickUpComment): Comment => ({ id: String(c.id), author: c.user?.username ?? '', body: c.comment_text ?? '', createdAt: iso(c.date) });

export class ClickUpTracker implements IssueTracker {
  readonly kind = 'clickup' as const;
  readonly caps: TrackerCapabilities = { comment: false, close: false, assign: false, labels: false };

  constructor(
    readonly space: string,
    private readonly api = new ClickUpApi(),
  ) {}

  async list(): Promise<Issue[]> {
    return (await this.api.openTasks(this.space)).map(taskIssue);
  }

  async detail(id: string): Promise<IssueDetail> {
    const [t, cs] = await Promise.all([this.api.task(id), this.api.comments(id)]);
    return { id: String(t.id), state: closed(t) ? 'CLOSED' : 'OPEN', body: t.text_content || t.description || '', comments: cs.map(comment).reverse(), viewer: '' };
  }

  reference(i: Issue): IssueReference {
    // ClickUp doesn't close a task when a merge request merges: the MR names it with its link instead.
    return { text: `ClickUp task ${i.ref}`, closing: `ClickUp task ${i.ref}: ${i.url}`, url: i.url };
  }
}
