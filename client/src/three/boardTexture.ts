// Paints a theme's whole board face onto one canvas, used as the texture on
// top of the board mesh. Everything a theme renames or recolours shows up here
// automatically. Each look (theme.art) has its own art direction:
//
//   heritage  Classic map, Original theme: a premium print on cream stock.
//   rainbow   Speedway, Original theme: a neon rainbow track round a starfield.
//   night     Metropolis, Original theme: navy and gold, a skyline in the middle.
//   tptv      Takeprofit TV on any map: the takeprofit-tv site's broadcast look.
//   chog      Chog on any map: the purple room with the Chog portrait.
//   pixel     Blitz, Original theme: an arcade cabinet's attract screen.
//   atlas     Crossroads, Original theme: a printed road atlas.
//
// A board with a lane (Crossroads) prints the lane's tiles up the middle and
// lays its centre out round them (centreLane).
//
// Every colour band also carries its set's glyph (SET_GLYPHS), so sets stay
// distinguishable without colour vision.

import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Theme } from '../../../shared/themes.ts';
import { getMap, shapeOf } from '../../../shared/maps.ts';
import { BAND, C, W, ringOf, tile, tileWidth } from './layout.ts';
import { drawGlyph, drawIcon, SET_GLYPHS, type IconKind } from './boardIcons.ts';
import {
  centreHeritage, centreLane, centreLogo, centreNight, centrePixel, centreRainbow, centreTptv, drawTptvMark, laneMarks, TPTV,
} from './boardCentres.ts';
import { fitFont, HALF_DIAG, IN, PX, S, seeded, wrap } from './boardPaint.ts';
import { luminance, oklch } from './oklch.ts';

type Ctx = CanvasRenderingContext2D;

/** Width a line of text `size` tall can have at `y` in a corner tile's rotated frame (a diamond). */
function chord(y: number, size: number): number {
  return Math.max(60, 2 * (HALF_DIAG - Math.abs(y) - size * 0.42) - 16);
}

/** How one look prints: inks, rules, finish, and painters for its tiles. */
interface Skin {
  face: string;
  text: string;
  price: string;
  priceFont: string;
  accent: string;
  /** Tile outlines. */
  rule: string;
  /** The fine rule just inside each tile; null for none. */
  hair: string | null;
  /** Colour the icons' cut-outs are filled with (the tile under them). */
  paper: string;
  /** Outline behind corner lettering on busy backgrounds. */
  textStroke?: string;
  /** Strength of the highlight across colour bands (0 = flat print). */
  gloss: number;
  /** Opacity of the grain laid over the finished face. */
  grain: number;
  frame: string;
  jail: { cell: string; bars: string; label: string; outline: string };
  /** Paints a tile's ground, in its local frame (inner edge at -d/2), before anything else. */
  tile?: (ctx: Ctx, i: number, n: number, w: number, d: number, corner: boolean) => void;
  /** Paints over the finished ring of tiles. */
  after?: (ctx: Ctx, n: number) => void;
}

/** Rainbow Road's hue for space i: one full turn of the colour wheel per lap. */
const lapHue = (i: number, n: number) => (10 + (360 * i) / n) % 360;

