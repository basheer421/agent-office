// The issues workers just took. Assigning one and listing the issues again takes seconds, so each
// is marked `taken` on the board from the moment it's handed over until a list has its assignee.

export class Claims {
  /** By issue number: when the tracker had it assigned (Infinity until it answers). */
  private claimed = new Map<number, { at: number }>();

  /** A worker took issue `n`. Call what it returns once the tracker has answered, with whether it's assigned now. */
  take(n: number): (assigned: boolean, now?: number) => void {
    const claim = { at: Infinity };
    this.claimed.set(n, claim);
    return (assigned, now = Date.now()) => {
      if (assigned) claim.at = now;
      // Unless someone handed it over again meanwhile, and the tracker hasn't answered them yet.
      else if (this.claimed.get(n) === claim) this.claimed.delete(n);
    };
  }

  has(n: number): boolean {
    return this.claimed.has(n);
  }

  /**
   * `items` with the taken ones marked. A list asked for (`asked`) before an issue was assigned doesn't
   * have its assignee yet, so it stays marked over it; one asked for after is believed, and the claim forgotten.
   */
  mark<T extends { number: number; taken?: boolean }>(items: T[], asked = 0): T[] {
    for (const [n, claim] of this.claimed) if (claim.at < asked) this.claimed.delete(n);
    return items.map(({ taken: _taken, ...it }) => (this.claimed.has(it.number) ? { ...it, taken: true } : it) as T);
  }
}
