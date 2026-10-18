// Small timing and easing helpers for cutscene scripts. Times are ms.

import type { Vector3 } from 'three';

export const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
/** 0 before `a`, 1 after `b`, linear between. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
export const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeIn = (k: number) => k * k * k;
/** Overshoots a little and settles: things popping into place. */
export const easeOutBack = (k: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
};
/** A bell: 0 at a, 1 in the middle, 0 at b. */
export const bell = (t: number, a: number, b: number) => Math.sin(Math.PI * seg(t, a, b));

/** out = base + x·along + z·out + y up, on the board plane (along/out are tile axes [x, z]). */
export function onBoard(out: Vector3, base: { x: number; z: number }, along: readonly [number, number], outward: readonly [number, number],
  a: number, o: number, y: number): Vector3 {
  return out.set(base.x + along[0] * a + outward[0] * o, y, base.z + along[1] * a + outward[1] * o);
}

/** The yaw (rotation.y) that turns a model facing +z toward direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);

/** Turn `from` toward `to` the short way round, by fraction k. */
export function turn(from: number, to: number, k: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * k;
}
