// The ten characters, as parts lists on a shared chibi rig: a big head on a
// small body, mitten hands and stubby feet. Every figure faces +z, stands on
// y = 0 and is about 0.45 units tall (tiles are 0.73–1.14 wide). Head parts
// are relative to the head centre so the rig can nod and slump the head.
//
// Silhouettes are designed for the default camera, which looks down at the
// board at ~50°: what reads from there is the top of the head, so every
// character's identity is in its hat / hair / ears / helmet.

import type { ReactNode } from 'react';
import type { CharacterId } from '../../../../shared/characters.ts';
import { Eyes, GEO, Part, type LookColors, type MatKey, type Mats } from './parts.tsx';

export const HEAD_Y = 0.29;

export interface Look {
  colors?: LookColors;
  hand: MatKey;
  foot: MatKey;
  /** Replaces the default egg-shaped body. */
  body?: (m: Mats) => ReactNode;
  /** Added on top of the body (belly, belt, tail, backpack…). */
  extras?: (m: Mats) => ReactNode;
  head: (m: Mats) => ReactNode;
  /** Held in the left (+x) / right (−x) hand. */
  left?: (m: Mats) => ReactNode;
  right?: (m: Mats) => ReactNode;
  /** Real arms: a limb from each shoulder (left side, +x; mirrored) to the hand, following the rig. */
  arms?: { shoulder: [number, number, number]; radius: number; mat: MatKey };
  /** Real legs: hip (left side; mirrored) to the stepping foot. Absent: the body hides them (robes). */
  legs?: { hip: [number, number, number]; radius: number; mat: MatKey };
}

const PI = Math.PI;

/** Egg body in the player's colour; most characters use it. */
export function DefaultBody({ m, mat = 'main' }: { m: Mats; mat?: MatKey }) {
  return <Part g={GEO.sphere} m={m[mat]} p={[0, 0.12, 0]} s={[0.085, 0.095, 0.075]} cast />;
}

const Belt = ({ m, mat = 'ink' as MatKey, y = 0.085 }: { m: Mats; mat?: MatKey; y?: number }) => (
  <Part g={GEO.torus(0.22)} m={m[mat]} p={[0, y, 0]} s={0.078} r={[PI / 2, 0, 0]} />
);

// Spiky: the hedgehog-ish mascot. Swept-back quills are the silhouette.
const SPIKES: [number, number, number, number, number][] = [
  [0, 0.075, -0.03, -0.75, 0],
  [-0.058, 0.055, -0.035, -0.85, 0.5],
  [0.058, 0.055, -0.035, -0.85, -0.5],
  [-0.042, -0.005, -0.08, -1.35, 0.4],
  [0.042, -0.005, -0.08, -1.35, -0.4],
  [0, -0.055, -0.08, -1.75, 0],
];

const spiky: Look = {
  colors: { skin: '#f6dcb4', accent: '#e0262d', c1: '#2f9e4f' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.017, mat: 'main' },
  legs: { hip: [0.034, 0.07, 0], radius: 0.022, mat: 'main' },
  hand: 'white',
  foot: 'accent',
  extras: m => <Part g={GEO.sphere} m={m.skin} p={[0, 0.11, 0.045]} s={[0.058, 0.066, 0.036]} />,
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.main} s={0.11} cast />
      {SPIKES.map(([x, y, z, rx, rz], k) => (
        <Part key={k} g={GEO.cone} m={m.main} p={[x, y, z]} r={[rx, 0, rz]} s={[0.045, 0.16, 0.045]} cast />
      ))}
      <Part g={GEO.cone} m={m.main} p={[-0.07, 0.085, 0.01]} r={[0, 0, 0.5]} s={[0.03, 0.06, 0.03]} />
      <Part g={GEO.cone} m={m.main} p={[0.07, 0.085, 0.01]} r={[0, 0, -0.5]} s={[0.03, 0.06, 0.03]} />
      <Part g={GEO.sphere} m={m.skin} p={[0, -0.04, 0.075]} s={[0.065, 0.048, 0.045]} />
      <Part g={GEO.dot} m={m.ink} p={[0, -0.022, 0.118]} s={0.016} />
      <Eyes m={m} y={0.025} z={0.085} gap={0.034} r={0.03} />
    </>
  ),
};

