import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, Euler, MeshBasicMaterial, MeshPhysicalMaterial, Quaternion, RingGeometry, SRGBColorSpace, type Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SpeedFace } from '../../../shared/types.ts';
import { DICE_MS, markRoll } from './sequence.ts';

const SIZE = 0.5;
const ROLL_MS = DICE_MS;
// Rounded edges like a real die; keeps BoxGeometry's face groups and UVs.
const DIE_GEO = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 5, 0.085);
// Where the dice come to rest. A die's footprint is at most SIZE·√2 across at
// any yaw, so homes at least 0.75 apart can never overlap once settled.
const HOME_A: [number, number] = [-0.5, 1.4];
const HOME_B: [number, number] = [0.45, 1.72];
const HOME_SPEED: [number, number] = [-0.1, 2.4];
// Pips are dished into the face: the bump map does the shading, so the
// painted pip only needs a darker rim where the dent turns away from the light.
const PIP_BUMP = 0.012;
// Scratch objects for the frame loop (nothing is allocated per frame).
const qTarget = new Quaternion();
const qFace = new Quaternion();
const qTumble = new Quaternion();
const eTmp = new Euler();

// BoxGeometry face order: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
// The Speed Die (official variant): 1, 2, 3, two Mr. Monopolys and a Bus.
const SPEED_LAYOUT: SpeedFace[] = [1, 'mr', 2, 'bus', 3, 'mr'];
const SPEED_BODY = '#d8262e';
const SPEED_INK = '#ffffff';

/** Rotation that puts box face `i` (in BoxGeometry order) on top (+y). */
const FACE_UP: [number, number, number][] = [
  [0, 0, Math.PI / 2],
  [0, 0, -Math.PI / 2],
  [0, 0, 0],
  [Math.PI, 0, 0],
  [-Math.PI / 2, 0, 0],
  [Math.PI / 2, 0, 0],
];

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
};

function canvasTexture(draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const pipRadius = (v: number) => (v === 1 ? 16 : 12);

function drawPips(g: CanvasRenderingContext2D, v: number, pip: string, body: string) {
  g.fillStyle = body;
  g.fillRect(0, 0, 128, 128);
  for (const [x, y] of PIPS[v]) {
    // Drilled pips: the paint sits in the dish, with a dark ring at the rim.
    const r = pipRadius(v);
    const cx = x * 128, cy = y * 128;
    const grad = g.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
    grad.addColorStop(0, pip);
    grad.addColorStop(0.7, pip);
    grad.addColorStop(0.88, 'rgba(0,0,0,0.7)');
    grad.addColorStop(1, 'rgba(0,0,0,0.9)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, r + 1, Math.PI * 0.2, Math.PI * 0.8);
    g.stroke();
  }
}

/** Height map for the dished pips: white is the face, each pip a soft hollow with a crisp rim. */
function drawPipBump(g: CanvasRenderingContext2D, v: number) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (const [x, y] of PIPS[v]) {
    const r = pipRadius(v) + 1;
    const cx = x * 128, cy = y * 128;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, '#707070');
    grad.addColorStop(0.55, '#808080');
    grad.addColorStop(0.92, '#f0f0f0');
    grad.addColorStop(1, '#ffffff');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** Glossy moulded resin with a clear lacquer, so the dice catch the room's reflections. */
function dieMaterial(map: CanvasTexture, bump: CanvasTexture | null): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    map, bumpMap: bump, bumpScale: bump ? PIP_BUMP : 0, roughness: 0.32, metalness: 0,
    clearcoat: 0.6, clearcoatRoughness: 0.18,
  });
}

