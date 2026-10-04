import './windows.css';
import './tracker-writes.css';
import { TASK_TITLE_MAX, type Issue, type IssueStatus, type ServerMsg } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { errorBox, spinnerRow } from './pieces';

// ---- Status and new task (ClickUp, P4b) -----------------------------------------------------------
// Writes a person makes from the board: moving an issue to another status, and a new task in the
// floor's default list. The office signs each with their name and tells the floor in a toast.

type Answer<T extends ServerMsg['t']> = (msg: Extract<ServerMsg, { t: T }>) => void;
const statusLists = new Map<string, Answer<'issues.statusList'>>();
const statusSets = new Map<string, Answer<'issues.statusSet'>>();
let created: Answer<'issues.created'> | undefined;

/** Main feeds server messages through here (see routePullMessage), so an open picker or dialog hears back. */
export function routeTrackerWrite(msg: ServerMsg) {
  if (msg.t === 'issues.statusList') statusLists.get(msg.id)?.(msg);
  if (msg.t === 'issues.statusSet') statusSets.get(msg.id)?.(msg);
  if (msg.t === 'issues.created') created?.(msg);
}

/** The issue's status as a button that opens the picker, when the tracker has statuses. */
export function statusButton(it: Issue, net: Net, onSet: (status: string) => void): HTMLElement | null {
  if (!store.tracker.caps.status || it.state !== 'OPEN') return null;
  return h('button.btn.small.status-pill', { type: 'button', title: 'Move it to another status', onclick: () => openStatus(it, net, onSet) }, `🔀 ${it.status ?? 'status'}`);
}

export function openStatus(it: Issue, net: Net, onSet: (status: string) => void) {
  const list = h('div.status-list');
  const result = h('div.gh-merge-result.hidden');
  let busy = false;
  const el = h(
    'div.modal.gh-merge.status-picker',
    { role: 'dialog', 'aria-label': `Status of ${it.ref}` },
    h('header', {}, h('h2', {}, `🔀 Move ${it.ref}`)),
    h('div.body', {}, h('p.gh-merge-title', {}, it.title), list, result),
  );
  const show = (statuses: IssueStatus[]) =>
    list.replaceChildren(
      ...statuses.map((s) =>
        h(
          'button.btn.status-row',
          { type: 'button', class: s.name === it.status ? 'on' : '', disabled: s.name === it.status, onclick: () => pick(s.name) },
          h('span.status-dot', { style: `background:${s.color}` }),
          h('span.grow', {}, s.name),
          s.type === 'closed' || s.type === 'done' ? h('small', {}, s.type) : null,
        ),
      ),
    );
  const pick = (status: string) => {
    if (busy) return;
    busy = true;
    for (const b of list.querySelectorAll('button')) (b as HTMLButtonElement).disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), `Moving it to “${status}”…`);
    net.send({ t: 'issues.setStatus', id: it.id, status });
  };
  statusSets.set(it.id, (msg) => {
    busy = false;
    if (msg.error) {
      result.className = 'gh-merge-result error';
      result.replaceChildren(msg.error);
      for (const b of list.querySelectorAll('button')) (b as HTMLButtonElement).disabled = b.classList.contains('on');
      return;
    }
    modal.close();
    onSet(msg.status ?? '');
  });
  statusLists.set(it.id, (msg) => {
    if (msg.error) list.replaceChildren(errorBox(msg.error, () => (list.replaceChildren(spinnerRow('Loading statuses…')), net.send({ t: 'issues.statuses', id: it.id }))));
    else show(msg.statuses ?? []);
  });
  const modal = openModal(el, {
    onClose: () => {
      statusLists.delete(it.id);
      statusSets.delete(it.id);
    },
  });
  list.append(spinnerRow('Loading statuses…'));
  net.send({ t: 'issues.statuses', id: it.id });
}

/** A new task in the floor's default list (⚙️ Project settings). `onCreated` gets it as saved. */
export function openNewTask(net: Net, onCreated?: (issue: Issue) => void) {
  const title = h('input', { type: 'text', maxlength: TASK_TITLE_MAX, placeholder: 'Title', 'aria-label': 'Title' }) as HTMLInputElement;
  const body = h('textarea', { rows: 6, placeholder: 'Description (optional). ⌘/Ctrl+Enter adds it.', 'aria-label': 'Description' }) as HTMLTextAreaElement;
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const go = h('button.btn.primary', { type: 'button' }, '➕ Add task');
  let busy = false;
  const el = h(
    'div.modal.gh-merge.new-task',
    { role: 'dialog', 'aria-label': 'New task' },
    h('header', {}, h('h2', {}, '➕ New task')),
    h('div.body', {}, h('p.gh-quiet', {}, "Goes in the floor's default list (⚙️ Project settings), signed with your name."), title, body, result),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  const send = () => {
    if (busy) return;
    if (!title.value.trim()) return title.focus();
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), 'Adding it…');
    net.send({ t: 'issues.create', title: title.value.trim(), body: body.value });
  };
  created = (msg) => {
    busy = false;
    go.disabled = false;
    if (msg.error || !msg.issue) {
      result.className = 'gh-merge-result error';
      result.replaceChildren(msg.error ?? 'No task came back');
      return;
    }
    modal.close();
    onCreated?.(msg.issue);
  };
  const modal = openModal(el, { doing: '➕ adding a task', onClose: () => (created = undefined) });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', send);
  title.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), send()));
  body.addEventListener('keydown', (e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), send()));
  setTimeout(() => title.focus(), 30);
}

/** N on the issues board (while it's the window on top and you aren't typing) opens a new task. */
export function newTaskKey(board: HTMLElement, net: Net, onCreated?: (issue: Issue) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyN' || e.metaKey || e.ctrlKey || e.altKey || !store.tracker.caps.create) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const root = document.getElementById('modal-root');
    if (!root || root.lastElementChild !== board.parentElement) return;
    e.preventDefault();
    e.stopPropagation();
    openNewTask(net, onCreated);
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