const robot: Look = {
  colors: { glow: '#63f3ff' },
  arms: { shoulder: [0.085, 0.165, 0], radius: 0.012, mat: 'metal' },
  legs: { hip: [0.034, 0.068, 0], radius: 0.014, mat: 'metal' },
  hand: 'metal',
  foot: 'metal',
  body: m => (
    <>
      <Part g={GEO.box} m={m.main} p={[0, 0.12, 0]} s={[0.16, 0.15, 0.12]} cast />
      <Part g={GEO.box} m={m.glass} p={[0, 0.135, 0.061]} s={[0.08, 0.05, 0.004]} />
      <Part g={GEO.dot} m={m.glow} p={[-0.02, 0.135, 0.064]} s={0.009} />
      <Part g={GEO.dot} m={m.accent} p={[0.02, 0.135, 0.064]} s={0.009} />
      <Part g={GEO.cyl} m={m.metal} p={[0, 0.03, 0]} s={[0.05, 0.04, 0.05]} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.box} m={m.metal} s={[0.2, 0.165, 0.17]} cast />
      <Part g={GEO.box} m={m.glass} p={[0, 0.005, 0.083]} s={[0.165, 0.075, 0.012]} />
      <Part g={GEO.dot} m={m.glow} p={[-0.037, 0.005, 0.09]} s={[0.022, 0.016, 0.01]} />
      <Part g={GEO.dot} m={m.glow} p={[0.037, 0.005, 0.09]} s={[0.022, 0.016, 0.01]} />
      <Part g={GEO.cyl} m={m.main} p={[-0.105, 0, 0]} r={[0, 0, PI / 2]} s={[0.04, 0.025, 0.04]} />
      <Part g={GEO.cyl} m={m.main} p={[0.105, 0, 0]} r={[0, 0, PI / 2]} s={[0.04, 0.025, 0.04]} />
      <Part g={GEO.cyl} m={m.metal} p={[0, 0.12, 0]} s={[0.008, 0.08, 0.008]} />
      <Part g={GEO.sphere} m={m.glow} p={[0, 0.165, 0]} s={0.026} />
      <Part g={GEO.box} m={m.main} p={[0, 0.085, 0]} s={[0.12, 0.012, 0.12]} />
    </>
  ),
};

const cat: Look = {
  colors: { accent: '#ff8fb3', c1: '#7bc043' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.017, mat: 'main' },
  legs: { hip: [0.034, 0.07, 0], radius: 0.022, mat: 'main' },
  hand: 'main',
  foot: 'white',
  extras: m => (
    <>
      <Part g={GEO.sphere} m={m.white} p={[0, 0.105, 0.045]} s={[0.05, 0.06, 0.035]} />
      <Part g={GEO.torus(0.2, PI * 1.25)} m={m.main} p={[0, 0.16, -0.1]} r={[0, PI / 2, -0.5]} s={0.075} cast />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.main} s={[0.115, 0.1, 0.105]} cast />
      {[-1, 1].map(side => (
        <group key={side} position={[side * 0.062, 0.085, -0.005]} rotation={[0, 0, -side * 0.35]}>
          <Part g={GEO.cone} m={m.main} s={[0.042, 0.085, 0.03]} cast />
          <Part g={GEO.cone} m={m.accent} p={[0, -0.006, 0.018]} s={[0.024, 0.055, 0.01]} />
        </group>
      ))}
      <Part g={GEO.sphere} m={m.white} p={[0, -0.04, 0.078]} s={[0.055, 0.035, 0.035]} />
      <Part g={GEO.dot} m={m.accent} p={[0, -0.02, 0.108]} s={[0.014, 0.01, 0.01]} />
      {[-1, 1].map(side => [-0.012, 0.004].map(dy => (
        <Part key={`${side}${dy}`} g={GEO.box} m={m.ink} p={[side * 0.085, -0.035 + dy, 0.07]} r={[0, side * -0.4, side * dy * 12]} s={[0.07, 0.003, 0.003]} />
      )))}
      <Eyes m={m} y={0.015} z={0.08} gap={0.042} r={0.027} slit />
    </>
  ),
};