function skinFor(theme: Theme): Skin {
  const pal = theme.palette;
  const base: Skin = {
    face: pal.board, text: pal.boardText, price: pal.boardText, priceFont: 'Inter, sans-serif', accent: pal.accent,
    rule: pal.boardLine, hair: pal.boardLine, paper: pal.board, gloss: 0.18, grain: 0.3, frame: pal.boardLine,
    jail: { cell: pal.accent, bars: pal.boardLine, label: '#ffffff', outline: pal.boardLine },
  };
  switch (theme.art) {
    case 'heritage':
      return { ...base, gloss: 0.14, grain: 0.32 };
    case 'rainbow':
      return {
        ...base,
        rule: 'rgba(214, 206, 255, 0.28)', hair: null, paper: oklch(0.26, 0.08, 286), price: '#ffea6b',
        priceFont: 'Inter, sans-serif', gloss: 0.42, grain: 0.14, frame: '#0c0824', textStroke: 'rgba(12, 8, 36, 0.9)',
        jail: { cell: pal.accent, bars: '#140f34', label: '#ffffff', outline: '#140f34' },
        tile: (ctx, i, n, w, d, corner) => {
          const h = lapHue(i, n);
          const g = ctx.createLinearGradient(0, -d / 2, 0, d / 2);
          g.addColorStop(0, oklch(0.42, 0.15, h));
          g.addColorStop(0.55, oklch(0.3, 0.11, h));
          g.addColorStop(1, oklch(0.22, 0.08, h));
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -d / 2, w, d);
          if (corner && i === 0) checkered(ctx, w, d);
          // Neon kerb along the outer edge, with its glow rising into the tile.
          const glow = ctx.createLinearGradient(0, d / 2 - 46, 0, d / 2);
          glow.addColorStop(0, oklch(0.8, 0.17, h, 0));
          glow.addColorStop(1, oklch(0.8, 0.17, h, 0.4));
          ctx.fillStyle = glow;
          ctx.fillRect(-w / 2, d / 2 - 46, w, 46);
          ctx.fillStyle = oklch(0.84, 0.16, h);
          ctx.fillRect(-w / 2, d / 2 - 9, w, 9);
        },
        after: rainbowTrack,
      };
    case 'night':
      return {
        ...base,
        rule: 'rgba(233, 189, 99, 0.55)', hair: 'rgba(233, 189, 99, 0.35)', paper: '#111d3c', price: pal.boardLine,
        gloss: 0.32, grain: 0.16, frame: pal.boardLine,
        jail: { cell: oklch(0.3, 0.08, 266), bars: pal.boardLine, label: pal.boardLine, outline: '#0b1430' },
        tile: (ctx, i, _n, w, d, corner) => {
          const g = ctx.createLinearGradient(0, -d / 2, 0, d / 2);
          g.addColorStop(0, '#16244b');
          g.addColorStop(1, '#0b1430');
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -d / 2, w, d);
          if (corner && i !== 0) sunburst(ctx, w, d);
        },
        after: nightNeon,
      };
    case 'tptv':
      return {
        ...base,
        face: TPTV.ink, text: TPTV.bone, price: TPTV.bone, priceFont: TPTV.mono, accent: TPTV.amber,
        rule: 'rgba(242, 240, 234, 0.22)', hair: TPTV.rule, paper: TPTV.ink2, gloss: 0, grain: 0.2, frame: '#2e2e36',
        jail: { cell: TPTV.amber, bars: TPTV.ink, label: TPTV.bone, outline: TPTV.ink },
        tile: (ctx, _i, _n, w, d, corner) => {
          ctx.fillStyle = corner ? TPTV.ink3 : TPTV.ink2;
          ctx.fillRect(-w / 2, -d / 2, w, d);
        },
        after: tptvBars,
      };
    case 'chog':
      return {
        ...base, gloss: 0.3, grain: 0.22,
        tile: (ctx, i, n, w, d) => {
          // The lane (a board with one) in Chog pink: the fast chain across the middle.
          const lane = i >= ringOf(n);
          const g = ctx.createLinearGradient(0, -d / 2, 0, d / 2);
          g.addColorStop(0, lane ? '#4a1d5e' : '#2a1a5c');
          g.addColorStop(1, lane ? '#2b1050' : pal.board);
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -d / 2, w, d);
        },
      };
    case 'pixel':
      return {
        ...base,
        rule: 'rgba(160, 140, 255, 0.45)', hair: null, paper: '#0d0b1d', price: '#ffe14d', gloss: 0.2, grain: 0.1,
        frame: '#2b2460', textStroke: 'rgba(7, 6, 15, 0.9)',
        jail: { cell: '#ff4fd8', bars: '#07060f', label: '#ffffff', outline: '#07060f' },
        tile: (ctx, i, _n, w, d) => {
          ctx.fillStyle = i % 2 ? '#0d0b1d' : '#100d24';
          ctx.fillRect(-w / 2, -d / 2, w, d);
          // Scanlines and a faint pixel grid, like a CRT up close.
          ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
          for (let y = -d / 2; y < d / 2; y += 8) ctx.fillRect(-w / 2, y, w, 3);
          ctx.fillStyle = 'rgba(120, 100, 255, 0.07)';
          for (let x = -w / 2; x < w / 2; x += 24) ctx.fillRect(x, -d / 2, 2, d);
          // A neon strip along the outer edge.
          ctx.fillStyle = i % 2 ? '#41e0ff' : '#ff4fd8';
          ctx.fillRect(-w / 2, d / 2 - 8, w, 8);
        },
      };
    case 'atlas':
      return {
        ...base,
        rule: 'rgba(60, 74, 86, 0.75)', hair: 'rgba(60, 74, 86, 0.35)', paper: '#f2ecd9', gloss: 0.08, grain: 0.34,
        frame: '#2f3b45',
        jail: { cell: '#d2492f', bars: '#2f3b45', label: '#ffffff', outline: '#2f3b45' },
        tile: (ctx, i, n, w, d) => {
          const lane = i >= ringOf(n);
          ctx.fillStyle = lane ? '#e9eef2' : '#f2ecd9';
          ctx.fillRect(-w / 2, -d / 2, w, d);
          // Faint contour lines, as on the map round them.
          ctx.strokeStyle = 'rgba(176, 140, 90, 0.18)';
          ctx.lineWidth = 2;
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            for (let x = -w / 2; x <= w / 2; x += 8) {
              const y = -d / 2 + d * (0.3 + k * 0.18) + Math.sin(x / 40 + i * 1.7 + k) * 9;
              if (x === -w / 2) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
          // The Express is a motorway: blue with white edge lines along its outer side.
          if (lane) {
            ctx.fillStyle = '#2f5ea8';
            ctx.fillRect(-w / 2, d / 2 - 30, w, 30);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-w / 2, d / 2 - 24, w, 3);
            ctx.fillRect(-w / 2, d / 2 - 9, w, 3);
          }
        },
      };
  }
}

