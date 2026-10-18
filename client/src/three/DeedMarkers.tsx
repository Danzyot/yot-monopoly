// Who owns what, on the board: a glossy plaque along each owned tile's outer
// edge in the owner's colour, with a little pennant on a pole at its corner
// that flutters. Mortgaged deeds go grey and lose their flag, and the tile is
// dimmed. Everything is instanced (one draw call for plaques, one for poles,
// one for pennants), so a 48-space board full of deeds costs the same as one.
// A deed that changes hands pops in.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, Color, CylinderGeometry, DoubleSide, InstancedMesh, MeshBasicMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, Object3D, PlaneGeometry, Shape, ShapeGeometry,
} from 'three';
import type { GameView } from '../../../shared/types.ts';
import { C, tile, tileWidth } from './layout.ts';

const MAX = 64;
const POP_MS = 420;
const POLE_H = 0.34;

const plaqueGeo = new BoxGeometry(1, 0.045, 0.085);
const poleGeo = new CylinderGeometry(0.012, 0.012, POLE_H, 6);
const pennantGeo = (() => {
  const s = new Shape();
  s.moveTo(0, 0); s.lineTo(0.2, 0.055); s.lineTo(0, 0.11); s.closePath();
  return new ShapeGeometry(s);
})();
const plaqueMat = new MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
const poleMat = new MeshStandardMaterial({ color: '#d9c48a', metalness: 0.8, roughness: 0.35 });
const pennantMat = new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide, toneMapped: false });
const dimGeo = new PlaneGeometry(1, 1);
const dimMat = new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false });

const dummy = new Object3D();
const col = new Color();
const GREY = new Color('#6b6b70');

export function DeedMarkers({ game, n }: { game: GameView; n: number }) {
  const plaques = useRef<InstancedMesh>(null);
  const poles = useRef<InstancedMesh>(null);
  const pennants = useRef<InstancedMesh>(null);
  const T = tileWidth(n);
  const colorOf = useMemo(() => new Map(game.players.map(p => [p.id, p.color])), [game.players]);

  // Each deed's geometry, plus when its current owner took it (for the pop-in).
  const since = useRef(new Map<string, number>());
  const first = useRef(true);
  const deeds = useMemo(() => Object.entries(game.owned).map(([k, o]) => {
    const i = Number(k);
    const g = tile(i, n);
    const inset = C / 2 - 0.06;
    const horiz = g.out[0] === 0;
    const len = (g.corner ? C : T) * 0.86;
    return {
      key: `${i}:${o.owner}`, i, owner: o.owner, mortgaged: o.mortgaged,
      x: g.x + g.out[0] * inset, z: g.z + g.out[1] * inset, horiz, len,
      // The pennant stands at the end of the plaque in the direction of play.
      fx: g.x + g.out[0] * inset + g.along[0] * (len / 2 - 0.03),
      fz: g.z + g.out[1] * inset + g.along[1] * (len / 2 - 0.03),
      cx: g.x, cz: g.z, w: horiz ? T : C, d: horiz ? C : T,
    };
  }), [game.owned, n, T]);
  useEffect(() => {
    const now = performance.now();
    const seen = since.current;
    // Already owned when we arrived: just there. Afterwards, new hands pop in.
    for (const d of deeds) if (!seen.has(d.key)) seen.set(d.key, first.current ? 0 : now);
    for (const k of [...seen.keys()]) if (!deeds.some(d => d.key === k)) seen.delete(k);
    first.current = false;
  }, [deeds]);

  useFrame(({ clock }) => {
    const P = plaques.current, L = poles.current, F = pennants.current;
    if (!P || !L || !F) return;
    const now = performance.now();
    const t = clock.elapsedTime;
    let k = 0, f = 0;
    for (const d of deeds) {
      if (k >= MAX) break;
      const born = since.current.get(d.key) ?? 0;
      const pop = born ? Math.min(1, (now - born) / POP_MS) : 1;
      // Overshoot a touch, then settle.
      const s = pop < 1 ? 1 + Math.sin(pop * Math.PI) * 0.35 * (1 - pop) + (pop - 1) : 1;
      const scale = Math.max(0.001, s);
      const c = d.mortgaged ? GREY : col.set(colorOf.get(d.owner) ?? '#888');

      dummy.position.set(d.x, 0.022 * scale, d.z);
      dummy.rotation.set(0, d.horiz ? 0 : Math.PI / 2, 0);
      dummy.scale.set(d.len * scale, scale, scale);
      dummy.updateMatrix();
      P.setMatrixAt(k, dummy.matrix);
      P.setColorAt(k, c);
      k++;

      if (d.mortgaged) continue;
      if (f >= MAX) continue;
      dummy.position.set(d.fx, POLE_H / 2 * scale, d.fz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      L.setMatrixAt(f, dummy.matrix);
      // The pennant hangs off the pole top, facing along the row, and ripples.
      const yaw = d.horiz ? 0 : Math.PI / 2;
      const flutter = Math.sin(t * 5.5 + d.i * 1.3) * 0.22 + Math.sin(t * 9.1 + d.i) * 0.08;
      dummy.position.set(d.fx, (POLE_H - 0.115) * scale, d.fz);
      dummy.rotation.set(0, yaw + flutter, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      F.setMatrixAt(f, dummy.matrix);
      F.setColorAt(f, c);
      f++;
    }
    P.count = k; L.count = f; F.count = f;
    P.instanceMatrix.needsUpdate = true;
    L.instanceMatrix.needsUpdate = true;
    F.instanceMatrix.needsUpdate = true;
    if (P.instanceColor) P.instanceColor.needsUpdate = true;
    if (F.instanceColor) F.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={plaques} args={[plaqueGeo, plaqueMat, MAX]} count={0} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={poles} args={[poleGeo, poleMat, MAX]} count={0} castShadow frustumCulled={false} />
      <instancedMesh ref={pennants} args={[pennantGeo, pennantMat, MAX]} count={0} frustumCulled={false} />
      {deeds.filter(d => d.mortgaged).map(d => (
        <mesh key={`m${d.i}`} geometry={dimGeo} material={dimMat} position={[d.cx, 0.006, d.cz]} rotation={[-Math.PI / 2, 0, 0]} scale={[d.w, d.d, 1]} />
      ))}
    </group>
  );
}
