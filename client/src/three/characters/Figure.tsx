// The shared chibi rig: body + feet in a "pose" group (squash, lean, lie
// down), two hands that can wave, and a head that can nod. Animation code
// (the board pieces, the lobby preview) drives it through `poseRig` so both
// move the same way.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Vector3, type Group, type Material, type Mesh, type Object3D,
} from 'three';
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
  /** Eyelids (characters that blink), hinged along the top of each eye. */
  lidL: Group | null;
  lidR: Group | null;
  /** Hand follow-through spring: [x,y,z, vx,vy,vz] per hand, then a primed flag. */
  lag: Float32Array;
}

export const newRig = (): Rig => ({
  pose: null, head: null, handL: null, handR: null, footL: null, footR: null, lidL: null, lidR: null, lag: new Float32Array(13),
});

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
// frame the limbs are rebuilt to reach them, rubber-hose style: a smooth tube
// that bows at the elbow (back and out) or the knee (forward) when the hand or
// foot comes in close, and pulls straight when it reaches away.

const RADIAL = 10;
const RINGS = 8;

function limbGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const n = (RINGS + 1) * (RADIAL + 1) * 3;
  g.setAttribute('position', new BufferAttribute(new Float32Array(n), 3).setUsage(DynamicDrawUsage));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(n), 3).setUsage(DynamicDrawUsage));
  const index: number[] = [];
  for (let r = 0; r < RINGS; r++) {
    for (let k = 0; k < RADIAL; k++) {
      const a = r * (RADIAL + 1) + k, b = a + RADIAL + 1;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  g.setIndex(index);
  return g;
}

const vS = new Vector3(), vH = new Vector3(), vU = new Vector3(), vBend = new Vector3(), vN = new Vector3();
const vC = new Vector3(), vP = new Vector3(), vT = new Vector3(), vB = new Vector3();

/**
 * Re-shape `g` into a tube from s to h (radius r0 → r1) that bows toward `pole`
 * as much as a limb of length `natural` would have to when its ends are closer.
 */
function bend(g: BufferGeometry, s: Vector3, h: Vector3, r0: number, r1: number, natural: number, pole: Vector3) {
  vU.subVectors(h, s);
  const len = Math.max(1e-4, vU.length());
  vU.divideScalar(len);
  vBend.copy(pole).addScaledVector(vU, -pole.dot(vU));
  if (vBend.lengthSq() < 1e-8) vBend.set(0, 0, 1).addScaledVector(vU, -vU.z);
  vBend.normalize();
  vN.crossVectors(vU, vBend).normalize();
  // The apex of a quadratic curve sits halfway to its control point.
  const bow = 0.6 * Math.sqrt(Math.max(0, natural * natural - len * len));
  vC.addVectors(s, h).multiplyScalar(0.5).addScaledVector(vBend, bow);
  const pos = g.attributes.position.array as Float32Array;
  const nor = g.attributes.normal.array as Float32Array;
  let o = 0;
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS, u = 1 - t;
    vP.set(0, 0, 0).addScaledVector(s, u * u).addScaledVector(vC, 2 * u * t).addScaledVector(h, t * t);
    vT.subVectors(vC, s).multiplyScalar(2 * u).addScaledVector(vB.subVectors(h, vC), 2 * t).normalize();
    vB.crossVectors(vT, vN);
    const r = r0 + (r1 - r0) * t;
    for (let k = 0; k <= RADIAL; k++) {
      const a = (k / RADIAL) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const nx = vN.x * c + vB.x * sn, ny = vN.y * c + vB.y * sn, nz = vN.z * c + vB.z * sn;
      pos[o] = vP.x + nx * r; pos[o + 1] = vP.y + ny * r; pos[o + 2] = vP.z + nz * r;
      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
      o += 3;
    }
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
}

/** Rest-ish lengths: arms bow a little hanging at the side and pull straight raised; knees bend as a foot lifts. */
const ARM_LEN = 0.09;
const LEG_LEN = 0.05;
const poleArm = [new Vector3(0.6, -0.25, -0.75), new Vector3(-0.6, -0.25, -0.75)];
const poleLeg = [new Vector3(0.12, 0, 1), new Vector3(-0.12, 0, 1)];

function Limbs({ look, mats, rig }: { look: Look; mats: Mats; rig: Rig }) {
  const geos = useMemo(() => [limbGeometry(), limbGeometry(), limbGeometry(), limbGeometry()], []);
  useEffect(() => () => geos.forEach(g => g.dispose()), [geos]);
  return (
    <>
      {look.arms && <mesh geometry={geos[0]} material={mats[look.arms.mat]} castShadow frustumCulled={false} />}
      {look.arms && <mesh geometry={geos[1]} material={mats[look.arms.mat]} castShadow frustumCulled={false} />}
      {look.legs && <mesh geometry={geos[2]} material={mats[look.legs.mat]} castShadow frustumCulled={false} />}
      {look.legs && <mesh geometry={geos[3]} material={mats[look.legs.mat]} castShadow frustumCulled={false} />}
      <LimbDriver look={look} geos={geos} rig={rig} />
    </>
  );
}

/** Rebuilds the limb tubes each frame from the rig's current hand and foot positions. */
function LimbDriver({ look, geos, rig }: { look: Look; geos: BufferGeometry[]; rig: Rig }) {
  useFrame(() => {
    const { arms, legs } = look;
    if (arms) {
      for (const [g, hand, side, i] of [[geos[0], rig.handL, 1, 0], [geos[1], rig.handR, -1, 1]] as const) {
        if (!hand) continue;
        vS.set(arms.shoulder[0] * side, arms.shoulder[1], arms.shoulder[2]);
        bend(g, vS, vH.copy(hand.position), arms.radius, arms.radius * 0.85, ARM_LEN, poleArm[i]);
      }
    }
    if (legs) {
      for (const [g, foot, side, i] of [[geos[2], rig.footL, 1, 0], [geos[3], rig.footR, -1, 1]] as const) {
        if (!foot) continue;
        vS.set(legs.hip[0] * side, legs.hip[1], legs.hip[2]);
        vH.set(foot.position.x, foot.position.y + ANKLE, foot.position.z - 0.006);
        bend(g, vS, vH, legs.radius, legs.radius * 0.9, LEG_LEN, poleLeg[i]);
      }
    }
  });
  return null;
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
  // Eyelids, for the characters that blink: each hangs from its hinge on the head.
  const lids = useMemo(() => {
    const cid = LOOKS[id] ? id : 'spiky';
    return (['LidL', 'LidR'] as const).map(name => {
      const src = gltf.scene.getObjectByName(`${cid}_${name}`);
      const hinge = src?.userData.hinge as [number, number, number] | undefined;
      if (!src || !hinge) return null;
      const obj = src.clone(true);
      obj.position.set(0, 0, 0);
      obj.traverse((o: Object3D) => {
        const m = o as Mesh;
        if (m.isMesh) m.material = mats[((m.material as Material).name.split(':')[1] ?? 'skin') as keyof Mats] ?? mats.skin;
      });
      return { obj, hinge };
    });
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
        {lids.map((l, i) => l && (
          <group key={i} ref={g => { rig[i ? 'lidR' : 'lidL'] = g; }} position={l.hinge} visible={false}>
            <primitive object={l.obj} />
          </group>
        ))}
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
  /** 0–1: dejected (paid out): head down, shoulders in, slow head shake, a hand to the face. */
  sad?: number;
  /** 0–1 through a stomping tantrum (sent to jail); arms fold at the end. */
  stomp?: number;
  /** Seconds spent waiting for its player to act: the right foot taps while it waits. */
  tap?: number;
  /** 0–1: eyes closed (on top of blinking, sulking and dozing in jail). */
  lids?: number;
  /** 0–1 through a cheer (with handsUp): a little arm pump on each jump and squinted-shut happy eyes. */
  cheer?: number;
  /** 0–1: crouched, winding up for a hop (anticipation). */
  crouch?: number;
  /** 0–1: a shrug, hands up and out, head cocked. */
  shrug?: number;
  /** 0–1: a big stretch: arms up, leaning back, a yawn. */
  stretch?: number;
  /** 0–1: shifting its weight from foot to foot. */
  fidget?: number;
  /** 0–1: taunting: a hand on the hip, the other beckoning. */
  taunt?: number;
  /**
   * Seconds since the last frame. When given, the hands trail the body on a
   * spring (follow-through: they overshoot and settle a beat behind).
   */
  dt?: number;
  /** A one-frame vertical jolt (units/s) to the hands' spring — negative on landing, so the arms slap down and rebound. */
  kick?: number;
  // ---- move accents (moves.ts fills these; see accentRig / reachHand) ----
  /** Extra body pitch (+ forward), roll (+ leans to its right) and yaw (+ turns to its left), radians. */
  lean?: number;
  tilt?: number;
  twist?: number;
  /** Extra head pitch (+ chin down) and roll. */
  nod?: number;
  cock?: number;
  /** Foot lifts (units) for a stamp or a shuffle. */
  liftL?: number;
  liftR?: number;
  /** 0–1 blend of the [left, right] hand toward `reachAt` (x, y, z, rx, rz per hand, left then right). */
  reach?: Float32Array;
  reachAt?: Float32Array;
  /** Swap sides: the move's right-hand work is done by the left (the right hand holds the character's own item). */
  mirror?: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Hand spring: ~26 rad/s, a little under-damped so it visibly overshoots. */
const SPRING_W = 26;
const SPRING_Z = 0.55;
/** Hand positions are computed into these (no per-frame allocation). */
const hx = [0, 0], hy = [0, 0], hz = [0, 0], hrz = [0, 0], hrx = [0, 0];

export function poseRig(rig: Rig, o: PoseInput) {
  const { pose, head, handL, handR, footL, footR, lidL, lidR } = rig;
  if (!pose || !head || !handL || !handR) return;
  const alive = 1 - o.lie;
  const sad = o.sad ?? 0;
  const wave = o.wave ?? 0;
  const pump = o.pump ?? 0;
  const stomp = o.stomp ?? 0;
  const cheer = o.cheer ?? 0;
  const crouch = o.crouch ?? 0;
  const shrug = o.shrug ?? 0;
  const stretch = o.stretch ?? 0;
  const fidget = o.fidget ?? 0;
  const taunt = o.taunt ?? 0;
  const walking = o.walk !== undefined;
  const w = o.walk ?? 0;
  const stride = o.stride ?? 1;
  const step = walking ? Math.sin(Math.PI * w) : 0;
  // + leaning forward on take-off, - sitting back into the landing.
  const pitch = walking ? Math.cos(Math.PI * w) : 0;
  // Arms fold across the chest for the last quarter of the tantrum.
  const fold = stomp > 0 ? smooth((stomp - 0.72) / 0.2) : 0;
  // Weight shifts left/right while fidgeting; the unweighted foot shuffles.
  const shift = fidget > 0 ? Math.sin(o.time * 2.6 + o.phase) * fidget : 0;
  // A cheer's jumps: 0 → 1 → 0 twice; the arm pump rides on top of handsUp.
  const jump = cheer > 0 ? Math.abs(Math.sin(Math.PI * 2 * cheer)) : 0;
  const breathe = Math.sin(o.time * 2.4 + o.phase) * alive * (1 - o.slump * 0.5);

  if (lidL || lidR) {
    // A blink every few seconds (each piece on its own beat, sometimes a
    // double), squinted shut with delight in a cheer or a yawn, heavy lids when
    // sulking or slumped in jail, shut when out of the game.
    const period = 3.4 + ((o.phase * 0.37) % 1) * 2.4;
    const tt = o.time + o.phase * 5;
    const k = tt % period;
    const cycle = Math.floor(tt / period);
    const double = ((cycle * 0.618 + o.phase * 0.3) % 1) < 0.3;
    let blink = k < 0.17 ? Math.sin((Math.PI * k) / 0.17) : 0;
    if (double && k >= 0.25 && k < 0.4) blink = Math.sin((Math.PI * (k - 0.25)) / 0.15);
    const shut = Math.max(blink, sad * 0.55, o.slump * 0.5, o.lie, o.lids ?? 0,
      cheer > 0 ? Math.sin(Math.PI * cheer) * 0.3 * o.handsUp : 0, stretch * 0.7);
    for (const lid of [lidL, lidR]) {
      if (!lid) continue;
      lid.visible = shut > 0.03;
      lid.scale.y = Math.max(0.03, shut);
    }
  }

  // Stamping shakes the whole body a little on each impact.
  const stompHit = stomp > 0 && fold < 1 ? Math.max(0, Math.sin(stomp * Math.PI * 6)) * (1 - fold) : 0;
  const sy = o.squash * (1 + breathe * 0.025) * (1 - stompHit * 0.05) * (1 - crouch * 0.1) * (1 + stretch * 0.05);
  const sxz = 1 / Math.sqrt(sy);
  pose.scale.set(sxz, sy, sxz);
  // Lean forward when slumped, into a crouch and on take-off; sit back into
  // the landing and a stretch; fall back flat when out of the game. The pivot
  // is at the feet, so lift a little while lying to keep the body above the board.
  pose.rotation.x = o.slump * 0.32 + sad * 0.16 - o.lie * (Math.PI / 2) + step * 0.08 + pitch * 0.05 + crouch * 0.1
    - stretch * 0.14 + fold * 0.03 + taunt * 0.04;
  // A waddle from side to side while walking; a sway while shifting weight.
  pose.rotation.z = step * 0.07 * stride + Math.sin(stomp * Math.PI * 6) * 0.04 * (stomp > 0 ? 1 - fold : 0)
    + shift * 0.06 + taunt * 0.05;
  // The hips twist a touch with each stride.
  pose.rotation.y = step * 0.05 * stride - shift * 0.04;
  pose.position.y = o.lie * 0.075;
  pose.position.z = o.lie * 0.2;

  // The head bobs against the body's stretch (it lags the hop) and droops when down.
  head.position.y = HEAD_Y - o.slump * 0.025 - sad * 0.012 + breathe * 0.004 - step * 0.012 - crouch * 0.01 + stretch * 0.01;
  head.rotation.x = o.slump * 0.45 + sad * 0.42 + Math.sin(o.time * 1.3 + o.phase) * 0.04 * alive - step * 0.05 - pitch * 0.04
    + crouch * 0.12 - stretch * 0.28 - fold * 0.14 - taunt * 0.1 - shrug * 0.06;
  // Sad: a slow "no" of the head. Taunt: a saucy wag.
  head.rotation.y = (o.look ?? 0) * alive + (sad > 0 ? Math.sin(o.time * 2.2) * 0.2 * sad : 0)
    + (taunt > 0 ? Math.sin(o.time * 3) * 0.1 * taunt : 0);
  head.rotation.z = Math.sin(o.time * 0.9 + o.phase * 2) * 0.05 * alive * (1 - o.handsUp) - step * 0.05 * stride
    + shrug * 0.22 - stretch * 0.14 - shift * 0.05 + taunt * 0.12;

  const swing = Math.sin(o.time * 2.4 + o.phase) * 0.012 * alive;
  const flap = Math.sin(o.time * 18) * 0.02 * o.handsUp;
  const droop = Math.min(1, o.slump + sad * 0.8);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    let x = 0, y = 0, z = 0;
    // Rest → drooping → raised, component by component (no arrays).
    for (let k = 0; k < 3; k++) {
      const v = lerp(lerp(HAND_REST[k], HAND_DROOP[k], droop), HAND_UP[k], o.handsUp);
      if (k === 0) x = side * v + side * flap; else if (k === 1) y = v + swing * side; else z = v;
    }
    let rz = side * o.handsUp * 0.6;
    let rx = 0;
    if (walking) {
      // Arms swing against the legs: the arm opposite the leading foot comes
      // forward and up; the other one back.
      const fwd = side !== stride ? 1 : -1;
      z += step * 0.035 * fwd;
      y += step * (fwd > 0 ? 0.03 : 0.012);
    }
    // Cheering: each jump throws one arm higher, left then right.
    if (jump > 0) {
      const mine = (cheer < 0.5) === (side === 1) ? 1 : 0.35;
      y += jump * 0.045 * mine * o.handsUp;
    }
    if (crouch > 0) {
      // Winding up: arms pulled back behind.
      z -= crouch * 0.04;
      y -= crouch * 0.015;
    }
    if (shrug > 0) {
      x += side * 0.035 * shrug;
      y += 0.055 * shrug;
      z += 0.025 * shrug;
      rz = lerp(rz, side * 0.9, shrug);
    }
    if (stretch > 0) {
      // Both arms up and back, fingers spread.
      x = lerp(x, side * 0.1, stretch);
      y = lerp(y, 0.4 + Math.sin(o.time * 3 + i) * 0.006, stretch);
      z = lerp(z, -0.03, stretch);
      rz = lerp(rz, side * 0.35, stretch);
    }
    if (fidget > 0) {
      // Hands drift with the weight shift.
      x += shift * 0.012;
      y += (side * shift) * 0.01;
    }
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
    if (sad > 0 && side === -1) {
      // The right hand comes up to the face (which tips forward as it sulks).
      const face = smooth(sad * 1.3);
      x = lerp(x, -0.05, face);
      y = lerp(y, HEAD_Y - 0.06 + Math.sin(o.time * 5) * 0.003, face);
      z = lerp(z, 0.105, face);
      rz = lerp(rz, -0.9, face);
    }
    if (taunt > 0) {
      if (side === 1) {
        // Left hand on the hip.
        x = lerp(x, 0.08, taunt);
        y = lerp(y, 0.1, taunt);
        z = lerp(z, 0.035, taunt);
        rz = lerp(rz, 1.2, taunt);
      } else {
        // Right hand out front, beckoning "come and get it".
        const curl = Math.max(0, Math.sin(o.time * 8));
        x = lerp(x, -0.06, taunt);
        y = lerp(y, 0.2 + curl * 0.02, taunt);
        z = lerp(z, 0.11 - curl * 0.025, taunt);
        rx = lerp(rx, -0.6 + curl * 0.8, taunt);
      }
    }
    if (stomp > 0) {
      // Fists down and in, shaking…
      const in_ = Math.min(1, stomp * 4);
      x = lerp(x, side * 0.095, in_);
      y = lerp(y, 0.09 + stompHit * 0.015, in_);
      // …then folded across the chest in a huff.
      x = lerp(x, -side * 0.03, fold);
      y = lerp(y, side === 1 ? 0.175 : 0.158, fold);
      z = lerp(z, side === 1 ? 0.072 : 0.082, fold);
      rz = lerp(rz, side * 1.4, fold);
    }
    hx[i] = x; hy[i] = y; hz[i] = z; hrz[i] = rz; hrx[i] = rx;
    if (o.reach) reachHand(o, i);
  }

  const lag = rig.lag;
  if (o.dt !== undefined && lag[12] > 0) {
    // Follow-through: each hand chases its target on a damped spring, in
    // sub-steps small enough to stay stable on slow frames.
    const dt = Math.min(o.dt, 0.1);
    const n = Math.max(1, Math.ceil(dt / 0.012));
    const h = dt / n;
    const kk = SPRING_W * SPRING_W, cc = 2 * SPRING_Z * SPRING_W;
    if (o.kick) { lag[4] += o.kick; lag[10] += o.kick * 0.8; }
    for (let i = 0; i < 2; i++) {
      const b = i * 6;
      for (let s = 0; s < n; s++) {
        for (let c = 0; c < 3; c++) {
          const target = c === 0 ? hx[i] : c === 1 ? hy[i] : hz[i];
          const v = lag[b + 3 + c] + (-kk * (lag[b + c] - target) - cc * lag[b + 3 + c]) * h;
          lag[b + 3 + c] = v;
          lag[b + c] += v * h;
        }
      }
      hx[i] = lag[b]; hy[i] = lag[b + 1]; hz[i] = lag[b + 2];
    }
  } else {
    for (let i = 0; i < 2; i++) {
      const b = i * 6;
      lag[b] = hx[i]; lag[b + 1] = hy[i]; lag[b + 2] = hz[i];
      lag[b + 3] = lag[b + 4] = lag[b + 5] = 0;
    }
    lag[12] = 1;
  }
  handL.position.set(hx[0], hy[0], hz[0]);
  handL.rotation.set(hrx[0], 0, hrz[0]);
  handR.position.set(hx[1], hy[1], hz[1]);
  handR.rotation.set(hrx[1], 0, hrz[1]);

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
    if (crouch > 0) z -= crouch * 0.008;
    if (fidget > 0) {
      // The foot the weight came off shuffles out and back.
      const off = Math.max(0, -shift * side);
      y += off * 0.014;
      x += side * off * 0.012;
      foot.rotation.x = -off * 0.3;
    }
    if (side === 1 && taunt > 0) {
      // Weight on the right, left toe cocked out.
      x += taunt * 0.012;
      foot.rotation.x = -taunt * 0.25;
    }
    if (side === -1 && stomp > 0) {
      // Right foot stamps three times.
      y += Math.max(0, Math.sin(stomp * Math.PI * 6 + Math.PI)) * 0.045 * (1 - fold);
    }
    if (side === -1 && o.tap) {
      // Impatient: a toe-tap every half second or so, heel down.
      const tapIn = Math.min(1, o.tap);
      const k = Math.max(0, Math.sin(o.time * 7.5));
      y += k * 0.02 * tapIn;
      foot.rotation.x = -k * 0.55 * tapIn;
    }
    foot.position.set(x, y, z);
  }
  accentRig(rig, o);
}

// ---- move accents ------------------------------------------------------------
// The choreographed moves (moves.ts) steer the rig through a few generic
// channels on top of everything above: each hand can be pulled to an exact
// pose (and still trails on the spring), and the body, head and feet take
// extra angles and lifts. `mirror` flips the lot left for right.

/** Blend hand `i` (0 left, 1 right) toward its reach pose; runs before the spring. */
function reachHand(o: PoseInput, i: number) {
  const src = o.mirror ? 1 - i : i;
  const w = o.reach![src];
  if (!(w > 0) || !o.reachAt) return;
  const a = o.reachAt, b = src * 5, sx = o.mirror ? -1 : 1;
  hx[i] = lerp(hx[i], a[b] * sx, w);
  hy[i] = lerp(hy[i], a[b + 1], w);
  hz[i] = lerp(hz[i], a[b + 2], w);
  hrx[i] = lerp(hrx[i], a[b + 3], w);
  hrz[i] = lerp(hrz[i], a[b + 4] * sx, w);
}

/** Add the move's body, head and foot accents onto the posed rig. */
function accentRig(rig: Rig, o: PoseInput) {
  const { pose, head, footL, footR } = rig;
  if (!pose || !head) return;
  const sx = o.mirror ? -1 : 1;
  pose.rotation.x += o.lean ?? 0;
  pose.rotation.z += (o.tilt ?? 0) * sx;
  pose.rotation.y += (o.twist ?? 0) * sx;
  head.rotation.x += o.nod ?? 0;
  head.rotation.z += (o.cock ?? 0) * sx;
  const l = o.mirror ? o.liftR : o.liftL, r = o.mirror ? o.liftL : o.liftR;
  if (footL && l) { footL.position.y += l; footL.rotation.x -= l * 5; }
  if (footR && r) { footR.position.y += r; footR.rotation.x -= r * 5; }
}

// ---- emotes ----------------------------------------------------------------
// One-off reactions live in moves.ts (choreography) and moveFx.ts (props and
// sound); re-exported here for the board pieces and the gallery.
export { EMOTE_MS, EMOTE_OUT, emotePose, envelope, type EmoteKind } from './moves.ts';

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
