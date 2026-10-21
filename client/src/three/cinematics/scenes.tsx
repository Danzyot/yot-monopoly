// The cutscene scripts. Each scene renders its cast and hands the director an
// update(t) that poses everything for scene time t (ms): the camera shot,
// the cast, and the player's double. Shots cut hard between set-ups and ease
// inside them; each scene ends with the double exactly where, and as, the
// board piece will be when it is handed back.
//
//   jail      establishing (the patrol car skids up, cops jump out and grab)
//             → tracking (dragged to the cell, heels sliding, kicking)
//             → reaction (shoved in, the door slams, the cops dust off)
//   bankrupt  pockets turned out (a moth flies out) → the tow truck hauls the
//             houses away → the piece keels over and fades
//   winner    a podium rises, confetti → a trophy comes down into its hands
//             → a slow circle round the champion
//   jackpot   banknotes rain down on Free Parking while the piece jumps for joy

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { BoxGeometry, ConeGeometry, DoubleSide, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3, type Group } from 'three';
import type { CutsceneCue } from '../../../../shared/cutscenes.ts';
import type { CharacterId } from '../../../../shared/characters.ts';
import { C, jailOf, tile, tokenSpot } from '../layout.ts';
import { pieceObjects } from '../camera.ts';
import { poseRig } from '../characters/Figure.tsx';
import { jailDoor } from './store.ts';
import {
  CastPart, Cop, POCKET_GEO, PoliceCar, TowTruck, flashLights, makeBills, makeConfetti, makeDust, newCarRig, newCopPose, newCopRig,
  handL, handR, poseCop, restPose, rollWheels, type CopPose, type CopRig, type DoubleRig, type CarRig,
} from './actors.tsx';
import { bell, easeIn, easeInOut, easeOut, easeOutBack, lerp, onBoard, seg, turn, yawOf } from './util.ts';

export type LostProp = 'house' | 'hotel' | 'deed';

export interface Run {
  seq: number;
  cue: CutsceneCue;
  player: { id: string; character: CharacterId; color: string; name: string };
  n: number;
  /** Low graphics: a shorter cut with fewer actors. */
  low: boolean;
  /** Scene time = time since the start + offset (low graphics skip the opening shot). */
  offset: number;
  /** Length on screen (ms). */
  dur: number;
  /** The space the moment happens on (the arrest, the bankruptcy, the win, Free Parking). */
  tile: number;
  /** Where the piece stands when the cutscene starts, and its size on the board. */
  from: Vector3;
  scale: number;
  /** Bankrupt: what the tow truck takes away. */
  items: LostProp[];
  /** The board has the jail cell (JailCell) to drag the piece into. */
  jailCell: boolean;
  houseColor: string;
  hotelColor: string;
  currency: string;
  dbl: DoubleRig;
}

/** The camera this frame, as the scene wants it (the director blends it home at the end). */
export interface Shot { pos: Vector3; target: Vector3; shake: number }
export type SceneUpdate = (t: number, dt: number, time: number) => void;
export interface SceneCtx { run: Run; cam: Shot; update: MutableRefObject<SceneUpdate | null> }

/** Register this render's update with the director. */
function useUpdate(ctx: SceneCtx, fn: SceneUpdate) {
  const ref = useRef(fn);
  ref.current = fn;
  useLayoutEffect(() => {
    const call: SceneUpdate = (t, dt, time) => ref.current(t, dt, time);
    ctx.update.current = call;
    return () => { if (ctx.update.current === call) ctx.update.current = null; };
  }, [ctx]);
}

const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const UP = new Vector3(0, 1, 0);

function placeDouble(d: DoubleRig, x: number, y: number, z: number, yaw: number, lean: number, scale: number) {
  if (!d.root || !d.yaw || !d.lean || !d.scale) return;
  d.root.position.set(x, y, z);
  d.yaw.rotation.y = yaw;
  d.lean.rotation.x = lean;
  d.scale.scale.setScalar(scale);
}

function placeCop(c: CopRig, x: number, z: number, yaw: number, scale: number, visible = true) {
  if (!c.root || !c.yaw) return;
  c.root.visible = visible;
  c.root.position.set(x, 0, z);
  c.root.scale.setScalar(scale);
  c.yaw.rotation.y = yaw;
}

