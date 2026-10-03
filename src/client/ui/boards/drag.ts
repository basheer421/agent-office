import './drag.css';
import type { ChangeRequest, ChangeRequestDetail, CrMove } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { toast } from '../dom';
import { closeWaiters, crShort, getJson, moveWaiters, refOf } from './api';
import { openMerge } from './merge';

// Dragging a card between the PR board's columns does what the column means on the host. Pointer
// events, not HTML5 drag and drop, so a trackpad and a mouse both work. A card that can't go
// where it was dropped, or whose move the host turns down, stays where it was with a toast saying why.

/** A PR board column, by the key the board gives it. */
type Col = 'draft' | 'review' | 'approved' | 'merged' | 'closed';

/** Where a card is now. */
export function columnOf(p: ChangeRequest): Col {
  if (p.state === 'draft') return 'draft';
  if (p.state === 'merged') return 'merged';
  if (p.state === 'closed') return 'closed';
  return p.reviewDecision === 'APPROVED' ? 'approved' : 'review';
}

type Plan = { moves: CrMove[] } | { merge: true } | { close: true } | { no: string };

/** What dropping a card from `from` into `to` takes, in order, or why it can't go there. */
export function planMove(from: Col, to: Col): Plan {
  const cr = crShort();
  if (from === 'merged') return { no: `A merged ${cr} stays merged` };
  if (to === 'merged') return from === 'review' || from === 'approved' ? { merge: true } : from === 'draft' ? { no: `Mark it ready for review before merging` } : { no: `Reopen it before merging` };
  if (to === 'closed') return { close: true };
  const reopen: CrMove[] = from === 'closed' ? ['reopen'] : [];
  // A reopened PR comes back as it was closed: a draft or not, so say which it should be.
  if (to === 'draft') return { moves: from === 'draft' ? [] : [...reopen, 'draft'] };
  if (to === 'review') {
    if (from === 'approved') return { no: `An approval can't be taken back from here` };
    return { moves: from === 'draft' ? ['ready'] : [...reopen, 'ready'] };
  }
  // to === 'approved'
  return { moves: from === 'draft' ? ['ready', 'approve'] : from === 'closed' ? ['reopen', 'ready', 'approve'] : ['approve'] };
}

/** PRs with a drop still in flight, by number: their cards stay greyed out across re-renders. */
const pending = new Set<number>();

/** Sends one move and waits for the answer: undefined, or the error. */
function sendMove(net: Net, n: number, move: CrMove): Promise<string | undefined> {
  return new Promise((resolve) => {
    moveWaiters.set(n, (msg) => {
      moveWaiters.delete(n);
      resolve(msg.error);
    });
    net.send({ t: 'cr.move', number: n, move });
  });
}

async function perform(p: ChangeRequest, to: Col, net: Net, repaint: () => void) {
  const plan = planMove(columnOf(p), to);
  if ('no' in plan) return void toast(`${refOf(p)}: ${plan.no}`, 'warn');
  if ('merge' in plan) {
    // Merging can't be undone, so it always goes through the merge dialog.
    try {
      const d = await getJson<ChangeRequestDetail>(`/api/boards/cr?number=${p.number}`);
      openMerge(p, d, net, () => toast(`Open ${refOf(p)} to hand it to a worker`, 'info'), () => net.send({ t: 'boards.refresh' }));
    } catch (err) {
      toast(`Couldn't load ${refOf(p)}: ${(err as Error).message}`, 'error');
    }
    return;
  }
  const busy = (on: boolean) => {
    if (on) pending.add(p.number);
    else pending.delete(p.number);
    repaint();
  };
  if ('close' in plan) {
    busy(true);
    const key = `pull:${p.number}`;
    const error = await new Promise<string | undefined>((resolve) => {
      closeWaiters.set(key, (msg) => {
        closeWaiters.delete(key);
        resolve(msg.error);
      });
      net.send({ t: 'cr.close', number: p.number });
    });
    busy(false);
    if (error) toast(`Couldn't close ${refOf(p)}: ${error}`, 'error');
    return;
  }
  if (!plan.moves.length) return;
  busy(true);
  for (const move of plan.moves) {
    const error = await sendMove(net, p.number, move);
    if (error) {
      busy(false);
      net.send({ t: 'boards.refresh' });
      return void toast(`Couldn't move ${refOf(p)}: ${error}`, 'error');
    }
  }
  busy(false);
}

