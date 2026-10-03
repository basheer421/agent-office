// Spots change requests that merged between two looks at the list, so the gong rings however they
// merged: from the PR window, by a worker's own CLI, by auto-merge, or on the host itself.
import type { ChangeRequest } from '../../shared/model/change-request.js';

export class MergeWatch {
  /** Open at the last look; unset until the first, so starting the office up rings for nothing. */
  private open?: Set<number>;
  /** Rang for already (merged from the PR window), so the next look doesn't ring them again. */
  private rang = new Set<number>();

  /** The gong rings for `n`: false if it already has. */
  ring(n: number): boolean {
    if (this.rang.has(n)) return false;
    this.rang.add(n);
    return true;
  }

  /** A fresh list from the host: the ones that merged since the last look and haven't rung yet. */
  look(crs: ChangeRequest[]): ChangeRequest[] {
    const open = this.open;
    const merged = open ? crs.filter((p) => p.state === 'merged' && open.has(p.number) && !this.rang.has(p.number)) : [];
    // Once the host says it merged, it never shows as open again to ring twice.
    for (const p of crs) if (p.state === 'merged') this.rang.delete(p.number);
    this.open = new Set(crs.flatMap((p) => (p.state === 'open' || p.state === 'draft' ? [p.number] : [])));
    return merged;
  }
}
