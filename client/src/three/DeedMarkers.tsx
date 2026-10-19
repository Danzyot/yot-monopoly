// Who owns what, on the board, readable at a glance from the table view and
// on a phone. Every player is a Chog this season, so the owner's colour is
// the whole story:
//   - every owned tile: a wash of the owner's colour over its face, a solid
//     frame round it, a solid band along its outer edge, and an owner badge
//     (a colour dot in a white ring) just past its inner edge, facing the
//     middle of the board;
//   - the viewer's own tiles: a stronger wash, a thicker rim that pulses bright,
//     a raised flag in their colour on a pole, and a spinning gold star in
//     place of the dot;
//   - a complete colour set: a gold edge inside the frame and a gold ring on
//     the badge;
//   - mortgaged: no wash or frame, a grey band and grey hatching over the tile.
// Everything is instanced (one draw call per kind of piece, eleven in all,
// none casting shadows), so a board full of deeds costs the same as one. A deed
// that changes hands pops in.

import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BoxGeometry, CanvasTexture, Color, CylinderGeometry, DoubleSide, ExtrudeGeometry, InstancedMesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, PlaneGeometry, RepeatWrapping, Shape, ShapeGeometry,
} from 'three';
import { groupIndices, type SpaceDef } from '../../../shared/board.ts';
import type { GameView } from '../../../shared/types.ts';
import { C, tile, tileWidth } from './layout.ts';

const MAX = 64;
const POP_MS = 420;
const POLE_H = 0.46;
/** Frame strip widths: everyone's, the viewer's (thicker, pulsing), and the gold set edge inside it. */
const FRAME = 0.05;
const MY_FRAME = 0.085;
const GOLD = 0.035;
/** How far past the tile's inner edge the owner badge sits (on the board's middle, clear of houses and pieces). */
const BADGE_OUT = 0.2;

const bandGeo = new BoxGeometry(1, 0.05, 0.12);
const poleGeo = new CylinderGeometry(0.014, 0.014, POLE_H, 6);
const pennantGeo = (() => {
  const s = new Shape();
  s.moveTo(0, 0); s.lineTo(0.27, 0.075); s.lineTo(0, 0.15); s.closePath();
  return new ShapeGeometry(s);
})();
const starGeo = (() => {
  const s = new Shape();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 0.075 : 0.17;
    const a = Math.PI / 2 + (k * Math.PI) / 5;
    if (k) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: false }).translate(0, 0, -0.0225);
})();
const ringGeo = new CylinderGeometry(0.135, 0.135, 0.02, 24).translate(0, 0.01, 0);
const dotGeo = new CylinderGeometry(0.095, 0.095, 0.03, 24).translate(0, 0.015, 0);
const washGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const frameGeo = new BoxGeometry(1, 0.012, 1);
const myFrameGeo = new BoxGeometry(1, 0.02, 1);
const hatchGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// Glossy standard rather than a physical clear coat: no difference at this size, and a far quicker shader to compile.
const bandMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 });
const poleMat = new MeshStandardMaterial({ color: '#f1dd9c', metalness: 0.8, roughness: 0.3 });
const pennantMat = new MeshBasicMaterial({ color: '#ffffff', side: DoubleSide, toneMapped: false });
const starMat = new MeshStandardMaterial({ color: '#ffd23f', emissive: '#ffae00', emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.3 });
const ringMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const dotMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const washMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false });
// The viewer's own tiles: a stronger wash.
const myWashMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.42, depthWrite: false, toneMapped: false });
const frameMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
// The viewer's rim: its colour is scaled up and down every frame (a pulse), out of tone mapping so it glows.
const myFrameMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const hatchMat = new MeshBasicMaterial({ map: hatchTexture(), transparent: true, depthWrite: false, toneMapped: false });

/** Grey diagonal hatching over a darkened tile: "mortgaged" from across the table. */
function hatchTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(14, 12, 22, 0.62)';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(190, 190, 200, 0.85)';
  x.lineWidth = 7;
  for (let k = -64; k <= 128; k += 21) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k - 64, 64); x.stroke(); }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(2.5, 2.5);
  return t;
}

