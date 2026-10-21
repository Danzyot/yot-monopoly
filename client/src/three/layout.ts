// Board geometry, in world units. The board lies on the XZ plane centred on
// the origin with its top face at y = 0. GO is the bottom-right corner (+x,+z,
// nearest the default camera) and play runs clockwise as seen from above.
//
// `n` is the board's number of spaces, which names its map (shared/maps.ts
// shapeOf): the loop's spaces go round the edge, and a board with a lane
// (Crossroads) lays the lane's spaces straight up the middle, from the middle
// of GO's side to the middle of the far side, the same size as edge tiles.

import { shapeOf } from '../../../shared/maps.ts';
import { routeTo } from '../../../shared/route.ts';
import type { MoveLeg } from '../../../shared/types.ts';

export const W = 11;          // board width
export const C = 1.5;         // corner tile size / edge tile depth
export const BAND = 0.3;      // colour band depth on properties

/** Spaces round the edge of a board of `n` spaces (all of them, unless it has a lane). */
export function ringOf(n: number): number {
  return shapeOf(n).ring;
}

/** The jail corner of a board of `n` spaces. */
export function jailOf(n: number): number {
  return ringOf(n) / 4;
}

/** Edge tile width for a board of `n` spaces (ring/4 - 1 tiles between corners; lane tiles match). */
export function tileWidth(n: number): number {
  return (W - 2 * C) / (ringOf(n) / 4 - 1);
}

/**
 * The tiles a recorded walk steps on, in order, ending on `leg.to`: the
 * server's own list on a board with a lane (MoveLeg.via), else counted back
 * round the loop from where it ended (backwards for "go back 3").
 */
export function legTiles(leg: Pick<MoveLeg, 'to' | 'steps' | 'via'>, n: number): number[] {
  if (leg.via?.length) return leg.via;
  const steps = leg.steps ?? 0;
  const ring = ringOf(n);
  const dir = Math.sign(steps);
  const origin = ((leg.to - steps) % ring + ring) % ring;
  return Array.from({ length: Math.abs(steps) }, (_, k) => ((origin + dir * (k + 1)) % ring + ring) % ring);
}

/** The way forward from tile `from` to tile `to` (a board with a lane: the shorter one), the tiles stepped on. */
export function routeBetween(from: number, to: number, n: number): number[] {
  return from === to ? [] : routeTo(shapeOf(n), from, to);
}

export type Side = 0 | 1 | 2 | 3; // bottom, left, top, right

export interface TileGeom {
  x: number;
  z: number;
  side: Side;
  corner: boolean;
  /** Unit vector pointing from the tile towards the board edge. */
  out: [number, number];
  /** Unit vector along the row, in the direction of play. */
  along: [number, number];
  /** Canvas rotation so the tile's "bottom" faces the outer edge. */
  rot: number;
}

const H = W / 2;

export function tile(i: number, n: number): TileGeom {
  const ring = ringOf(n);
  const T = tileWidth(n);
  if (i >= ring) {
    // The lane, south to north up the middle, read from its west side (like the left edge).
    const k = i - ring;
    return { x: 0, z: H - C - (k + 0.5) * T, side: 1, corner: false, out: [-1, 0], along: [0, -1], rot: Math.PI / 2 };
  }
  const per = ring / 4;
  const side = Math.floor(i / per) as Side;
  const k = i % per;
  const corner = k === 0;
  const off = corner ? C / 2 : C + (k - 0.5) * T; // distance from the side's starting corner edge
  switch (side) {
    case 0: return { x: H - (corner ? C / 2 : off), z: H - C / 2, side, corner, out: [0, 1], along: [-1, 0], rot: 0 };
    case 1: return { x: -H + C / 2, z: H - (corner ? C / 2 : off), side, corner, out: [-1, 0], along: [0, -1], rot: Math.PI / 2 };
    case 2: return { x: -H + (corner ? C / 2 : off), z: -H + C / 2, side, corner, out: [0, -1], along: [1, 0], rot: Math.PI };
    default: return { x: H - C / 2, z: -H + (corner ? C / 2 : off), side, corner, out: [1, 0], along: [0, 1], rot: -Math.PI / 2 };
  }
}

