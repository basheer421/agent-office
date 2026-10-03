// How often the office draws a frame. A browser runs requestAnimationFrame at the display's rate
// (60, 120 on a ProMotion screen) for as long as the tab is showing, even behind another window with
// nothing moving, so the office skips frames itself: fewer while nobody's touching it, a few while
// another window has the focus, and as many as the ⚙️ Settings cap says otherwise.

import type { FpsCap } from '../../state/persist';

/** No input for this long (ms), and you're not moving: the office drops to IDLE_FPS. */
export const IDLE_AFTER_MS = 20_000;
export const IDLE_FPS = 10;
/** Another window has the focus. */
export const BLUR_FPS = 4;
export const BATTERY_FPS = 30;

export interface PaceState {
  hidden: boolean;
  focused: boolean;
  /** Since the last key, click, mouse move or touch (ms). */
  idleMs: number;
  /** Moving, falling or anything else that has to look smooth right now. */
  busy: boolean;
  onBattery: boolean;
  cap: FpsCap;
}

/** Frames a second to draw at: 0 is none, null every frame the browser offers. */
export function targetFps(s: PaceState): number | null {
  if (s.hidden) return 0;
  if (!s.focused) return BLUR_FPS;
  if (!s.busy && s.idleMs >= IDLE_AFTER_MS) return IDLE_FPS;
  if (s.cap === '30') return 30;
  if (s.cap === '60') return 60;
  if (s.cap === 'auto' && s.onBattery) return BATTERY_FPS;
  return null;
}

/** Slack (ms) so a 60 Hz display still draws every other frame at 30 fps, not every third. */
const SLACK_MS = 2;

/** Says, for each frame the browser offers, whether to draw it. */
export class Pacer {
  private last = -Infinity;
  /** Whether the last frame drawn came slower than the display offers, on purpose. */
  slowed = false;

  shouldDraw(now: number, s: PaceState): boolean {
    const fps = targetFps(s);
    this.slowed = fps !== null && fps < BATTERY_FPS;
    if (fps === 0) return false;
    if (fps !== null && now - this.last < 1000 / fps - SLACK_MS) return false;
    this.last = now;
    return true;
  }
}

/**
 * Most pixels a frame draws at full quality: a 2560x1600 screen's worth. A Retina laptop at 2x
 * (3024x1964 on a 14" M-series) is half as many again, every one of them drawn twice (the scene and
 * its outlines), which is what pegs Firefox on a Mac (#28). Past this, pixels are drawn a bit bigger.
 */
export const PIXEL_BUDGET = 2560 * 1600;

/** Device pixels per CSS pixel to draw at: one at low quality, else up to 2, within PIXEL_BUDGET. */
export function pixelRatioFor(dpr: number, width: number, height: number, low: boolean): number {
  if (low) return 1;
  const want = Math.min(dpr, 2);
  const area = width * height;
  if (area <= 0) return want;
  return Math.max(1, Math.min(want, Math.sqrt(PIXEL_BUDGET / area)));
}