function placeCar(c: CarRig, p: Vector3, yaw: number, scale: number, visible = true) {
  if (!c.root) return;
  c.root.visible = visible;
  c.root.position.copy(p);
  c.root.rotation.y = yaw;
  c.root.scale.setScalar(scale);
}

function resetCop(p: CopPose) {
  p.stride = 0; p.lean = 0; p.hop = 0; p.look = 0; p.nod = 0; p.useL = false; p.useR = false;
}

/** The board piece right now (hidden while held), for where and how big the double ends up. */
function realPiece(id: string) {
  const o = pieceObjects.get(id);
  return o ? { pos: o.position, scale: o.children[0]?.scale.x ?? 0 } : null;
}

// ---------------------------------------------------------------------------
// Go to jail
// ---------------------------------------------------------------------------

const STRIP = 0.42; // JailCell's "just visiting" strip
const SIDE = C - STRIP;

export function JailScene({ ctx }: { ctx: SceneCtx }) {
  const { run, cam } = ctx;
  const d = run.dbl;
  const copA = useMemo(newCopRig, []);
  const copB = useMemo(newCopRig, []);
  const car = useMemo(newCarRig, []);
  const pa = useMemo(newCopPose, []);
  const pb = useMemo(newCopPose, []);
  const dust = useMemo(() => (run.low ? null : makeDust(24)), [run.low]);
  useEffect(() => () => dust?.dispose(), [dust]);
  const plan = useMemo(() => {
    const [ax, az] = tokenSpot(run.tile, 0, 1, false, run.n);
    const g = tile(run.tile, run.n);
    const J = tile(jailOf(run.n), run.n);
    const cell = { x: J.x + STRIP / 2, z: J.z - STRIP / 2 };
    const doorZ = cell.z - SIDE / 2;
    return { A: { x: ax, z: az }, along: g.along, out: g.out, cell, door: { x: cell.x, z: doorZ }, z0: doorZ - 2.1, z1: doorZ - 0.62 };
  }, [run]);
  const st = useRef({ carA: -4.6, dustAt: 0 });

  useUpdate(ctx, (T, dt, time) => {
    const S = run.scale;
    const CS = S * 1.08;
    const o = d.pose;
    restPose(o, time, dt);
    resetCop(pa);
    resetCop(pb);
    const { A, along: al, out: ou, cell, door } = plan;
    const real = realPiece(run.player.id);
    if (T < 1700) {
      // -- Shot 1: the arrest. The car skids up behind the piece, two cops pile out and grab it.
      const ka = lerp(-4.6, -1.3, easeOut(seg(T, 0, 800)));
      onBoard(v1, A, al, ou, ka, 0.06, 0);
      placeCar(car, v1, yawOf(al[0], al[1]), S);
      rollWheels(car, (ka - st.current.carA) / S);
      st.current.carA = ka;
      if (car.body) car.body.rotation.x = bell(T, 700, 1050) * 0.08;
      flashLights(car, T);
      const kOut = seg(T, 620, 780);
      const kRun = easeInOut(seg(T, 700, 1250));
      const face = seg(T, 1150, 1400);
      for (let i = 0; i < 2; i++) {
        const c = i ? copB : copA, p = i ? pb : pa, side = i ? -1 : 1;
        // From the car's doors to either side of the piece (the far one round the front of it).
        const ra = lerp(-1.3, side * 0.33, kRun);
        const ro = lerp(side * 0.44, 0.02, kRun ** 3);
        onBoard(v2, A, al, ou, ra, ro, 0);
        const heading = yawOf(al[0] * (1.3 + side * 0.33) - ou[0] * side * 0.42, al[1] * (1.3 + side * 0.33) - ou[1] * side * 0.42);
        const yaw = turn(heading, yawOf(-al[0] * side, -al[1] * side), face);
        placeCop(c, v2.x, v2.z, yaw, CS * easeOutBack(kOut), T > 620);
        p.phase = T * 0.02 + (side > 0 ? 0 : Math.PI);
        p.stride = T < 1250 ? 1.5 : 0;
        p.hop = bell(T, 620, 820) * 0.06;
        const reach = easeOut(seg(T, 1250, 1450));
        if (reach > 0) {
          handL(p, lerp(0.118, 0.06, reach), lerp(0.125, 0.19, reach), lerp(0.02, 0.1, reach));
          handR(p, lerp(-0.118, -0.06, reach), lerp(0.125, 0.19, reach), lerp(0.02, 0.1, reach));
          p.lean = 0.1 * reach;
        }
      }
      // The piece jumps out of its skin, then is held up by the arms.
      const startle = bell(T, 380, 680);
      placeDouble(d, A.x, startle * 0.14 + seg(T, 1300, 1500) * 0.02, A.z, yawOf(ou[0] + al[0] * 0.5, ou[1] + al[1] * 0.5), 0, S);
      o.handsUp = Math.max(seg(T, 360, 460) * 0.7, seg(T, 1250, 1450) * 0.9);
      o.squash = 1 + startle * 0.16;
      o.lids = 0;
      const k = easeInOut(seg(T, 0, 1700));
      onBoard(cam.pos, A, al, ou, lerp(1.0, 0.75, k), lerp(2.75, 2.25, k), lerp(1.2, 0.95, k));
      onBoard(cam.target, A, al, ou, -0.4, 0, 0.32);
      cam.shake = 0;
    } else if (T < 4200) {
      // -- Shot 2: dragged off to the cell, heels sliding, feet kicking.
      placeCar(car, v1, 0, S, false);
      const k = easeInOut(seg(T, 1750, 4000));
      const z = lerp(plan.z0, plan.z1, k);
      const x = door.x + Math.sin(T * 0.011) * 0.025;
      placeDouble(d, x, 0.015, z, Math.PI, -0.3, S);
      o.handsUp = 0.88;
      o.walk = (T / 420) % 1;
      o.stride = Math.floor(T / 420) % 2 ? 1 : -1;
      o.squash = 1 + Math.sin(T * 0.02) * 0.03;
      for (let i = 0; i < 2; i++) {
        const c = i ? copB : copA, p = i ? pb : pa, side = i ? 1 : -1;
        placeCop(c, x + side * 0.33, z + 0.05, 0, CS, side < 0 || !run.low);
        p.phase = T * 0.0125 + (side > 0 ? Math.PI : 0);
        p.stride = 1;
        p.lean = 0.14;
        if (side < 0) {
          handL(p, 0.09, 0.18, 0);
          handR(p, -0.1, 0.3 + Math.sin(T * 0.012) * 0.02, 0.06);
        } else handR(p, -0.09, 0.18, 0);
      }
      if (dust && T - st.current.dustAt > 95) {
        st.current.dustAt = T;
        dust.spawn(x + (Math.random() - 0.5) * 0.12, 0.02, z - 0.06, (Math.random() - 0.5) * 0.15, 0.1, -0.2, 0.8, 0.7 + Math.random() * 0.5);
      }
      // Tracking alongside, a step ahead, so the piece's face and both cops read.
      cam.pos.set(x + 1.05, 0.78, z - 1.95 + k * 0.15);
      cam.target.set(x - 0.08, 0.36, z + 0.3);
      cam.shake = 0;
      if (run.jailCell) jailDoor.angle = 1.55 * easeOut(seg(T, 3050, 3400));
    } else {
      // -- Shot 3: shoved into the cell, the door slams, the cops dust off their hands.
      placeCar(car, v1, 0, S, false);
      const fx = real ? real.pos.x : cell.x;
      const fz = real ? real.pos.z : cell.z;
      const ks = easeOut(seg(T, 4200, 4560));
      const endScale = real && real.scale > 0 ? real.scale : S;
      placeDouble(d, lerp(door.x, fx, ks), 0.015 * (1 - ks), lerp(plan.z1, fz, ks), Math.PI, lerp(-0.3, 0, seg(T, 4450, 4800)),
        lerp(S, endScale, seg(T, 4400, 5000)));
      o.handsUp = 0.88 * (1 - seg(T, 4450, 4800));
      o.slump = easeInOut(seg(T, 4800, 5450));
      d.tinter?.set(0.6 * seg(T, 4800, 5450), 1);
      const aside = easeInOut(seg(T, 4600, 4950));
      const spin = easeInOut(seg(T, 4800, 5150));
      for (let i = 0; i < 2; i++) {
        const c = i ? copB : copA, p = i ? pb : pa, side = i ? 1 : -1;
        // Then they take a step out to either side of the door, like a pair of guards.
        placeCop(c, door.x + side * (0.33 + aside * 0.16), plan.z1 + 0.05 + aside * 0.12, side * spin * Math.PI, CS, side < 0 || !run.low);
        p.phase = T * 0.012;
        p.stride = bell(T, 4600, 4950) * 0.8;
        const shove = bell(T, 4200, 4520);
        if (T < 4700) {
          handL(p, 0.08, 0.18, shove * 0.08);
          handR(p, -0.08, 0.18, shove * 0.08);
          p.lean = 0.14 + shove * 0.15;
        } else if (side < 0) {
          // The sergeant taps his baton in his palm.
          handR(p, -0.05, 0.165 + Math.abs(Math.sin(T * 0.011)) * 0.035, 0.08);
          handL(p, 0.03, 0.15, 0.085);
          p.nod = 0.08;
        } else {
          // The rookie dusts off his gloves.
          const w = Math.sin(T * 0.035) * 0.015;
          handL(p, 0.035 + w, 0.15, 0.085);
          handR(p, -0.035 + w, 0.15, 0.085);
          p.look = -0.25;
        }
      }
      if (run.jailCell) {
        jailDoor.angle = T < 4560 ? 1.55
          : T < 4700 ? 1.55 * (1 - easeIn(seg(T, 4560, 4700)))
          : Math.sin(seg(T, 4700, 4900) * Math.PI) * 0.12;
      }
      cam.shake = T >= 4700 ? 0.035 * (1 - seg(T, 4700, 5050)) : 0;
      cam.pos.set(door.x + 0.15, 0.82, door.z - lerp(2.5, 2.1, easeOut(seg(T, 4200, 5900))));
      cam.target.set(cell.x, 0.3, cell.z - 0.45);
    }
    poseCop(copA, pa);
    poseCop(copB, pb);
    dust?.update(dt);
    poseRig(d.rig, o);
  });

  return (
    <>
      <Suspense fallback={null}>
        {!run.low && <PoliceCar rig={car} />}
        <Cop rig={copA} variant="A" baton />
        {!run.low && <Cop rig={copB} variant="B" />}
      </Suspense>
      {dust && <primitive object={dust.mesh} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bankrupt
// ---------------------------------------------------------------------------

const houseBody = new BoxGeometry(0.13, 0.12, 0.15);
const houseRoof = new ConeGeometry(0.115, 0.09, 4);
const hotelBody = new BoxGeometry(0.3, 0.18, 0.18);
const deedCard = new BoxGeometry(0.12, 0.006, 0.16);
const deedBand = new BoxGeometry(0.12, 0.007, 0.04);
const mothWing = new PlaneGeometry(0.05, 0.035);

function Prop({ kind, mats, groupRef }: { kind: LostProp; mats: Record<'house' | 'hotel' | 'white' | 'band', MeshStandardMaterial>; groupRef: (g: Group | null) => void }) {
  return (
    <group ref={groupRef}>
      {kind === 'house' && <>
        <mesh geometry={houseBody} material={mats.house} position={[0, 0.06, 0]} castShadow />
        <mesh geometry={houseRoof} material={mats.house} position={[0, 0.165, 0]} rotation={[0, Math.PI / 4, 0]} castShadow />
      </>}
      {kind === 'hotel' && <>
        <mesh geometry={hotelBody} material={mats.hotel} position={[0, 0.09, 0]} castShadow />
        <mesh geometry={houseRoof} material={mats.hotel} position={[0, 0.215, 0]} scale={[1.6, 0.8, 1]} rotation={[0, Math.PI / 4, 0]} />
      </>}
      {kind === 'deed' && <>
        <mesh geometry={deedCard} material={mats.white} position={[0, 0.004, 0]} castShadow />
        <mesh geometry={deedBand} material={mats.band} position={[0, 0.006, -0.055]} />
      </>}
    </group>
  );
}

/** Where item i rides on the tow truck's flatbed (truck model space). */
const BED: [number, number][] = [[0.075, -0.1], [-0.075, -0.1], [0.075, -0.3], [-0.075, -0.3]];

export function BankruptScene({ ctx }: { ctx: SceneCtx }) {
  const { run, cam } = ctx;
  const d = run.dbl;
  const truck = useMemo(newCarRig, []);
  const mats = useMemo(() => ({
    house: new MeshStandardMaterial({ color: run.houseColor, roughness: 0.4 }),
    hotel: new MeshStandardMaterial({ color: run.hotelColor, roughness: 0.4 }),
    white: new MeshStandardMaterial({ color: '#f7f4ea', roughness: 0.6 }),
    band: new MeshStandardMaterial({ color: run.player.color, roughness: 0.5 }),
    pocket: new MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.85, transparent: true }),
    moth: new MeshStandardMaterial({ color: '#cfc7b8', roughness: 0.9, side: DoubleSide, transparent: true }),
  }), [run]);
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose(); }, [mats]);
  const items = useRef<(Group | null)[]>([]);
  // Pockets hang off the hips of the figure's own pose group, so they lean and fall with it.
  const pockets = useMemo(() => [new Mesh(POCKET_GEO, mats.pocket), new Mesh(POCKET_GEO, mats.pocket)], [mats]);
  useEffect(() => {
    const pose = d.rig.pose;
    if (!pose) return;
    for (const pk of pockets) { pk.visible = false; pose.add(pk); }
    return () => { for (const pk of pockets) pose.remove(pk); };
  }, [d, pockets]);
  const moth = useRef<Group | null>(null);
  const wings = useRef<(Mesh | null)[]>([null, null]);
  const st = useRef({ a: -3.8 });
  const g = useMemo(() => tile(run.tile, run.n), [run]);
  const P = run.from;
  const S = run.scale;
  const face = yawOf(g.out[0] + g.along[0] * 0.3, g.out[1] + g.along[1] * 0.3);

  useUpdate(ctx, (T, dt, time) => {
    const o = d.pose;
    restPose(o, time, dt);
    const al = g.along, ou = g.out;
    placeDouble(d, P.x, 0, P.z, face, 0, S);
    // Pockets turned out (they hang off the hips of the figure's own pose, so they fall with it).
    const pop = easeOutBack(seg(T, 450, 750));
    let fade = 1;
    if (T < 1900) {
      // -- Shot 1: patting down empty pockets; a moth flutters out.
      o.shrug = bell(T, 100, 1000);
      o.sad = seg(T, 950, 1350);
      const k = easeInOut(seg(T, 0, 1900));
      onBoard(cam.pos, P, al, ou, 0.3, lerp(1.4, 1.15, k), 0.55);
      cam.target.set(P.x, 0.3, P.z);
    } else if (T < 4000) {
      // -- Shot 2: the tow truck hauls the houses away.
      o.sad = 1;
      o.look = 0.75 * seg(T, 1950, 2300) - 1.2 * seg(T, 3450, 3950);
      onBoard(cam.pos, P, al, ou, -1.25, 2.25, 1.05);
      onBoard(cam.target, P, al, ou, 0.45, -0.35, 0.25);
    } else {
      // -- Shot 3: it keels over and fades away.
      o.sad = 1 - seg(T, 4100, 4300);
      o.lie = easeInOut(seg(T, 4150, 4750));
      fade = 1 - seg(T, 4800, 5250);
      onBoard(cam.pos, P, al, ou, -0.4, 1.1, 0.45);
      cam.target.set(P.x, 0.15, P.z);
    }
    d.tinter?.set(0.85 * seg(T, 4000, 4700), fade);
    mats.pocket.opacity = fade;
    for (let i = 0; i < pockets.length; i++) {
      const pk = pockets[i];
      pk.visible = pop > 0.01 && fade > 0.02;
      pk.scale.set(0.022 * pop, 0.03 * pop, 0.016 * pop);
      pk.position.set(i ? -0.074 : 0.074, 0.088 - 0.012 * pop, 0.014);
    }
    // The moth: out of the left pocket, fluttering up and away.
    if (moth.current) {
      const m = seg(T, 850, 1900);
      moth.current.visible = m > 0 && m < 1 && !run.low;
      v1.set(0.074 * S, 0.09 * S, 0.02 * S).applyAxisAngle(UP, face);
      moth.current.position.set(P.x + v1.x + Math.sin(m * 9) * 0.07, v1.y + m * 0.85, P.z + v1.z + Math.cos(m * 7) * 0.05);
      moth.current.rotation.y = time * 2;
      const flap = 0.25 + Math.sin(time * 55) * 0.8;
      if (wings.current[0]) wings.current[0].rotation.z = flap;
      if (wings.current[1]) wings.current[1].rotation.z = -flap;
    }
    // The truck drives in, stops beside the piece, takes the goods and pulls away.
    let a = lerp(-3.8, 0.35, easeOut(seg(T, 1900, 2650)));
    a += easeIn(seg(T, 3450, 4000)) * 4.5;
    const tyaw = yawOf(al[0], al[1]);
    onBoard(v1, P, al, ou, a, -0.62, 0);
    placeCar(truck, v1, tyaw, S, T >= 1900 && T < 4000);
    rollWheels(truck, (a - st.current.a) / S);
    st.current.a = a;
    if (truck.body) truck.body.rotation.x = bell(T, 2550, 2800) * 0.05;
    flashLights(truck, T);
    const cos = Math.cos(tyaw), sin = Math.sin(tyaw);
    for (let i = 0; i < items.current.length; i++) {
      const it = items.current[i];
      if (!it) continue;
      const at = 2750 + i * 170;
      const k = easeInOut(seg(T, at, at + 380));
      const [lx, lz] = BED[i];
      // The slot on the bed, in the world.
      v2.set(v1.x + (lx * cos + lz * sin) * S, 0.13 * S, v1.z + (-lx * sin + lz * cos) * S);
      v3.set(P.x, 0.3, P.z);
      it.visible = T > at - 120 && T < 4000;
      it.position.lerpVectors(v3, v2, k);
      it.position.y += bell(T, at, at + 380) * 0.45;
      it.rotation.y = tyaw + (1 - k) * 4;
      it.scale.setScalar(easeOutBack(seg(T, at - 120, at)));
    }
    poseRig(d.rig, o);
  });

  return (
    <>
      <Suspense fallback={null}><TowTruck rig={truck} /></Suspense>
      {run.items.map((k, i) => (
        <Prop key={i} kind={k} mats={mats} groupRef={gr => { items.current[i] = gr; }} />
      ))}
      <group ref={moth} visible={false}>
        <mesh ref={m => { wings.current[0] = m; }} geometry={mothWing} material={mats.moth} position={[0.022, 0, 0]} />
        <mesh ref={m => { wings.current[1] = m; }} geometry={mothWing} material={mats.moth} position={[-0.022, 0, 0]} />
      </group>
    </>
  );
}

