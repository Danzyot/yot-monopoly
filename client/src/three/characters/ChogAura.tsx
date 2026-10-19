// A Chog Genesis token's aura, drawn live: one small additive sprite system
// per figure (a single draw call), in the aura's colour. Fire flickers up
// from the feet, smoke drifts up slowly, wind streaks round the figure and the
// colour auras hang as a soft glowing ring. Skipped on Low graphics.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, DynamicDrawUsage, NormalBlending, Points, PointsMaterial,
} from 'three';
import type { ChogAuraKind } from '../../../../shared/chogs/traits.ts';

const COUNT = 36;

let sprite: CanvasTexture | null = null;
/** A soft round sprite, drawn once. */
function spriteTexture(): CanvasTexture {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sprite = new CanvasTexture(c);
  return sprite;
}

interface Kind { size: number; opacity: number; speed: number; radius: number; height: number; additive: boolean }
const KINDS: Record<ChogAuraKind, Kind> = {
  fire: { size: 0.075, opacity: 0.85, speed: 0.32, radius: 0.13, height: 0.42, additive: true },
  smoke: { size: 0.09, opacity: 0.4, speed: 0.12, radius: 0.15, height: 0.5, additive: false },
  wind: { size: 0.05, opacity: 0.6, speed: 0.5, radius: 0.19, height: 0.35, additive: true },
  glow: { size: 0.07, opacity: 0.55, speed: 0.08, radius: 0.17, height: 0.3, additive: true },
};

export function ChogAura({ kind, color }: { kind: ChogAuraKind; color: string }) {
  const k = KINDS[kind];
  const seeds = useMemo(() => Float32Array.from({ length: COUNT * 3 }, () => Math.random()), []);
  const points = useMemo(() => {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(DynamicDrawUsage));
    geo.boundingSphere = null;
    const mat = new PointsMaterial({
      size: k.size, map: spriteTexture(), color: new Color(color), transparent: true, opacity: k.opacity,
      depthWrite: false, blending: k.additive ? AdditiveBlending : NormalBlending, sizeAttenuation: true,
    });
    const p = new Points(geo, mat);
    p.frustumCulled = false;
    return p;
  }, [k, color]);
  useEffect(() => () => { points.geometry.dispose(); (points.material as PointsMaterial).dispose(); }, [points]);
  const phase = useRef(Math.random() * 100);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime + phase.current;
    const pos = points.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      const s0 = seeds[i * 3], s1 = seeds[i * 3 + 1], s2 = seeds[i * 3 + 2];
      const a = s0 * Math.PI * 2;
      let x: number, y: number, z: number;
      if (kind === 'wind') {
        // Streaks orbiting the figure, each on its own level and pace.
        const ang = a + t * k.speed * (0.7 + s1 * 0.6) * (s2 > 0.5 ? 1 : -1);
        x = Math.cos(ang) * k.radius; z = Math.sin(ang) * k.radius;
        y = 0.08 + s1 * k.height + Math.sin(t * 2 + a) * 0.02;
      } else if (kind === 'glow') {
        // A slow ring that bobs and breathes.
        const ang = a + t * k.speed;
        const r = k.radius * (0.9 + 0.1 * Math.sin(t * 1.3 + s1 * 6));
        x = Math.cos(ang) * r; z = Math.sin(ang) * r;
        y = 0.1 + s1 * k.height + Math.sin(t * 1.7 + s2 * 6) * 0.03;
      } else {
        // Fire and smoke: rise from a ring at the feet and start again at the top, each on its own cycle.
        const life = (t * k.speed * (0.7 + s1 * 0.6) + s2) % 1;
        const wobble = Math.sin(t * (kind === 'fire' ? 9 : 2) + a) * (kind === 'fire' ? 0.015 : 0.03) * life;
        const r = k.radius * (1 - life * 0.45);
        x = Math.cos(a) * r + wobble; z = Math.sin(a) * r;
        y = 0.02 + life * k.height;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    points.geometry.attributes.position.needsUpdate = true;
    // Fire pulses; the rest just breathe a little.
    (points.material as PointsMaterial).opacity = k.opacity * (kind === 'fire' ? 0.75 + 0.25 * Math.sin(t * 11) : 0.9 + 0.1 * Math.sin(t * 2));
  });
  return <primitive object={points} />;
}