const knight: Look = {
  colors: { accent: '#f4c542', c1: '#d23a2e' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.017, mat: 'metal' },
  legs: { hip: [0.034, 0.07, 0], radius: 0.024, mat: 'metal' },
  hand: 'metal',
  foot: 'metal',
  extras: m => (
    <>
      <Part g={GEO.sphere} m={m.metal} p={[-0.08, 0.17, 0]} s={[0.042, 0.032, 0.045]} />
      <Part g={GEO.sphere} m={m.metal} p={[0.08, 0.17, 0]} s={[0.042, 0.032, 0.045]} />
      <Part g={GEO.box} m={m.gold} p={[0, 0.12, 0.074]} s={[0.012, 0.07, 0.006]} />
      <Part g={GEO.box} m={m.gold} p={[0, 0.135, 0.072]} s={[0.05, 0.012, 0.006]} />
      <Belt m={m} mat="metal" y={0.07} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.metal} s={[0.108, 0.115, 0.108]} cast />
      <Part g={GEO.box} m={m.ink} p={[0, 0.012, 0.1]} s={[0.12, 0.02, 0.03]} />
      <Part g={GEO.box} m={m.ink} p={[0, -0.025, 0.103]} s={[0.018, 0.06, 0.02]} />
      <Part g={GEO.box} m={m.metal} p={[0, 0.02, 0]} s={[0.018, 0.2, 0.226]} />
      {[0, 1, 2].map(k => (
        <Part key={k} g={GEO.sphere} m={m.main} p={[0, 0.125 + (k === 1 ? 0.02 : 0), 0.035 - k * 0.06]} s={[0.03, 0.05, 0.045]} cast />
      ))}
    </>
  ),
  left: m => (
    <group position={[0.025, 0.005, 0.02]} rotation={[0, 0, PI / 2]}>
      <Part g={GEO.cyl} m={m.gold} s={[0.065, 0.012, 0.065]} cast />
      <Part g={GEO.cyl} m={m.main} p={[0, -0.004, 0]} s={[0.052, 0.012, 0.052]} />
    </group>
  ),
  right: m => (
    <group position={[0, 0.07, 0.02]}>
      <Part g={GEO.box} m={m.metal} s={[0.014, 0.16, 0.006]} />
      <Part g={GEO.box} m={m.gold} p={[0, -0.07, 0]} s={[0.05, 0.012, 0.012]} />
    </group>
  ),
};

