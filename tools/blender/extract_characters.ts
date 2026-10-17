// Dumps every character's parts list (from client/src/three/characters/looks.tsx)
// as JSON for characters.py: the game's own designs are the source of truth,
// Blender rebuilds them as smooth models. Run by characters.py:
//   node --import tsx tools/blender/extract_characters.ts <out.json>
//
// Walks the React elements the look functions return without rendering them:
// <group>s contribute transforms, <Part>s become entries, other components
// (Eyes, Belt, DefaultBody) are expanded by calling them.

import { writeFileSync } from 'node:fs';
import * as React from 'react';
import { Fragment, type ReactNode } from 'react';
import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { Mats } from '../../client/src/three/characters/parts.tsx';
import type { CharacterId } from '../../shared/characters.ts';

// Outside Vite the TSX compiles to React.createElement: give it a React.
(globalThis as unknown as { React: typeof React }).React = React;
type LooksMod = typeof import('../../client/src/three/characters/looks.tsx');
type PartsMod = typeof import('../../client/src/three/characters/parts.tsx');
let Part: PartsMod['Part'];

type V3 = [number, number, number];
interface Entry { geo: { type: string; params: Record<string, number> }; mat: string; matrix: number[] }

function local(p?: V3, r?: V3, s?: V3 | number): Matrix4 {
  const pos = new Vector3(...(p ?? [0, 0, 0]));
  const q = new Quaternion().setFromEuler(new Euler(...(r ?? [0, 0, 0])));
  const sc = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(...(s ?? [1, 1, 1]));
  return new Matrix4().compose(pos, q, sc);
}

function describe(g: BufferGeometry): Entry['geo'] {
  const params = (g as unknown as { parameters: Record<string, number> }).parameters;
  return { type: g.type, params: { ...params } };
}

function walk(node: ReactNode, m: Matrix4, out: Entry[]): void {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, m, out); return; }
  const el = node as { type: unknown; props: Record<string, unknown> };
  if (!el || typeof el !== 'object' || !('type' in el)) return;
  const props = el.props ?? {};
  if (el.type === Fragment) { walk(props.children as ReactNode, m, out); return; }
  if (el.type === Part) {
    const mat = props.m as { name: string };
    out.push({
      geo: describe(props.g as BufferGeometry),
      mat: mat.name,
      matrix: m.clone().multiply(local(props.p as V3, props.r as V3, props.s as V3 | number)).elements.slice(),
    });
    return;
  }
  if (typeof el.type === 'string') {
    if (el.type !== 'group') throw new Error(`unexpected <${el.type}> in a look`);
    const lm = local(props.position as V3, props.rotation as V3, props.scale as V3 | number);
    walk(props.children as ReactNode, m.clone().multiply(lm), out);
    return;
  }
  if (typeof el.type === 'function') {
    walk((el.type as (p: unknown) => ReactNode)(props), m, out);
    return;
  }
  throw new Error('unknown element');
}

function mats(makeMaterials: PartsMod['makeMaterials'], color: string, colors = {}): Mats {
  const m = makeMaterials(color, colors);
  for (const [k, v] of Object.entries(m)) v.name = k;
  return m;
}

async function main() {
  const { LOOKS, DefaultBody } = (await import('../../client/src/three/characters/looks.tsx')) as LooksMod;
  const parts = (await import('../../client/src/three/characters/parts.tsx')) as PartsMod;
  const { GEO, makeMaterials } = parts;
  Part = parts.Part;
  const out: Record<string, unknown> = {};
  for (const [id, look] of Object.entries(LOOKS) as [CharacterId, (typeof LOOKS)[CharacterId]][]) {
    const m = mats(makeMaterials, '#4a90e2', look.colors);
    const I = new Matrix4();
    const body: Entry[] = [];
    walk(look.body ? look.body(m) : DefaultBody({ m }), I, body);
    walk(look.extras?.(m), I, body);
    for (const side of [-1, 1]) {
      // The feet live in Figure.tsx, not in the look.
      walk({ type: Part, props: { g: GEO.sphere, m: m[look.foot], p: [side * 0.045, 0.018, 0.018], s: [0.036, 0.022, 0.052] } } as unknown as ReactNode, I, body);
    }
    const hand = (extra?: (m: Mats) => ReactNode) => {
      const e: Entry[] = [];
      walk({ type: Part, props: { g: GEO.sphere, m: m[look.hand], s: 0.029 } } as unknown as ReactNode, I, e);
      walk(extra?.(m), I, e);
      return e;
    };
    const head: Entry[] = [];
    walk(look.head(m), I, head);
    out[id] = {
      colors: look.colors ?? {},
      materials: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, {
        color: `#${v.color.getHexString()}`, roughness: v.roughness, metalness: v.metalness,
        emissive: `#${v.emissive.getHexString()}`,
      }])),
      parts: { Body: body, Head: head, HandL: hand(look.left), HandR: hand(look.right) },
    };
  }
  writeFileSync(process.argv[2], JSON.stringify(out));
  console.log(`extracted ${Object.keys(out).length} characters`);
}

void main();
