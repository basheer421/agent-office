import type { CloseReason, Issue, ChangeRequest } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store, workerForPull } from '../../state';
import { h, openModal } from '../dom';
import { closeWaiters, crNoun, crShort, idOf, refOf } from './api';

// ---- Close dialog -------------------------------------------------------------------------------

const REASON_LABEL: Record<CloseReason, string> = { completed: '✅ Completed', 'not planned': '🚫 Not planned' };

/** Closes an issue (as completed or not planned) or a PR without merging, with an optional comment. */
export function openClose(kind: 'issue' | 'pull', it: Issue | ChangeRequest, net: Net, onClosed: () => void) {
  const key = `${kind}:${idOf(it)}`;
  const pull = kind === 'pull' ? (it as ChangeRequest) : null;
  let reason: CloseReason = 'completed';
  let busy = false;

  const go = h('button.btn.danger', { type: 'button' });
  const reasons = h('div.seg');
  const renderReasons = () => {
    reasons.replaceChildren(...(Object.keys(REASON_LABEL) as CloseReason[]).map((r) => h('button.btn', { type: 'button', class: r === reason ? 'on' : '', onclick: () => ((reason = r), renderReasons()) }, REASON_LABEL[r])));
    go.textContent = pull ? `🚫 Close ${crNoun()}` : `${reason === 'completed' ? '✔️' : '🚫'} Close as ${reason}`;
  };
  const comment = h('textarea', { rows: 4, placeholder: 'Leave a comment (optional)', 'aria-label': 'Closing comment' }) as HTMLTextAreaElement;
  const del = h('input', { type: 'checkbox', id: 'close-del' }) as HTMLInputElement;
  const w = pull && workerForPull(store.workers.values(), pull);
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const noun = pull ? crNoun() : 'issue';

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': `Close ${noun} ${refOf(it)}` },
    h('header', {}, h('h2', {}, `${pull ? '🚫' : '✔️'} Close ${pull ? crShort() : 'issue'} ${refOf(it)}`)),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, pull ? h('small', {}, `${pull.sourceBranch} → ${pull.targetBranch}`) : null),
      pull
        ? h('div.gh-status.muted', {}, h('span', {}, 'ℹ️'), `It won't be merged, and can be reopened later.${w ? ` ${w.name} is still at a desk working on its branch.` : ''}`)
        : h('label', {}, 'Why'),
      pull ? h('label.gh-check', { for: 'close-del' }, del, `Delete ${pull.sourceBranch} too`) : reasons,
      comment,
      result,
    ),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  renderReasons();

  const modal = openModal(el, { onClose: () => closeWaiters.delete(key) });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), `Closing the ${noun}…`);
    closeWaiters.set(key, (msg) => {
      closeWaiters.delete(key);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(msg.error);
        return;
      }
      modal.close();
      onClosed();
    });
    const text = comment.value.trim() || undefined;
    if (pull) net.send({ t: 'cr.close', number: pull.number, comment: text, deleteBranch: del.checked });
    else net.send({ t: 'issues.close', id: idOf(it), comment: text, reason });
  });
  setTimeout(() => comment.focus(), 30);
}