const wizard: Look = {
  colors: { glow: '#b8f0ff', accent: '#f4c542', c3: '#3a5a8c' },
  arms: { shoulder: [0.065, 0.17, 0], radius: 0.02, mat: 'main' },
  hand: 'skin',
  foot: 'ink',
  body: m => (
    <>
      <Part g={GEO.taper(0.5)} m={m.main} p={[0, 0.105, 0]} s={[0.1, 0.21, 0.09]} cast />
      <Belt m={m} mat="gold" y={0.12} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.skin} s={0.098} cast />
      <Part g={GEO.cone} m={m.white} p={[0, -0.09, 0.055]} r={[PI - 0.25, 0, 0]} s={[0.07, 0.15, 0.05]} />
      <Part g={GEO.sphere} m={m.white} p={[0, -0.02, 0.085]} s={[0.05, 0.02, 0.02]} />
      <Part g={GEO.dot} m={m.skin} p={[0, 0.0, 0.1]} s={0.02} />
      <Part g={GEO.cyl} m={m.main} p={[0, 0.06, 0]} s={[0.15, 0.014, 0.15]} cast />
      <Part g={GEO.cone} m={m.main} p={[0, 0.17, -0.025]} r={[-0.3, 0, 0.1]} s={[0.1, 0.23, 0.1]} cast />
      <Part g={GEO.star} m={m.gold} p={[0.0, 0.15, 0.055]} s={[0.02, 0.026, 0.008]} />
      <Eyes m={m} y={0.02} z={0.078} gap={0.034} r={0.02} />
    </>
  ),
  right: m => (
    <group position={[0, 0.08, 0]}>
      <Part g={GEO.cyl} m={m.wood} s={[0.01, 0.32, 0.01]} />
      <Part g={GEO.sphere} m={m.glow} p={[0, 0.17, 0]} s={0.028} />
    </group>
  ),
};

const astronaut: Look = {
  colors: { accent: '#ff7a1a', glass: '#141a2e' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.018, mat: 'white' },
  legs: { hip: [0.034, 0.07, 0], radius: 0.026, mat: 'white' },
  hand: 'white',
  foot: 'white',
  body: m => <DefaultBody m={m} mat="white" />,
  extras: m => (
    <>
      <Part g={GEO.box} m={m.main} p={[0, 0.14, -0.075]} s={[0.13, 0.14, 0.06]} cast />
      <Belt m={m} mat="main" y={0.085} />
      <Part g={GEO.box} m={m.accent} p={[0.03, 0.145, 0.07]} s={[0.035, 0.028, 0.008]} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.white} s={0.12} cast />
      <Part g={GEO.sphere} m={m.glass} p={[0, 0.005, 0.07]} s={[0.092, 0.075, 0.06]} />
      <Part g={GEO.sphere} m={m.white} p={[-0.03, 0.03, 0.12]} s={[0.012, 0.008, 0.004]} />
      <Part g={GEO.torus(0.25)} m={m.main} p={[0, -0.095, 0]} r={[PI / 2, 0, 0]} s={0.075} />
      <Part g={GEO.cyl} m={m.main} p={[-0.118, 0.01, 0]} r={[0, 0, PI / 2]} s={[0.03, 0.02, 0.03]} />
      <Part g={GEO.cyl} m={m.metal} p={[0.08, 0.12, -0.02]} r={[0, 0, -0.3]} s={[0.006, 0.07, 0.006]} />
      <Part g={GEO.dot} m={m.accent} p={[0.092, 0.155, -0.02]} s={0.014} />
    </>
  ),
};

