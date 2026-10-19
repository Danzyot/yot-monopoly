// Metropolis map: the table stands on a skyscraper rooftop at night. A
// concrete roof with a parapet, string lights, AC units, a water tower and a
// blinking mast; beyond the edge, a city of instanced towers with lit
// windows falls away into the haze; overhead, stars and a glowing moon.
// This drawn roof is the stand-in for the modelled, light-baked one
// (tools/blender/skyline_set.py); both share the night sky below.

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending, BackSide, BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, SphereGeometry,
  type MeshStandardMaterial,
} from 'three';
import type { Theme } from '../../../../shared/themes.ts';
import { FLOOR, Scatter, mix, rng, speckle, useCanvasTexture, type Inst } from './common.tsx';

const ROOF = 18;          // rooftop half-width
const STREET = -70;       // ground level of the city far below
// Where the moon hangs (the baked set's moonlight comes from here too).
const MOON: [number, number, number] = [-150, 160, -240];

/** Box whose top/bottom faces sample a dark corner of the window texture. */
function towerGeometry(): BoxGeometry {
  const g = new BoxGeometry(1, 1, 1);
  const uv = g.getAttribute('uv');
  // Face order: +x, −x, +y, −y, +z, −z, four vertices each.
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.01, 0.01);
  uv.needsUpdate = true;
  return g;
}

