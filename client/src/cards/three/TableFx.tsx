// The felt and what glows on it: the round purple felt with its gold rings
// and padded rim, the direction-of-play ring turning slowly round the middle
// (and whipping round the other way on a Reverse), the colour in play
// glowing under the discard pile (a burst that settles on the colour a Wild
// names), and the confetti for the round and match wins. Each is one draw.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D, PlaneGeometry, type Mesh,
} from 'three';
import { CARD_HEX } from '../CardFace.tsx';
import { rng, useCanvasTexture } from '../../three/environments/common.tsx';
import { CENTRE, DISCARD, FELT_R, FELT_Y, TABLE_TOP } from './layout.ts';
import { seg, type SceneState } from './state.ts';

const NONE = '#6f7fd8';

/** The felt: a purple pool with a fine nap, a gold double ring near the edge and a dashed ring inside it. */
export function Felt() {
  const tex = useCanvasTexture(1024, 1024, g => {
    const c = 512;
    const grad = g.createRadialGradient(c, c * 0.9, 40, c, c, 520);
    grad.addColorStop(0, '#7a4ee0');
    grad.addColorStop(0.5, '#4c27a6');
    grad.addColorStop(1, '#2a1570');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 1024);
    const r = rng(7);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${r() * 0.05})` : `rgba(0,0,0,${r() * 0.1})`;
      g.fillRect(r() * 1024, r() * 1024, 1 + r() * 2, 1 + r() * 2);
    }
    g.strokeStyle = 'rgba(255, 210, 63, 0.75)';
    g.lineWidth = 7;
    g.beginPath(); g.arc(c, c, 488, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(c, c, 470, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    g.lineWidth = 3;
    g.setLineDash([14, 12]);
    g.beginPath(); g.arc(c, c, 400, 0, Math.PI * 2); g.stroke();
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FELT_Y, 0]} receiveShadow>
        <circleGeometry args={[FELT_R, 72]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      {/* The padded leather rim. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TABLE_TOP + 0.08, 0]} receiveShadow castShadow>
        <torusGeometry args={[FELT_R + 0.14, 0.3, 10, 80]} />
        <meshStandardMaterial color="#1c0e46" roughness={0.7} />
      </mesh>
    </group>
  );
}

/** The play-direction ring: three arcs with arrow heads, turning slowly; a Reverse whips it round the other way. */
export function DirectionRing({ state }: { state: RefObject<SceneState | null> }) {
  const tex = useCanvasTexture(512, 512, g => {
    g.translate(256, 256);
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * Math.PI * 2) / 3);
      g.lineWidth = 18;
      g.beginPath(); g.arc(0, 0, 212, -Math.PI / 2, -Math.PI / 2 + Math.PI * 0.42); g.stroke();
      // Arrow head at the arc's end.
      g.rotate(-Math.PI / 2 + Math.PI * 0.42);
      g.beginPath(); g.moveTo(212 - 34, -30); g.lineTo(212, 2); g.lineTo(212 + 34, -30); g.stroke();
      g.restore();
    }
  }, []);
  const mesh = useRef<Mesh>(null);
  const mat = useMemo(() => new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }), [tex]);
  useEffect(() => () => mat.dispose(), [mat]);
  const spin = useRef({ angle: 0, color: new Color(NONE), want: new Color(NONE) });
  useFrame((_, delta) => {
    const st = state.current;
    const m = mesh.current;
    if (!st || !m) return;
    const dt = Math.min(delta, 0.1);
    const dir = st.frame.direction;
    // A turn every 16 s; a Reverse under way whips it round the new way.
    let w = (dir * Math.PI * 2) / 16;
    const play = st.frame.play;
    if (play) {
      const now = performance.now();
      for (const s of play.steps) {
        if (s.step.type !== 'reverse' || s.at > now || now >= s.end) continue;
        const k = (now - s.at) / Math.max(1, s.end - s.at);
        w += dir * 7 * Math.sin(Math.PI * k);
      }
    }
    if (!st.reduced) spin.current.angle -= w * dt;
    m.rotation.z = spin.current.angle;
    spin.current.want.set(st.frame.color ? CARD_HEX[st.frame.color].base : NONE);
    spin.current.color.lerp(spin.current.want, 1 - Math.exp(-6 * dt));
    mat.color.copy(spin.current.color);
  });
  return (
    <mesh ref={mesh} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[CENTRE.x, FELT_Y + 0.006, CENTRE.z]}>
      <planeGeometry args={[7.6, 7.6]} />
    </mesh>
  );
}

/** The colour in play, glowing under the discard pile; a Wild bursts a ring that settles on its colour. */
export function ColourGlow({ state }: { state: RefObject<SceneState | null> }) {
  const tex = useCanvasTexture(256, 256, g => {
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }, []);
  const glow = useRef<Mesh>(null);
  const burst = useRef<Mesh>(null);
  const glowMat = useMemo(() => new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false, blending: AdditiveBlending, toneMapped: false }), [tex]);
  // Normal blending: the ring shows the colour named, not a sum with the purple felt under it.
  const burstMat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide }), []);
  useEffect(() => () => { glowMat.dispose(); burstMat.dispose(); }, [glowMat, burstMat]);
  const cur = useRef(new Color(NONE));
  useFrame(({ clock }, delta) => {
    const st = state.current;
    if (!st || !glow.current || !burst.current) return;
    const dt = Math.min(delta, 0.1);
    const want = st.frame.color ? CARD_HEX[st.frame.color].base : NONE;
    let flash = 0;
    let ring = -1;
    let ringColor = want;
    const play = st.frame.play;
    if (play) {
      const now = performance.now();
      for (const s of play.steps) {
        if (s.step.type !== 'color' || s.at > now || now >= s.end) continue;
        const k = (now - s.at) / Math.max(1, s.end - s.at);
        // White flash that settles on the colour; the ring rushes out.
        flash = Math.max(flash, 1 - seg(k, 0.1, 0.7));
        ring = k;
        ringColor = CARD_HEX[s.step.color].base;
      }
    }
    cur.current.lerp(new Color(want), 1 - Math.exp(-5 * dt));
    glowMat.color.copy(cur.current).lerp(new Color('#ffffff'), flash * 0.8);
    glowMat.opacity = (st.frame.color ? 0.55 : 0.25) + Math.sin(clock.elapsedTime * 2.2) * 0.08 + flash * 0.5;
    const b = burst.current;
    if (ring >= 0 && !st.reduced) {
      b.visible = true;
      const sc = 0.35 + 2.3 * (1 - (1 - ring) ** 3);
      b.scale.set(sc, sc, 1);
      burstMat.color.set(ringColor);
      burstMat.opacity = 1 - ring;
    } else b.visible = false;
  });
  return (
    <group position={[DISCARD.x, FELT_Y + 0.003, DISCARD.z]}>
      <mesh ref={glow} material={glowMat} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.6, 4.6]} />
      </mesh>
      <mesh ref={burst} material={burstMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} visible={false}>
        <ringGeometry args={[0.95, 1.12, 56]} />
      </mesh>
    </group>
  );
}

// ---- confetti --------------------------------------------------------------------
// A burst from the middle of the table (the round win, each landing of the
// victory dance). Laid out analytically from the burst time, nothing simulated.

const COUNT = 72;
const LIFE_MS = 1700;
const COLORS = ['#e5383b', '#f7b500', '#22b16b', '#2a78f0', '#ff7a6e', '#ffe066', '#ffffff'];
let bursts: number[] = [];

/** Throw confetti from the middle of the table at `at` (performance.now() time). */
export function celebrate(at = performance.now()) {
  bursts.push(at);
  if (bursts.length > 3) bursts = bursts.slice(-3);
}

const confGeo = new PlaneGeometry(0.16, 0.09);
const confMat = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
const dummy = new Object3D();
const seeds = Array.from({ length: COUNT }, (_, i) => {
  const a = (i / COUNT) * Math.PI * 2 + Math.sin(i * 12.9) * 0.4;
  return { a, up: 3.2 + ((i * 37) % 11) / 11 * 2, out: 1.4 + ((i * 53) % 7) / 7 * 2, spin: 6 + (i % 5) * 3 };
});

export function TableConfetti({ at }: { at?: [number, number, number] }) {
  const mesh = useRef<InstancedMesh>(null);
  const colored = useRef(false);
  const [cx, cy, cz] = at ?? [CENTRE.x, FELT_Y + 0.4, CENTRE.z];
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
      const flutter = Math.sin(t * s.spin + i) * 0.1 * t;
      dummy.position.set(cx + Math.cos(s.a) * s.out * t + flutter, cy + s.up * t - 3.2 * t * t, cz + Math.sin(s.a) * s.out * t);
      if (dummy.position.y < FELT_Y + 0.01) dummy.position.y = FELT_Y + 0.01;
      dummy.rotation.set(t * s.spin, t * s.spin * 0.7, i);
      dummy.scale.setScalar(Math.max(0, fade));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = COUNT;
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[confGeo, confMat, COUNT]} count={0} frustumCulled={false} />;
}