const pirate: Look = {
  colors: { accent: '#f4c542', hair: '#5a3a22', c3: '#3b6b8c' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.018, mat: 'main' },
  legs: { hip: [0.034, 0.068, 0], radius: 0.024, mat: 'ink' },
  hand: 'skin',
  foot: 'ink',
  extras: m => (
    <>
      <Belt m={m} mat="ink" y={0.08} />
      <Part g={GEO.box} m={m.gold} p={[0, 0.08, 0.078]} s={[0.03, 0.024, 0.008]} />
      <Part g={GEO.box} m={m.white} p={[0, 0.16, 0.064]} s={[0.035, 0.05, 0.01]} r={[-0.3, 0, 0]} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.skin} s={0.1} cast />
      <Part g={GEO.prism3} m={m.ink} p={[0, 0.075, -0.005]} r={[-0.15, PI / 6 + PI, 0]} s={[0.17, 0.06, 0.17]} cast />
      <Part g={GEO.sphere} m={m.ink} p={[0, 0.095, -0.01]} s={[0.085, 0.06, 0.085]} cast />
      <Part g={GEO.torus(0.12)} m={m.gold} p={[0, 0.058, -0.005]} r={[PI / 2, 0, 0]} s={0.1} />
      <Part g={GEO.dot} m={m.white} p={[0, 0.1, 0.07]} s={[0.018, 0.018, 0.01]} />
      <Part g={GEO.cyl} m={m.ink} p={[-0.036, 0.015, 0.088]} r={[PI / 2, 0, 0]} s={[0.026, 0.01, 0.026]} />
      <Part g={GEO.torus(0.06)} m={m.ink} p={[0, 0.02, 0]} r={[PI / 2 - 0.3, 0, 0.25]} s={0.102} />
      <Part g={GEO.sphere} m={m.main} p={[0, -0.075, 0.04]} s={[0.07, 0.035, 0.05]} />
      <Part g={GEO.dot} m={m.skin} p={[0, -0.005, 0.1]} s={0.019} />
      <Eyes m={m} y={0.015} z={0.08} gap={0.036} r={0.022} />
    </>
  ),
  right: m => (
    <group position={[0, -0.02, 0.02]}>
      <Part g={GEO.torus(0.25, PI * 1.3)} m={m.metal} p={[0, -0.02, 0]} r={[0, PI / 2, PI]} s={0.03} />
    </group>
  ),
};

const ninja: Look = {
  colors: { accent: '#e0262d', c3: '#4a2e1c' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.016, mat: 'main' },
  legs: { hip: [0.034, 0.07, 0], radius: 0.023, mat: 'main' },
  hand: 'main',
  foot: 'ink',
  extras: m => (
    <>
      <Belt m={m} mat="ink" y={0.09} />
      <group position={[0, 0.17, -0.075]} rotation={[0.15, 0, 0.7]}>
        <Part g={GEO.box} m={m.metal} p={[0, 0.03, 0]} s={[0.016, 0.24, 0.006]} />
        <Part g={GEO.box} m={m.ink} p={[0, -0.11, 0]} s={[0.022, 0.07, 0.012]} />
        <Part g={GEO.box} m={m.gold} p={[0, -0.075, 0]} s={[0.04, 0.008, 0.016]} />
      </group>
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.main} s={0.105} cast />
      <Part g={GEO.sphere} m={m.skin} p={[0, 0.012, 0.066]} s={[0.078, 0.042, 0.046]} />
      <Part g={GEO.torus(0.12)} m={m.accent} p={[0, 0.05, 0]} r={[PI / 2 + 0.12, 0, 0]} s={0.1} />
      <Part g={GEO.box} m={m.accent} p={[0.02, 0.03, -0.14]} r={[-0.5, 0.2, 0.2]} s={[0.018, 0.09, 0.006]} cast />
      <Part g={GEO.box} m={m.accent} p={[-0.02, 0.03, -0.14]} r={[-0.5, -0.2, -0.2]} s={[0.018, 0.09, 0.006]} cast />
      <Eyes m={m} y={0.014} z={0.092} gap={0.032} r={0.021} />
    </>
  ),
};