/** `ownLights` false: no lights of its own (a baked set's stand-in, lit by the set's lights while that loads). */
export function Skyline({ theme, ownLights = true }: { theme: Theme; ownLights?: boolean }) {
  const { accent, sky } = theme.palette;
  const lit = mix('#ffd49a', accent, 0.12);
  const concrete = mix('#4b4f5a', sky, 0.15);

  const windowTex = useCanvasTexture(256, 512, g => {
    const r = rng(77);
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, 256, 512);
    const cols = 8, rows = 48;
    const cw = 256 / cols, ch = 512 / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const on = r() < 0.32;
        g.fillStyle = on
          ? (r() < 0.8 ? lit : r() < 0.5 ? '#bfe3ff' : mix(lit, '#ffffff', 0.4))
          : `rgba(40,50,70,${0.3 + r() * 0.3})`;
        g.globalAlpha = on ? 0.55 + r() * 0.45 : 1;
        g.fillRect(x * cw + 5, y * ch + 2.5, cw - 10, ch - 5);
      }
    }
    g.globalAlpha = 1;
    // Dark corner that roofs sample (see towerGeometry).
    g.fillStyle = '#05070d';
    g.fillRect(0, 496, 16, 16);
  }, [lit]);

  const roofTex = useCanvasTexture(256, 256, g => {
    speckle(g, concrete, 0.2, 12);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    for (let k = 0; k <= 256; k += 64) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke();
      g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke();
    }
  }, [concrete], [9, 9]);

  const towerGeo = useMemo(towerGeometry, []);

  const city = useMemo(() => {
    const r = rng(2024);
    const tints = ['#1a2033', '#20263a', '#161b2b', '#262b3f', '#1d2436'];
    const towers: Inst[] = [];
    const beacons: Inst[] = [];
    // Our own building, under the roof.
    towers.push({ p: [0, (STREET + FLOOR - 2) / 2, 0], s: [ROOF * 2 - 0.5, FLOOR - 2 - STREET, ROOF * 2 - 0.5], c: '#1d2436' });
    let tries = 0;
    while (towers.length < 240 && tries++ < 3000) {
      const a = r() * Math.PI * 2;
      const d = 30 + Math.sqrt(r()) * 110;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const w = 6 + r() * 7, dp = 6 + r() * 7;
      // Keep the nearby blocks below the roof so they frame rather than block.
      const maxTop = d < 55 ? FLOOR - 4 : d < 85 ? FLOOR + 10 : FLOOR + 40;
      const top = STREET + 20 + r() * (maxTop - STREET - 20);
      const h = top - STREET;
      if (towers.some(t => Math.abs(t.p[0] - x) < w && Math.abs(t.p[2] - z) < dp)) continue;
      towers.push({ p: [x, STREET + h / 2, z], s: [w, h, dp], ry: (Math.floor(r() * 4) * Math.PI) / 2, c: tints[Math.floor(r() * tints.length)] });
      if (r() < 0.25) beacons.push({ p: [x, top + 0.6, z], s: 0.45 });
    }
    return { towers, beacons };
  }, []);

  const bulbs = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    const colors = ['#ffd27a', accent, '#fff3d6', '#7fd6ff'];
    let k = 0;
    for (let t = -ROOF + 1; t <= ROOF - 1; t += 1.6) {
      for (const [x, z] of [[t, -ROOF + 0.4], [-ROOF + 0.4, t], [ROOF - 0.4, t]] as const) {
        const sag = Math.abs(Math.sin((t / 3.2) * Math.PI)) * 0.35;
        out.push({ p: [x, FLOOR + 2.4 - sag, z], s: 0.13, c: colors[k++ % colors.length] });
      }
    }
    return out;
  }, [accent]);

  const acUnits = useMemo<Inst[]>(() => [
    { p: [-13, FLOOR + 0.9, -13], s: [3, 1.8, 2.2] },
    { p: [-9, FLOOR + 0.9, -14.5], s: [2.4, 1.8, 2] },
    { p: [14, FLOOR + 0.8, 4], s: [2.2, 1.6, 3.2] },
    { p: [-14.5, FLOOR + 0.8, 6], s: [2, 1.6, 3] },
  ], []);

  // A dark fan grille on top of each unit, so they read as AC boxes.
  const fans = useMemo<Inst[]>(() => acUnits.map(u => {
    const [w, h, d] = u.s as [number, number, number];
    const r = Math.min(w, d) * 0.32;
    return { p: [u.p[0], u.p[1] + h / 2 + 0.03, u.p[2]], s: [r, 0.08, r] };
  }), [acUnits]);

  // Built here rather than as JSX children, so free them here too.
  useEffect(() => () => { towerGeo.dispose(); }, [towerGeo]);

  // The mast's warning light blinks, as they do.
  const beaconRef = useRef<MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (beaconRef.current) beaconRef.current.emissiveIntensity = clock.elapsedTime % 1.6 < 0.5 ? 3 : 0.2;
  });

  return (
    <group>
      {ownLights && (
        <>
          <hemisphereLight args={['#7f8fd0', '#120f1a', 0.6]} />
          <directionalLight position={MOON} intensity={0.5} color="#a9bcff" />
          <pointLight position={[0, FLOOR + 3, -ROOF + 1]} color={mix('#ffcf80', accent, 0.3)} intensity={90} decay={2} />
        </>
      )}

      {/* Roof slab, painted helipad ring, parapet. */}
      <mesh position={[0, FLOOR - 1, 0]} receiveShadow>
        <boxGeometry args={[ROOF * 2, 2, ROOF * 2]} />
        <meshStandardMaterial map={roofTex} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR + 0.02, 0]}>
        <ringGeometry args={[10.6, 11.3, 96, 1]} />
        <meshStandardMaterial color="#e3b93c" roughness={0.7} />
      </mesh>
      {([[0, -ROOF, ROOF * 2, 0.6], [0, ROOF, ROOF * 2, 0.6], [-ROOF, 0, 0.6, ROOF * 2], [ROOF, 0, 0.6, ROOF * 2]] as const).map(([x, z, w, d], k) => (
        <mesh key={k} position={[x, FLOOR + 0.6, z]}>
          <boxGeometry args={[w, 1.2, d]} />
          <meshStandardMaterial color={mix(concrete, '#000000', 0.15)} roughness={0.9} />
        </mesh>
      ))}

      {/* String lights on posts along the parapet. */}
      <Scatter items={bulbs}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </Scatter>
      {[-ROOF + 1, 0, ROOF - 1].flatMap(t => [[t, -ROOF + 0.4], [-ROOF + 0.4, t], [ROOF - 0.4, t]]).map(([x, z], k) => (
        <mesh key={k} position={[x, FLOOR + 1.5, z]}>
          <cylinderGeometry args={[0.06, 0.06, 3, 6]} />
          <meshStandardMaterial color="#2b2e36" />
        </mesh>
      ))}

      <Scatter items={acUnits}>
        <boxGeometry />
        <meshStandardMaterial color="#8a909c" metalness={0.4} roughness={0.5} />
      </Scatter>
      <Scatter items={fans}>
        <cylinderGeometry args={[1, 1, 1, 16]} />
        <meshStandardMaterial color="#2a2d33" metalness={0.3} roughness={0.6} />
      </Scatter>

      {/* Water tower. */}
      <group position={[13, FLOOR, -13]}>
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], k) => (
          <mesh key={k} position={[x * 1.3, 1.8, z * 1.3]}><cylinderGeometry args={[0.12, 0.12, 3.6, 6]} /><meshStandardMaterial color="#3a3a3a" /></mesh>
        ))}
        <mesh position={[0, 5.2, 0]}><cylinderGeometry args={[2.2, 2.2, 3.6, 18]} /><meshStandardMaterial color="#6b4a33" roughness={0.9} /></mesh>
        <mesh position={[0, 7.6, 0]}><coneGeometry args={[2.4, 1.3, 18]} /><meshStandardMaterial color="#3b3f47" roughness={0.8} /></mesh>
      </group>

      {/* Radio mast with a blinking light. */}
      <group position={[-15.5, FLOOR, -15.5]}>
        <mesh position={[0, 6, 0]}><cylinderGeometry args={[0.08, 0.22, 12, 6]} /><meshStandardMaterial color="#9aa1ab" metalness={0.5} /></mesh>
        <mesh position={[0, 12.2, 0]}>
          <sphereGeometry args={[0.3, 10, 8]} />
          <meshStandardMaterial ref={beaconRef} color="#ff2a2a" emissive="#ff2a2a" emissiveIntensity={2} />
        </mesh>
      </group>

      {/* The city. */}
      <CityTowers items={city.towers} geometry={towerGeo} windowTex={windowTex} />
      <Scatter items={city.beacons}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color="#ff3b3b" toneMapped={false} />
      </Scatter>

      <NightSky />
    </group>
  );
}