/** Greys out the cards of PRs with a drop in flight; the board calls it after every render. */
export function markPending(body: HTMLElement) {
  body.querySelectorAll<HTMLElement>('.card[data-number]').forEach((c) => c.classList.toggle('moving', pending.has(Number(c.dataset.number))));
}

/** How far the pointer goes before a press on a card becomes a drag rather than a click. */
const SLOP = 6;

/**
 * Lets the cards in `body` (the PR board) be dragged between its columns. Cards carry
 * `data-number`, columns `data-col`. Returns a function that stops it.
 */
export function enableCardDrag(body: HTMLElement, net: Net, repaint: () => void): () => void {
  let press: { card: HTMLElement; id: number; x: number; y: number; dx: number; dy: number } | null = null;
  let ghost: HTMLElement | null = null;
  let over: HTMLElement | null = null;
  /** When the last drag ended: the click that follows a drop isn't a click on the card. */
  let dropped = -Infinity;
  const swallow = (e: MouseEvent) => {
    if (performance.now() - dropped < 100) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const columnAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('.column[data-col]') ?? null;
  const setOver = (col: HTMLElement | null) => {
    if (col === over) return;
    over?.classList.remove('drop-over');
    over = col;
    over?.classList.add('drop-over');
  };
  const end = () => {
    ghost?.remove();
    ghost = null;
    setOver(null);
    press?.card.classList.remove('drag-source');
    body.classList.remove('dragging');
    press = null;
  };

  const down = (e: PointerEvent) => {
    // Mouse and trackpad (and pens); a finger on a touch screen scrolls the columns instead.
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const card = (e.target as Element).closest<HTMLElement>('.card[data-number]');
    if (!card || (e.target as Element).closest('button, a, input') || card.classList.contains('moving')) return;
    const r = card.getBoundingClientRect();
    press = { card, id: e.pointerId, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top };
  };
  const move = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    if (!ghost) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < SLOP) return;
      const r = press.card.getBoundingClientRect();
      ghost = press.card.cloneNode(true) as HTMLElement;
      ghost.classList.add('drag-ghost');
      ghost.style.width = `${r.width}px`;
      document.body.append(ghost);
      press.card.classList.add('drag-source');
      body.classList.add('dragging');
      body.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    ghost.style.left = `${e.clientX - press.dx}px`;
    ghost.style.top = `${e.clientY - press.dy}px`;
    setOver(columnAt(e.clientX, e.clientY));
  };
  const up = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const dragged = ghost !== null;
    const n = Number(press.card.dataset.number);
    const from = press.card.closest<HTMLElement>('.column[data-col]')?.dataset.col;
    const to = dragged ? columnAt(e.clientX, e.clientY)?.dataset.col : undefined;
    end();
    if (!dragged) return;
    // The click that follows the drop isn't a click on the card.
    dropped = performance.now();
    const p = store.pulls.items.find((x) => x.number === n);
    if (!p || !to || to === from) return;
    void perform(p, to as Col, net, repaint);
  };
  const cancel = (e: PointerEvent) => {
    if (press && e.pointerId === press.id) end();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && ghost) {
      e.stopPropagation();
      end();
    }
  };

  body.addEventListener('click', swallow, true);
  body.addEventListener('pointerdown', down);
  body.addEventListener('pointermove', move);
  body.addEventListener('pointerup', up);
  body.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
  return () => {
    end();
    body.removeEventListener('click', swallow, true);
    body.removeEventListener('pointerdown', down);
    body.removeEventListener('pointermove', move);
    body.removeEventListener('pointerup', up);
    body.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
  };
}
