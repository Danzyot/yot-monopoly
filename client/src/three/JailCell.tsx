// Iron bars round the "In Jail" square of the Jail corner. Jailed pieces stand
// inside; the door (on the side facing the next space) swings open when
// someone is let out, then clangs shut behind them.

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { BoxGeometry, CylinderGeometry, Euler, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Group } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameView } from '../../../shared/types.ts';
import { C, jailOf, tile } from './layout.ts';
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

type Piece = { geo: BufferGeometry; p: [number, number, number]; ry?: number; s?: [number, number, number] };
/** Bake each piece's placement into one geometry: the whole cage is one draw (two with shadows). */
function merged(pieces: Piece[]): BufferGeometry {
  const m = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), sc = new Vector3();
  return mergeGeometries(pieces.map(({ geo, p, ry = 0, s = [1, 1, 1] }) =>
    geo.clone().applyMatrix4(m.compose(v.set(...p), q.setFromEuler(e.set(0, ry, 0)), sc.set(...s)))));
}

// Bars on all four sides, leaving a gap for the door in the middle of the -z
// side; top rails and a lower rail just above the floor; a post at each corner.
const CAGE = (() => {
  const h = SIDE / 2;
  const pieces: Piece[] = [];
  for (let k = 1; k < PER_SIDE; k++) {
    const t = -h + (SIDE * k) / PER_SIDE;
    const spots: [number, number][] = [[-h, t], [h, t], [t, h]];
    if (Math.abs(t) > DOOR_W / 2) spots.push([t, -h]);
    for (const [x, z] of spots) pieces.push({ geo: barGeo, p: [x, H / 2, z] });
  }
  for (const y of [0.02, H]) {
    pieces.push(
      { geo: railGeo, p: [-h, y, 0], ry: Math.PI / 2, s: [SIDE, 1, 1] },
      { geo: railGeo, p: [h, y, 0], ry: Math.PI / 2, s: [SIDE, 1, 1] },
      { geo: railGeo, p: [0, y, h], s: [SIDE, 1, 1] },
      { geo: railGeo, p: [-(h + DOOR_W / 2) / 2, y, -h], s: [h - DOOR_W / 2, 1, 1] },
      { geo: railGeo, p: [(h + DOOR_W / 2) / 2, y, -h], s: [h - DOOR_W / 2, 1, 1] },
    );
  }
  for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h]]) pieces.push({ geo: postGeo, p: [x, (H + 0.03) / 2, z] });
  return merged(pieces);
})();

// The door's rails and bars, in the door's own frame (hinged at its left end).
const DOOR = merged([
  ...[0.02, H].map(y => ({ geo: railGeo, p: [DOOR_W / 2, y, 0] as [number, number, number], s: [DOOR_W, 1, 1] as [number, number, number] })),
  ...[0.25, 0.5, 0.75].map(f => ({ geo: barGeo, p: [f * DOOR_W, H / 2, 0] as [number, number, number] })),
]);

export function JailCell({ game, n }: { game: GameView | null; n: number }) {
  const g = tile(jailOf(n), n);
  // The cell's centre; the corner's inner quadrant (toward +x, -z).
  const cx = g.x + STRIP / 2, cz = g.z - STRIP / 2;
  const door = useRef<Group>(null);

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
  return (
    <group position={[cx, 0, cz]}>
      <mesh geometry={CAGE} material={iron} castShadow />
      {/* The door, hinged on its left post, opening outward. */}
      <group ref={door} position={[-DOOR_W / 2, 0, -h]}>
        <mesh geometry={DOOR} material={iron} castShadow />
        <mesh material={iron} position={[DOOR_W - 0.02, H * 0.55, 0.012]}>
          <boxGeometry args={[0.04, 0.05, 0.02]} />
        </mesh>
      </group>
    </group>
  );
}