/** The chequered flag across Rainbow Road's start: a bold strip on GO's start line, a faint flag behind. */
function checkered(ctx: Ctx, w: number, d: number) {
  const q = 24;
  for (let y = -d / 2, r = 0; y < d / 2; y += q, r++) {
    for (let x = -w / 2, c = 0; x < w / 2; x += q, c++) {
      const strip = x < -w / 2 + q * 2;
      if ((r + c) % 2) continue;
      ctx.fillStyle = strip ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(x, y, q, q);
    }
  }
  ctx.fillStyle = 'rgba(10, 6, 30, 0.85)';
  for (let y = -d / 2, r = 0; y < d / 2; y += q, r++) {
    for (let c = 0; c < 2; c++) if ((r + c) % 2) ctx.fillRect(-w / 2 + c * q, y, q, q);
  }
}

/** Art Deco fan rising from a Night City corner's outer corner. */
function sunburst(ctx: Ctx, w: number, d: number) {
  ctx.save();
  ctx.translate(w / 2, d / 2);
  ctx.fillStyle = 'rgba(233, 189, 99, 0.09)';
  for (let k = 0; k < 9; k++) {
    const a0 = Math.PI + (k / 9) * (Math.PI / 2), a1 = a0 + Math.PI / 36;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, w * 1.4, a0, a1); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(233, 189, 99, 0.25)';
  ctx.lineWidth = 2;
  for (const r of [w * 0.3, w * 0.36]) { ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, Math.PI * 1.5); ctx.stroke(); }
  ctx.restore();
}

/** Corners of the centre square inset by `o`, in play order: GO's corner first. */
function innerCorners(o: number): [number, number][] {
  const a = IN + o, b = PX - IN - o;
  return [[b, b], [a, b], [a, a], [b, a]];
}

/**
 * The rainbow road itself: a glossy ribbon just inside the ring of spaces,
 * each stretch the hue of the spaces beside it, with chevrons running in the
 * direction of play.
 */