/**
 * Stars and a moon with a soft halo, all ignoring the haze. With `horizon`,
 * also a dome that fades from that colour (the fog's) at the horizon to deep
 * navy overhead, so distant towers melt into the sky rather than a flat fill.
 */
export function NightSky({ horizon }: { horizon?: string }) {
  const glowTex = useCanvasTexture(128, 128, g => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,230,0.9)');
    grad.addColorStop(0.25, 'rgba(210,225,255,0.35)');
    grad.addColorStop(1, 'rgba(160,180,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }, []);

  const stars = useMemo(() => {
    const r = rng(99);
    const pos: number[] = [];
    for (let i = 0; i < 800; i++) {
      const a = r() * Math.PI * 2;
      const el = 0.08 + r() * 1.3; // above the horizon
      const R = 380;
      pos.push(Math.cos(a) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(a) * Math.cos(el) * R);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return g;
  }, []);

  const dome = useMemo(() => {
    if (!horizon) return null;
    const g = new SphereGeometry(700, 32, 24);
    const low = new Color(horizon);
    const mid = new Color('#151a3a');
    const top = new Color('#05070f');
    const c = new Color();
    const pos = g.getAttribute('position');
    const cols: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      // Elevation 0 at the horizon, 1 straight up; below the horizon stays haze.
      const el = Math.max(0, pos.getY(i) / 700);
      if (el < 0.25) c.copy(low).lerp(mid, Math.pow(el / 0.25, 0.7));
      else c.copy(mid).lerp(top, Math.min(1, (el - 0.25) / 0.6));
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new Float32BufferAttribute(cols, 3));
    return g;
  }, [horizon]);

  useEffect(() => () => { stars.dispose(); dome?.dispose(); }, [stars, dome]);

  return (
    <group>
      {dome && (
        <mesh geometry={dome} renderOrder={-1}>
          <meshBasicMaterial vertexColors side={BackSide} fog={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <points geometry={stars}>
        <pointsMaterial size={2} sizeAttenuation={false} color="#ffffff" fog={false} transparent opacity={0.85} />
      </points>
      <mesh position={MOON}>
        <sphereGeometry args={[11, 24, 16]} />
        <meshBasicMaterial color="#fff4d8" fog={false} toneMapped={false} />
      </mesh>
      <sprite position={MOON} scale={[110, 110, 1]}>
        <spriteMaterial map={glowTex} blending={AdditiveBlending} depthWrite={false} fog={false} transparent />
      </sprite>
    </group>
  );
}

function CityTowers({ items, geometry, windowTex }: {
  items: Inst[]; geometry: BoxGeometry; windowTex: ReturnType<typeof useCanvasTexture>;
}) {
  return (
    <Scatter items={items}>
      <primitive object={geometry} attach="geometry" />
      <meshStandardMaterial color="#ffffff" roughness={0.8} emissiveMap={windowTex} emissive="#ffffff" emissiveIntensity={1.2} />
    </Scatter>
  );
}
