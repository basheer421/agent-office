// The pieces of 🏢 Building only (see index.ts) that need no office: skipping a part's updates, and
// hiding a part without taking its visibility from whoever already sets it.
import * as THREE from 'three';

/**
 * Wraps `obj[name]` so it's skipped while `skip()` says so. Every caller of the parts wrapped here
 * (the loop, the cars, the rooftop, the fixtures' update) looks the method up on the part each frame,
 * so wrapping it once it's built is enough. Wrapping the same method again does nothing.
 */
export function skipWhile<T extends object, K extends keyof T>(obj: T, name: K, skip: () => boolean) {
  // SAFETY: only ever called with the name of a method (update, cull), so it's a function.
  const real = obj[name] as unknown as ((...args: unknown[]) => unknown) & { skips?: true };
  if (real.skips) return;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    if (skip()) return;
    return real.apply(this, args);
  };
  (obj as Record<K, unknown>)[name] = Object.assign(wrapped, { skips: true as const });
}

/**
 * Puts a group of its own between `obj` and its parent, so hiding it there leaves `obj.visible` to
 * whoever sets it (travel and the maps do the holiday props', the cars their own). Hands back that
 * group, or the one put there before.
 */
export function veil(obj: THREE.Object3D): THREE.Group {
  const parent = obj.parent;
  if (parent?.userData.veil) return parent as THREE.Group;
  const group = new THREE.Group();
  group.userData.veil = true;
  if (parent) {
    parent.add(group);
    parent.remove(obj);
  }
  group.add(obj);
  return group;
}
