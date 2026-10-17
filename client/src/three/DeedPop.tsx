// A title deed that pops up out of a street the moment it's bought (or won at
// auction): it rises off the tile, turns once so everyone can read it, then
// shrinks away into its new owner's piece. Plays once the dice and the walk
// are done, like the money.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CanvasTexture, Group, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { Theme } from '../../../shared/themes.ts';
import type { GameView } from '../../../shared/types.ts';
import { pieceObjects } from './camera.ts';
import { tile } from './layout.ts';
import { useSceneBusy } from './sequence.ts';

const RISE_MS = 550;
const HOLD_MS = 700;
const GO_MS = 450;
const TOTAL = RISE_MS + HOLD_MS + GO_MS;

interface Pop { id: number; space: number; owner: string }

const geo = new PlaneGeometry(0.84, 1.08);

function deedCanvas(theme: Theme, space: number): HTMLCanvasElement {
  const s = theme.spaces[space];
  const w = 248, h = 320;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const font = theme.ui?.font ?? 'Nunito, sans-serif';
  const display = theme.ui?.display ?? '"Lilita One", sans-serif';
  ctx.fillStyle = '#fffdf6';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 18); ctx.fill();
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(10, 10, w - 20, h - 20, 12); ctx.stroke();
  const band = s.kind === 'property' ? theme.groupColors[s.group!] ?? '#888' : s.kind === 'railroad' ? '#2b2b33' : '#5e7a8a';
  ctx.fillStyle = band;
  ctx.fillRect(18, 18, w - 36, 92);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const light = s.kind === 'property' && isLight(band);
  ctx.fillStyle = light ? '#1a1a2e' : '#ffffff';
  ctx.font = `800 15px ${font}`;
  ctx.fillText('TITLE DEED', w / 2, 40);
  let size = 30;
  const name = s.name.toUpperCase();
  do { ctx.font = `400 ${size}px ${display}`; size -= 1; } while (ctx.measureText(name).width > w - 50 && size > 12);
  ctx.fillText(name, w / 2, 80);
  ctx.fillStyle = '#1a1a2e';
  ctx.font = `400 64px ${display}`;
  ctx.fillText(s.kind === 'railroad' ? '🚂' : s.kind === 'utility' ? '💡' : '🏠', w / 2, 175);
  ctx.font = `800 26px ${font}`;
  ctx.fillText(`${theme.currency}${s.price ?? ''}`, w / 2, 262);
  return cv;
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) > 170;
}

const ease = (k: number) => 1 - (1 - k) ** 3;
const tmp = new Vector3();

function Deed({ theme, pop, n, onDone }: { theme: Theme; pop: Pop; n: number; onDone: (id: number) => void }) {
  const ref = useRef<Group>(null);
  const start = useRef(performance.now());
  const finished = useRef(false);
  const [front, back] = useMemo(() => {
    const t = new CanvasTexture(deedCanvas(theme, pop.space));
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return [new MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }),
      new MeshBasicMaterial({ color: '#f3ead2', transparent: true, toneMapped: false })];
  }, [theme, pop.space]);
  useEffect(() => () => { front.map?.dispose(); front.dispose(); back.dispose(); }, [front, back]);
  const g = tile(pop.space, n);

  useFrame(({ camera }) => {
    const el = ref.current;
    if (!el) return;
    const t = performance.now() - start.current;
    if (t >= TOTAL) {
      if (!finished.current) { finished.current = true; el.visible = false; onDone(pop.id); }
      return;
    }
    let scale = 1;
    if (t < RISE_MS) {
      const k = ease(t / RISE_MS);
      el.position.set(g.x, 0.15 + k * 0.95, g.z);
      scale = 0.3 + 0.7 * k;
    } else if (t < RISE_MS + HOLD_MS) {
      el.position.set(g.x, 1.1 + Math.sin(((t - RISE_MS) / HOLD_MS) * Math.PI) * 0.06, g.z);
    } else {
      // Into the new owner's piece (or just away, if it can't be found).
      const k = ease((t - RISE_MS - HOLD_MS) / GO_MS);
      const piece = pieceObjects.get(pop.owner);
      const to = piece ? tmp.set(piece.position.x, 0.55, piece.position.z) : tmp.set(g.x, 1.6, g.z);
      el.position.set(g.x + (to.x - g.x) * k, 1.1 + (to.y - 1.1) * k, g.z + (to.z - g.z) * k);
      scale = 1 - 0.85 * k;
    }
    el.scale.setScalar(scale);
    // Face the camera, with one full turn on the way up so it reads as a flip.
    el.quaternion.copy(camera.quaternion);
    if (t < RISE_MS) el.rotateY((1 - ease(t / RISE_MS)) * Math.PI * 2);
    const fade = t > TOTAL - 150 ? (TOTAL - t) / 150 : 1;
    front.opacity = back.opacity = fade;
  });

  return (
    <group ref={ref} position={[g.x, 0.15, g.z]} scale={0.3}>
      <mesh geometry={geo} material={front} />
      <mesh geometry={geo} material={back} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

export function DeedPop({ game, theme }: { game: GameView; theme: Theme }) {
  const busy = useSceneBusy();
  const prev = useRef<Set<number> | null>(null);
  const waiting = useRef<Omit<Pop, 'id'>[]>([]);
  const seq = useRef(0);
  const [pops, setPops] = useState<Pop[]>([]);
  const n = theme.spaces.length;

  // New deeds: spaces that had no owner before (bought, or won at auction). Trades aren't purchases.
  useEffect(() => {
    const now = new Set(Object.keys(game.owned).map(Number));
    const was = prev.current;
    prev.current = now;
    if (!was) return;
    for (const i of now) if (!was.has(i)) waiting.current.push({ space: i, owner: game.owned[i].owner });
  }, [game.owned]);

  useEffect(() => {
    if (busy || !waiting.current.length) return;
    const fresh = waiting.current.splice(0).slice(-3).map(p => ({ ...p, id: ++seq.current }));
    setPops(ps => [...ps, ...fresh]);
  }, [busy, game.owned]);

  const done = (id: number) => setPops(ps => ps.filter(p => p.id !== id));
  return <>{pops.map(p => <Deed key={p.id} theme={theme} pop={p} n={n} onDone={done} />)}</>;
}
