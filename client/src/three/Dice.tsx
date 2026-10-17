import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, Euler, MeshStandardMaterial, Quaternion, SRGBColorSpace, type Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SpeedFace } from '../../../shared/types.ts';
import { DICE_MS, markRoll } from './sequence.ts';

const SIZE = 0.5;
const ROLL_MS = DICE_MS;
// Rounded edges like a real die; keeps BoxGeometry's face groups and UVs.
const DIE_GEO = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 4, 0.07);

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

function drawPips(g: CanvasRenderingContext2D, v: number, pip: string, body: string) {
  g.fillStyle = body;
  g.fillRect(0, 0, 128, 128);
  for (const [x, y] of PIPS[v]) {
    // Drilled pips: a darker rim and a lit lower edge read as a dent.
    const r = v === 1 ? 16 : 12;
    const cx = x * 128, cy = y * 128;
    const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    grad.addColorStop(0, pip);
    grad.addColorStop(0.75, pip);
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r + 1, Math.PI * 0.15, Math.PI * 0.85);
    g.stroke();
  }
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

function speedTexture(f: SpeedFace): CanvasTexture {
  return canvasTexture(g => {
    if (typeof f === 'number') return drawPips(g, f, SPEED_INK, SPEED_BODY);
    g.fillStyle = SPEED_BODY;
    g.fillRect(0, 0, 128, 128);
    if (f === 'mr') drawHat(g);
    else drawBus(g);
  });
}

function Die({ top, seq, home, delay, materials, rollOnMount = false }: {
  /** Box face index (BoxGeometry order) that should land on top. */
  top: number; seq: number; home: [number, number]; delay: number; materials: MeshStandardMaterial[];
  /** Tumble in when first shown (the Speed Die appears with the roll that brings it). */
  rollOnMount?: boolean;
}) {
  const ref = useRef<Mesh>(null);
  const st = useRef({ seq: -1, t0: 0, yaw: 0, spin: new Euler(), from: [0, 0] as [number, number] });

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
    }
    const target = new Quaternion().setFromEuler(new Euler(0, s.yaw, 0))
      .multiply(new Quaternion().setFromEuler(new Euler(...FACE_UP[top])));
    const k = s.t0 ? Math.min(1, Math.max(0, (now - s.t0) / ROLL_MS)) : 1;
    if (k >= 1) {
      m.quaternion.slerp(target, 0.25);
      m.position.set(home[0], SIZE / 2, home[1]);
      return;
    }
    const e = 1 - (1 - k) ** 3;
    m.position.x = s.from[0] + (home[0] - s.from[0]) * e;
    m.position.z = s.from[1] + (home[1] - s.from[1]) * e;
    // Two diminishing bounces.
    m.position.y = SIZE / 2 + Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 1.4;
    const tumble = new Quaternion().setFromEuler(new Euler(s.spin.x * (1 - e), s.spin.y * (1 - e), s.spin.z * (1 - e)));
    m.quaternion.copy(target).multiply(tumble);
  });

  return (
    <mesh ref={ref} castShadow geometry={DIE_GEO} material={materials} position={[home[0], SIZE / 2, home[1]]} />
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
    () => FACE_VALUES.map(v => new MeshStandardMaterial({ map: canvasTexture(g => drawPips(g, v, pip, body)), roughness: 0.35 })),
    [pip, body],
  );
  const speedMaterials = useMemo(
    () => SPEED_LAYOUT.map(f => new MeshStandardMaterial({ map: speedTexture(f), roughness: 0.3 })),
    [],
  );
  return (
    <group>
      <Die top={FACE_VALUES.indexOf(a)} seq={seq} home={[-0.45, 1.4]} delay={0} materials={pipMaterials} />
      <Die top={FACE_VALUES.indexOf(b)} seq={seq} home={[0.4, 1.7]} delay={60} materials={pipMaterials} />
      {speed !== null && (
        <Die top={SPEED_LAYOUT.indexOf(speed)} seq={seq} home={[-0.1, 2.35]} delay={120} materials={speedMaterials} rollOnMount />
      )}
    </group>
  );
}
