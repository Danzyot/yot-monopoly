import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { CanvasTexture, Euler, MeshStandardMaterial, Quaternion, SRGBColorSpace, type Mesh } from 'three';

const SIZE = 0.5;
const ROLL_MS = 1100;

// BoxGeometry face order: +x, -x, +y, -y, +z, -z. Opposite faces sum to 7.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

/** Rotation that puts `v` on top (+y). */
function faceUp(v: number): Quaternion {
  const e: Record<number, [number, number, number]> = {
    1: [0, 0, 0],
    6: [Math.PI, 0, 0],
    2: [-Math.PI / 2, 0, 0],
    5: [Math.PI / 2, 0, 0],
    3: [0, 0, Math.PI / 2],
    4: [0, 0, -Math.PI / 2],
  };
  return new Quaternion().setFromEuler(new Euler(...e[v]));
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
};

function faceTexture(v: number, pip: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfbf7';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = pip;
  for (const [x, y] of PIPS[v]) {
    g.beginPath();
    g.arc(x * 128, y * 128, v === 1 ? 16 : 12, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function Die({ value, seq, home, delay, pip }: { value: number; seq: number; home: [number, number]; delay: number; pip: string }) {
  const ref = useRef<Mesh>(null);
  const materials = useMemo(
    () => FACE_VALUES.map(v => new MeshStandardMaterial({ map: faceTexture(v, pip), roughness: 0.35 })),
    [pip],
  );
  const st = useRef({ seq: -1, t0: 0, yaw: 0, spin: new Euler(), from: [0, 0] as [number, number] });

  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const s = st.current;
    const now = performance.now();
    if (s.seq !== seq) {
      const first = s.seq === -1;
      s.seq = seq;
      s.t0 = first ? 0 : now + delay;
      s.yaw = Math.random() * Math.PI * 2;
      s.spin.set(6 + Math.random() * 8, 4 + Math.random() * 6, 5 + Math.random() * 8);
      s.from = [home[0] + 2.2, home[1] + 2.2];
    }
    const target = new Quaternion().setFromEuler(new Euler(0, s.yaw, 0)).multiply(faceUp(value));
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
    <mesh ref={ref} castShadow material={materials} position={[home[0], SIZE / 2, home[1]]}>
      <boxGeometry args={[SIZE, SIZE, SIZE]} />
    </mesh>
  );
}

export function Dice({ dice, seq, pip = '#111' }: { dice: [number, number] | null; seq: number; pip?: string }) {
  const [a, b] = dice ?? [5, 2];
  return (
    <group>
      <Die value={a} seq={seq} home={[-0.45, 1.4]} delay={0} pip={pip} />
      <Die value={b} seq={seq} home={[0.4, 1.7]} delay={60} pip={pip} />
    </group>
  );
}
