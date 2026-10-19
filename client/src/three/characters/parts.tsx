// Building blocks for the procedural characters: shared unit geometries (one
// upload per renderer however many figures are on screen), a small per-figure
// material set, and a <Part> shorthand so each model reads like a parts list.

import {
  BoxGeometry, ConeGeometry, CylinderGeometry, MeshStandardMaterial, OctahedronGeometry,
  SphereGeometry, TorusGeometry, type BufferGeometry,
} from 'three';

// Unit-sized shapes, stretched per part with `scale`. Segment counts are kept
// modest: eight figures (plus phones) share the frame with the board.
const cache = new Map<string, BufferGeometry>();
function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let g = cache.get(key) as T | undefined;
  if (!g) cache.set(key, (g = make()));
  return g;
}

export const GEO = {
  sphere: cached('sphere', () => new SphereGeometry(1, 18, 14)),
  /** Low-poly sphere for tiny details (pupils, buttons). */
  dot: cached('dot', () => new SphereGeometry(1, 8, 6)),
  box: cached('box', () => new BoxGeometry(1, 1, 1)),
  cyl: cached('cyl', () => new CylinderGeometry(1, 1, 1, 16)),
  cone: cached('cone', () => new ConeGeometry(1, 1, 14)),
  /** Three-sided prism: a tricorn hat for free. */
  prism3: cached('prism3', () => new CylinderGeometry(1, 1, 1, 3)),
  star: cached('star', () => new OctahedronGeometry(1)),
  /** Tapered cylinder (top radius = `top` × bottom): robes, necks. */
  taper: (top: number) => cached(`taper${top}`, () => new CylinderGeometry(top, 1, 1, 16)),
  /** Torus with tube thickness `tube` relative to its radius; optional partial arc. */
  torus: (tube: number, arc = Math.PI * 2) =>
    cached(`torus${tube}:${arc}`, () => new TorusGeometry(1, tube, 8, 24, arc)),
};

export type MatKey =
  | 'main' | 'skin' | 'accent' | 'white' | 'ink' | 'metal' | 'gold' | 'glow' | 'glass' | 'wood'
  // Detailed characters: hair, clothes and three free colours of their own.
  | 'hair' | 'cloth' | 'denim' | 'c1' | 'c2' | 'c3';

export type Mats = Record<MatKey, MeshStandardMaterial>;

/** Per-character colour overrides for the non-player-coloured parts. */
export interface LookColors {
  skin?: string;
  accent?: string;
  glow?: string;
  hair?: string;
  cloth?: string;
  denim?: string;
  c1?: string;
  c2?: string;
  c3?: string;
  glass?: string;
}

/**
 * One material set per figure instance. The player's colour goes on `main`;
 * everything else is the character's own. Instances don't share materials
 * because each piece greys out / fades on its own (jail, bankruptcy).
 */
export function makeMaterials(color: string, c: LookColors = {}): Mats {
  const std = (color: string, roughness = 0.6, metalness = 0) =>
    new MeshStandardMaterial({ color, roughness, metalness });
  const glowColor = c.glow ?? '#7ff6ff';
  return {
    // The player's colour is glossy vinyl. Standard, not physical, materials
    // throughout: a clear coat and sheen read the same at piece size, and the
    // physical shader is the slowest of all to compile (Windows translates
    // every shader to D3D), once per figure kind on every page load.
    main: std(color, 0.32),
    skin: std(c.skin ?? '#f2c9a0', 0.62),
    accent: std(c.accent ?? '#e23b3b', 0.55),
    white: std('#f7f5ef', 0.6),
    ink: std('#15151c', 0.45),
    metal: std('#b9c2cf', 0.3, 0.75),
    gold: std('#f4c542', 0.3, 0.8),
    glow: new MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 1.4, roughness: 0.4 }),
    glass: std(c.glass ?? '#1c2438', 0.12, 0.7),
    wood: std('#7a4a24', 0.8),
    hair: std(c.hair ?? '#2a1d16', 0.75),
    cloth: std(c.cloth ?? '#1d1d22', 0.85),
    denim: std(c.denim ?? '#2f4466', 0.8),
    c1: std(c.c1 ?? '#3fa34d', 0.5),
    c2: std(c.c2 ?? '#5a1a1a', 0.6),
    c3: std(c.c3 ?? '#4a2e1c', 0.4),
  };
}

export function disposeMaterials(m: Mats) {
  for (const mat of Object.values(m)) mat.dispose();
}

type V3 = [number, number, number];

/** One mesh: unit geometry `g`, stretched by `s`, in material `m`. */
export function Part({ g, m, p, s, r, cast }: {
  g: BufferGeometry;
  m: MeshStandardMaterial;
  p?: V3;
  s?: V3 | number;
  r?: V3;
  /** Only the big parts cast shadows; specks just cost draw calls. */
  cast?: boolean;
}) {
  return <mesh geometry={g} material={m} position={p} scale={s} rotation={r} castShadow={!!cast} />;
}

/** A pair of cartoon eyes on the front of a head (coordinates relative to the head centre). */
export function Eyes({ m, y = 0.015, z = 0.09, gap = 0.04, r = 0.026, slit = false }: {
  m: Mats; y?: number; z?: number; gap?: number; r?: number; slit?: boolean;
}) {
  return (
    <>
      {[-1, 1].map(side => (
        <group key={side} position={[side * gap, y, z]}>
          <Part g={GEO.sphere} m={m.white} s={[r, r * 1.15, r * 0.7]} />
          <Part g={GEO.dot} m={m.ink} p={[0, 0, r * 0.55]} s={slit ? [r * 0.25, r * 0.8, r * 0.3] : [r * 0.55, r * 0.65, r * 0.35]} />
        </group>
      ))}
    </>
  );
}
