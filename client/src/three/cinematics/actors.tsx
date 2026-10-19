// The cutscene cast. Cops, their patrol car, the tow truck, the trophy and
// the podium come from cops.glb (tools/blender/cops.py), fetched the first
// time a cutscene needs them; arms and legs are drawn live between the
// modelled hands, feet and body, like the characters'. The player's own piece
// is played by a double (PieceDouble) on the same rig as the board piece, so
// the cutscene can pose it freely and hand it back looking exactly the same.
// Particles (confetti, banknotes, dust) are one instanced mesh each, built
// once and recycled; nothing here allocates per frame.

import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo, type ReactNode } from 'react';
import {
  CanvasTexture, Color, CylinderGeometry, DoubleSide, IcosahedronGeometry, InstancedMesh, Mesh, MeshStandardMaterial, Object3D,
  PlaneGeometry, SRGBColorSpace, SphereGeometry, Vector3, type BufferGeometry, type Group, type Material,
} from 'three';
import { ASSETS } from '../assets.gen.ts';
import { CharacterFigure, Tinter, newRig, useCharacterMaterials, type PoseInput, type Rig } from '../characters/Figure.tsx';
import type { CharacterId } from '../../../../shared/characters.ts';

const COPS_URL = ASSETS.cops.url;
let copsAsked = false;
let copsReady = false;

/** Start fetching cops.glb (once); the first cutscene that needs it asks. */
export function preloadCast() {
  if (copsAsked) return;
  copsAsked = true;
  useGLTF.preload(COPS_URL);
}
export const castReady = () => copsReady;

/** Mounted inside Suspense while a cutscene is lined up: marks cops.glb as in once it is. */
export function CastLoader() {
  useGLTF(COPS_URL);
  useEffect(() => { copsReady = true; }, []);
  return null;
}

function part(scene: Object3D, name: string, shadow = true): Object3D {
  const src = scene.getObjectByName(name);
  if (!src) throw new Error(`cops.glb has no ${name}`);
  const o = src.clone(true);
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  o.traverse(m => { if ((m as Mesh).isMesh) (m as Mesh).castShadow = shadow; });
  return o;
}

function findMaterial(scene: Object3D, name: string): Material {
  let found: Material | null = null;
  scene.traverse(o => {
    const m = o as Mesh;
    if (found || !m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat.name === name) found = mat;
  });
  return found ?? new MeshStandardMaterial({ color: '#25386e' });
}

/** Give a part its own copies of its materials (so it can glow on its own); returns them for disposal. */
function ownMaterials(o: Object3D): MeshStandardMaterial[] {
  const out: MeshStandardMaterial[] = [];
  o.traverse(c => {
    const m = c as Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as MeshStandardMaterial).clone();
    m.material = mat;
    out.push(mat);
  });
  return out;
}

// ---- limbs -----------------------------------------------------------------

/** A unit cylinder along y, stretched between two points each frame. */
const LIMB = new CylinderGeometry(1, 1, 1, 10, 1);
const UP = new Vector3(0, 1, 0);
const tA = new Vector3();
const tB = new Vector3();

function stretch(mesh: Mesh | null, a: Vector3, b: Vector3, r: number) {
  if (!mesh) return;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  tB.subVectors(b, a);
  const len = tB.length();
  if (len < 1e-5) return;
  mesh.quaternion.setFromUnitVectors(UP, tB.multiplyScalar(1 / len));
  mesh.scale.set(r, len, r);
}

// ---- cops ------------------------------------------------------------------

const HEAD_Y = 0.335;
const HAND: [number, number, number] = [0.118, 0.125, 0.02];
const FOOT: [number, number, number] = [0.045, 0, 0.012];
const SHOULDER = new Vector3(0.085, 0.222, 0);
const HIP_X = 0.04;
const HIP_Y = 0.085;

export interface CopRig {
  root: Group | null; yaw: Group | null; body: Group | null; head: Group | null;
  handL: Group | null; handR: Group | null; footL: Group | null; footR: Group | null;
  armL: Mesh | null; armR: Mesh | null; legL: Mesh | null; legR: Mesh | null;
}
export const newCopRig = (): CopRig => ({
  root: null, yaw: null, body: null, head: null, handL: null, handR: null, footL: null, footR: null,
  armL: null, armR: null, legL: null, legR: null,
});

