// A token Chog's paint: one texture per figure holding its hat and its
// outfit — ground colours, swatches, repeating patterns and the decals
// printed on them (the text on a cap, the number on a jersey) — painted on a
// canvas from the look (shared/chogs/wear.ts). The parts' UVs
// (tools/blender/chog_wear.py) address it by shared/chogs/paint-layout.json:
// per slot (hat, body) a D area for the faces in front, a P area for every
// other face (a repeating pattern wraps there every `wrap` px, so pattern
// periods across divide it), and a row of swatch squares.
//
// Textures are shared by the figures of the same values and kept for the
// last few looks; a figure's material (it greys and fades with the figure)
// is its own.

import { CanvasTexture, LinearMipmapLinearFilter, MeshStandardMaterial, SRGBColorSpace } from 'three';
import LAYOUT from '../../../../shared/chogs/paint-layout.json';
import type { ChogDecal, ChogLook, ChogPaint, ChogPattern } from '../../../../shared/chogs/traits.ts';

type Slot = 'hat' | 'body';
type Rect = [number, number, number, number];
type Ctx = CanvasRenderingContext2D;

const K = LAYOUT.k;

/** The texture for a look's hat and outfit; `lite` paints it at half size (Low graphics). */
export function chogPaintTexture(look: ChogLook, lite: boolean): CanvasTexture | null {
  if (!look.head && !look.body) return null;
  const key = `${look.head?.value ?? ''}|${look.body?.value ?? ''}|${lite ? 'lo' : 'hi'}`;
  let tex = textures.get(key);
  if (tex) {
    // Most recently used last.
    textures.delete(key);
    textures.set(key, tex);
    return tex;
  }
  tex = paintTexture(look, lite ? 0.5 : 1);
  textures.set(key, tex);
  for (const [k, t] of textures) {
    if (textures.size <= KEEP) break;
    // A texture still on a figure re-uploads if it draws again; one that is gone frees its memory.
    t.dispose();
    textures.delete(k);
  }
  return tex;
}

const KEEP = 24;
const textures = new Map<string, CanvasTexture>();

/** A figure's own material over the look's paint (merged.ts keeps it following the figure's grey and fade). */
export function chogPaintMaterial(look: ChogLook, lite: boolean): MeshStandardMaterial | null {
  const map = chogPaintTexture(look, lite);
  return map && new MeshStandardMaterial({ name: 'paint', map, roughness: 0.78, metalness: 0 });
}

function paintTexture(look: ChogLook, scale: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(LAYOUT.w * scale);
  canvas.height = Math.round(LAYOUT.h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, LAYOUT.w, LAYOUT.h);
  if (look.head) paintSlot(ctx, 'hat', look.head.paint);
  if (look.body) paintSlot(ctx, 'body', look.body.paint);
  const tex = new CanvasTexture(canvas);
  // The UVs address the canvas top-down.
  tex.flipY = false;
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function paintSlot(ctx: Ctx, slot: Slot, paint: ChogPaint) {
  const A = LAYOUT[slot];
  const d = A.d as Rect, p = A.p as Rect;
  const row = (y: number, area: Rect) => area[1] + (A.ytop - y) * K;
  for (const area of [d, p]) {
    ctx.fillStyle = paint.base;
    ctx.fillRect(...area);
  }
  const patterns = paint.pattern ? (Array.isArray(paint.pattern) ? paint.pattern : [paint.pattern]) : [];
  for (const pat of patterns) {
    // D's pattern is centred on the front; P's starts after its guard band (the same phase: periods divide the wrap).
    for (const [area, ox] of [[d, d[0] + d[2] / 2], [p, p[0] + LAYOUT.guard]] as const) {
      ctx.save();
      const top = pat.to !== undefined ? Math.max(area[1], row(pat.to, area)) : area[1];
      const bottom = pat.from !== undefined ? Math.min(area[1] + area[3], row(pat.from, area)) : area[1] + area[3];
      ctx.beginPath();
      ctx.rect(area[0], top, area[2], bottom - top);
      ctx.clip();
      drawPattern(ctx, pat, area, ox, (y: number) => row(y, area));
      ctx.restore();
    }
  }
  for (const decal of paint.decals ?? []) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(...d);
    ctx.clip();
    drawDecal(ctx, decal, d[0] + d[2] / 2 + (decal.x ?? 0) * K, row(decal.y, d), decal.size * K);
    ctx.restore();
  }
  const s = LAYOUT.swatch;
  for (let k = 0; k < LAYOUT.w / s; k++) {
    ctx.fillStyle = paint.sw?.[k] ?? paint.base;
    ctx.fillRect(k * s, A.sw, s, s);
  }
}

