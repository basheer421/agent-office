// A card dragged across the change request board: the move on the host, then a fresh look so the
// board shows where it went. Returns an error to show, or undefined.
import type { CrMove } from '../shared/protocol.js';
import type { Boards } from './boards.js';
import type { Actor } from './hosts/index.js';

export async function moveCr(boards: Boards, n: number, move: CrMove, as?: Actor): Promise<string | undefined> {
  const host = boards.host;
  const { crNoun } = host.words;
  try {
    if (move === 'ready' || move === 'draft') {
      if (!host.caps.draft || !host.setDraft) return `This host can't turn a ${crNoun} into a draft or back from here`;
      await host.setDraft(n, move === 'draft', as);
    } else if (move === 'approve') {
      if (!host.caps.reviews || !host.approve) return `This host can't approve a ${crNoun} from here`;
      await host.approve(n, as);
    } else {
      if (!host.reopen) return `This host can't reopen a ${crNoun} from here`;
      await host.reopen(n, as);
    }
  } catch (err) {
    return (err as Error).message;
  }
  // A look already under way was asked before the move, so look again shortly after.
  void boards.refresh().then(() => setTimeout(() => void boards.refresh(), 3000));
  return undefined;
}

/** What the floor is told, after `who`: "marked PR #5 ready for review". */
export function movedWords(move: CrMove, what: string): string {
  return { ready: `marked ${what} ready for review`, draft: `turned ${what} back into a draft`, approve: `👍 approved ${what}`, reopen: `reopened ${what}` }[move];
}