const chef: Look = {
  colors: { accent: '#e0262d', c1: '#33333d', c2: '#f19a8e', c3: '#4a7a3a' },
  arms: { shoulder: [0.08, 0.165, 0], radius: 0.018, mat: 'white' },
  legs: { hip: [0.034, 0.068, 0], radius: 0.024, mat: 'c1' },
  hand: 'skin',
  foot: 'ink',
  extras: m => (
    <>
      <Part g={GEO.sphere} m={m.white} p={[0, 0.095, 0.045]} s={[0.065, 0.07, 0.04]} />
      {[0.14, 0.17].map(y => [-0.02, 0.02].map(x => (
        <Part key={`${x}${y}`} g={GEO.dot} m={m.white} p={[x, y, 0.07]} s={0.009} />
      )))}
      <Part g={GEO.cone} m={m.accent} p={[0, 0.185, 0.06]} r={[PI + 0.4, 0, 0]} s={[0.03, 0.04, 0.012]} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.skin} s={0.1} cast />
      <Part g={GEO.cyl} m={m.white} p={[0, 0.1, 0]} s={[0.08, 0.08, 0.08]} cast />
      <Part g={GEO.sphere} m={m.white} p={[0, 0.17, 0]} s={[0.095, 0.055, 0.095]} cast />
      <Part g={GEO.sphere} m={m.white} p={[0.045, 0.165, 0.03]} s={0.045} />
      <Part g={GEO.sphere} m={m.white} p={[-0.045, 0.165, -0.02]} s={0.045} />
      <Part g={GEO.torus(0.2)} m={m.main} p={[0, 0.07, 0]} r={[PI / 2, 0, 0]} s={0.083} />
      <Part g={GEO.sphere} m={m.ink} p={[-0.025, -0.035, 0.088]} r={[0, 0, 0.35]} s={[0.03, 0.012, 0.012]} />
      <Part g={GEO.sphere} m={m.ink} p={[0.025, -0.035, 0.088]} r={[0, 0, -0.35]} s={[0.03, 0.012, 0.012]} />
      <Part g={GEO.dot} m={m.skin} p={[0, -0.012, 0.1]} s={0.022} />
      <Eyes m={m} y={0.02} z={0.08} gap={0.035} r={0.02} />
    </>
  ),
  right: m => (
    <group position={[0, 0.05, 0.02]} rotation={[0.3, 0, 0]}>
      <Part g={GEO.cyl} m={m.wood} s={[0.007, 0.12, 0.007]} />
      <Part g={GEO.sphere} m={m.wood} p={[0, 0.07, 0]} s={[0.02, 0.028, 0.008]} />
    </group>
  ),
};

const alien: Look = {
  colors: { glow: '#b6ff5c' },
  arms: { shoulder: [0.062, 0.16, 0], radius: 0.013, mat: 'main' },
  legs: { hip: [0.034, 0.07, 0], radius: 0.018, mat: 'main' },
  hand: 'main',
  foot: 'main',
  body: m => <Part g={GEO.sphere} m={m.main} p={[0, 0.11, 0]} s={[0.07, 0.09, 0.065]} cast />,
  extras: m => <Part g={GEO.cyl} m={m.glow} p={[0, 0.13, 0.064]} r={[PI / 2, 0, 0]} s={[0.018, 0.004, 0.018]} />,
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.main} p={[0, 0.015, 0]} s={[0.125, 0.11, 0.105]} cast />
      <Part g={GEO.sphere} m={m.glass} p={[-0.047, 0.0, 0.085]} r={[0, -0.35, 0.45]} s={[0.036, 0.022, 0.016]} />
      <Part g={GEO.sphere} m={m.glass} p={[0.047, 0.0, 0.085]} r={[0, 0.35, -0.45]} s={[0.036, 0.022, 0.016]} />
      <Part g={GEO.box} m={m.ink} p={[0, -0.055, 0.092]} s={[0.025, 0.004, 0.004]} />
      {[-1, 1].map(side => (
        <group key={side} position={[side * 0.045, 0.1, 0]} rotation={[0, 0, -side * 0.45]}>
          <Part g={GEO.cyl} m={m.main} p={[0, 0.045, 0]} s={[0.007, 0.09, 0.007]} />
          <Part g={GEO.sphere} m={m.glow} p={[0, 0.095, 0]} s={0.022} />
        </group>
      ))}
    </>
  ),
};

// CJ WAWA (snacky) and Yot (starer) are modelled in detail in Blender (tools/blender/
// characters.py); these simple versions show only while the model loads.