// ---------------------------------------------------------------------------
// Winner
// ---------------------------------------------------------------------------

const PODIUM_TOP = 0.206;

export function WinnerScene({ ctx }: { ctx: SceneCtx }) {
  const { run, cam } = ctx;
  const d = run.dbl;
  const confetti = useMemo(() => makeConfetti(run.low ? 70 : 160), [run.low]);
  useEffect(() => () => confetti.dispose(), [confetti]);
  const podium = useRef<Group | null>(null);
  const trophy = useRef<Group | null>(null);
  const st = useRef({ burst: false, drizzle: 0 });
  const g = useMemo(() => tile(run.tile, run.n), [run]);
  const P = run.from;
  const S = run.scale;
  const face = yawOf(g.out[0] + g.along[0] * 0.25, g.out[1] + g.along[1] * 0.25);

  useUpdate(ctx, (T, dt, time) => {
    const o = d.pose;
    restPose(o, time, dt);
    const al = g.along, ou = g.out;
    const top = PODIUM_TOP * S;
    const rise = easeOutBack(seg(T, 250, 1050));
    const sink = easeIn(seg(T, 5300, 5800));
    const podY = (top + 0.02) * (rise - sink - 1);
    if (podium.current) {
      podium.current.position.set(P.x, podY, P.z);
      podium.current.rotation.y = face;
      podium.current.scale.setScalar(S);
    }
    placeDouble(d, P.x, Math.max(0, podY + top), P.z, face, 0, S);
    // Confetti: one big burst as the podium tops out, then a drizzle.
    if (T >= 1000 && !st.current.burst) {
      st.current.burst = true;
      confetti.burst(P.x, 1.6, P.z, run.low ? 45 : 100, 2.4, 3.4);
    }
    if (T > 1100 && T < 5000 && T - st.current.drizzle > (run.low ? 90 : 40)) {
      st.current.drizzle = T;
      confetti.rain(P.x, P.z, 1.3, 2.2, 1, 3);
    }
    confetti.update(dt);
    o.handsUp = Math.max(seg(T, 600, 900) * 0.7 * (1 - seg(T, 1900, 2200)), seg(T, 2600, 2900)) * (1 - seg(T, 5250, 5600));
    o.cheer = T >= 1000 && T < 1900 ? ((T - 1000) / 600) % 1 : T >= 2950 && T < 5250 ? ((T - 2950) / 650) % 1 : 0;
    o.squash = 1 + bell(T, 1050, 1250) * 0.08;
    // The trophy comes down into its hands, then is held high.
    if (trophy.current) {
      const tr = trophy.current;
      tr.visible = T >= 2100 && T < 5600;
      const { handL, handR } = d.rig;
      if (handL && handR) {
        handL.getWorldPosition(v1);
        handR.getWorldPosition(v2);
        v1.add(v2).multiplyScalar(0.5);
        v1.y -= 0.035 * S;
      } else v1.set(P.x, top + 0.5 * S, P.z);
      const k = easeOut(seg(T, 2100, 2900));
      v2.set(P.x, top + 2.2, P.z);
      tr.position.lerpVectors(v2, v1, k);
      tr.rotation.y = face + (1 - k) * 8;
      tr.scale.setScalar(S * 1.15 * (1 - easeIn(seg(T, 5300, 5600))));
    }
    if (T < 2000) {
      const k = easeInOut(seg(T, 0, 2000));
      onBoard(cam.pos, P, al, ou, 1.15, lerp(2.7, 2.3, k), lerp(1.3, 1.1, k));
      cam.target.set(P.x, 0.5, P.z);
    } else if (T < 3800) {
      // Low and looking up: the hero shot.
      onBoard(cam.pos, P, al, ou, 0.45, 2.0 - 0.25 * seg(T, 2000, 3800), 0.42);
      cam.target.set(P.x, top + 0.62, P.z);
    } else {
      const a = Math.atan2(ou[0], ou[1]) + 0.35 + 1.25 * easeInOut(seg(T, 3800, 6000));
      cam.pos.set(P.x + Math.sin(a) * 1.9, 0.95, P.z + Math.cos(a) * 1.9);
      cam.target.set(P.x, 0.45 + top * 0.5 * (1 - sink), P.z);
    }
    cam.shake = 0;
    poseRig(d.rig, o);
  });

  return (
    <>
      <Suspense fallback={null}>
        <CastPart name="Podium" groupRef={gr => { podium.current = gr; }} />
        <CastPart name="Trophy" groupRef={gr => { trophy.current = gr; if (gr) gr.visible = false; }} />
      </Suspense>
      <primitive object={confetti.mesh} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Free Parking jackpot
// ---------------------------------------------------------------------------

export function JackpotScene({ ctx }: { ctx: SceneCtx }) {
  const { run, cam } = ctx;
  const d = run.dbl;
  const bills = useMemo(() => makeBills(run.low ? 50 : 120, run.currency), [run]);
  useEffect(() => () => bills.dispose(), [bills]);
  const st = useRef({ last: 0, burst: false });
  const g = useMemo(() => tile(run.tile, run.n), [run]);
  const P = run.from;
  const S = run.scale;
  const face = yawOf(g.out[0] + g.along[0] * 0.3, g.out[1] + g.along[1] * 0.3);

  useUpdate(ctx, (T, dt, time) => {
    const o = d.pose;
    restPose(o, time, dt);
    // The pot bursts out of the space like a fountain, then it rains banknotes.
    if (T > 120 && !st.current.burst) {
      st.current.burst = true;
      bills.burst(P.x, 0.15, P.z, run.low ? 14 : 30, 2.6, 2.8);
    }
    if (T > 250 && T < 2700 && T - st.current.last > (run.low ? 70 : 28)) {
      st.current.last = T;
      bills.rain(P.x, P.z, 0.95, 1.55, 1, 2.4);
    }
    bills.update(dt);
    const joy = seg(T, 350, 500) * (1 - seg(T, 3100, 3400));
    const hop = Math.abs(Math.sin(Math.max(0, T - 350) * 0.0085));
    placeDouble(d, P.x, hop * 0.14 * joy, P.z, face, 0, S);
    o.handsUp = joy;
    o.cheer = joy > 0 ? ((T - 350) / 370) % 1 : 0;
    o.squash = 1 + (hop < 0.25 ? (0.25 - hop) * -0.5 : hop * 0.08) * joy;
    const k = easeInOut(seg(T, 0, 3800));
    onBoard(cam.pos, P, g.along, g.out, 0.55, lerp(2.1, 1.45, k), lerp(1.6, 0.75, k));
    cam.target.set(P.x, 0.35, P.z);
    cam.shake = 0;
    poseRig(d.rig, o);
  });

  return <primitive object={bills.mesh} />;
}
