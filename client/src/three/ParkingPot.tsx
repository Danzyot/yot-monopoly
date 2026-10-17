// The Free Parking jackpot as real money: stacks of gold coins on the corner
// that grow as taxes and fines pile in (a coin per 25 or so), and vanish when
// someone scoops the lot. Only when the jackpot rule is on.

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import { tile } from './layout.ts';

const MAX = 60;
const COIN_H = 0.022;
const DROP_MS = 420;
const STAGGER_MS = 45;
const GONE_MS = 320;

const coinGeo = new CylinderGeometry(0.085, 0.085, COIN_H, 20);
const coinMat = new MeshStandardMaterial({ color: '#f4c542', metalness: 0.85, roughness: 0.3, emissive: '#5a3c00', emissiveIntensity: 0.25 });
const dummy = new Object3D();

/** Three piles toward the board side of the corner, clear of the printed car. */
const PILES: [number, number][] = [[0.3, 0.42], [0.47, 0.22], [0.5, 0.48]];

const coinsFor = (pot: number) => Math.min(MAX, Math.ceil(pot / 25));

export function ParkingPot({ pot, n }: { pot: number; n: number }) {
  const g = tile(n / 2, n);
  // The parking corner is top-left: the board side is +x, +z.
  const mesh = useRef<InstancedMesh>(null);
  const born = useRef<number[]>([]);
  const goneAt = useRef(0);
  const target = coinsFor(pot);
  const first = useRef(true);

  useEffect(() => {
    const now = performance.now();
    const b = born.current;
    if (target > b.length) {
      // Already there on arrival: no drop. Afterwards new coins rain in one by one.
      const t0 = first.current ? 0 : now;
      for (let i = b.length; i < target; i++) b.push(t0 ? t0 + (i - b.length) * STAGGER_MS : 0);
      goneAt.current = 0;
    } else if (target < b.length) {
      goneAt.current = now;
    }
    first.current = false;
  }, [target]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    const b = born.current;
    // Shrink away what's been paid out, then forget it.
    let shrink = 1;
    if (goneAt.current) {
      const k = (now - goneAt.current) / GONE_MS;
      if (k >= 1) { b.length = Math.min(b.length, target); goneAt.current = 0; } else shrink = 1 - k;
    }
    for (let i = 0; i < b.length; i++) {
      const pile = PILES[i % 3];
      const level = Math.floor(i / 3);
      const t = b[i] ? Math.min(1, Math.max(0, (now - b[i]) / DROP_MS)) : 1;
      const s = (i >= target ? shrink : 1) * (b[i] && now < b[i] ? 0 : 1);
      dummy.position.set(
        g.x + pile[0] + Math.sin(i * 2.7) * 0.012,
        COIN_H / 2 + level * COIN_H + (1 - t * t) * 0.7,
        g.z + pile[1] + Math.cos(i * 1.9) * 0.012,
      );
      dummy.rotation.set(0, i * 0.7, (1 - t) * 0.6);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = b.length;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[coinGeo, coinMat, MAX]} count={0} castShadow receiveShadow frustumCulled={false} />;
}
