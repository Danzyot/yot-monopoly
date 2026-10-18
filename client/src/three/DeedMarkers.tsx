// Who owns what, on the board: a glossy plaque along each owned tile's outer
// edge in the owner's colour, with a little pennant on a pole at its corner
// that flutters. Mortgaged deeds go grey and lose their flag, and the tile is
// dimmed. Everything is instanced (one draw call for plaques, one for poles,
// one for pennants, one each for the tile washes and frames), so a 48-space
// board full of deeds costs the same as one. Owned tiles also get a light wash
// of the owner's colour and a solid frame, so ownership reads at a glance.
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
// The whole tile in the owner's colour: a light wash over the face and a
// solid frame round the edge, so ownership reads from any camera.
const washGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const washMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false });
const frameGeo = new BoxGeometry(1, 0.012, 1);
const frameMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const FRAME = 0.045;
const dimMat = new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false });

const dummy = new Object3D();
const col = new Color();
const GREY = new Color('#6b6b70');

export function DeedMarkers({ game, n }: { game: GameView; n: number }) {
  const plaques = useRef<InstancedMesh>(null);
  const poles = useRef<InstancedMesh>(null);
  const pennants = useRef<InstancedMesh>(null);
  const washes = useRef<InstancedMesh>(null);
  const frames = useRef<InstancedMesh>(null);
  const T = tileWidth(n);
  const colorOf = useMemo(() => new Map(game.players.map(p => [p.id, p.color])), [game.players]);

  // Each deed's geometry, plus when its current owner took it (for the pop-in).
  const since = useRef(new Map<string, number>());
  const first = useRef(true);
  const dirty = useRef(true);
  const popEnd = useRef(0);
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
    // Rewrite every instance until the pop-ins are over; after that only the pennants move.
    dirty.current = true;
    popEnd.current = now + POP_MS;
  }, [deeds, colorOf]);

  useFrame(({ clock }) => {
    const P = plaques.current, L = poles.current, F = pennants.current, W = washes.current, R = frames.current;
    if (!P || !L || !F || !W || !R) return;
    const now = performance.now();
    const t = clock.elapsedTime;
    if (!dirty.current && now >= popEnd.current) {
      // Settled: the plaques, poles, washes and frames stand still, so only the
      // pennants are rewritten (and only their matrices go up to the GPU).
      let f = 0, k = 0;
      for (const d of deeds) {
        if (k++ >= MAX) break;
        if (d.mortgaged || f >= MAX) continue;
        const flutter = Math.sin(t * 5.5 + d.i * 1.3) * 0.22 + Math.sin(t * 9.1 + d.i) * 0.08;
        dummy.position.set(d.fx, POLE_H - 0.115, d.fz);
        dummy.rotation.set(0, (d.horiz ? 0 : Math.PI / 2) + flutter, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        F.setMatrixAt(f++, dummy.matrix);
      }
      if (f) F.instanceMatrix.needsUpdate = true;
      return;
    }
    if (now >= popEnd.current) dirty.current = false;
    let k = 0, f = 0, w = 0, r = 0;
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

      if (!d.mortgaged) {
        // Wash over the tile face, then four frame strips round its edge.
        dummy.position.set(d.cx, 0.008, d.cz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(d.w * scale, 1, d.d * scale);
        dummy.updateMatrix();
        W.setMatrixAt(w, dummy.matrix);
        W.setColorAt(w, c);
        w++;
        const hw = (d.w * scale) / 2 - FRAME / 2, hd = (d.d * scale) / 2 - FRAME / 2;
        for (let e = 0; e < 4; e++) {
          // Top, bottom, left, right strips.
          const side = e < 2;
          dummy.position.set(d.cx + (side ? 0 : e === 2 ? -hw : hw), 0.012, d.cz + (side ? (e === 0 ? -hd : hd) : 0));
          dummy.scale.set(side ? d.w * scale : FRAME, 1, side ? FRAME : d.d * scale);
          dummy.updateMatrix();
          R.setMatrixAt(r, dummy.matrix);
          R.setColorAt(r, c);
          r++;
        }
      }

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
    P.count = k; L.count = f; F.count = f; W.count = w; R.count = r;
    W.instanceMatrix.needsUpdate = true;
    R.instanceMatrix.needsUpdate = true;
    if (W.instanceColor) W.instanceColor.needsUpdate = true;
    if (R.instanceColor) R.instanceColor.needsUpdate = true;
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
      <instancedMesh ref={washes} args={[washGeo, washMat, MAX]} count={0} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={frames} args={[frameGeo, frameMat, MAX * 4]} count={0} frustumCulled={false} />
      {deeds.filter(d => d.mortgaged).map(d => (
        <mesh key={`m${d.i}`} geometry={dimGeo} material={dimMat} position={[d.cx, 0.006, d.cz]} rotation={[-Math.PI / 2, 0, 0]} scale={[d.w, d.d, 1]} />
      ))}
    </group>
  );
}
