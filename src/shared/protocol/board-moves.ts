// Dragging a card across the change request board: each drop is one of these moves on the host.
// Merging and closing aren't here: a drop into Merged opens the merge dialog (cr.merge), and one
// into Closed sends cr.close, as the PR window does.

/** Mark ready for review, convert back to draft, approve, or reopen a closed one. */
export type CrMove = 'ready' | 'draft' | 'approve' | 'reopen';

export const CR_MOVES: readonly CrMove[] = ['ready', 'draft', 'approve', 'reopen'];

export type BoardMovesClientMsg =
  /** Answered with cr.moved. */
  { t: 'cr.move'; number: number; move: CrMove };

export type BoardMovesServerMsg =
  /** Sent to whoever moved it: done, or why not. */
  { t: 'cr.moved'; number: number; move: CrMove; error?: string };
