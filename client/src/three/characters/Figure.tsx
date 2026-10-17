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
  footL: Group | null;
  footR: Group | null;
}

export const newRig = (): Rig => ({ pose: null, head: null, handL: null, handR: null, footL: null, footR: null });

/** Per-figure materials in the player's colour, freed when the figure goes. */
export function useCharacterMaterials(id: CharacterId, color: string): Mats {
  const mats = useMemo(() => makeMaterials(color, LOOKS[id]?.colors), [id, color]);
  useEffect(() => () => disposeMaterials(mats), [mats]);
  return mats;
}

const HAND_REST: [number, number, number] = [0.11, 0.115, 0.015];
const HAND_UP: [number, number, number] = [0.125, 0.37, 0.02];
const HAND_DROOP: [number, number, number] = [0.085, 0.07, 0.035];
/** Where each foot rests (its pivot is the middle of the sole). */
const FOOT_REST: [number, number, number] = [0.042, 0, 0.012];
/** Leg ends this far above the foot pivot. */
const ANKLE = 0.03;

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

const PART_NAMES = ['Body', 'Head', 'HandL', 'HandR', 'FootL', 'FootR'] as const;

// ---- limbs -----------------------------------------------------------------
// Characters with `arms` / `legs` get a limb from each shoulder to its hand and
// from each hip to its foot. Hands and feet are animated by poseRig; each
// frame the limbs are re-aimed at them, so they follow every move.

const LIMB_GEO = new CylinderGeometry(1, 0.85, 1, 10, 1, true);
const UP = new Vector3(0, 1, 0);
const tmpDir = new Vector3();
const tmpQ = new Quaternion();

function aim(mesh: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, radius: number) {
  tmpDir.set(bx - ax, by - ay, bz - az);
  const len = Math.max(0.001, tmpDir.length());
  mesh.position.set(ax + tmpDir.x / 2, ay + tmpDir.y / 2, az + tmpDir.z / 2);
  mesh.quaternion.copy(tmpQ.setFromUnitVectors(UP, tmpDir.divideScalar(len)));
  mesh.scale.set(radius, len, radius);
}