const dummy = new Object3D();
const col = new Color();
const GREY = new Color('#7b7b84');
const WHITE = new Color('#ffffff');
const GOLD_C = new Color('#ffcc33');
const RING_GREY = new Color('#3a3a44');

interface Deed {
  key: string; i: number; owner: string; mortgaged: boolean; mine: boolean; set: boolean;
  /** The tile's centre and its size along x and z. */
  cx: number; cz: number; w: number; d: number;
  /** Band along the outer edge. */
  bx: number; bz: number; horiz: boolean; len: number;
  /** The flag at the band's far end (direction of play). */
  fx: number; fz: number;
  /** The badge, just past the inner edge. */
  ox: number; oz: number;
}

export function DeedMarkers({ game, n, me, spaces }: { game: GameView; n: number; me?: string; spaces: SpaceDef[] }) {
  const bands = useRef<InstancedMesh>(null);
  const poles = useRef<InstancedMesh>(null);
  const pennants = useRef<InstancedMesh>(null);
  const stars = useRef<InstancedMesh>(null);
  const rings = useRef<InstancedMesh>(null);
  const dots = useRef<InstancedMesh>(null);
  const washes = useRef<InstancedMesh>(null);
  const myWashes = useRef<InstancedMesh>(null);
  const frames = useRef<InstancedMesh>(null);
  const myFrames = useRef<InstancedMesh>(null);
  const hatches = useRef<InstancedMesh>(null);
  const T = tileWidth(n);
  const colorOf = useMemo(() => new Map(game.players.map(p => [p.id, p.color])), [game.players]);

  // Each deed's geometry, plus when its current owner took it (for the pop-in).
  const since = useRef(new Map<string, number>());
  const first = useRef(true);
  const dirty = useRef(true);
  const popEnd = useRef(0);
  const deeds = useMemo<Deed[]>(() => Object.entries(game.owned).map(([k, o]) => {
    const i = Number(k);
    const g = tile(i, n);
    const inset = C / 2 - 0.075;
    const horiz = g.out[0] === 0;
    const len = (g.corner ? C : T) * 0.9;
    const s = spaces[i];
    const set = s?.kind === 'property' && !!s.group && groupIndices(spaces, s.group).every(j => game.owned[j]?.owner === o.owner);
    const bx = g.x + g.out[0] * inset, bz = g.z + g.out[1] * inset;
    const badge = C / 2 + BADGE_OUT;
    return {
      key: `${i}:${o.owner}`, i, owner: o.owner, mortgaged: o.mortgaged, mine: !!me && o.owner === me, set,
      cx: g.x, cz: g.z, w: horiz ? T : C, d: horiz ? C : T,
      bx, bz, horiz, len,
      fx: bx + g.along[0] * (len / 2 - 0.04), fz: bz + g.along[1] * (len / 2 - 0.04),
      ox: g.x - g.out[0] * badge, oz: g.z - g.out[1] * badge,
    };
  }), [game.owned, n, T, me, spaces]);
  useEffect(() => {
    const now = performance.now();
    const seen = since.current;
    // Already owned when we arrived: just there. Afterwards, new hands pop in.
    for (const d of deeds) if (!seen.has(d.key)) seen.set(d.key, first.current ? 0 : now);
    for (const k of [...seen.keys()]) if (!deeds.some(d => d.key === k)) seen.delete(k);
    first.current = false;
    // Rewrite every instance until the pop-ins are over; after that only the flags and stars move.
    dirty.current = true;
    popEnd.current = now + POP_MS;
  }, [deeds, colorOf]);

  // Per-instance colours from the start, not from the first deed: a mesh that
  // gains them changes shader, and that would be built mid-game.
  useLayoutEffect(() => {
    for (const m of [bands.current, pennants.current, rings.current, dots.current, washes.current, myWashes.current, frames.current, myFrames.current]) {
      if (m && !m.instanceColor) m.setColorAt(0, col.set('#ffffff'));
    }
  }, []);

  useFrame(({ clock }) => {
    const B = bands.current, L = poles.current, F = pennants.current, S = stars.current, R = rings.current, D = dots.current;
    const W = washes.current, MW = myWashes.current, Fr = frames.current, M = myFrames.current, H = hatches.current;
    if (!B || !L || !F || !S || !R || !D || !W || !MW || !Fr || !M || !H) return;
    const now = performance.now();
    const t = clock.elapsedTime;
    // The viewer's rim breathes between their colour and a near-white glow of it.
    myFrameMat.color.setScalar(1.25 + Math.sin(t * 3.2) * 0.45);

    const flags = (scaleOf: (d: Deed) => number) => {
      let f = 0, s = 0;
      for (const d of deeds) {
        if (!d.mine) continue;
        const scale = scaleOf(d);
        if (!d.mortgaged && f < MAX) {
          // The pennant hangs off the pole top, facing along the row, and ripples.
          const flutter = Math.sin(t * 5.5 + d.i * 1.3) * 0.22 + Math.sin(t * 9.1 + d.i) * 0.08;
          dummy.position.set(d.fx, (POLE_H - 0.16) * scale, d.fz);
          dummy.rotation.set(0, (d.horiz ? 0 : Math.PI / 2) + flutter, 0);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          F.setMatrixAt(f++, dummy.matrix);
        }
        if (s < MAX) {
          // The star over the badge: bobbing and turning.
          dummy.position.set(d.ox, (0.25 + Math.sin(t * 2.4 + d.i) * 0.04) * scale, d.oz);
          dummy.rotation.set(0, t * 1.6 + d.i, 0);
          dummy.scale.setScalar(scale * (d.mortgaged ? 0.75 : 1));
          dummy.updateMatrix();
          S.setMatrixAt(s++, dummy.matrix);
        }
      }
      return [f, s];
    };

    if (!dirty.current && now >= popEnd.current) {
      // Settled: only the flags and stars move (and only their matrices go up to the GPU).
      const [f, s] = flags(() => 1);
      if (f) F.instanceMatrix.needsUpdate = true;
      if (s) S.instanceMatrix.needsUpdate = true;
      return;
    }
    if (now >= popEnd.current) dirty.current = false;
    const scaleOf = (d: Deed) => {
      const born = since.current.get(d.key) ?? 0;
      const pop = born ? Math.min(1, (now - born) / POP_MS) : 1;
      // Overshoot a touch, then settle.
      const s = pop < 1 ? 1 + Math.sin(pop * Math.PI) * 0.35 * (1 - pop) + (pop - 1) : 1;
      return Math.max(0.001, s);
    };
    const strips = (mesh: InstancedMesh, at: number, d: Deed, width: number, y: number, inset: number, scale: number, c: Color) => {
      const w = d.w * scale - inset * 2, dd = d.d * scale - inset * 2;
      const hw = w / 2 - width / 2, hd = dd / 2 - width / 2;
      for (let e = 0; e < 4; e++) {
        // Top, bottom, left, right strips.
        const side = e < 2;
        dummy.position.set(d.cx + (side ? 0 : e === 2 ? -hw : hw), y, d.cz + (side ? (e === 0 ? -hd : hd) : 0));
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(side ? w : width, 1, side ? width : dd);
        dummy.updateMatrix();
        mesh.setMatrixAt(at + e, dummy.matrix);
        mesh.setColorAt(at + e, c);
      }
      return at + 4;
    };

    let b = 0, w = 0, mw = 0, r = 0, m = 0, h = 0, o = 0, dt = 0, k = 0, p = 0;
    for (const d of deeds) {
      if (k++ >= MAX) break;
      const scale = scaleOf(d);
      const owner = col.set(colorOf.get(d.owner) ?? '#888');
      const c = d.mortgaged ? GREY : owner;

      // The band along the outer edge.
      dummy.position.set(d.bx, 0.025 * scale, d.bz);
      dummy.rotation.set(0, d.horiz ? 0 : Math.PI / 2, 0);
      dummy.scale.set(d.len * scale, scale * (d.mine ? 1.4 : 1), scale);
      dummy.updateMatrix();
      B.setMatrixAt(b, dummy.matrix);
      B.setColorAt(b, c);
      b++;

      // The owner badge past the inner edge: a ring (gold for a full set), and a dot unless it is the viewer's (they get a star).
      dummy.position.set(d.ox, 0, d.oz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      R.setMatrixAt(o, dummy.matrix);
      R.setColorAt(o, d.mortgaged ? RING_GREY : d.set ? GOLD_C : d.mine ? owner : WHITE);
      o++;
      if (!d.mine) {
        D.setMatrixAt(dt, dummy.matrix);
        D.setColorAt(dt, owner);
        dt++;
      }

      if (d.mortgaged) {
        dummy.position.set(d.cx, 0.02, d.cz);
        dummy.scale.set(d.w * scale, 1, d.d * scale);
        dummy.updateMatrix();
        H.setMatrixAt(h++, dummy.matrix);
        continue;
      }
      // Wash over the tile face, then the frame round its edge (thicker and pulsing for the viewer's own).
      dummy.position.set(d.cx, 0.008, d.cz);
      dummy.scale.set(d.w * scale, 1, d.d * scale);
      dummy.updateMatrix();
      if (d.mine) { MW.setMatrixAt(mw, dummy.matrix); MW.setColorAt(mw++, owner); }
      else { W.setMatrixAt(w, dummy.matrix); W.setColorAt(w++, owner); }
      if (d.mine) m = strips(M, m, d, MY_FRAME, 0.014, 0, scale, owner);
      else r = strips(Fr, r, d, FRAME, 0.012, 0, scale, owner);
      if (d.set) r = strips(Fr, r, d, GOLD, 0.013, d.mine ? MY_FRAME : FRAME, scale, GOLD_C);

      // The viewer's flag pole at the band's far end.
      if (d.mine && p < MAX) {
        dummy.position.set(d.fx, (POLE_H / 2) * scale, d.fz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        L.setMatrixAt(p++, dummy.matrix);
      }
    }
    const [f, s] = flags(scaleOf);
    // Pennants take the viewer's colour.
    const mine = col.set((me && colorOf.get(me)) ?? '#ffffff');
    for (let q = 0; q < f; q++) F.setColorAt(q, mine);

    B.count = b; R.count = o; D.count = dt; H.count = h; W.count = w; MW.count = mw; Fr.count = r; M.count = m; L.count = p; F.count = f; S.count = s;
    for (const mesh of [B, R, D, H, W, MW, Fr, M, L, F, S]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={washes} args={[washGeo, washMat, MAX]} count={0} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={myWashes} args={[washGeo, myWashMat, MAX]} count={0} frustumCulled={false} renderOrder={1} />
      <instancedMesh ref={hatches} args={[hatchGeo, hatchMat, MAX]} count={0} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={frames} args={[frameGeo, frameMat, MAX * 8]} count={0} frustumCulled={false} />
      <instancedMesh ref={myFrames} args={[myFrameGeo, myFrameMat, MAX * 4]} count={0} frustumCulled={false} />
      <instancedMesh ref={bands} args={[bandGeo, bandMat, MAX]} count={0} receiveShadow frustumCulled={false} />
      <instancedMesh ref={rings} args={[ringGeo, ringMat, MAX]} count={0} frustumCulled={false} />
      <instancedMesh ref={dots} args={[dotGeo, dotMat, MAX]} count={0} frustumCulled={false} />
      <instancedMesh ref={stars} args={[starGeo, starMat, MAX]} count={0} frustumCulled={false} />
      <instancedMesh ref={poles} args={[poleGeo, poleMat, MAX]} count={0} frustumCulled={false} />
      <instancedMesh ref={pennants} args={[pennantGeo, pennantMat, MAX]} count={0} frustumCulled={false} />
    </group>
  );
}
