// A ClickUp space as the floor's tracker: the open tasks of the space picked in ⚙️ Project settings,
// each task's list as a label (so the board's label filter filters by list), and its tags. It writes
// only what a person clicks on the board (a comment, a status, closing, a new task), each signed with
// their name since ClickUp only knows the office's token. Never assigns: a worker taking a task must
// not write to ClickUp by itself, so caps.assign stays false.
import type { Comment } from '../../../shared/model/change-request.js';
import type { Issue, IssueDetail, IssueReference } from '../../../shared/model/issue.js';
import type { Label } from '../../../shared/model/label.js';
import type { IssueStatus, TrackerCapabilities } from '../../../shared/model/tracker.js';
import type { IssueTracker } from '../types.js';
import { HostError } from '../../../shared/model/host.js';
import { ClickUpApi, type ClickUpComment, type ClickUpTask } from './api.js';

export { ClickUpApi, NO_TOKEN, clickUpEnv, type ClickUpList, type ClickUpSpace } from './api.js';

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
    ...(t.status?.status ? { status: t.status.status } : {}),
  };
}

/** What the office adds to a comment or task it writes for someone, since ClickUp sees only its token. */
export const signed = (text: string, by?: string, what = '') => (by ? `${text}\n\n— ${what}${by}, from Agent Office` : text);

const comment = (c: ClickUpComment): Comment => ({ id: String(c.id), author: c.user?.username ?? '', body: c.comment_text ?? '', createdAt: iso(c.date) });

export class ClickUpTracker implements IssueTracker {
  readonly kind = 'clickup' as const;
  readonly caps: TrackerCapabilities = { comment: true, close: true, assign: false, labels: false, status: true, create: true };

  /** `list` is where new tasks go (⚙️ Project settings); none means the space's first list. */
  constructor(
    readonly space: string,
    readonly newTaskList?: string,
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

  async comment(id: string, body: string, _as?: unknown, by?: string): Promise<Comment> {
    const text = signed(body, by);
    const r = await this.api.addComment(id, text);
    return { id: r.id, author: by ?? '', body: text, createdAt: r.date ? iso(String(r.date)) : new Date().toISOString() };
  }

  async statuses(id: string): Promise<IssueStatus[]> {
    const t = await this.api.task(id);
    if (!t.list?.id) throw new HostError('failed', "ClickUp didn't say which list the task is in");
    return (await this.api.listStatuses(t.list.id)).map((s) => ({ name: s.status, color: s.color || '#888888', type: s.type || 'custom' }));
  }

  async setStatus(id: string, status: string): Promise<void> {
    await this.api.setStatus(id, status);
  }

  /** Moves it to its list's closed status (else its last done one), after the comment if there is one. */
  async close(id: string, o: { comment?: string; reason?: string }, _as?: unknown, by?: string): Promise<void> {
    const all = await this.statuses(id);
    const to = all.find((s) => s.type === 'closed') ?? all.filter((s) => s.type === 'done').at(-1);
    if (!to) throw new HostError('failed', "The task's list has no closed or done status to move it to");
    const why = o.reason === 'not planned' ? 'Closed as not planned.' : '';
    const text = [why, o.comment ?? ''].filter(Boolean).join('\n\n');
    if (text) await this.comment(id, text, undefined, by);
    await this.api.setStatus(id, to.name);
  }

  async create(o: { title: string; body: string }, by?: string): Promise<Issue> {
    const list = this.newTaskList ?? (await this.api.lists(this.space))[0]?.id;
    if (!list) throw new HostError('not-found', 'The ClickUp space has no list to put a new task in');
    return taskIssue(await this.api.createTask(list, o.title, signed(o.body, by, 'Created by ')));
  }
}
