// What the profiler (index.ts) adds up: a window of about a second, then the averages.

export interface ProfileStats {
  /** Frames actually run in the window, per second. */
  fps: number;
  /** Mean ms per run frame in each phase. */
  phases: Record<string, number>;
  /** Mean ms per run frame across every phase. */
  ticksMs: number;
  /** Texture uploads (texImage/texSubImage calls) in the window, per second. */
  uploads: number;
}

export class ProfileWindow {
  private sums = new Map<string, number>();
  private frames = 0;
  private uploads = 0;
  private start = -1;
  last: ProfileStats | null = null;

  constructor(
    private readonly phases: string[],
    private readonly span = 1000,
  ) {}

  phase(name: string, ms: number) {
    this.sums.set(name, (this.sums.get(name) ?? 0) + ms);
  }

  upload() {
    this.uploads++;
  }

  /** A frame begins at `now`: true when a window just closed and `last` has new numbers. */
  frame(now: number): boolean {
    if (this.start < 0) this.start = now;
    const took = now - this.start;
    if (took >= this.span && this.frames > 0) {
      const phases: Record<string, number> = {};
      let total = 0;
      for (const p of this.phases) {
        const ms = (this.sums.get(p) ?? 0) / this.frames;
        phases[p] = ms;
        total += ms;
      }
      const per = 1000 / took;
      this.last = { fps: this.frames * per, phases, ticksMs: total, uploads: Math.round(this.uploads * per) };
      this.sums.clear();
      this.frames = this.uploads = 0;
      this.start = now;
      this.frames++;
      return true;
    }
    this.frames++;
    return false;
  }

  reset() {
    this.sums.clear();
    this.frames = this.uploads = 0;
    this.start = -1;
    this.last = null;
  }
}
