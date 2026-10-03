// Sending a worker home, the same from the 3D office (X at its desk) and the 2D view (🏠 on its card).
import type { DeskDef } from '../../shared/layout';
import type { ClientMsg, WorkerInfo } from '../../shared/protocol';
import { store } from '../state';
import { confirmDialog, sendHomeDialog } from '../ui/prompt';
import { providerLabel } from '../ui/provider';

/** Asks first: what becomes of its worktree, or just whether to stop its session. `desk` is the one it sits at. */
export function sendHome(w: WorkerInfo, desk: DeskDef | undefined, send: (msg: ClientMsg) => void) {
  const where = desk?.label ?? 'the desk';
  const session = w.kind === 'shell' ? 'shared shell' : `${providerLabel(w.provider, store.project)} session`;
  if (w.meeting) {
    // The meeting's worktree is the whole table's: it's tidied away once they've all gone.
    const m = store.meeting.current;
    const on = m?.id === w.meeting && m.status === 'running';
    confirmDialog(`Send ${w.name} home?`, on ? `${w.name} is in the meeting on “${m.title}”, which stops without it.` : `${w.name} leaves the meeting room.`, 'Send home', () => send({ t: 'worker.kill', workerId: w.id }));
    return;
  }
  if (w.worktree) {
    // A worker with its own worktree: choose what becomes of the worktree and its branch.
    sendHomeDialog({
      workerId: w.id,
      name: w.name,
      where,
      worktree: w.worktree,
      repos: w.repos?.length ? [w.worktree.path.split(/[\\/]/).pop() ?? 'its own', ...w.repos.map((r) => r.name)] : undefined,
      ask: () => send({ t: 'worker.worktree', workerId: w.id }),
      onConfirm: (cleanup) => send({ t: 'worker.kill', workerId: w.id, cleanup }),
    });
    return;
  }
  const body = desk?.station
    ? `This stops its ${session} for everyone, and it forgets what it was asked. The next prompt at the ${where} starts a fresh one.`
    : `This stops the ${session} at ${where} for everyone and frees the desk.`;
  confirmDialog(`Send ${w.name} home?`, body, 'Send home', () => send({ t: 'worker.kill', workerId: w.id }));
}