/** Which space is under a point on the board, or null for the middle. */
export function tileAt(x: number, z: number, n: number): number | null {
  if (Math.abs(x) > H || Math.abs(z) > H) return null;
  const inner = H - C;
  const ring = ringOf(n);
  const T = tileWidth(n);
  if (Math.abs(x) < inner && Math.abs(z) < inner) {
    if (ring === n || Math.abs(x) > C / 2) return null;
    return ring + Math.min(n - ring - 1, Math.max(0, Math.floor((inner - z) / T)));
  }
  const per = ring / 4;
  const k = (d: number) => Math.min(per - 1, Math.max(1, Math.floor((d - C) / T) + 1));
  if (z > inner) { // bottom row
    if (x > inner) return 0;
    if (x < -inner) return per;
    return k(H - x);
  }
  if (z < -inner) {
    if (x < -inner) return 2 * per;
    if (x > inner) return 3 * per;
    return 2 * per + k(x + H);
  }
  if (x < -inner) return per + k(H - z);
  return 3 * per + k(z + H);
}

/** Where a token stands: spread several tokens on one tile so none overlap. */
export function tokenSpot(i: number, slot: number, count: number, inJail: boolean, n: number): [number, number] {
  const g = tile(i, n);
  const T = tileWidth(n);
  if (i === jailOf(n)) {
    if (inJail) {
      // Inside the cell, the inner square of the corner.
      const cx = g.x + 0.22, cz = g.z - 0.22;
      // Spread along the cell's diagonal first, square to the table and follow views.
      const a = Math.PI / 4 + (slot / Math.max(1, count)) * Math.PI * 2;
      const r = count > 1 ? 0.22 : 0;
      return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
    }
    // Just visiting: along the outer L of the corner.
    const path: [number, number][] = [[-0.55, -0.1], [-0.55, 0.35], [-0.3, 0.58], [0.1, 0.58], [-0.55, -0.45], [0.45, 0.58], [-0.55, 0.1], [0.3, 0.58]];
    const [dx, dz] = path[slot % path.length];
    return [g.x + dx, g.z + dz];
  }
  // Keep off the colour band: sit toward the outer edge.
  const depth = g.corner ? 0 : 0.2;
  const cx = g.x + g.out[0] * depth, cz = g.z + g.out[1] * depth;
  if (count <= 1) return [cx, cz];
  const cols = count <= 2 ? 2 : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const col = slot % cols, row = Math.floor(slot / cols);
  const spread = g.corner ? 0.42 : Math.min(0.26, T * 0.3);
  const u = (col - (cols - 1) / 2) * spread;
  const v = (row - (rows - 1) / 2) * spread;
  return [cx + g.along[0] * u + g.out[0] * v, cz + g.along[1] * u + g.out[1] * v];
}

/**
 * House/hotel positions on a property's colour band: the inner strip, toward
 * the middle of the board. Pieces stand and walk on the outer part of the tile
 * (tokenSpot), so a building never stands where a piece does, and from the
 * table camera it is in front of a piece on the far row, not on top of it.
 */
export function buildingSpots(i: number, houses: number, n: number): [number, number][] {
  const g = tile(i, n);
  const T = tileWidth(n);
  const inset = C / 2 - BAND / 2 - 0.02;
  const cx = g.x - g.out[0] * inset, cz = g.z - g.out[1] * inset;
  if (houses >= 5) return [[cx, cz]];
  const out: [number, number][] = [];
  for (let h = 0; h < houses; h++) {
    const u = (h - 1.5) * (T / 4.2);
    out.push([cx + g.along[0] * u, cz + g.along[1] * u]);
  }
  return out;
}
