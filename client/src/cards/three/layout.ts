// Where everything sits on the 3D card table, in the Chog room's units: the
// modelled table top is at y = -0.28 (the same table Monopoly's board sits
// on), the felt a hair above it. The viewer's seat is at +z, nearest the
// camera; the others run from their left, round the far side, to their right,
// like the 2D layout. Figures stand on the felt at the rim with their hand
// fanned in front of them, the piles in the middle.

import { Euler, Object3D, Quaternion, Vector3, type Camera } from 'three';
import type { CardsPlayerView } from '../../../../shared/cards/types.ts';

export const TABLE_TOP = -0.28;
export const FELT_Y = TABLE_TOP + 0.03;
export const FELT_R = 7.2;
/** Where the figures stand. */
export const SEAT_R = 5.7;
/** Where a hand is fanned, in front of its player. */
export const FAN_R = 4.15;
/** The figures are modelled ~0.45 tall: scaled up to read from across the table. */
export const FIG_SCALE = 3.9;
/** Cards in a seat's fan are drawn this much smaller than the ones on the table. */
export const FAN_SCALE = 0.62;
/** A stacked card adds this much height. */
export const CARD_STEP = 0.012;
/** Cards in flight ride this high above the felt at the top of the arc. */
export const FLIGHT_ARC = 1.6;

export const PILE = new Vector3(-1.45, FELT_Y, 0.35);
export const DISCARD = new Vector3(1.45, FELT_Y, 0.35);
/** The felt's middle, where the ring turns. */
export const CENTRE = new Vector3(0, FELT_Y, 0.2);

/** Our seat's angle: toward the camera. */
const MY_ANGLE = Math.PI / 2;

/** On phones the opponents sit in a row along the far side: this far either side of straight across. */
export const ROW_ARC = 0.74;

/**
 * Each player's angle round the table (radians; x = cos, z = sin). `row`
 * (phones): the opponents in a row along the far arc, so a portrait screen
 * can frame them all across the table, like the 2D table's row of chips.
 */
export function seatAngles(players: readonly CardsPlayerView[], me: string | null, row = false): Map<string, number> {
  const at = new Map<string, number>();
  const i = me ? players.findIndex(p => p.id === me) : -1;
  const others = i >= 0 ? [...players.slice(i + 1), ...players.slice(0, i)] : players;
  if (i >= 0) at.set(me!, MY_ANGLE);
  const n = others.length;
  others.forEach((p, k) => {
    // Seated: from our left, over the far side, round to our right (clockwise seat order).
    // Watching: everyone spread evenly, the first seat at the far side.
    const t = row
      ? Math.PI * 1.5 - ROW_ARC + ((k + 1) / (n + 1)) * ROW_ARC * 2
      : i >= 0
        ? MY_ANGLE + 0.62 + ((k + 1) / (n + 1)) * (Math.PI * 2 - 1.24)
        : Math.PI * 1.5 + (k * Math.PI * 2) / n;
    at.set(p.id, t);
  });
  return at;
}

export const seatPos = (angle: number, r = SEAT_R, out = new Vector3()) => out.set(Math.cos(angle) * r, FELT_Y, Math.sin(angle) * r);

/** The yaw that turns a figure (modelled facing +z) at `angle` toward the middle of the table. */
export const faceCentreYaw = (angle: number) => Math.atan2(-Math.cos(angle), -Math.sin(angle));

const dummy = new Object3D();
const euler = new Euler();
const tmp = new Vector3();

/** A card lying flat on the felt (its face +z turned up or down), its top away from the camera, turned by `yaw`. */
export function flatQuat(yaw: number, faceUp: boolean, out = new Quaternion()): Quaternion {
  euler.set(faceUp ? -Math.PI / 2 : Math.PI / 2, yaw, 0, 'YXZ');
  return out.setFromEuler(euler);
}

/** A seeded 0–1 value, the same every frame for the same `seed` (where a card lands, its tilt). */
export function hash01(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The pose of card `k` of `n` in a seat's fan: standing in front of the
 * player at `angle`, leaning back toward them so the table sees the backs,
 * spread a little either way.
 */
export function fanCard(angle: number, k: number, n: number, outPos: Vector3, outQuat: Quaternion, lift = 0): void {
  const centre = seatPos(angle, FAN_R, tmp);
  dummy.position.copy(centre);
  dummy.position.y += 0.56 + lift;
  // +z (the face) toward the player's chest; the back faces the middle of the table.
  dummy.lookAt(Math.cos(angle) * SEAT_R, FELT_Y + 0.9, Math.sin(angle) * SEAT_R);
  dummy.rotateX(-0.42);
  const off = k - (n - 1) / 2;
  const spacing = Math.min(0.26, 1.7 / Math.max(n, 1));
  dummy.translateX(-off * spacing);
  dummy.translateZ(-off * 0.004);
  dummy.rotateZ(off * 0.06);
  dummy.updateMatrix();
  outPos.copy(dummy.position);
  outQuat.copy(dummy.quaternion);
}

/** The world point on the plane y = `planeY` under screen pixel (x, y) of `canvas`. */
export function screenToTable(x: number, y: number, canvas: HTMLElement, camera: Camera, planeY: number, out = new Vector3()): Vector3 {
  const r = canvas.getBoundingClientRect();
  const nx = ((x - r.left) / Math.max(1, r.width)) * 2 - 1;
  const ny = -((y - r.top) / Math.max(1, r.height)) * 2 + 1;
  tmp.set(nx, ny, 0.5).unproject(camera);
  const origin = camera.position;
  const dir = tmp.sub(origin).normalize();
  const t = (planeY - origin.y) / (dir.y || -1e-6);
  if (!(t > 0)) return out.set(nx * 6, planeY, 9);
  return out.copy(origin).addScaledVector(dir, t);
}