/** How a cop stands this frame. Hands are in the cop's own (model) space. */
export interface CopPose {
  /** Walk cycle (radians) and stride (0 standing still, 1 a brisk march, more to run). */
  phase: number;
  stride: number;
  /** Forward lean (radians) and a jump off the ground (model units). */
  lean: number;
  hop: number;
  /** Head turn (+ to its left) and nod (+ down). */
  look: number;
  nod: number;
  /** Placed hands (when useL / useR), otherwise they swing with the walk. */
  hl: Vector3;
  hr: Vector3;
  useL: boolean;
  useR: boolean;
}
export const newCopPose = (): CopPose => ({
  phase: 0, stride: 0, lean: 0, hop: 0, look: 0, nod: 0, hl: new Vector3(), hr: new Vector3(), useL: false, useR: false,
});
/** Put a cop's left / right glove at (x, y, z) in its own space this frame. */
export function handL(p: CopPose, x: number, y: number, z: number) { p.hl.set(x, y, z); p.useL = true; }
export function handR(p: CopPose, x: number, y: number, z: number) { p.hr.set(x, y, z); p.useR = true; }

export function poseCop(rig: CopRig, p: CopPose) {
  const { body, head, handL, handR, footL, footR } = rig;
  if (!body || !head || !handL || !handR || !footL || !footR) return;
  const s = Math.sin(p.phase);
  const bob = Math.abs(Math.cos(p.phase)) * 0.012 * Math.min(1, p.stride);
  body.position.y = bob + p.hop;
  body.rotation.x = p.lean;
  head.rotation.set(p.nod, p.look, 0);
  const swing = 0.05 * p.stride;
  if (p.useL) handL.position.copy(p.hl);
  else handL.position.set(HAND[0], HAND[1] + Math.max(0, -s) * 0.015 * p.stride, HAND[2] - s * swing);
  if (p.useR) handR.position.copy(p.hr);
  else handR.position.set(-HAND[0], HAND[1] + Math.max(0, s) * 0.015 * p.stride, HAND[2] + s * swing);
  // Feet: one forward and lifting while the other plants and slides back.
  const step = 0.05 * p.stride;
  footL.position.set(FOOT[0], Math.max(0, s) * 0.035 * Math.min(1.4, p.stride) + p.hop, FOOT[2] + s * step);
  footR.position.set(-FOOT[0], Math.max(0, -s) * 0.035 * Math.min(1.4, p.stride) + p.hop, FOOT[2] - s * step);
  footL.rotation.x = -Math.max(0, s) * 0.35 * p.stride;
  footR.rotation.x = -Math.max(0, -s) * 0.35 * p.stride;
  // Sleeves from the shoulders to the gloves (body space), trouser legs from the hips to the boots.
  stretch(rig.armL, SHOULDER, handL.position, 0.021);
  stretch(rig.armR, tA.set(-SHOULDER.x, SHOULDER.y, SHOULDER.z), handR.position, 0.021);
  stretch(rig.legL, tA.set(HIP_X, HIP_Y + body.position.y, 0), tmpAnkle.copy(footL.position).setY(footL.position.y + 0.03), 0.025);
  stretch(rig.legR, tA.set(-HIP_X, HIP_Y + body.position.y, 0), tmpAnkle.copy(footR.position).setY(footR.position.y + 0.03), 0.025);
}
const tmpAnkle = new Vector3();

export function Cop({ rig, variant, baton }: { rig: CopRig; variant: 'A' | 'B'; baton?: boolean }) {
  const { scene } = useGLTF(COPS_URL);
  const parts = useMemo(() => ({
    body: part(scene, 'CopBody'),
    head: part(scene, `CopHead${variant}`),
    handL: part(scene, 'CopHandL'),
    handR: part(scene, 'CopHandR'),
    footL: part(scene, 'CopFootL', false),
    footR: part(scene, 'CopFootR', false),
    baton: baton ? part(scene, 'CopBaton') : null,
  }), [scene, variant, baton]);
  const sleeve = useMemo(() => findMaterial(scene, 'cop:navy'), [scene]);
  const pants = useMemo(() => findMaterial(scene, 'cop:pants'), [scene]);
  return (
    <group ref={g => { rig.root = g; }}>
      <group ref={g => { rig.yaw = g; }}>
        <group ref={g => { rig.body = g; }}>
          <primitive object={parts.body} />
          <group ref={g => { rig.head = g; }} position={[0, HEAD_Y, 0]}><primitive object={parts.head} /></group>
          <group ref={g => { rig.handL = g; }} position={HAND}><primitive object={parts.handL} /></group>
          <group ref={g => { rig.handR = g; }} position={[-HAND[0], HAND[1], HAND[2]]}>
            <primitive object={parts.handR} />
            {parts.baton && <primitive object={parts.baton} position={[0, -0.005, 0.012]} rotation={[1.1, 0, 0]} />}
          </group>
          <mesh ref={m => { rig.armL = m; }} geometry={LIMB} material={sleeve} castShadow />
          <mesh ref={m => { rig.armR = m; }} geometry={LIMB} material={sleeve} castShadow />
        </group>
        <group ref={g => { rig.footL = g; }} position={FOOT}><primitive object={parts.footL} /></group>
        <group ref={g => { rig.footR = g; }} position={[-FOOT[0], FOOT[1], FOOT[2]]}><primitive object={parts.footR} /></group>
        <mesh ref={m => { rig.legL = m; }} geometry={LIMB} material={pants} />
        <mesh ref={m => { rig.legR = m; }} geometry={LIMB} material={pants} />
      </group>
    </group>
  );
}

