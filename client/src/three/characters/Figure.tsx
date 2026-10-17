// The shared chibi rig: body + feet in a "pose" group (squash, lean, lie
// down), two hands that can wave, and a head that can nod. Animation code
// (the board pieces, the lobby preview) drives it through `poseRig` so both
// move the same way.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Color, CylinderGeometry, Quaternion, Vector3, type Group, type Material, type Mesh, type Object3D } from 'three';
import { ASSETS } from '../assets.gen.ts';
import { WithModel } from '../models.tsx';
import type { CharacterId } from '../../../../shared/characters.ts';
import { GEO, Part, disposeMaterials, makeMaterials, type Mats } from './parts.tsx';
import { HEAD_Y, LOOKS, DefaultBody, type Look } from './looks.tsx';

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

/**
 * A character on the rig. The modelled version (tools/blender/characters.py)
 * shows once characters.glb is in; until then, or if it fails, the same design
 * drawn from primitives. Both hang their parts on the same rig groups.
 */
export function CharacterFigure(props: { id: CharacterId; mats: Mats; rig: Rig }) {
  return (
    <WithModel fallback={<DrawnFigure {...props} />}>
      <ModelFigure {...props} />
    </WithModel>
  );
}

const PART_NAMES = ['Body', 'Head', 'HandL', 'HandR'] as const;

// ---- arms ------------------------------------------------------------------
// Characters with `arms` get a limb from each shoulder to its hand. The hands
// are animated by poseRig; each frame the limbs are re-aimed at them.

const ARM_GEO = new CylinderGeometry(1, 0.85, 1, 10, 1, true);
const UP = new Vector3(0, 1, 0);
const tmpDir = new Vector3();
const tmpQ = new Quaternion();

function ArmLinks({ arms, mats, rig }: { arms: NonNullable<Look['arms']>; mats: Mats; rig: Rig }) {
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  useFrame(() => {
    for (const [mesh, hand, side] of [[left.current, rig.handL, 1], [right.current, rig.handR, -1]] as const) {
      if (!mesh || !hand) continue;
      const sx = arms.shoulder[0] * side, sy = arms.shoulder[1], sz = arms.shoulder[2];
      tmpDir.set(hand.position.x - sx, hand.position.y - sy, hand.position.z - sz);
      const len = Math.max(0.001, tmpDir.length());
      mesh.position.set(sx + tmpDir.x / 2, sy + tmpDir.y / 2, sz + tmpDir.z / 2);
      mesh.quaternion.copy(tmpQ.setFromUnitVectors(UP, tmpDir.divideScalar(len)));
      mesh.scale.set(arms.radius, len, arms.radius);
    }
  });
  return (
    <>
      <mesh ref={left} geometry={ARM_GEO} material={mats[arms.mat]} castShadow />
      <mesh ref={right} geometry={ARM_GEO} material={mats[arms.mat]} castShadow />
    </>
  );
}

function ModelFigure({ id, mats, rig }: { id: CharacterId; mats: Mats; rig: Rig }) {
  const gltf = useGLTF(ASSETS.characters.url);
  const parts = useMemo(() => {
    const cid = LOOKS[id] ? id : 'spiky';
    return Object.fromEntries(PART_NAMES.map(name => {
      const src = gltf.scene.getObjectByName(`${cid}_${name}`);
      if (!src) throw new Error(`characters.glb has no ${cid}_${name}`);
      const obj = src.clone(true);
      obj.position.set(0, 0, 0);
      obj.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        // "<id>:<key>" -> this figure's own material of that key (player colour, jail grey, fade).
        const swap = (mat: Material) => mats[(mat.name.split(':')[1] ?? 'main') as keyof Mats] ?? mats.main;
        m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
        m.castShadow = name === 'Body' || name === 'Head';
      });
      return [name, obj];
    })) as Record<(typeof PART_NAMES)[number], Object3D>;
  }, [gltf.scene, id, mats]);
  const look = LOOKS[id] ?? LOOKS.spiky;
  return (
    <group ref={g => { rig.pose = g; }}>
      <primitive object={parts.Body} />
      {look.arms && <ArmLinks arms={look.arms} mats={mats} rig={rig} />}
      <group ref={g => { rig.handL = g; }} position={[HAND_REST[0], HAND_REST[1], HAND_REST[2]]}>
        <primitive object={parts.HandL} />
      </group>
      <group ref={g => { rig.handR = g; }} position={[-HAND_REST[0], HAND_REST[1], HAND_REST[2]]}>
        <primitive object={parts.HandR} />
      </group>
      <group ref={g => { rig.head = g; }} position={[0, HEAD_Y, 0]}>
        <primitive object={parts.Head} />
      </group>
    </group>
  );
}

function DrawnFigure({ id, mats, rig }: { id: CharacterId; mats: Mats; rig: Rig }) {
  const look = LOOKS[id] ?? LOOKS.spiky;
  return (
    <group ref={g => { rig.pose = g; }}>
      {look.body ? look.body(mats) : <DefaultBody m={mats} />}
      {look.extras?.(mats)}
      {look.arms && <ArmLinks arms={look.arms} mats={mats} rig={rig} />}
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
