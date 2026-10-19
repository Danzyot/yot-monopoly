// Speedway map: the table sits in the infield of a floodlit race track at
// dusk. Asphalt all round, a painted loop with red-and-white kerbs and a
// dashed centre line, a chequered start line, two grandstands packed with a
// (instanced) crowd, tyre walls and four floodlight towers.

import { useMemo } from 'react';
import type { Theme } from '../../../../shared/themes.ts';
import { FLOOR, Scatter, mix, rng, speckle, useCanvasTexture, type Inst } from './common.tsx';

const TRACK_IN = 13.5;
const TRACK_OUT = 19;
const MID = (TRACK_IN + TRACK_OUT) / 2;
/** Where the start/finish line crosses the track: back-left, in view of the default camera. */
const START_ANGLE = -Math.PI / 2 - 0.55;

/** Point on a circle of radius r at angle a (0 = +x, −π/2 = back of the table). */
const polar = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];

/** `ownLights` false: no lights of its own (a baked set's stand-in, lit by the set's lights while that loads). */
export function Speedway({ theme, ownLights = true }: { theme: Theme; ownLights?: boolean }) {
  const { accent, sky } = theme.palette;
  const asphalt = '#2c2e33';

  const groundTex = useCanvasTexture(256, 256, g => speckle(g, '#3a3d42', 0.25, 4), [], [24, 24]);
  const trackTex = useCanvasTexture(256, 256, g => speckle(g, asphalt, 0.3, 8), [], [30, 6]);
  const grassTex = useCanvasTexture(256, 256, g => {
    // Mown stripes on the infield.
    g.fillStyle = '#2f6a36';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 32, 256);
    speckle(g, 'rgba(0,0,0,0)', 0.08, 2);
  }, [], [6, 6]);
  const checkerTex = useCanvasTexture(128, 32, g => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111111' : '#f5f5f5';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }, []);

  const kerbs = useMemo(() => {
    const red: Inst[] = [];
    const white: Inst[] = [];
    for (const r of [TRACK_IN - 0.3, TRACK_OUT + 0.3]) {
      const n = Math.round((Math.PI * 2 * r) / 1.1);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const [x, z] = polar(r, a);
        (k % 2 ? red : white).push({ p: [x, FLOOR + 0.06, z], s: [0.6, 0.12, 1.1], ry: -a });
      }
    }
    return { red, white };
  }, []);

  const dashes = useMemo<Inst[]>(() => {
    const n = 44;
    return Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      const [x, z] = polar(MID, a);
      return { p: [x, FLOOR + 0.03, z], s: [0.18, 0.02, 1.2], ry: -a };
    });
  }, []);

  // Two grandstands behind the track, facing the table, and their crowd.
  const stands = useMemo(() => {
    const r = rng(33);
    const shirts = ['#e6194b', '#3cb4ff', '#ffd23f', '#3ddc84', '#f5f5f5', '#ff8c1a', accent, '#b15cff'];
    const crowd: Inst[] = [];
    const blocks: { a: number; rows: number }[] = [{ a: -Math.PI / 2 + 0.55, rows: 5 }, { a: -Math.PI / 2 - 1.25, rows: 5 }];
    for (const b of blocks) {
      for (let row = 0; row < b.rows; row++) {
        const rr = 23 + row * 1.2;
        for (let s = -9; s <= 9; s++) {
          if (r() < 0.12) continue; // empty seats
          const a = b.a + (s * 0.6) / rr;
          const [x, z] = polar(rr, a);
          crowd.push({ p: [x, FLOOR + 1.2 + row * 0.9 + 0.35, z], s: [0.42, 0.7, 0.36], ry: -a + Math.PI / 2, c: shirts[Math.floor(r() * shirts.length)] });
        }
      }
    }
    return { blocks, crowd };
  }, [accent]);

  const tyres = useMemo<Inst[]>(() => {
    const out: Inst[] = [];
    for (const a of [-0.25, 0.3, Math.PI - 0.3, Math.PI + 0.35, Math.PI / 2 + 0.6, Math.PI / 2 - 0.6]) {
      for (let k = -2; k <= 2; k++) {
        const aa = a + k * 0.045;
        for (let h = 0; h < 2; h++) {
          const [x, z] = polar(TRACK_OUT + 1.6, aa);
          out.push({ p: [x, FLOOR + 0.22 + h * 0.4, z], s: 1 });
        }
      }
    }
    return out;
  }, []);

  const towers: [number, number][] = [[-23, -17], [23, -17], [-25, 9], [25, 9]];
  const [sx, sz] = polar(MID, START_ANGLE);
  const standColor = mix('#6f7680', sky, 0.2);

  return (
    <group>
      {ownLights && (
        <>
          <hemisphereLight args={['#c9d8ff', '#2a2622', 0.6]} />
          {/* Floodlights wash the infield; no shadows, they would cost a map each. */}
          {towers.slice(0, 2).map(([x, z], k) => (
            <spotLight key={k} position={[x, FLOOR + 22, z]} angle={0.55} penumbra={0.6} intensity={900} decay={2} color="#eef4ff" />
          ))}
          <pointLight position={[0, FLOOR + 3, -22]} color={accent} intensity={80} decay={2} />
        </>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR - 0.01, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial map={groundTex} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR, 0]}>
        <circleGeometry args={[TRACK_IN - 0.6, 64]} />
        <meshStandardMaterial map={grassTex} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR + 0.01, 0]}>
        <ringGeometry args={[TRACK_IN, TRACK_OUT, 96, 1]} />
        <meshStandardMaterial map={trackTex} roughness={0.9} />
      </mesh>
      {[TRACK_IN + 0.25, TRACK_OUT - 0.25].map(r => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR + 0.02, 0]}>
          <ringGeometry args={[r - 0.08, r + 0.08, 96, 1]} />
          <meshStandardMaterial color="#f2f2f2" roughness={0.6} />
        </mesh>
      ))}
      <Scatter items={dashes}><boxGeometry /><meshStandardMaterial color="#f2d64b" roughness={0.6} /></Scatter>
      <Scatter items={kerbs.red}><boxGeometry /><meshStandardMaterial color="#d62828" roughness={0.6} /></Scatter>
      <Scatter items={kerbs.white}><boxGeometry /><meshStandardMaterial color="#f2f2f2" roughness={0.6} /></Scatter>
      <mesh position={[sx, FLOOR + 0.035, sz]} rotation={[-Math.PI / 2, 0, -START_ANGLE]}>
        <planeGeometry args={[TRACK_OUT - TRACK_IN, 1.4]} />
        <meshStandardMaterial map={checkerTex} roughness={0.6} />
      </mesh>
      {/* Start gantry over the line. */}
      <group position={[sx, FLOOR, sz]} rotation={[0, -START_ANGLE, 0]}>
        {[-1, 1].map(s => (
          <mesh key={s} position={[s * ((TRACK_OUT - TRACK_IN) / 2 + 0.8), 3, 0]}>
            <boxGeometry args={[0.35, 6, 0.35]} />
            <meshStandardMaterial color="#9aa1ab" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 6, 0]}>
          <boxGeometry args={[TRACK_OUT - TRACK_IN + 2.2, 0.9, 0.4]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.35} roughness={0.5} />
        </mesh>
      </group>

      <Scatter items={tyres}>
        <cylinderGeometry args={[0.42, 0.42, 0.38, 14]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </Scatter>

      {/* Grandstands: stepped tiers with a roof. */}
      {stands.blocks.map((b, i) => (
        <group key={i} rotation={[0, -b.a - Math.PI / 2, 0]}>
          {Array.from({ length: b.rows }, (_, row) => (
            <mesh key={row} position={[0, FLOOR + 0.6 + row * 0.45, -(23 + row * 1.2)]}>
              <boxGeometry args={[12, 1.2 + row * 0.9, 1.2]} />
              <meshStandardMaterial color={row % 2 ? standColor : mix(standColor, accent, 0.25)} roughness={0.85} />
            </mesh>
          ))}
          {[-6, 6].map(x => (
            <mesh key={x} position={[x, FLOOR + 4.5, -(23 + b.rows * 1.2)]}>
              <boxGeometry args={[0.3, 9, 0.3]} />
              <meshStandardMaterial color="#9aa1ab" />
            </mesh>
          ))}
          <mesh position={[0, FLOOR + 9, -(23 + (b.rows * 1.2) / 2)]} rotation={[0.12, 0, 0]}>
            <boxGeometry args={[12.8, 0.25, b.rows * 1.2 + 1.5]} />
            <meshStandardMaterial color={mix('#d9dde3', accent, 0.3)} roughness={0.6} />
          </mesh>
        </group>
      ))}
      <Scatter items={stands.crowd}><boxGeometry /><meshStandardMaterial roughness={0.8} /></Scatter>

      {/* Floodlight towers. */}
      {towers.map(([x, z], k) => (
        <group key={k} position={[x, FLOOR, z]} rotation={[0, Math.atan2(-x, -z), 0]}>
          <mesh position={[0, 11, 0]}><cylinderGeometry args={[0.25, 0.4, 22, 8]} /><meshStandardMaterial color="#8d949e" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, 22, 0.3]} rotation={[0.5, 0, 0]}>
            <boxGeometry args={[3.2, 2, 0.4]} />
            <meshStandardMaterial color="#30343a" />
          </mesh>
          <mesh position={[0, 22, 0.52]} rotation={[0.5, 0, 0]}>
            <planeGeometry args={[2.9, 1.7]} />
            <meshBasicMaterial color="#fffbe8" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
