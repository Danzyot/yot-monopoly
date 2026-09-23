// Helpers shared by the per-map surroundings: the floor height under the
// table, a seeded RNG (so the lobby and the game build the same scenery), an
// instanced "scatter" for repeated props, colour mixing for palette tints and
// procedural canvas textures. Nothing is downloaded: every surface is drawn.

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  CanvasTexture, Color, Object3D, RepeatWrapping, SRGBColorSpace, type InstancedMesh,
} from 'three';

// The camera looks steeply down at the board, so what frames it is mostly
// floor: a compact table on a raised floor leaves a band of room visible all
// round instead of a sea of tabletop.
/** Radius of the round table top (the board's corners sit 7.8 from centre). */
export const TABLE_R = 8.6;
/** Top of the floor / ground the table stands on. */
export const FLOOR = -4.6;

export type V3 = [number, number, number];

/** Deterministic PRNG (mulberry32): same seed, same city every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `a` blended toward `b` by `t`, as a CSS hex string. */
export function mix(a: string, b: string, t: number): string {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
}

export interface Inst {
  p: V3;
  s?: V3 | number;
  /** Yaw in radians. */
  ry?: number;
  /** Per-instance colour (multiplies the material colour). */
  c?: string;
}

/** Many copies of one mesh in a single draw call. Children: geometry + material. */
export function Scatter({ items, children, castShadow, receiveShadow }: {
  items: Inst[];
  children: ReactNode;
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new Object3D();
    const col = new Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(0, it.ry ?? 0, 0);
      if (typeof it.s === 'number') o.scale.setScalar(it.s);
      else o.scale.set(...(it.s ?? [1, 1, 1]));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      if (it.c) m.setColorAt(i, col.set(it.c));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [items]);
  // Scenery spans the whole view; per-instance culling would buy nothing.
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} frustumCulled={false}
      castShadow={castShadow} receiveShadow={receiveShadow}>
      {children}
    </instancedMesh>
  );
}

/** A texture drawn once on a canvas; redrawn when `deps` change, freed on unmount. */
export function useCanvasTexture(
  w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, deps: unknown[],
  repeat?: [number, number],
): CanvasTexture {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    if (repeat) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(...repeat);
    }
    return t;
  }, deps);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

/** Fine speckle over a base colour: wood grain, asphalt, concrete. */
export function speckle(g: CanvasRenderingContext2D, base: string, amount: number, seed: number, streak = false) {
  const { width: w, height: h } = g.canvas;
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const n = Math.floor(w * h * amount);
  for (let i = 0; i < n; i++) {
    const light = r() > 0.5;
    g.fillStyle = light ? `rgba(255,255,255,${r() * 0.06})` : `rgba(0,0,0,${r() * 0.12})`;
    if (streak) g.fillRect(r() * w, r() * h, 2 + r() * 40, 1);
    else g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}