// ---- vehicles ----------------------------------------------------------------

export const WHEEL_R = 0.063;

export interface CarRig {
  root: Group | null;
  /** Pitches on braking. */
  body: Group | null;
  wheels: (Group | null)[];
  /** Light-bar domes (red, blue) or the tow truck's beacon. */
  lights: MeshStandardMaterial[];
}
export const newCarRig = (): CarRig => ({ root: null, body: null, wheels: [null, null, null, null], lights: [] });

function Vehicle({ rig, body, lights, wheels }: { rig: CarRig; body: string; lights: string[]; wheels: [number, number, number][] }) {
  const { scene } = useGLTF(COPS_URL);
  const parts = useMemo(() => {
    const lamps = lights.map(n => part(scene, n, false));
    return { body: part(scene, body), lamps, mats: lamps.flatMap(ownMaterials), wheels: wheels.map(() => part(scene, 'CarWheel')) };
  }, [scene, body, lights, wheels]);
  useEffect(() => () => { for (const m of parts.mats) m.dispose(); }, [parts]);
  rig.lights = parts.mats;
  return (
    <group ref={g => { rig.root = g; }}>
      <group ref={g => { rig.body = g; }}>
        <primitive object={parts.body} />
        {parts.lamps.map((l, i) => <primitive key={i} object={l} />)}
      </group>
      {wheels.map((w, i) => (
        <group key={i} position={w} scale={[w[0] > 0 ? -1 : 1, 1, 1]}>
          <group ref={g => { rig.wheels[i] = g; }}><primitive object={parts.wheels[i]} /></group>
        </group>
      ))}
    </group>
  );
}

const CAR_WHEELS: [number, number, number][] = [[0.17, WHEEL_R, 0.22], [-0.17, WHEEL_R, 0.22], [0.17, WHEEL_R, -0.22], [-0.17, WHEEL_R, -0.22]];
const TRUCK_WHEELS: [number, number, number][] = [[0.17, WHEEL_R, 0.33], [-0.17, WHEEL_R, 0.33], [0.17, WHEEL_R, -0.28], [-0.17, WHEEL_R, -0.28]];
const CAR_LIGHTS = ['CarSirenRed', 'CarSirenBlue'];
const TRUCK_LIGHTS = ['TruckBeacon'];

export const PoliceCar = ({ rig }: { rig: CarRig }) => <Vehicle rig={rig} body="CarBody" lights={CAR_LIGHTS} wheels={CAR_WHEELS} />;
export const TowTruck = ({ rig }: { rig: CarRig }) => <Vehicle rig={rig} body="TruckBody" lights={TRUCK_LIGHTS} wheels={TRUCK_WHEELS} />;

/** Roll the wheels by `dist` (model units travelled). */
export function rollWheels(rig: CarRig, dist: number) {
  for (const w of rig.wheels) if (w) w.rotation.x += dist / WHEEL_R;
}

/** Siren lights: red and blue taking turns in quick double flashes (or one beacon pulsing). */
export function flashLights(rig: CarRig, t: number) {
  const [a, b] = rig.lights;
  const beat = Math.floor(t / 90) % 8;
  const on = (k: number) => (k === 0 || k === 2 ? 4.5 : 0.25);
  if (a && b) {
    a.emissiveIntensity = on(beat);
    b.emissiveIntensity = on((beat + 4) % 8);
  } else if (a) a.emissiveIntensity = 0.6 + Math.max(0, Math.sin(t / 70)) * 3.5;
}

// ---- trophy and podium ---------------------------------------------------------

export function CastPart({ name, groupRef, children }: { name: 'Trophy' | 'Podium'; groupRef: (g: Group | null) => void; children?: ReactNode }) {
  const { scene } = useGLTF(COPS_URL);
  const obj = useMemo(() => part(scene, name), [scene, name]);
  return <group ref={groupRef}><primitive object={obj} />{children}</group>;
}