function Limbs({ look, mats, rig }: { look: Look; mats: Mats; rig: Rig }) {
  const armL = useRef<Mesh>(null);
  const armR = useRef<Mesh>(null);
  const legL = useRef<Mesh>(null);
  const legR = useRef<Mesh>(null);
  useFrame(() => {
    const { arms, legs } = look;
    if (arms) {
      for (const [mesh, hand, side] of [[armL.current, rig.handL, 1], [armR.current, rig.handR, -1]] as const) {
        if (!mesh || !hand) continue;
        aim(mesh, arms.shoulder[0] * side, arms.shoulder[1], arms.shoulder[2], hand.position.x, hand.position.y, hand.position.z, arms.radius);
      }
    }
    if (legs) {
      for (const [mesh, foot, side] of [[legL.current, rig.footL, 1], [legR.current, rig.footR, -1]] as const) {
        if (!mesh || !foot) continue;
        aim(mesh, legs.hip[0] * side, legs.hip[1], legs.hip[2], foot.position.x, foot.position.y + ANKLE, foot.position.z - 0.006, legs.radius);
      }
    }
  });
  return (
    <>
      {look.arms && <mesh ref={armL} geometry={LIMB_GEO} material={mats[look.arms.mat]} castShadow />}
      {look.arms && <mesh ref={armR} geometry={LIMB_GEO} material={mats[look.arms.mat]} castShadow />}
      {look.legs && <mesh ref={legL} geometry={LIMB_GEO} material={mats[look.legs.mat]} castShadow />}
      {look.legs && <mesh ref={legR} geometry={LIMB_GEO} material={mats[look.legs.mat]} castShadow />}
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
      <Limbs look={look} mats={mats} rig={rig} />
      <group ref={g => { rig.footL = g; }} position={[FOOT_REST[0], FOOT_REST[1], FOOT_REST[2]]}>
        <primitive object={parts.FootL} />
      </group>
      <group ref={g => { rig.footR = g; }} position={[-FOOT_REST[0], FOOT_REST[1], FOOT_REST[2]]}>
        <primitive object={parts.FootR} />
      </group>
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
      <Limbs look={look} mats={mats} rig={rig} />
      {([[1, 'footL'], [-1, 'footR']] as const).map(([side, key]) => (
        <group key={side} ref={g => { rig[key] = g; }} position={[side * FOOT_REST[0], FOOT_REST[1], FOOT_REST[2]]}>
          <Part g={GEO.sphere} m={mats[look.foot]} p={[side * 0.003, 0.018, 0.006]} s={[0.036, 0.022, 0.052]} cast />
        </group>
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
  /** Mid-step: progress 0–1 through one hop, and which foot leads (1 left, -1 right). */
  walk?: number;
  stride?: 1 | -1;
  /** Head turn (radians, + to its left). */
  look?: number;
  /** 0–1: waving with the right hand. */
  wave?: number;
  /** 0–1: fist pumps with the left hand. */
  pump?: number;
  /** 0–1: dejected (paid out): head down, shoulders in. */
  sad?: number;
  /** 0–1 through a stomping tantrum (sent to jail). */
  stomp?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function poseRig(rig: Rig, o: PoseInput) {
  const { pose, head, handL, handR, footL, footR } = rig;
  if (!pose || !head || !handL || !handR) return;
  const alive = 1 - o.lie;
  const sad = o.sad ?? 0;
  const wave = o.wave ?? 0;
  const pump = o.pump ?? 0;
  const stomp = o.stomp ?? 0;
  const walking = o.walk !== undefined;
  const w = o.walk ?? 0;
  const stride = o.stride ?? 1;
  const step = walking ? Math.sin(Math.PI * w) : 0;
  const breathe = Math.sin(o.time * 2.4 + o.phase) * alive * (1 - o.slump * 0.5);
  // Stamping shakes the whole body a little on each impact.
  const stompHit = stomp > 0 ? Math.max(0, Math.sin(stomp * Math.PI * 6)) : 0;
  const sy = o.squash * (1 + breathe * 0.025) * (1 - stompHit * 0.05);
  const sxz = 1 / Math.sqrt(sy);
  pose.scale.set(sxz, sy, sxz);
  // Lean forward when slumped; fall back flat when out of the game. The pivot
  // is at the feet, so lift a little while lying to keep the body above the board.
  pose.rotation.x = o.slump * 0.32 + sad * 0.16 - o.lie * (Math.PI / 2) + step * 0.08;
  // A waddle from side to side while walking.
  pose.rotation.z = step * 0.07 * stride + Math.sin(stomp * Math.PI * 6) * 0.04 * (stomp > 0 ? 1 : 0);
  pose.position.y = o.lie * 0.075;
  pose.position.z = o.lie * 0.2;

  head.position.y = HEAD_Y - o.slump * 0.025 - sad * 0.012 + breathe * 0.004;
  head.rotation.x = o.slump * 0.45 + sad * 0.42 + Math.sin(o.time * 1.3 + o.phase) * 0.04 * alive - step * 0.05;
  head.rotation.y = (o.look ?? 0) * alive + (sad > 0 ? Math.sin(o.time * 7) * 0.12 * sad : 0);
  head.rotation.z = Math.sin(o.time * 0.9 + o.phase * 2) * 0.05 * alive * (1 - o.handsUp) - step * 0.05 * stride;

  const swing = Math.sin(o.time * 2.4 + o.phase) * 0.012 * alive;
  const flap = Math.sin(o.time * 18) * 0.02 * o.handsUp;
  for (const [hand, side] of [[handL, 1], [handR, -1]] as const) {
    const droop = Math.min(1, o.slump + sad * 0.8);
    const base = HAND_REST.map((v, k) => lerp(v, HAND_DROOP[k], droop));
    const p = base.map((v, k) => lerp(v, HAND_UP[k], o.handsUp));
    let x = side * p[0] + side * flap;
    let y = p[1] + swing * side;
    // Arms swing against the legs while walking.
    let z = p[2] - step * 0.035 * stride * side;
    let rz = side * o.handsUp * 0.6;
    if (side === -1 && wave > 0) {
      x = lerp(x, -0.135 + Math.sin(o.time * 14) * 0.03, wave);
      y = lerp(y, 0.33, wave);
      z = lerp(z, 0.05, wave);
      rz = lerp(rz, -0.5 + Math.sin(o.time * 14) * 0.4, wave);
    }
    if (side === 1 && pump > 0) {
      const beat = Math.abs(Math.sin(o.time * 11));
      x = lerp(x, 0.1, pump);
      y = lerp(y, 0.26 + beat * 0.09, pump);
      z = lerp(z, 0.03, pump);
    }
    if (stomp > 0) {
      // Fists down and in, shaking.
      x = lerp(x, side * 0.095, Math.min(1, stomp * 4));
      y = lerp(y, 0.09 + stompHit * 0.015, Math.min(1, stomp * 4));
    }
    hand.position.set(x, y, z);
    hand.rotation.z = rz;
  }

  for (const [foot, side] of [[footL, 1], [footR, -1]] as const) {
    if (!foot) continue;
    let x = side * FOOT_REST[0], y = FOOT_REST[1], z = FOOT_REST[2];
    if (walking) {
      // The leading foot reaches forward and lifts; the other pushes off behind.
      const lead = side === stride;
      y += step * (lead ? 0.034 : 0.012);
      z += step * (lead ? 0.038 : -0.024);
      foot.rotation.x = step * (lead ? -0.35 : 0.3);
    } else {
      foot.rotation.x = 0;
    }
    if (side === -1 && stomp > 0) {
      // Right foot stamps three times.
      y += Math.max(0, Math.sin(stomp * Math.PI * 6 + Math.PI)) * 0.045;
    }
    foot.position.set(x, y, z);
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
