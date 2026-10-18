// Iron bars round the "In Jail" square of the Jail corner. Jailed pieces stand
// inside; the door (on the side facing the next space) swings open when
// someone is let out, then clangs shut behind them.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BoxGeometry, CylinderGeometry, InstancedMesh, MeshStandardMaterial, Object3D, type Group } from 'three';
import type { GameView } from '../../../shared/types.ts';
import { C, tile } from './layout.ts';
import { jailDoor } from './cinematics/store.ts';

const STRIP = 0.42; // the "Just visiting" L (boardTexture drawJail)
const SIDE = C - STRIP;
const H = 0.42;
const BAR_R = 0.014;
const PER_SIDE = 6;
const DOOR_W = SIDE * 0.42;
const OPEN_MS = 2600;

const iron = new MeshStandardMaterial({ color: '#2f3238', metalness: 0.85, roughness: 0.32 });
const barGeo = new CylinderGeometry(BAR_R, BAR_R, H, 8);
const railGeo = new BoxGeometry(1, 0.03, 0.03);
const postGeo = new BoxGeometry(0.04, H + 0.03, 0.04);
const dummy = new Object3D();

export function JailCell({ game, n }: { game: GameView | null; n: number }) {
  const g = tile(n / 4, n);
  // The cell's centre; the corner's inner quadrant (toward +x, -z).
  const cx = g.x + STRIP / 2, cz = g.z - STRIP / 2;
  const bars = useRef<InstancedMesh>(null);
  const door = useRef<Group>(null);

  // Bars on all four sides, leaving a gap for the door in the middle of the -z side.
  const spots = useMemo(() => {
    const out: [number, number][] = [];
    const h = SIDE / 2;
    for (let k = 1; k < PER_SIDE; k++) {
      const t = -h + (SIDE * k) / PER_SIDE;
      out.push([-h, t], [h, t], [t, h]);
      if (Math.abs(t) > DOOR_W / 2) out.push([t, -h]);
    }
    return out;
  }, []);
  useEffect(() => {
    const m = bars.current;
    if (!m) return;
    spots.forEach(([x, z], i) => {
      dummy.position.set(x, H / 2, z);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [spots]);

  // Open the door when someone gets out.
  const jailed = useRef<Set<string> | null>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    const now = new Set((game?.players ?? []).filter(p => p.inJail && !p.bankrupt).map(p => p.id));
    const was = jailed.current;
    jailed.current = now;
    if (was && [...was].some(id => !now.has(id))) openedAt.current = performance.now();
  }, [game?.players]);
  useFrame(() => {
    if (!door.current) return;
    const t = (performance.now() - openedAt.current) / OPEN_MS;
    // Swing open fast, hold, swing shut with a little bounce.
    let a = 0;
    if (t < 0.15) a = t / 0.15;
    else if (t < 0.7) a = 1;
    else if (t < 1) { const k = (t - 0.7) / 0.3; a = 1 - k * k; }
    else if (t < 1.12) a = Math.sin(((t - 1) / 0.12) * Math.PI) * 0.06;
    // A cutscene slamming the door works it itself.
    door.current.rotation.y = jailDoor.angle ?? a * 1.6;
  });

  const h = SIDE / 2;
  const doorBars = [0.25, 0.5, 0.75].map(f => f * DOOR_W);
  return (
    <group position={[cx, 0, cz]}>
      <instancedMesh ref={bars} args={[barGeo, iron, spots.length]} castShadow frustumCulled={false} />
      {/* Top rails, and a lower rail just above the floor. */}
      {[0.02, H].map(y => (
        <group key={y}>
          <mesh geometry={railGeo} material={iron} position={[-h, y, 0]} rotation={[0, Math.PI / 2, 0]} scale={[SIDE, 1, 1]} castShadow />
          <mesh geometry={railGeo} material={iron} position={[h, y, 0]} rotation={[0, Math.PI / 2, 0]} scale={[SIDE, 1, 1]} castShadow />
          <mesh geometry={railGeo} material={iron} position={[0, y, h]} scale={[SIDE, 1, 1]} castShadow />
          <mesh geometry={railGeo} material={iron} position={[-(h + DOOR_W / 2) / 2, y, -h]} scale={[h - DOOR_W / 2, 1, 1]} castShadow />
          <mesh geometry={railGeo} material={iron} position={[(h + DOOR_W / 2) / 2, y, -h]} scale={[h - DOOR_W / 2, 1, 1]} castShadow />
        </group>
      ))}
      {[[-h, -h], [h, -h], [-h, h], [h, h]].map(([x, z]) => (
        <mesh key={`${x},${z}`} geometry={postGeo} material={iron} position={[x, (H + 0.03) / 2, z]} castShadow />
      ))}
      {/* The door, hinged on its left post, opening outward. */}
      <group ref={door} position={[-DOOR_W / 2, 0, -h]}>
        {[0.02, H].map(y => (
          <mesh key={y} geometry={railGeo} material={iron} position={[DOOR_W / 2, y, 0]} scale={[DOOR_W, 1, 1]} castShadow />
        ))}
        {doorBars.map(x => <mesh key={x} geometry={barGeo} material={iron} position={[x, H / 2, 0]} castShadow />)}
        <mesh material={iron} position={[DOOR_W - 0.02, H * 0.55, 0.012]}>
          <boxGeometry args={[0.04, 0.05, 0.02]} />
        </mesh>
      </group>
    </group>
  );
}
