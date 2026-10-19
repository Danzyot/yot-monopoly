// Classic map: a cosy games room. The table stands on a round rug over a
// plank floor; behind it a papered wall with a moonlit window, a bookshelf, a
// potted plant, an armchair and a floor lamp whose warm pool of light is the
// room's mood. The front of the room is left open for the camera.

import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { Theme } from '../../../../shared/themes.ts';
import { FLOOR, Scatter, mix, rng, speckle, useCanvasTexture, type Inst } from './common.tsx';

const BACK = -17;   // back wall z
const SIDE = 20;    // side walls at ±x
const WALL_H = 16;

/** `ownLights` false: no lights of its own (a baked set's stand-in, lit by the set's lights while that loads). */
export function Lounge({ theme, ownLights = true }: { theme: Theme; ownLights?: boolean }) {
  const { accent, table, sky } = theme.palette;
  const woodFloor = mix('#6a4529', table, 0.3);
  const wall = mix('#5d4838', sky, 0.3);
  const trim = mix('#3a281c', table, 0.35);
  const rugBase = mix(accent, '#2b1813', 0.6);
  const rugEdge = mix(accent, '#ecd8b0', 0.35);

  const floorTex = useCanvasTexture(512, 512, g => {
    // Planks: rows of boards with staggered joints and a little tone variation.
    const r = rng(11);
    const rows = 8;
    const h = 512 / rows;
    for (let y = 0; y < rows; y++) {
      let x = -r() * 200;
      while (x < 512) {
        const w = 160 + r() * 200;
        g.fillStyle = mix(woodFloor, r() > 0.5 ? '#000000' : '#ffffff', r() * 0.12);
        g.fillRect(x, y * h, w, h);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x, y * h, 2, h);
        x += w;
      }
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(0, y * h, 512, 2);
    }
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
      g.fillRect(r() * 512, r() * 512, 10 + r() * 60, 1);
    }
  }, [woodFloor], [5, 5]);

  const rugTex = useCanvasTexture(512, 512, g => {
    const c = 256;
    const ring = (r: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.fill();
    };
    ring(256, rugEdge);
    ring(236, rugBase);
    ring(214, rugEdge);
    ring(206, mix(rugBase, '#000000', 0.15));
    // A ring of diamonds between the borders.
    g.fillStyle = rugEdge;
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      g.save();
      g.translate(c + Math.cos(a) * 225, c + Math.sin(a) * 225);
      g.rotate(a + Math.PI / 4);
      g.fillRect(-5, -5, 10, 10);
      g.restore();
    }
    const r = rng(5);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.05})`;
      g.fillRect(r() * 512, r() * 512, 2, 2);
    }
  }, [rugBase, rugEdge]);

  const wallTex = useCanvasTexture(256, 256, g => {
    // Faint vertical wallpaper stripes.
    g.fillStyle = wall;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.045)';
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 12, 256);
    speckle(g, 'rgba(0,0,0,0)', 0.05, 3);
  }, [wall], [10, 3]);

  const windowTex = useCanvasTexture(256, 200, g => {
    const grad = g.createLinearGradient(0, 0, 0, 200);
    grad.addColorStop(0, '#0b1230');
    grad.addColorStop(1, mix('#2b3f73', sky, 0.3));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 200);
    const r = rng(9);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
      g.fillRect(r() * 256, r() * 140, 1.5, 1.5);
    }
    const glow = g.createRadialGradient(190, 55, 4, 190, 55, 50);
    glow.addColorStop(0, 'rgba(255,248,220,0.9)');
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    g.fillStyle = glow;
    g.fillRect(120, 0, 136, 120);
    g.fillStyle = '#fff6da';
    g.beginPath();
    g.arc(190, 55, 16, 0, Math.PI * 2);
    g.fill();
    // Rooftops across the street.
    g.fillStyle = '#070a18';
    for (let x = 0; x < 256; x += 22 + r() * 18) g.fillRect(x, 150 - r() * 40, 20 + r() * 16, 80);
  }, [sky]);

  const books = useMemo<Inst[]>(() => {
    const r = rng(21);
    const colors = ['#8c2f39', '#2f5d8c', '#3c7a4a', '#c9a227', '#6b3f8c', '#b5651d', '#e8e0cc', accent];
    const out: Inst[] = [];
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = FLOOR + 0.6 + shelf * 2.6;
      let x = -2.7;
      while (x < 2.6) {
        const w = 0.22 + r() * 0.25;
        const h = 1.3 + r() * 0.7;
        if (r() > 0.93) { x += 0.4; continue; } // the odd gap
        out.push({ p: [x + w / 2, y + h / 2, 0], s: [w, h, 1 + r() * 0.2], c: colors[Math.floor(r() * colors.length)] });
        x += w + 0.02;
      }
    }
    return out;
  }, [accent]);

  return (
    <group>
      {ownLights && (
        <>
          <hemisphereLight args={['#ffe2bd', mix(table, '#000000', 0.4), 0.55]} />
          {/* Floor lamp: the warm pool of light the room is built around. */}
          <pointLight position={[13.5, FLOOR + 9.2, -9]} color="#ffb46b" intensity={320} decay={2} />
          <pointLight position={[-8, FLOOR + 10, -13]} color={accent} intensity={60} decay={2} />
        </>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR, 0]} receiveShadow>
        <planeGeometry args={[SIDE * 2, 60]} />
        <meshStandardMaterial map={floorTex} roughness={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR + 0.02, 0]}>
        <circleGeometry args={[12.8, 64]} />
        <meshStandardMaterial map={rugTex} roughness={1} />
      </mesh>

      {/* Walls with a skirting board. */}
      <mesh position={[0, FLOOR + WALL_H / 2, BACK]}>
        <planeGeometry args={[SIDE * 2, WALL_H]} />
        <meshStandardMaterial map={wallTex} roughness={0.95} />
      </mesh>
      {[-1, 1].map(s => (
        <mesh key={s} position={[s * SIDE, FLOOR + WALL_H / 2, BACK + 30]} rotation={[0, -s * Math.PI / 2, 0]}>
          <planeGeometry args={[60, WALL_H]} />
          <meshStandardMaterial map={wallTex} roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[0, FLOOR + 0.6, BACK + 0.15]}>
        <boxGeometry args={[SIDE * 2, 1.2, 0.3]} />
        <meshStandardMaterial color={trim} roughness={0.7} />
      </mesh>
      <mesh position={[0, FLOOR + 4.2, BACK + 0.12]}>
        <boxGeometry args={[SIDE * 2, 0.25, 0.24]} />
        <meshStandardMaterial color={trim} roughness={0.7} />
      </mesh>

      {/* Window with curtains. */}
      <group position={[5, FLOOR + 8.5, BACK + 0.1]}>
        <mesh position={[0, 0, -0.05]}>
          <boxGeometry args={[10.8, 8.8, 0.3]} />
          <meshStandardMaterial color={trim} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.12]}>
          <planeGeometry args={[10, 8]} />
          <meshBasicMaterial map={windowTex} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.2]}><boxGeometry args={[0.25, 8, 0.15]} /><meshStandardMaterial color={trim} /></mesh>
        <mesh position={[0, 0, 0.2]}><boxGeometry args={[10, 0.25, 0.15]} /><meshStandardMaterial color={trim} /></mesh>
        <mesh position={[0, -4.6, 0.4]}><boxGeometry args={[11.6, 0.35, 0.9]} /><meshStandardMaterial color={trim} /></mesh>
        {[-1, 1].map(s => (
          <mesh key={s} position={[s * 6.4, -0.6, 0.5]}>
            <boxGeometry args={[2.2, 10.4, 0.4]} />
            <meshStandardMaterial color={mix(accent, '#4a1c1c', 0.55)} roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 5, 0.6]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.12, 0.12, 15, 8]} />
          <meshStandardMaterial color="#b08d57" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>

      {/* Bookshelf. */}
      <group position={[-10, 0, BACK + 0.9]}>
        <mesh position={[0, FLOOR + 5.5, -0.6]}><boxGeometry args={[6.2, 11, 0.2]} /><meshStandardMaterial color={trim} /></mesh>
        {[-1, 1].map(s => (
          <mesh key={s} position={[s * 3, FLOOR + 5.5, 0]}><boxGeometry args={[0.3, 11, 1.4]} /><meshStandardMaterial color={trim} /></mesh>
        ))}
        {[0, 1, 2, 3, 4].map(k => (
          <mesh key={k} position={[0, FLOOR + 0.35 + k * 2.6, 0]}><boxGeometry args={[6.2, 0.25, 1.4]} /><meshStandardMaterial color={trim} /></mesh>
        ))}
        <Scatter items={books}>
          <boxGeometry />
          <meshStandardMaterial roughness={0.8} />
        </Scatter>
      </group>

      {/* Armchair, turned toward the table. */}
      <group position={[-14.5, FLOOR, -3]} rotation={[0, Math.PI / 2.3, 0]}>
        {([
          [[0, 1.1, 0], [4, 1.4, 3.6]],
          [[0, 3.2, -1.5], [4, 3.6, 0.9]],
          [[-2.1, 2, 0], [0.9, 2.4, 3.6]],
          [[2.1, 2, 0], [0.9, 2.4, 3.6]],
        ] as const).map(([p, s], k) => (
          <mesh key={k} position={[p[0], p[1], p[2]]}>
            <boxGeometry args={[s[0], s[1], s[2]]} />
            <meshStandardMaterial color={mix('#355a52', accent, 0.2)} roughness={0.95} />
          </mesh>
        ))}
        <mesh position={[0, 2, 0.2]}><boxGeometry args={[3.2, 0.5, 3]} /><meshStandardMaterial color={mix('#406a61', accent, 0.2)} roughness={1} /></mesh>
      </group>

      {/* Potted plant in the corner. */}
      <group position={[16.5, FLOOR, -14.5]}>
        <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[1.3, 0.9, 2.4, 16]} /><meshStandardMaterial color="#a0522d" roughness={0.9} /></mesh>
        {Array.from({ length: 9 }, (_, k) => {
          const a = (k / 9) * Math.PI * 2;
          const tilt = 0.35 + (k % 3) * 0.2;
          return (
            <mesh key={k} position={[Math.sin(a) * 0.9, 3.6 + (k % 3) * 0.6, Math.cos(a) * 0.9]} rotation={[Math.cos(a) * tilt, 0, -Math.sin(a) * tilt]} scale={[0.6, 2.4, 0.25]}>
              <sphereGeometry args={[1, 10, 8]} />
              <meshStandardMaterial color={k % 2 ? '#2f7a3f' : '#3d8f4c'} roughness={0.8} />
            </mesh>
          );
        })}
      </group>

      {/* Floor lamp. */}
      <group position={[13.5, FLOOR, -9]}>
        <mesh position={[0, 0.1, 0]}><cylinderGeometry args={[1, 1.1, 0.2, 20]} /><meshStandardMaterial color="#2a2a2a" metalness={0.5} roughness={0.5} /></mesh>
        <mesh position={[0, 4.6, 0]}><cylinderGeometry args={[0.1, 0.1, 9, 8]} /><meshStandardMaterial color="#b08d57" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 9.4, 0]}>
          <cylinderGeometry args={[1.1, 1.8, 1.8, 20, 1, true]} />
          <meshStandardMaterial color="#f3dcb2" emissive="#ffb46b" emissiveIntensity={0.9} side={DoubleSide} roughness={0.9} />
        </mesh>
      </group>

      {/* A little side table with a mug, beside the armchair. */}
      <group position={[-14, FLOOR, -10.5]}>
        <mesh position={[0, 2.2, 0]}><cylinderGeometry args={[1.4, 1.4, 0.2, 20]} /><meshStandardMaterial color={trim} /></mesh>
        <mesh position={[0, 1.1, 0]}><cylinderGeometry args={[0.15, 0.2, 2.2, 8]} /><meshStandardMaterial color={trim} /></mesh>
        <mesh position={[0.3, 2.65, 0]}><cylinderGeometry args={[0.35, 0.3, 0.7, 14]} /><meshStandardMaterial color={accent} roughness={0.4} /></mesh>
      </group>
    </group>
  );
}