const snacky: Look = {
  colors: { skin: '#dcaa82', hair: '#2b1d14', cloth: '#8f9198', denim: '#2e4568', accent: '#d8322a', c1: '#3c9a48', c2: '#5c1d1d', c3: '#4a2e1c' },
  hand: 'skin',
  foot: 'main',
  arms: { shoulder: [0.085, 0.165, 0], radius: 0.019, mat: 'skin' },
  legs: { hip: [0.033, 0.075, 0], radius: 0.025, mat: 'denim' },
  body: m => (
    <>
      <Part g={GEO.sphere} m={m.white} p={[0, 0.125, 0]} s={[0.082, 0.085, 0.066]} cast />
      <Part g={GEO.box} m={m.accent} p={[0, 0.135, 0.064]} s={[0.05, 0.016, 0.006]} />
      <Part g={GEO.cyl} m={m.denim} p={[-0.034, 0.05, 0]} s={[0.027, 0.06, 0.027]} />
      <Part g={GEO.cyl} m={m.denim} p={[0.034, 0.05, 0]} s={[0.027, 0.06, 0.027]} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.skin} s={[0.118, 0.115, 0.11]} cast />
      <Part g={GEO.sphere} m={m.hair} p={[0, 0.045, -0.012]} s={[0.125, 0.09, 0.118]} cast />
      <Part g={GEO.sphere} m={m.hair} p={[0, 0.06, 0.07]} s={[0.1, 0.035, 0.05]} r={[0.5, 0, 0]} />
      <Eyes m={m} y={0.0} z={0.098} gap={0.042} r={0.022} />
      <Part g={GEO.sphere} m={m.white} p={[0, -0.052, 0.1]} s={[0.032, 0.012, 0.01]} />
    </>
  ),
};

const starer: Look = {
  colors: { skin: '#8b5a3c', c1: '#c4977a', c2: '#5a3624' },
  hand: 'skin',
  foot: 'main',
  arms: { shoulder: [0.072, 0.16, 0], radius: 0.018, mat: 'skin' },
  legs: { hip: [0.036, 0.062, 0.002], radius: 0.024, mat: 'skin' },
  // Shirtless: a pale belly, a white collar and a thin black belt.
  body: m => (
    <>
      <Part g={GEO.sphere} m={m.skin} p={[0, 0.12, 0]} s={[0.08, 0.095, 0.07]} cast />
      <Part g={GEO.sphere} m={m.c1} p={[0, 0.105, 0.04]} s={[0.055, 0.06, 0.035]} />
      <Part g={GEO.cone} m={m.white} p={[-0.022, 0.19, 0.062]} r={[0, 0, PI / 2]} s={[0.018, 0.034, 0.01]} />
      <Part g={GEO.cone} m={m.white} p={[0.022, 0.19, 0.062]} r={[0, 0, -PI / 2]} s={[0.018, 0.034, 0.01]} />
      <Part g={GEO.torus(0.1)} m={m.ink} p={[0, 0.07, 0]} r={[PI / 2, 0, 0]} s={[0.062, 0.053, 0.062]} />
    </>
  ),
  head: m => (
    <>
      <Part g={GEO.sphere} m={m.skin} p={[0, 0.012, 0]} s={[0.106, 0.138, 0.1]} cast />
      {[-1, 1].map(side => (
        <group key={side} position={[side * 0.047, 0.034, 0.08]}>
          <Part g={GEO.sphere} m={m.white} s={0.033} />
          <Part g={GEO.sphere} m={m.ink} p={[0, 0, 0.026]} s={[0.016, 0.016, 0.01]} />
        </group>
      ))}
      <Part g={GEO.sphere} m={m.c1} p={[0, -0.036, 0.116]} s={0.022} />
      <Part g={GEO.torus(0.15, PI)} m={m.ink} p={[0, -0.075, 0.1]} s={0.04} />
    </>
  ),
};

export const LOOKS: Record<CharacterId, Look> = {
  snacky, starer,
  spiky, robot, cat, knight, wizard, astronaut, pirate, ninja, chef, alien,
};
