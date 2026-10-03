// 🏢 Building only (⚙️ Settings' Graphics, ui/settings-graphics.ts): no city round the roof, no cars,
// no scenic loop, no weather and no holiday props. None of them is drawn or ticked while it's on: their
// updates are wrapped here to skip, so the parts that own them don't need to know about it. The weather
// is kept clear by features/performance, as Always clear does.
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';

export interface LiteWorld {
  /** Whether the world is down to the building. */
  lite(): boolean;
}

/** Wraps `obj[name]` so it's skipped while `skip()` says so. */
function skipWhile<T extends object, K extends keyof T>(obj: T, name: K, skip: () => boolean) {
  // SAFETY: only ever called with the name of a method (update, cull), so it's a function.
  const real = obj[name] as unknown as (...args: unknown[]) => unknown;
  (obj as Record<K, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
    if (skip()) return;
    return real.apply(this, args);
  };
}

export function installLiteWorld(ctx: Ctx, parts: Pick<Parts, 'stage' | 'rooftop'>): LiteWorld {
  const lite = () => ctx.settings.world === 'lite';
  const { office } = ctx;
  const { holiday } = parts.stage;
  skipWhile(office.cars, 'update', lite);
  skipWhile(office.scenic, 'update', lite);
  skipWhile(office.scenic, 'cull', lite);
  skipWhile(holiday, 'update', lite);
  /** The roof's city, once the roof is built and its updates are wrapped. */
  let city: { group: { visible: boolean } } | null = null;

  let was = false;
  // Before the frame is drawn, and after travel and the maps have had their say about the holiday props.
  ctx.ticks.add('hud', () => {
    const now = lite();
    const roof = parts.rooftop.roof();
    if (roof && !city) {
      city = roof.city;
      skipWhile(roof.city, 'update', lite);
    }
    if (!now && !was) return;
    office.cars.group.visible = !now;
    for (const car of office.cars.cars) car.interactable.off = now;
    office.scenic.group.visible = !now;
    if (city) city.group.visible = !now;
    if (now) holiday.group.visible = false;
    // Back to the full world: the holiday props as travel and the maps would have them.
    else holiday.group.visible = ctx.inOffice() && !ctx.upTop();
    was = now;
  });
  return { lite };
}
