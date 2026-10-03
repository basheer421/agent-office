import type { Ctx } from '../../core/context';
import { store } from '../../state';
import type { WorkerView } from './views';

/** How often the laptops in view are looked over, to tell the office which screens to send. */
const CHECK_MS = 500;

export interface ScreenWatchDeps {
  workerViews: ReadonlyMap<string, WorkerView>;
}

/**
 * Tells the office which workers' laptop screens this page wants: the ones the camera can see, and
 * none at all while the tab is hidden. The rest stop streaming, and come back with a full frame.
 */
export function installScreenWatch(ctx: Ctx, deps: ScreenWatchDeps) {
  /** What the office was last told, as a sorted key; null after arriving on a floor (it sends everything then). */
  let told: string | null = null;
  let checkedAt = 0;
  const tell = () => {
    const ids = document.hidden ? [] : [...deps.workerViews].filter(([, v]) => v.laptop.inView).map(([id]) => id).sort();
    const key = ids.join(',');
    if (key === told) return;
    told = key;
    ctx.net.send({ t: 'screens.watch', workerIds: ids });
  };
  store.on('floor', () => void (told = null));
  // rAF stops while hidden, so this can't wait for a tick.
  document.addEventListener('visibilitychange', tell);
  ctx.ticks.add('hud', ({ now }) => {
    if (now - checkedAt < CHECK_MS) return;
    checkedAt = now;
    tell();
  });
}
