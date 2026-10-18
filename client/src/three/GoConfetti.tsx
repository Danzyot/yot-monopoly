// A pop of confetti off the GO corner whenever a piece steps onto or over it
// (Pieces calls `celebrateGo` as the hop lands): the salary moment.

import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry } from 'three';
import { tile } from './layout.ts';

const COUNT = 64;
const LIFE_MS = 1500;
const COLORS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#fb8c00', '#ec407a', '#ffffff'];

let bursts: number[] = [];

/** Throw a burst of confetti from GO at `at` (performance.now() time; default now). */
export function celebrateGo(at = performance.now()) {
  bursts.push(at);
  if (bursts.length > 3) bursts = bursts.slice(-3);
}

const geo = new PlaneGeometry(0.14, 0.08);
const mat = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
const dummy = new Object3D();
// Fixed per-piece launch directions, speeds and spins, so nothing is allocated per frame.
const seeds = Array.from({ length: COUNT }, (_, i) => {
  const a = (i / COUNT) * Math.PI * 2 + Math.sin(i * 12.9) * 0.4;
  return { a, up: 2.6 + ((i * 37) % 11) / 11 * 1.6, out: 1.0 + ((i * 53) % 7) / 7 * 1.4, spin: 6 + (i % 5) * 3 };
});

export function GoConfetti({ n }: { n: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const colored = useRef(false);
  const g = tile(0, n);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    if (!colored.current) {
      const c = new Color();
      for (let i = 0; i < COUNT; i++) m.setColorAt(i, c.set(COLORS[i % COLORS.length]));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      colored.current = true;
    }
    const now = performance.now();
    if (bursts.length) bursts = bursts.filter(t => now - t < LIFE_MS);
    const t0 = bursts[bursts.length - 1];
    if (t0 === undefined || now < t0) { m.count = 0; return; }
    const t = (now - t0) / 1000;
    const fade = Math.min(1, (LIFE_MS / 1000 - t) / 0.4);
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      // Up and out, then gravity, fluttering as it falls.
      const flutter = Math.sin(t * s.spin + i) * 0.08 * t;
      dummy.position.set(
        g.x + Math.cos(s.a) * s.out * t + flutter,
        0.1 + s.up * t - 2.6 * t * t,
        g.z + Math.sin(s.a) * s.out * t,
      );
      if (dummy.position.y < 0.01) dummy.position.y = 0.01;
      dummy.rotation.set(t * s.spin, t * s.spin * 0.7, i);
      dummy.scale.setScalar(Math.max(0, fade));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = COUNT;
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geo, mat, COUNT]} count={0} frustumCulled={false} />;
}
