// The shared chibi rig: body + feet in a "pose" group (squash, lean, lie
// down), two hands that can wave, and a head that can nod. Animation code
// (the board pieces, the lobby preview) drives it through `poseRig` so both
// move the same way.

import { useEffect, useMemo } from 'react';
import { Color, type Group } from 'three';
import type { CharacterId } from '../../../../shared/characters.ts';
import { GEO, Part, disposeMaterials, makeMaterials, type Mats } from './parts.tsx';
import { HEAD_Y, LOOKS, DefaultBody } from './looks.tsx';

export interface Rig {
  pose: Group | null;
  head: Group | null;
  handL: Group | null;
  handR: Group | null;
}

export const newRig = (): Rig => ({ pose: null, head: null, handL: null, handR: null });

/** Per-figure materials in the player's colour, freed when the figure goes. */
export function useCharacterMaterials(id: CharacterId, color: string): Mats {
  const mats = useMemo(() => makeMaterials(color, LOOKS[id]?.colors), [id, color]);
  useEffect(() => () => disposeMaterials(mats), [mats]);
  return mats;
}

const HAND_REST: [number, number, number] = [0.11, 0.115, 0.015];
const HAND_UP: [number, number, number] = [0.125, 0.37, 0.02];
const HAND_DROOP: [number, number, number] = [0.085, 0.07, 0.035];

export function CharacterFigure({ id, mats, rig }: { id: CharacterId; mats: Mats; rig: Rig }) {
  const look = LOOKS[id] ?? LOOKS.spiky;
  return (
    <group ref={g => { rig.pose = g; }}>
      {look.body ? look.body(mats) : <DefaultBody m={mats} />}
      {look.extras?.(mats)}
      {[-1, 1].map(side => (
        <Part key={side} g={GEO.sphere} m={mats[look.foot]} p={[side * 0.045, 0.018, 0.018]} s={[0.036, 0.022, 0.052]} cast />
      ))}
      <group ref={g => { rig.handL = g; }} position={[HAND_REST[0], HAND_REST[1], HAND_REST[2]]}>
        <Part g={GEO.sphere} m={mats[look.hand]} s={0.029} />
        {look.left?.(mats)}
      </group>
      <group ref={g => { rig.handR = g; }} position={[-HAND_REST[0], HAND_REST[1], HAND_REST[2]]}>
        <Part g={GEO.sphere} m={mats[look.hand]} s={0.029} />
        {look.right?.(mats)}
      </group>
      <group ref={g => { rig.head = g; }} position={[0, HEAD_Y, 0]}>
        {look.head(mats)}
      </group>
    </group>
  );
}

export interface PoseInput {
  /** Seconds, for the idle loops. */
  time: number;
  /** Per-piece offset so a crowd doesn't breathe in unison. */
  phase: number;
  /** 0–1: jailed slump (lean forward, head down, arms hanging). */
  slump: number;
  /** 0–1: lying on its back (bankrupt). */
  lie: number;
  /** 0–1: arms in the air (cheering). */
  handsUp: number;
  /** Vertical squash-and-stretch factor; width compensates to keep volume. */
  squash: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function poseRig(rig: Rig, o: PoseInput) {
  const { pose, head, handL, handR } = rig;
  if (!pose || !head || !handL || !handR) return;
  const alive = 1 - o.lie;
  const breathe = Math.sin(o.time * 2.4 + o.phase) * alive * (1 - o.slump * 0.5);
  const sy = o.squash * (1 + breathe * 0.025);
  const sxz = 1 / Math.sqrt(sy);
  pose.scale.set(sxz, sy, sxz);
  // Lean forward when slumped; fall back flat when out of the game. The pivot
  // is at the feet, so lift a little while lying to keep the body above the board.
  pose.rotation.x = o.slump * 0.32 - o.lie * (Math.PI / 2);
  pose.position.y = o.lie * 0.075;
  pose.position.z = o.lie * 0.2;

  head.position.y = HEAD_Y - o.slump * 0.025 + breathe * 0.004;
  head.rotation.x = o.slump * 0.45 + Math.sin(o.time * 1.3 + o.phase) * 0.04 * alive;
  head.rotation.z = Math.sin(o.time * 0.9 + o.phase * 2) * 0.05 * alive * (1 - o.handsUp);

  const swing = Math.sin(o.time * 2.4 + o.phase) * 0.012 * alive;
  const wave = Math.sin(o.time * 18) * 0.02 * o.handsUp;
  for (const [hand, side] of [[handL, 1], [handR, -1]] as const) {
    const base = HAND_REST.map((v, k) => lerp(v, HAND_DROOP[k], o.slump));
    const p = base.map((v, k) => lerp(v, HAND_UP[k], o.handsUp));
    hand.position.set(side * p[0] + side * wave, p[1] + swing * side, p[2]);
    hand.rotation.z = side * o.handsUp * 0.6;
  }
}

const GREY = new Color('#8a8a8a');

/**
 * Grey out (0–1) and fade (1 = opaque) a figure's materials. Remembers each
 * material's own colour so it can come back when the player leaves jail.
 */
export class Tinter {
  private base = new Map<string, Color>();
  private grey = 0;
  private opacity = 1;
  constructor(private mats: Mats) {
    for (const [k, m] of Object.entries(mats)) this.base.set(k, m.color.clone());
  }
  set(grey: number, opacity: number) {
    if (Math.abs(grey - this.grey) < 0.002 && Math.abs(opacity - this.opacity) < 0.002) return;
    const fading = opacity < 0.999;
    for (const [k, m] of Object.entries(this.mats)) {
      m.color.copy(this.base.get(k)!).lerp(GREY, grey);
      if (m.transparent !== fading) {
        m.transparent = fading;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
      m.depthWrite = !fading;
    }
    this.grey = grey;
    this.opacity = opacity;
  }
}
