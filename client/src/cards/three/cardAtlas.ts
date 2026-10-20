// Every card face and the back, drawn once into a texture atlas for the 3D
// table. The faces are the same SVG art the 2D table shows (CardFace.tsx):
// all 65 faces (Classic's 54 and Chog Chaos's 11) and the back are laid out
// in one SVG document, with the
// display font embedded (an SVG loaded as an image sees no page fonts), and
// painted onto a canvas in one go. One texture, one material, so every card
// in the scene — the piles, each hand's fan, the cards in flight — is drawn
// in a single instanced draw call: each instance carries the atlas rectangle
// of its face, and the shader shows the face on the front and the back on the
// back (gl_FrontFacing), so a card is a plane that flips.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CanvasTexture, DoubleSide, InstancedBufferAttribute, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, Vector4,
  type BufferGeometry, type Texture,
} from 'three';
import { CARD_COLORS, type Card, type CardColor } from '../../../../shared/cards/deck.ts';
import { CardBack, CardFace } from '../CardFace.tsx';
import lilitaUrl from '../../fonts/lilita-one-400.woff2?url';

/** A card's size on the table (the 2:3 of the art). */
export const CARD_W = 1;
export const CARD_H = 1.5;

/** Where a face sits in the atlas, in texture coordinates (origin bottom-left). */
export interface UvRect { x: number; y: number; w: number; h: number }

export interface CardAtlas {
  texture: Texture;
  back: UvRect;
  rect(card: Card): UvRect;
}

const COLS = 10;
const CELL_W = 200;
const CELL_H = 300;

/** The atlas key of a card: the colour and value or kind (the two red 7s share one face). */
export function faceKey(c: Card): string {
  return c.kind === 'number' ? `${c.color}-${c.value}` : `${c.color ?? 'wild'}-${c.kind}`;
}

/** Every distinct face, in atlas order, then the back. */
function allFaces(): { key: string; card: Card | null }[] {
  const out: { key: string; card: Card | null }[] = [];
  let id = 0;
  const add = (card: Card) => out.push({ key: faceKey(card), card });
  for (const color of CARD_COLORS as readonly CardColor[]) {
    for (let v = 0; v <= 9; v++) add({ id: id++, kind: 'number', color, value: v });
    for (const kind of ['skip', 'reverse', 'draw2'] as const) add({ id: id++, kind, color });
  }
  add({ id: id++, kind: 'wild', color: null });
  add({ id: id++, kind: 'wild4', color: null });
  // Chog Chaos.
  for (const color of CARD_COLORS as readonly CardColor[]) for (const kind of ['purge', 'blitz'] as const) add({ id: id++, kind, color });
  for (const kind of ['wild6', 'wild10', 'roulette'] as const) add({ id: id++, kind, color: null });
  out.push({ key: 'back', card: null });
  return out;
}

const FACES = allFaces();
const ROWS = Math.ceil(FACES.length / COLS);
const ATLAS_W = COLS * CELL_W;
const ATLAS_H = ROWS * CELL_H;

function cellRect(i: number): UvRect {
  const col = i % COLS, row = Math.floor(i / COLS);
  return { x: (col * CELL_W) / ATLAS_W, y: 1 - ((row + 1) * CELL_H) / ATLAS_H, w: CELL_W / ATLAS_W, h: CELL_H / ATLAS_H };
}

async function fontFace(): Promise<string> {
  try {
    const res = await fetch(lilitaUrl);
    if (!res.ok) return '';
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `@font-face{font-family:'Lilita One';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
  } catch {
    return '';
  }
}

/** The whole atlas as one SVG document: each face a nested <svg> in its cell. */
function atlasSvg(font: string): string {
  const cells = FACES.map(({ card }, i) => {
    const markup = renderToStaticMarkup(card ? createElement(CardFace, { card }) : createElement(CardBack));
    const col = i % COLS, row = Math.floor(i / COLS);
    return markup.replace('<svg ', `<svg x="${col * CELL_W}" y="${row * CELL_H}" width="${CELL_W}" height="${CELL_H}" `);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS_W}" height="${ATLAS_H}"><style>${font}</style>${cells.join('')}</svg>`;
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('card atlas failed to render')); };
    img.src = url;
  });
}

let atlasPromise: Promise<CardAtlas> | null = null;

/** The atlas, built once per page (start it early: the lobby calls this). */
export function loadCardAtlas(): Promise<CardAtlas> {
  atlasPromise ??= (async () => {
    const font = await fontFace();
    const img = await loadImage(atlasSvg(font));
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    canvas.getContext('2d')!.drawImage(img, 0, 0, ATLAS_W, ATLAS_H);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const index = new Map(FACES.map((f, i) => [f.key, i]));
    const back = cellRect(index.get('back')!);
    return {
      texture,
      back,
      rect: (card: Card) => cellRect(index.get(faceKey(card)) ?? index.get('back')!),
    };
  })();
  return atlasPromise;
}

/**
 * The card material: standard lighting over the atlas, the face on the
 * front and the back on the back of the same plane. Per-instance `aFace`
 * (x, y, w, h in texture space) picks the face.
 */
export function cardMaterial(atlas: CardAtlas): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, metalness: 0, side: DoubleSide, alphaTest: 0.5 });
  const back = new Vector4(atlas.back.x, atlas.back.y, atlas.back.w, atlas.back.h);
  m.customProgramCacheKey = () => 'chog-cards';
  m.onBeforeCompile = s => {
    s.uniforms.uBack = { value: back };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFace;\nuniform vec4 uBack;\nvarying vec2 vFaceUv;\nvarying vec2 vBackUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFaceUv = aFace.xy + uv * aFace.zw;\nvBackUv = uBack.xy + vec2(1.0 - uv.x, uv.y) * uBack.zw;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFaceUv;\nvarying vec2 vBackUv;')
      .replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D( map, gl_FrontFacing ? vFaceUv : vBackUv );\ndiffuseColor *= sampledDiffuseColor;');
  };
  return m;
}

/** A card plane with room for `capacity` instances' faces. Its face is +z, its top +y. */
export function cardGeometry(capacity: number): { geo: BufferGeometry; faces: InstancedBufferAttribute } {
  const geo = new PlaneGeometry(CARD_W, CARD_H);
  const faces = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  geo.setAttribute('aFace', faces);
  return { geo, faces };
}