// ---- the piece's double ------------------------------------------------------------

export interface DoubleRig {
  root: Group | null;
  yaw: Group | null;
  /** Lean (rotation x: + forward) about the feet. */
  lean: Group | null;
  scale: Group | null;
  rig: Rig;
  pose: PoseInput;
  tinter: Tinter | null;
}
export const newDouble = (): DoubleRig => ({
  root: null, yaw: null, lean: null, scale: null, rig: newRig(), tinter: null,
  pose: { time: 0, phase: 0, slump: 0, lie: 0, handsUp: 0, squash: 1 },
});

/** Clear the pose for a fresh frame (everything optional back to off). */
export function restPose(o: PoseInput, time: number, dt: number) {
  o.time = time; o.phase = 0; o.slump = 0; o.lie = 0; o.handsUp = 0; o.squash = 1; o.dt = dt;
  o.walk = undefined; o.stride = 1; o.look = 0; o.wave = 0; o.pump = 0; o.sad = 0; o.stomp = 0; o.tap = undefined;
  o.lids = 0; o.cheer = 0; o.crouch = 0; o.shrug = 0; o.stretch = 0; o.fidget = 0; o.taunt = 0; o.kick = 0;
}

export function PieceDouble({ d, character, color, chogToken, children }: {
  d: DoubleRig; character: CharacterId; color: string;
  /** A holder's own Chog Genesis token: the double wears its traits, as the board piece does. */
  chogToken?: number;
  children?: ReactNode;
}) {
  const mats = useCharacterMaterials(character, color, chogToken);
  const tinter = useMemo(() => new Tinter(mats), [mats]);
  d.tinter = tinter;
  return (
    <group ref={g => { d.root = g; }}>
      <group ref={g => { d.yaw = g; }}>
        <group ref={g => { d.lean = g; }}>
          <group ref={g => { d.scale = g; }}>
            <CharacterFigure id={character} mats={mats} rig={d.rig} chogToken={chogToken} />
            {children}
          </group>
        </group>
      </group>
    </group>
  );
}

// ---- particles ---------------------------------------------------------------

const dummy = new Object3D();
const tmpColor = new Color();

export interface ParticleLook {
  /** Down-pull (units/s²), air drag (1/s), sideways flutter (units/s) and how fast they tumble. */
  gravity: number;
  drag: number;
  flutter: number;
  tumble: number;
  /** Scale growth per second (dust swells), and whether they settle flat on the board. */
  grow: number;
  settle: boolean;
}

/** A fixed pool of instanced particles, recycled oldest first. */
export class Particles {
  readonly mesh: InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private next = 0;
  private live = 0;
  private time = 0;

  constructor(readonly count: number, geo: BufferGeometry, mat: Material, colors: string[], private look: ParticleLook) {
    this.mesh = new InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.rot = new Float32Array(count * 3);
    this.spin = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, tmpColor.set(colors[i % colors.length]));
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
  }

  /** One particle at (x, y, z) moving at (vx, vy, vz), living `life` seconds. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size = 1) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    for (let k = 0; k < 3; k++) {
      this.rot[i * 3 + k] = Math.random() * Math.PI * 2;
      this.spin[i * 3 + k] = (Math.random() - 0.5) * this.look.tumble;
    }
    this.life[i] = life;
    this.size[i] = size;
    this.live = this.count;
  }

  /** A burst from a point: `k` particles flung up and out. */
  burst(x: number, y: number, z: number, k: number, speed: number, life: number) {
    for (let j = 0; j < k; j++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.55 + Math.random() * 0.45;
      const v = speed * (0.5 + Math.random() * 0.5);
      this.spawn(x, y, z, Math.cos(a) * v * (1 - up * 0.6), v * up, Math.sin(a) * v * (1 - up * 0.6), life * (0.7 + Math.random() * 0.5));
    }
  }

  /** Falling in from above, anywhere within `r` of (x, z). */
  rain(x: number, z: number, r: number, y: number, k: number, life: number) {
    for (let j = 0; j < k; j++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this.spawn(x + Math.cos(a) * d, y + Math.random() * 0.4, z + Math.sin(a) * d, 0, -0.3 - Math.random() * 0.3, 0, life * (0.8 + Math.random() * 0.4));
    }
  }

  update(dt: number) {
    if (!this.live) return;
    this.time += dt;
    const { gravity, drag, flutter, grow, settle } = this.look;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      let l = this.life[i];
      if (l <= 0) continue;
      l -= dt;
      this.life[i] = l;
      const j = i * 3;
      if (l <= 0) {
        dummy.scale.setScalar(0);
        dummy.position.set(0, -10, 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      alive++;
      const grounded = settle && this.pos[j + 1] <= 0.004;
      if (!grounded) {
        this.vel[j + 1] -= gravity * dt;
        const k = Math.exp(-drag * dt);
        this.vel[j] *= k; this.vel[j + 1] *= k; this.vel[j + 2] *= k;
        const f = flutter * Math.sin(this.time * 5 + i * 1.7);
        this.pos[j] += (this.vel[j] + f) * dt;
        this.pos[j + 1] += this.vel[j + 1] * dt;
        this.pos[j + 2] += (this.vel[j + 2] + flutter * Math.cos(this.time * 4 + i)) * dt;
        this.rot[j] += this.spin[j] * dt; this.rot[j + 1] += this.spin[j + 1] * dt; this.rot[j + 2] += this.spin[j + 2] * dt;
        if (settle && this.pos[j + 1] <= 0.004) {
          this.pos[j + 1] = 0.004;
          this.rot[j] = -Math.PI / 2; this.rot[j + 2] = 0;
        }
      }
      this.size[i] += grow * dt;
      const s = this.size[i] * Math.min(1, l / 0.35);
      dummy.position.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      dummy.rotation.set(this.rot[j], this.rot[j + 1], this.rot[j + 2]);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.live = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as Material).dispose();
    this.mesh.dispose();
  }
}