// ---- patterns ----------------------------------------------------------------------
// Drawn in pixels round the slot (u: + to its left from the front, v: down from ytop),
// tiled across the clipped area. Periods across are 448 / n.

/** A tiny deterministic random (patterns look the same on every figure and every load). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Call draw(x, y) at every tile origin over the area (tile w across, h down; rows of tiles offset by `shift`). */
function tiles(area: Rect, ox: number, w: number, h: number, draw: (x: number, y: number, i: number, j: number) => void, shift = 0) {
  const j0 = Math.floor(-h), j1 = Math.ceil(area[3] / h) + 1;
  for (let j = j0; j < j1; j++) {
    const y = area[1] + j * h;
    const off = (j & 1) * shift;
    const i0 = Math.floor((area[0] - ox - off) / w) - 1, i1 = Math.ceil((area[0] + area[2] - ox - off) / w) + 1;
    for (let i = i0; i <= i1; i++) draw(ox + off + i * w, y, i, j);
  }
}

function drawPattern(ctx: Ctx, pat: ChogPattern, area: Rect, ox: number, row: (y: number) => number) {
  ctx.fillStyle = pat.color;
  ctx.strokeStyle = pat.color;
  switch (pat.kind) {
    case 'ribs':
      tiles(area, ox, 16, area[3] + 64, x => ctx.fillRect(x + 5, area[1] - 32, 6, area[3] + 64));
      break;
    case 'stripes': {
      const top = pat.to ?? LAYOUT.hat.ytop + 1, bottom = pat.from ?? -1;
      for (let y = top; y > bottom; y -= pat.period) ctx.fillRect(area[0], row(y), area[2], pat.width * K);
      break;
    }
    case 'quilt':
      ctx.lineWidth = 4;
      for (let y = LAYOUT.body.ytop; y > -0.1; y -= 0.024) {
        ctx.beginPath();
        ctx.moveTo(area[0], row(y));
        ctx.lineTo(area[0] + area[2], row(y));
        ctx.stroke();
      }
      break;
    case 'trim':
      // Soft folds in cloth.
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6;
      tiles(area, ox, 112, 64, (x, y) => {
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 20);
        ctx.quadraticCurveTo(x + 50, y + 32, x + 96, y + 18);
        ctx.stroke();
      }, 56);
      break;
    case 'stars':
      tiles(area, ox, 112, 96, (x, y) => star(ctx, x + 56, y + 48, 26, 11, 5), 56);
      break;
    case 'rings':
      ctx.lineWidth = 7;
      tiles(area, ox, 56, 52, (x, y) => {
        ctx.beginPath();
        ctx.ellipse(x + 28, y + 26, 12, 14, 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }, 28);
      break;
    case 'flowers':
      tiles(area, ox, 112, 100, (x, y, i, j) => {
        const r = rng(i * 31 + j * 7 + 5);
        hibiscus(ctx, x + 56 + (r() - 0.5) * 30, y + 50 + (r() - 0.5) * 24, 30, r() * 6, pat.color, pat.color2 ?? pat.color);
      }, 56);
      break;
    case 'speckle':
      tiles(area, ox, 112, 112, (x, y, i, j) => {
        const r = rng(i * 17 + j * 131 + 3);
        for (let k = 0; k < 14; k++) {
          ctx.beginPath();
          ctx.arc(x + r() * 112, y + r() * 112, 2.5 + r() * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      break;
    case 'camo':
      tiles(area, ox, 224, 160, (x, y, i, j) => {
        const r = rng(i * 13 + j * 71 + 9);
        for (let k = 0; k < 7; k++) {
          ctx.fillStyle = k % 2 ? pat.color : pat.color2 ?? pat.color;
          blob(ctx, x + r() * 224, y + r() * 160, 26 + r() * 22, r);
        }
      });
      break;
    case 'paisley':
      tiles(area, ox, 112, 96, (x, y, i, j) => {
        const r = rng(i * 5 + j * 97 + 1);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(x + 40, y + 46, 16, 26, 0.6 + r(), 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 6; k++) {
          ctx.beginPath();
          ctx.arc(x + 70 + r() * 30, y + 10 + r() * 76, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }, 56);
      break;
    case 'glitch':
      tiles(area, ox, 224, 112, (x, y, i, j) => {
        const r = rng(i * 3 + j * 53 + 11);
        for (let k = 0; k < 9; k++) {
          ctx.fillStyle = k % 3 ? pat.color : pat.color2 ?? pat.color;
          ctx.fillRect(x + r() * 224, y + r() * 112, 20 + r() * 70, 5 + r() * 9);
        }
      });
      break;
    case 'patches':
      tiles(area, ox, 224, 200, (x, y, i, j) => {
        const r = rng(i * 41 + j * 19 + 2);
        for (let k = 0; k < 2; k++) {
          const px = x + 20 + r() * 150, py = y + 20 + r() * 130, w = 34 + r() * 26, h = 30 + r() * 22;
          ctx.fillStyle = k ? pat.color : pat.color2 ?? pat.color;
          ctx.fillRect(px, py, w, h);
          ctx.strokeStyle = pat.color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 5]);
          ctx.strokeRect(px + 4, py + 4, w - 8, h - 8);
          ctx.setLineDash([]);
        }
      });
      break;
    case 'bandage':
      ctx.lineWidth = 3.5;
      tiles(area, ox, 224, 30, (x, y) => {
        ctx.beginPath();
        ctx.moveTo(x, y + 4);
        ctx.lineTo(x + 224, y + 22);
        ctx.stroke();
      }, 90);
      break;
    case 'swirl':
      ctx.lineWidth = 5;
      tiles(area, ox, 112, 90, (x, y) => {
        ctx.beginPath();
        for (let a = 0; a < Math.PI * 3.2; a += 0.2) {
          const rr = 4 + a * 4.2;
          const px = x + 56 + Math.cos(a) * rr, py = y + 45 + Math.sin(a) * rr;
          if (a === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }, 56);
      break;
  }
}

function star(ctx: Ctx, cx: number, cy: number, ro: number, ri: number, n: number, rot = 0) {
  ctx.beginPath();
  for (let k = 0; k < n * 2; k++) {
    const a = rot - Math.PI / 2 + (k * Math.PI) / n;
    const r = k % 2 ? ri : ro;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function hibiscus(ctx: Ctx, cx: number, cy: number, r: number, rot: number, petal: string, heart: string) {
  ctx.fillStyle = petal;
  for (let k = 0; k < 5; k++) {
    const a = rot + (k * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.5, r * 0.32, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

function blob(ctx: Ctx, cx: number, cy: number, r: number, rand: () => number) {
  ctx.beginPath();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const rr = r * (0.6 + rand() * 0.5);
    ctx.lineTo(cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// ---- decals ---------------------------------------------------------------------------

const FONTS: Record<NonNullable<ChogDecal['font']>, string> = {
  block: '900 {}px "Arial Black", "Helvetica Neue", Arial, sans-serif',
  hand: 'bold {}px "Comic Sans MS", "Chalkboard SE", "Comic Neue", "Marker Felt", sans-serif',
  college: '900 {}px "Rockwell Extra Bold", "Rockwell", "Georgia", serif',
  round: 'bold {}px "Arial Rounded MT Bold", "Varela Round", "Trebuchet MS", sans-serif',
};

/** A decal centred at (cx, cy), `size` px tall (a line of text, or the symbol). */
function drawDecal(ctx: Ctx, dc: ChogDecal, cx: number, cy: number, size: number) {
  ctx.fillStyle = dc.color;
  ctx.strokeStyle = dc.stroke ?? dc.color;
  ctx.lineJoin = 'round';
  if (dc.text.startsWith('@')) {
    drawSymbol(ctx, dc.text.slice(1), size, cx, cy);
    return;
  }
  const lines = dc.text.split('\n');
  const lh = size * 1.08;
  ctx.font = FONTS[dc.font ?? 'block'].replace('{}', String(Math.round(size * 1.18)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
  const maxW = dc.w !== undefined ? dc.w * K : Infinity;
  const sx = Math.min(1, maxW / widest);
  if (dc.box) {
    const bw = widest * sx + size * 0.7, bh = lines.length * lh + size * 0.45;
    ctx.save();
    ctx.fillStyle = dc.box;
    ctx.strokeStyle = dc.color;
    ctx.lineWidth = size * 0.1;
    ctx.beginPath();
    ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, size * 0.18);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, 1);
  lines.forEach((line, k) => {
    const y = (k - (lines.length - 1) / 2) * lh;
    if (dc.stroke) {
      ctx.lineWidth = size * 0.22;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

function drawSymbol(ctx: Ctx, name: string, s: number, cx: number, cy: number) {
  const line = (w: number) => { ctx.lineWidth = s * w; ctx.lineCap = 'round'; };
  ctx.save();
  ctx.translate(cx, cy);
  switch (name) {
    case 'mon': {
      // Monad's mark: a rounded square ring set on its corner.
      ctx.rotate(Math.PI / 4);
      line(0.2);
      ctx.beginPath();
      ctx.roundRect(-s * 0.36, -s * 0.36, s * 0.72, s * 0.72, s * 0.24);
      ctx.stroke();
      break;
    }
    case 'btc': {
      ctx.font = `900 ${Math.round(s * 1.1)}px "Arial Black", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('B', s * 0.02, s * 0.04);
      for (const dx of [-0.12, 0.1]) {
        ctx.fillRect(s * dx - s * 0.045, -s * 0.62, s * 0.09, s * 0.2);
        ctx.fillRect(s * dx - s * 0.045, s * 0.44, s * 0.09, s * 0.2);
      }
      break;
    }
    case 'peace': {
      line(0.11);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
      ctx.moveTo(0, -s * 0.45);
      ctx.lineTo(0, s * 0.45);
      ctx.moveTo(0, 0);
      ctx.lineTo(-s * 0.32, s * 0.32);
      ctx.moveTo(0, 0);
      ctx.lineTo(s * 0.32, s * 0.32);
      ctx.stroke();
      break;
    }
    case 'star':
      star(ctx, 0, 0, s * 0.5, s * 0.21, 5);
      break;
    case 'bolt': {
      ctx.beginPath();
      const pts = [[0.12, -0.5], [-0.28, 0.06], [-0.02, 0.06], [-0.14, 0.5], [0.3, -0.08], [0.04, -0.08], [0.18, -0.5]];
      pts.forEach(([x, y]) => ctx.lineTo(x * s, y * s));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1d1a24';
      line(0.05);
      ctx.stroke();
      break;
    }
    case 'cloud': {
      // Two curling waves side by side (the cloud cap's mark).
      line(0.13);
      for (const dx of [-0.48, 0.48]) {
        ctx.beginPath();
        ctx.arc(dx * s, 0, s * 0.42, Math.PI * 0.9, Math.PI * 2.1);
        ctx.arc(dx * s + s * 0.1, -s * 0.02, s * 0.18, 0, Math.PI * 1.3);
        ctx.stroke();
      }
      break;
    }
    case 'gear': {
      // A wavy ring (the Balls Cap's mark).
      line(0.09);
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * Math.PI * 2;
        const r = s * (0.4 + 0.07 * Math.sin(a * 10));
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
      break;
    }
    case 'eth': {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.55); ctx.lineTo(s * 0.32, s * 0.02); ctx.lineTo(0, s * 0.2); ctx.lineTo(-s * 0.32, s * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.32, s * 0.12); ctx.lineTo(0, s * 0.3); ctx.lineTo(s * 0.32, s * 0.12); ctx.lineTo(0, s * 0.56);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pizza': {
      ctx.rotate(-0.3);
      ctx.fillStyle = '#f8c531';
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, -s * 0.35); ctx.lineTo(s * 0.4, -s * 0.35); ctx.lineTo(0, s * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c8742a';
      ctx.fillRect(-s * 0.44, -s * 0.48, s * 0.88, s * 0.16);
      ctx.fillStyle = '#d8262c';
      for (const [x, y] of [[-0.14, -0.15], [0.14, -0.12], [0.0, 0.15]]) {
        ctx.beginPath();
        ctx.arc(x * s, y * s, s * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'choggie':
    case 'chog': {
      // A little spiky Chog face.
      if (name === 'chog') line(0.08);
      star(ctx, 0, 0, s * 0.5, s * 0.36, 9);
      if (name === 'chog') break;
      ctx.fillStyle = '#f4f0ff';
      ctx.beginPath();
      ctx.arc(0, s * 0.04, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d1a24';
      for (const dx of [-0.1, 0.1]) {
        ctx.beginPath();
        ctx.arc(dx * s, 0, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'feather': {
      ctx.rotate(-0.7);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.18, s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c8f02a';
      line(0.05);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.45);
      ctx.lineTo(0, s * 0.6);
      ctx.stroke();
      break;
    }
    case '8ball': {
      ctx.fillStyle = '#16161c';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#16161c';
      ctx.font = `900 ${Math.round(s * 0.42)}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('8', 0, s * 0.02);
      break;
    }
    case 'dot':
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'triangle':
      line(0.16);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.42); ctx.lineTo(s * 0.45, s * 0.36); ctx.lineTo(-s * 0.45, s * 0.36);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(0, s * 0.45);
      ctx.bezierCurveTo(-s * 0.7, -s * 0.05, -s * 0.3, -s * 0.6, 0, -s * 0.2);
      ctx.bezierCurveTo(s * 0.3, -s * 0.6, s * 0.7, -s * 0.05, 0, s * 0.45);
      ctx.fill();
      break;
    case 'flag': {
      const w = s * 1.6, h = s;
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = k % 2 ? '#ffffff' : '#d8262c';
        ctx.fillRect(-w / 2, -h / 2 + (k * h) / 7, w, h / 7 + 0.5);
      }
      ctx.fillStyle = '#2a3a8a';
      ctx.fillRect(-w / 2, -h / 2, w * 0.42, h * 0.55);
      break;
    }
    default:
      ctx.font = `bold ${Math.round(s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 0, 0);
  }
  ctx.restore();
}