function rainbowTrack(ctx: Ctx, n: number) {
  const per = n / 4;
  const o1 = 12, o2 = 62;
  const outer = innerCorners(o1), inner = innerCorners(o2);
  ctx.save();
  for (let s = 0; s < 4; s++) {
    const e = (s + 1) % 4;
    const [ax, ay] = outer[s], [bx, by] = outer[e];
    const grad = ctx.createLinearGradient(ax, ay, bx, by);
    const lane = (i: number) => oklch(0.72, 0.21, lapHue(i, n));
    grad.addColorStop(0, lane(s * per));
    for (let k = 1; k < per; k++) grad.addColorStop((k - 0.5) / (per - 1), lane(s * per + k));
    grad.addColorStop(1, lane((s + 1) * per));
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(...inner[e]); ctx.lineTo(...inner[s]); ctx.closePath();
    ctx.save();
    ctx.shadowColor = 'rgba(255, 120, 220, 0.6)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    // Gloss: a white sheen on the outer half of the ribbon.
    const ux = Math.sign(bx - ax), uy = Math.sign(by - ay);
    const nx = -uy, ny = ux; // inward normal (play runs clockwise seen from above)
    const sheen = ctx.createLinearGradient(ax, ay, ax + nx * (o2 - o1), ay + ny * (o2 - o1));
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
    sheen.addColorStop(0.4, 'rgba(255, 255, 255, 0.04)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    ctx.fill();
    // Chevrons, pointing the way round.
    const len = Math.hypot(bx - ax, by - ay);
    const mid = (o2 - o1) / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    for (let t = 70; t < len - 50; t += 74) {
      const cx = ax + ux * t + nx * mid, cy = ay + uy * t + ny * mid;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(uy, ux));
      ctx.beginPath(); ctx.moveTo(-9, -15); ctx.lineTo(8, 0); ctx.lineTo(-9, 15); ctx.stroke();
      ctx.restore();
    }
  }
  // Bright kerb lines on both edges of the ribbon.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 3;
  for (const pts of [outer, inner]) {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

/** Night City: a cyan and magenta neon tube just inside the gold frame. */
function nightNeon(ctx: Ctx) {
  ctx.save();
  for (const [o, color, lw] of [[16, oklch(0.85, 0.13, 205), 4], [28, oklch(0.7, 0.22, 350), 3]] as const) {
    const pts = innerCorners(o);
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

/** Takeprofit TV: the SMPTE bars run round the inside of the ring, as the site's divider. */
function tptvBars(ctx: Ctx) {
  const pts = innerCorners(10);
  const h = 12;
  for (let s = 0; s < 4; s++) {
    const [ax, ay] = pts[s], [bx, by] = pts[(s + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(by - ay, bx - ax));
    const seg = len / 7;
    TPTV.bars.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * seg, 0, seg + 0.5, h); });
    ctx.restore();
  }
}

/** Procedural grain, laid over the finished print. */
function grain(ctx: Ctx, alpha: number) {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const rnd = seeded(0x2545f491);
  const rows = Array.from({ length: N }, rnd);
  const cols = Array.from({ length: N }, rnd);
  const d = img.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = 128 + (rnd() - 0.5) * 44 + (rows[y] - 0.5) * 20 + (cols[x] - 0.5) * 20;
      const i = (y * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ctx.createPattern(c, 'repeat')!;
  ctx.fillRect(0, 0, PX, PX);
  ctx.restore();
}

/** Soft shadow where the print meets the frame. */
function edgeShadow(ctx: Ctx) {
  const depth = 54;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const sides: [number, number, number, number][] = [
    [0, 0, 0, depth], [0, PX, 0, PX - depth], [0, 0, depth, 0], [PX, 0, PX - depth, 0],
  ];
  for (const [x0, y0, x1, y1] of sides) {
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, 'rgba(0,0,0,0.26)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, PX, PX);
  }
  ctx.restore();
}

/** A colour band with its set glyph, lit from above when the look is glossy. */
function colourBand(ctx: Ctx, color: string, group: string, w: number, d: number, b: number, skin: Skin) {
  const top = -d / 2;
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, top, w, b);
  if (skin.gloss > 0) {
    const g = ctx.createLinearGradient(0, top, 0, top + b);
    g.addColorStop(0, `rgba(255,255,255,${skin.gloss})`);
    g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${skin.gloss * 0.45})`);
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, top, w, b);
  }
  const glyph = SET_GLYPHS[group];
  if (glyph) {
    const light = /^#[0-9a-f]{6}$/i.test(color) ? luminance(color) > 0.3 : true;
    ctx.save();
    ctx.translate(0, top + b / 2);
    ctx.fillStyle = light ? 'rgba(20, 16, 12, 0.62)' : 'rgba(255, 255, 255, 0.86)';
    drawGlyph(ctx, glyph, b * 0.27);
    ctx.restore();
  }
  ctx.strokeStyle = skin.rule;
  ctx.lineWidth = 4;
  ctx.strokeRect(-w / 2, top, w, b);
}

/**
 * Paints the board face. `px` is the canvas size: the game uses the full
 * 2048 px; the lobby preview asks for a small one and gets the same art.
 */
export function drawBoard(theme: Theme, logo?: HTMLImageElement | null, px = PX): HTMLCanvasElement {
  const face = theme.ui?.boardFont ?? theme.ui?.font ?? 'Oswald, Impact, sans-serif';
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d')!;
  ctx.scale(px / PX, px / PX);
  const pal = theme.palette;
  const skin = skinFor(theme);
  const money = (n: number) => `${theme.currency}${n}`;
  // Takeprofit TV paints its own mark as vectors; only a room's own logo replaces it.
  const roomLogo = logo && !(theme.logoUrl && logo.src.endsWith(theme.logoUrl)) ? logo : null;

  ctx.fillStyle = skin.face;
  ctx.fillRect(0, 0, PX, PX);
  if (theme.art === 'heritage' || theme.art === 'chog') {
    // A soft light falling on the middle of the board.
    const lift = ctx.createRadialGradient(PX / 2, PX / 2, 100, PX / 2, PX / 2, PX * 0.7);
    lift.addColorStop(0, theme.art === 'chog' ? 'rgba(120, 70, 220, 0.35)' : 'rgba(255, 252, 240, 0.7)');
    lift.addColorStop(1, theme.art === 'chog' ? 'rgba(0, 0, 0, 0.2)' : 'rgba(150, 110, 60, 0.12)');
    ctx.fillStyle = lift;
    ctx.fillRect(0, 0, PX, PX);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // ---- centre ----
  const n = theme.spaces.length;
  const map = getMap(theme.mapId);
  const lane = shapeOf(n).lane;
  if (lane) centreLane(ctx, theme, face, logo ?? null);
  else {
    switch (theme.art) {
      case 'tptv': centreTptv(ctx, theme, roomLogo); break;
      case 'rainbow': centreRainbow(ctx, theme, face, logo ?? null); break;
      case 'night': centreNight(ctx, theme, face, logo ?? null); break;
      case 'pixel': centrePixel(ctx, theme, face, logo ?? null); break;
      default:
        if (logo) centreLogo(ctx, theme, face, logo);
        else centreHeritage(ctx, theme, face);
    }
  }

  // ---- tiles ----
  let utilityN = 0;
  const T = tileWidth(n);
  // Narrow tiles (big maps) get smaller lettering.
  const scale = Math.min(1, T / 0.8889);
  const iconScale = Math.max(0.72, scale);
  const railIcon: IconKind = theme.art === 'tptv' ? 'camera' : 'train';
  theme.spaces.forEach((s, i) => {
    const g = tile(i, n);
    ctx.save();
    ctx.translate((g.x + W / 2) * S, (g.z + W / 2) * S);
    const w = (g.corner ? C : T) * S;
    const d = C * S;
    ctx.rotate(g.rot);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -d / 2, w, d);
    ctx.clip();
    skin.tile?.(ctx, i, n, w, d, g.corner);
    ctx.restore();
    // Outer rule on the tile edge, drawn before clipping so it keeps its full weight.
    ctx.strokeStyle = skin.rule;
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.beginPath();
    ctx.rect(-w / 2, -d / 2, w, d);
    ctx.clip();
    ctx.fillStyle = skin.text;
    const pad = 10;
    /** Hairline inside the outer rule, from `top` down to the tile's outer edge. */
    const hairline = (top: number) => {
      if (!skin.hair) return;
      ctx.save();
      ctx.strokeStyle = skin.hair;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2 + 7, top + 7, w - 14, d / 2 - top - 14);
      ctx.restore();
    };

    const name = (y: number, size = Math.round(30 * scale)) => {
      ctx.fillStyle = skin.text;
      ctx.font = `600 ${size}px ${face}`;
      const lines = wrap(ctx, s.name.toUpperCase(), w - pad * 2 - 14);
      lines.forEach((l, k) => {
        fitFont(ctx, l, w - pad * 2 - 14, size, 600, face);
        ctx.fillText(l, 0, y + k * (size + 4));
      });
      return lines.length;
    };
    // Prices share one baseline near the outer edge of every tile.
    const price = (text: string, color = skin.price) => {
      ctx.fillStyle = color;
      fitFont(ctx, text, w - pad * 2 - 14, Math.round(28 * Math.max(0.85, scale)), skin.priceFont === TPTV.mono ? 700 : 600, skin.priceFont);
      ctx.fillText(text, 0, d / 2 - 34);
    };
    const icon = (kind: IconKind, y: number, size = 88) => {
      ctx.save();
      ctx.translate(0, y);
      drawIcon(ctx, kind, Math.round(size * iconScale), skin.text, skin.paper, skin.accent, theme.currency, face);
      ctx.restore();
    };

    if (g.corner) {
      hairline(-d / 2);
      ctx.rotate(-Math.PI / 4);
      const big = (text: string, y: number, size: number, color = skin.text) => {
        fitFont(ctx, text, chord(y, size), size, 700, face);
        if (skin.textStroke) {
          ctx.strokeStyle = skin.textStroke;
          ctx.lineWidth = Math.max(5, size * 0.12);
          ctx.strokeText(text, 0, y);
        }
        ctx.fillStyle = color;
        ctx.fillText(text, 0, y);
      };
      const cornerIcon = (kind: IconKind) => {
        ctx.save();
        drawIcon(ctx, kind, 100, skin.text, skin.paper, skin.accent, theme.currency, face);
        ctx.restore();
      };
      /** Renamed corners print their own name split over the icon; stock ones keep the two words. */
      const words = (stock: [string, string]) => {
        const up = s.name.toUpperCase();
        if (up === `${stock[0]} ${stock[1]}`) return { top: stock[0], bottom: stock[1], caption: '' };
        const ws = up.split(/\s+/);
        if (ws.length === 1) return { top: '', bottom: up, caption: `${stock[0]} ${stock[1]}` };
        const half = Math.ceil(ws.length / 2);
        return { top: ws.slice(0, half).join(' '), bottom: ws.slice(half).join(' '), caption: '' };
      };
      if (s.kind === 'go') {
        // The board's own salary; Blitz's rises every lap.
        const salary = map.goSalary ?? 200;
        big('COLLECT', -108, 30);
        big(map.salaryRise ? `${money(salary)} +${money(map.salaryRise.step)} A LAP` : `${money(salary)} SALARY`, -72, 30);
        big(s.name.toUpperCase(), 30, 130, skin.accent);
        // Filled, outlined chevron pointing along the direction of play.
        ctx.fillStyle = skin.accent;
        ctx.strokeStyle = skin.textStroke ?? pal.boardLine;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(52, 112); ctx.lineTo(-18, 112); ctx.lineTo(-18, 100); ctx.lineTo(-54, 120);
        ctx.lineTo(-18, 140); ctx.lineTo(-18, 128); ctx.lineTo(52, 128);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (s.kind === 'jail') {
        ctx.restore();
        drawJail(ctx, i, theme, n, skin, face);
        return;
      } else {
        const stock: [string, string] = s.kind === 'parking' ? ['FREE', 'PARKING'] : ['GO', 'TO JAIL'];
        const { top, bottom, caption } = words(stock);
        if (caption) big(caption, -104, 22);
        else big(top, -100, 44);
        cornerIcon(s.kind === 'parking' ? 'car' : 'cop');
        big(bottom, 100, 44);
      }
      ctx.restore();
      return;
    }

    switch (s.kind) {
      case 'property': {
        const b = BAND * S;
        colourBand(ctx, theme.groupColors[s.group!] ?? '#888888', s.group!, w, d, b, skin);
        hairline(-d / 2 + b);
        name(-d / 2 + b + 36);
        price(money(s.price!));
        break;
      }
      case 'railroad':
        hairline(-d / 2);
        name(-d / 2 + 38);
        icon(railIcon, 22);
        price(money(s.price!));
        break;
      case 'utility':
        hairline(-d / 2);
        name(-d / 2 + 38);
        icon(utilityN++ === 0 ? 'bulb' : 'water', 22);
        price(money(s.price!));
        break;
      case 'tax':
        hairline(-d / 2);
        name(-d / 2 + 38);
        icon(/luxury/i.test(s.name) ? 'gem' : 'bag', 22, 80);
        price(`PAY ${money(s.tax!)}`);
        break;
      case 'chance':
        hairline(-d / 2);
        name(-d / 2 + 38);
        ctx.save();
        if (theme.art === 'rainbow' || theme.art === 'night') { ctx.shadowColor = skin.accent; ctx.shadowBlur = 24; }
        ctx.fillStyle = skin.accent;
        ctx.font = `700 ${Math.round(150 * iconScale)}px ${face}`;
        ctx.fillText('?', 0, 44);
        ctx.restore();
        break;
      case 'arcade':
        hairline(-d / 2);
        name(-d / 2 + 38);
        icon('joystick', 24);
        price('MINI-GAME', skin.accent);
        break;
      case 'chest':
        hairline(-d / 2);
        name(-d / 2 + 38);
        if (theme.art === 'tptv' && !roomLogo) {
          ctx.save();
          ctx.translate(0, 34);
          drawTptvMark(ctx, 1.7 * iconScale);
          ctx.restore();
        } else if (logo) {
          const l = Math.round(120 * iconScale);
          ctx.drawImage(logo, -l / 2, 30 - l / 2, l, l);
        } else icon('chest', 30);
        break;
    }
    ctx.restore();
  });

  skin.after?.(ctx, n);
  if (lane) laneMarks(ctx, theme, n);

  // ---- print finish ----
  grain(ctx, skin.grain);
  edgeShadow(ctx);

  // Outer frame: a heavy rule with a hairline inside it.
  ctx.strokeStyle = skin.frame;
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, PX - 14, PX - 14);
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 26, PX - 52, PX - 52);
  // Inner frame around the centre, and its hairline (and round the lane up the middle).
  ctx.lineWidth = 6;
  ctx.strokeRect(IN, IN, PX - 2 * IN, PX - 2 * IN);
  if (lane) ctx.strokeRect(PX / 2 - (C / 2) * S, IN, C * S, PX - 2 * IN);
  ctx.lineWidth = 1.5;
  if (theme.art !== 'rainbow') ctx.strokeRect(IN + 10, IN + 10, PX - 2 * IN - 20, PX - 2 * IN - 20);
  return cv;
}

function drawJail(ctx: Ctx, i: number, theme: Theme, n: number, skin: Skin, face: string) {
  const g = tile(i, n);
  const x0 = (g.x - C / 2 + W / 2) * S, z0 = (g.z - C / 2 + W / 2) * S;
  const size = C * S;
  const strip = 0.42 * S;
  const cell = size - strip;
  // Cell in the inner quadrant (towards board centre: +x, -z).
  ctx.fillStyle = skin.jail.cell;
  ctx.fillRect(x0 + strip, z0, cell, cell);
  if (skin.gloss > 0) {
    const sheen = ctx.createLinearGradient(x0 + strip, z0, x0 + strip, z0 + cell);
    sheen.addColorStop(0, `rgba(255,255,255,${skin.gloss * 0.6})`);
    sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x0 + strip, z0, cell, cell);
  }
  ctx.strokeStyle = skin.rule;
  ctx.lineWidth = 4;
  ctx.strokeRect(x0 + strip, z0, cell, cell);
  ctx.strokeRect(x0, z0, size, size);
  // Hairline along the "just visiting" L.
  if (skin.hair) {
    ctx.save();
    ctx.strokeStyle = skin.hair;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 7, z0 + 7); ctx.lineTo(x0 + strip - 7, z0 + 7); ctx.lineTo(x0 + strip - 7, z0 + cell + 7);
    ctx.lineTo(x0 + size - 7, z0 + cell + 7); ctx.lineTo(x0 + size - 7, z0 + size - 7); ctx.lineTo(x0 + 7, z0 + size - 7);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  // Bars, with a cross rail.
  ctx.strokeStyle = skin.jail.bars;
  ctx.lineWidth = 6;
  for (let k = 1; k < 5; k++) {
    const x = x0 + strip + (cell * k) / 5;
    ctx.beginPath(); ctx.moveTo(x, z0 + 10); ctx.lineTo(x, z0 + cell - 10); ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x0 + strip + 10, z0 + cell * 0.72); ctx.lineTo(x0 + size - 10, z0 + cell * 0.72); ctx.stroke();
  ctx.save();
  ctx.translate(x0 + strip + cell / 2, z0 + cell / 2);
  ctx.rotate(-Math.PI / 4);
  const label = theme.spaces[i].name.toUpperCase();
  fitFont(ctx, label, size * 0.55, 60, 700, face);
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = skin.jail.outline;
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = skin.jail.label;
  ctx.fillText(label, 0, 0);
  ctx.restore();
  // "Just visiting" along the outer L.
  ctx.fillStyle = skin.text;
  fitFont(ctx, 'VISITING', cell - 30, 36, 600, face);
  ctx.fillText('JUST', x0 + (size + strip) / 2, z0 + size - strip / 2);
  ctx.save();
  ctx.translate(x0 + strip / 2, z0 + cell / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText('VISITING', 0, 0);
  ctx.restore();
}

export function boardTexture(theme: Theme, logo?: HTMLImageElement | null): CanvasTexture {
  const tex = new CanvasTexture(drawBoard(theme, logo));
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