/** Mr. Monopoly's top hat, drawn (emoji fonts are not guaranteed everywhere). */
function drawHat(g: CanvasRenderingContext2D) {
  g.fillStyle = SPEED_INK;
  g.beginPath();
  g.roundRect(40, 26, 48, 58, 6);
  g.fill();
  g.beginPath();
  g.ellipse(64, 88, 42, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = SPEED_BODY;
  g.fillRect(40, 66, 48, 9);
}

function drawBus(g: CanvasRenderingContext2D) {
  g.fillStyle = SPEED_INK;
  g.beginPath();
  g.roundRect(18, 34, 92, 52, 10);
  g.fill();
  g.fillStyle = SPEED_BODY;
  for (const x of [26, 48, 70]) g.fillRect(x, 42, 16, 16);
  g.fillRect(92, 42, 11, 30); // door
  g.fillStyle = SPEED_INK;
  for (const x of [38, 90]) {
    g.beginPath();
    g.arc(x, 90, 11, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = SPEED_BODY;
  for (const x of [38, 90]) {
    g.beginPath();
    g.arc(x, 90, 4, 0, Math.PI * 2);
    g.fill();
  }
}

function speedMaterial(f: SpeedFace): MeshPhysicalMaterial {
  if (typeof f === 'number') {
    return dieMaterial(canvasTexture(g => drawPips(g, f, SPEED_INK, SPEED_BODY)), canvasTexture(g => drawPipBump(g, f)));
  }
  return dieMaterial(canvasTexture(g => {
    g.fillStyle = SPEED_BODY;
    g.fillRect(0, 0, 128, 128);
    if (f === 'mr') drawHat(g);
    else drawBus(g);
  }), null);
}

function Die({ top, seq, home, delay, materials, rollOnMount = false }: {
  /** Box face index (BoxGeometry order) that should land on top. */
  top: number; seq: number; home: [number, number]; delay: number; materials: MeshPhysicalMaterial[];
  /** Tumble in when first shown (the Speed Die appears with the roll that brings it). */
  rollOnMount?: boolean;
}) {
  const ref = useRef<Mesh>(null);
  const st = useRef({ seq: -1, t0: 0, yaw: 0, spin: new Euler(), from: [0, 0] as [number, number], settled: false });

  useEffect(() => { st.current.settled = false; }, [top]);

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const s = st.current;
    const now = performance.now();
    if (s.seq !== seq) {
      const first = s.seq === -1 && !rollOnMount;
      s.seq = seq;
      s.t0 = first ? 0 : now + delay;
      s.yaw = Math.random() * Math.PI * 2;
      s.spin.set(6 + Math.random() * 8, 4 + Math.random() * 6, 5 + Math.random() * 8);
      s.from = [home[0] + 2.2, home[1] + 2.2];
      s.settled = false;
    }
    if (s.settled) return;
    const target = qTarget.setFromEuler(eTmp.set(0, s.yaw, 0)).multiply(qFace.setFromEuler(eTmp.set(...FACE_UP[top])));
    const k = s.t0 ? Math.min(1, Math.max(0, (now - s.t0) / ROLL_MS)) : 1;
    if (k >= 1) {
      m.quaternion.slerp(target, 0.25);
      m.position.set(home[0], SIZE / 2, home[1]);
      // Resting: stop touching it once it has turned the last little way.
      if (m.quaternion.angleTo(target) < 0.001) { m.quaternion.copy(target); s.settled = true; }
      return;
    }
    const e = 1 - (1 - k) ** 3;
    m.position.x = s.from[0] + (home[0] - s.from[0]) * e;
    m.position.z = s.from[1] + (home[1] - s.from[1]) * e;
    // Two diminishing bounces.
    m.position.y = SIZE / 2 + Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 1.4;
    m.quaternion.copy(target).multiply(qTumble.setFromEuler(eTmp.set(s.spin.x * (1 - e), s.spin.y * (1 - e), s.spin.z * (1 - e))));
  });

  return (
    <mesh ref={ref} castShadow geometry={DIE_GEO} material={materials} position={[home[0], SIZE / 2, home[1]]} />
  );
}

const FLASH_MS = 1000;
const flashGeo = new RingGeometry(0.55, 0.8, 48);
const flashMat = new MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0, depthWrite: false, toneMapped: false });

/** Doubles: a gold ring bursts out from between the dice as they settle. */
function DoublesFlash({ seq, on }: { seq: number; on: boolean }) {
  const ref = useRef<Mesh>(null);
  const st = useRef({ seq: -1, at: 0 });
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const s = st.current;
    const now = performance.now();
    if (s.seq !== seq) {
      // The first state we see is history, not a throw.
      s.at = s.seq === -1 || !on ? 0 : now + ROLL_MS + 80;
      s.seq = seq;
    }
    const k = s.at ? (now - s.at) / FLASH_MS : 2;
    m.visible = k >= 0 && k < 1;
    if (!m.visible) return;
    const grow = 1 - (1 - k) ** 2;
    m.scale.setScalar(0.6 + grow * 2.6);
    (m.material as MeshBasicMaterial).opacity = (1 - k) * 0.85;
  });
  return (
    <mesh ref={ref} geometry={flashGeo} material={flashMat} visible={false}
      position={[(HOME_A[0] + HOME_B[0]) / 2, 0.03, (HOME_A[1] + HOME_B[1]) / 2]} rotation={[-Math.PI / 2, 0, 0]} />
  );
}

export function Dice({ dice, seq, pip = '#111', body = '#fbfbf7', speed = null }: {
  dice: [number, number] | null; seq: number; pip?: string; body?: string;
  /** The Speed Die's face when it was part of this roll; hidden otherwise. */
  speed?: SpeedFace | null;
}) {
  const [a, b] = dice ?? [5, 2];
  // Tell the scene a throw is under way (pieces wait for the dice to settle).
  const mounted = useRef(false);
  markRoll(seq, !mounted.current);
  mounted.current = true;
  const pipMaterials = useMemo(
    () => FACE_VALUES.map(v => dieMaterial(canvasTexture(g => drawPips(g, v, pip, body)), canvasTexture(g => drawPipBump(g, v)))),
    [pip, body],
  );
  const speedMaterials = useMemo(() => SPEED_LAYOUT.map(speedMaterial), []);
  // Free the canvas textures and materials with the dice (scene changes, edition swaps).
  const free = (ms: MeshPhysicalMaterial[]) => { for (const m of ms) { m.map?.dispose(); m.bumpMap?.dispose(); m.dispose(); } };
  useEffect(() => () => free(pipMaterials), [pipMaterials]);
  useEffect(() => () => free(speedMaterials), [speedMaterials]);
  return (
    <group>
      <Die top={FACE_VALUES.indexOf(a)} seq={seq} home={HOME_A} delay={0} materials={pipMaterials} />
      <Die top={FACE_VALUES.indexOf(b)} seq={seq} home={HOME_B} delay={60} materials={pipMaterials} />
      {speed !== null && (
        <Die top={SPEED_LAYOUT.indexOf(speed)} seq={seq} home={HOME_SPEED} delay={120} materials={speedMaterials} rollOnMount />
      )}
      <DoublesFlash seq={seq} on={!!dice && dice[0] === dice[1]} />
    </group>
  );
}