const CONFETTI_COLORS = ['#f4c542', '#e8433f', '#3aa0ff', '#3ccf7a', '#b06bff', '#ff8fc7', '#ffffff'];

export function makeConfetti(count: number): Particles {
  const mat = new MeshStandardMaterial({ side: DoubleSide, roughness: 0.45, metalness: 0.2 });
  return new Particles(count, new PlaneGeometry(0.05, 0.075), mat, CONFETTI_COLORS,
    { gravity: 2.2, drag: 1.6, flutter: 0.35, tumble: 14, grow: 0, settle: true });
}

/** A banknote face: green paper, a border and the edition's currency sign. */
function billTexture(currency: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5fae6b'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#e9f5df'; g.lineWidth = 5; g.strokeRect(5, 5, 118, 54);
  g.fillStyle = '#e9f5df';
  g.beginPath(); g.ellipse(64, 32, 20, 18, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2f7a3d'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(currency.slice(0, 2) || '$', 64, 33);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function makeBills(count: number, currency: string): Particles {
  const mat = new MeshStandardMaterial({ map: billTexture(currency), side: DoubleSide, roughness: 0.7 });
  const p = new Particles(count, new PlaneGeometry(0.17, 0.085), mat, ['#ffffff', '#f2fff0', '#e6f7e6'],
    { gravity: 2.2, drag: 1.8, flutter: 0.45, tumble: 7, grow: 0, settle: true });
  const dispose = p.dispose.bind(p);
  p.dispose = () => { mat.map?.dispose(); dispose(); };
  return p;
}

export function makeDust(count: number): Particles {
  const mat = new MeshStandardMaterial({ color: '#f4efe6', roughness: 1, transparent: true, opacity: 0.5, depthWrite: false });
  return new Particles(count, new IcosahedronGeometry(0.035, 2), mat, ['#ffffff', '#f6f1e8'],
    { gravity: -0.15, drag: 3, flutter: 0.05, tumble: 2, grow: 0.9, settle: false });
}

/** Shared bits for small props: a pocket, a house, a deed card. */
export const POCKET_GEO = new SphereGeometry(1, 14, 10);

/**
 * The cast's own kinds of material (the particles, the see-through pocket and
 * moth), hidden, for as long as there is a game: compiled up front with the
 * rest of the scene (three/shaderGate.tsx), so the first cutscene of each kind
 * does not stop to build its shaders. The cops, the doubles and the props
 * share their shaders with what is already on the board.
 */
export function CastWarmup({ currency }: { currency: string }) {
  const set = useMemo(() => {
    const particles = [makeConfetti(1), makeBills(1, currency), makeDust(1)];
    const loose = [
      new MeshStandardMaterial({ transparent: true }),
      new MeshStandardMaterial({ side: DoubleSide, transparent: true }),
    ];
    const root = new Object3D();
    root.visible = false;
    for (const p of particles) root.add(p.mesh);
    for (const m of loose) root.add(new Mesh(POCKET_GEO, m));
    return { root, dispose: () => { for (const p of particles) p.dispose(); for (const m of loose) m.dispose(); } };
  }, [currency]);
  useEffect(() => () => set.dispose(), [set]);
  return <primitive object={set.root} />;
}
