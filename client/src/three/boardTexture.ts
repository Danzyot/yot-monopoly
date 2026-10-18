// Paints an edition's whole board face onto one canvas, used as the texture on
// top of the board mesh. Everything the edition renames or recolours shows up
// here automatically. The face is drawn like a printed board: vector icons in
// the edition's inks, hairline double rules around every tile, a linen grain
// over the lot and a soft shadow where the print meets the frame.

import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Theme } from '../../../shared/themes.ts';
import { BAND, C, W, tile, tileWidth } from './layout.ts';

const PX = 2048;
const S = PX / W; // pixels per world unit
/** Half the diagonal of a corner tile: the room a line of rotated text has at the centre. */
const HALF_DIAG = (C * S) / Math.SQRT2;

// Lettering face for the board being drawn; set per edition in drawBoard.
let FACE = 'Oswald, Impact, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 600, family = FACE) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    s -= 1;
  } while (ctx.measureText(text).width > max && s > 8);
}

/** Width a line of text `size` tall can have at `y` in a corner tile's rotated frame (a diamond). */
function chord(y: number, size: number): number {
  return Math.max(60, 2 * (HALF_DIAG - Math.abs(y) - size * 0.42) - 16);
}

/** Pencil-sketched icons, drawn in a 100×100 box centred on the origin. */
type IconKind = 'train' | 'camera' | 'bulb' | 'water' | 'bag' | 'gem' | 'car' | 'cop' | 'chest' | 'joystick';

function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, size: number, ink: string, paper: string, accent: string, currency = '$') {
  ctx.save();
  ctx.scale(size / 100, size / 100);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  const circle = (x: number, y: number, r: number, color = ink) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  const rrect = (x: number, y: number, w: number, h: number, r: number | number[], color = ink) => {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  };
  const poly = (pts: number[][], color = ink) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath(); ctx.fill();
  };
  const line = (x1: number, y1: number, x2: number, y2: number, w: number, color = ink) => {
    ctx.strokeStyle = color; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  };
  switch (kind) {
    case 'train': {
      // Side-on locomotive: cab, boiler, stack, dome, chassis, cowcatcher, wheels, steam.
      rrect(10, -38, 36, 50, 5);                 // cab
      rrect(17, -30, 20, 18, 3, paper);          // cab window
      rrect(-46, -20, 60, 32, [14, 0, 0, 14]);   // boiler
      poly([[-40, -42], [-20, -42], [-23, -20], [-37, -20]]); // smokestack
      circle(-6, -20, 8);                        // steam dome
      rrect(-50, 10, 98, 10, 3);                 // running board
      poly([[-44, 14], [-54, 34], [-26, 34]]);   // cowcatcher
      circle(-28, 32, 11); circle(-4, 32, 11); circle(28, 32, 14);
      circle(-28, 32, 4, paper); circle(-4, 32, 4, paper); circle(28, 32, 5, paper);
      circle(-22, -48, 6); circle(-9, -52, 8); circle(5, -50, 5); // puffs
      break;
    }
    case 'camera': {
      // Broadcast camera on a tripod: body, lens, two reels, tally light.
      rrect(-30, -18, 60, 38, 7);
      circle(-38, 1, 15); circle(-38, 1, 7, paper); circle(-38, 1, 3);
      circle(-12, -32, 13); circle(14, -32, 13);
      circle(-12, -32, 4, paper); circle(14, -32, 4, paper);
      rrect(18, -10, 18, 10, 2, paper);          // viewfinder
      circle(26, 10, 4, accent);                 // on-air light
      line(-12, 20, -26, 48, 6); line(12, 20, 26, 48, 6); line(0, 20, 0, 48, 6);
      break;
    }
    case 'bulb': {
      circle(0, -12, 28);
      poly([[-15, 10], [15, 10], [11, 26], [-11, 26]]);
      rrect(-13, 24, 26, 18, 3);
      rrect(-7, 42, 14, 7, 3);
      line(-13, 30, 13, 30, 2.5, paper); line(-12, 36, 12, 36, 2.5, paper);
      // Filament.
      ctx.strokeStyle = paper; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-9, 4); ctx.lineTo(-9, -12); ctx.lineTo(0, -4); ctx.lineTo(9, -12); ctx.lineTo(9, 4); ctx.stroke();
      // Rays.
      for (const a of [-90, -45, -135, -10, -170]) {
        const r = (a * Math.PI) / 180;
        line(Math.cos(r) * 36, -12 + Math.sin(r) * 36, Math.cos(r) * 47, -12 + Math.sin(r) * 47, 4);
      }
      break;
    }
    case 'water': {
      // A drop with a tap above it.
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.bezierCurveTo(16, 6, 28, 16, 28, 28);
      ctx.arc(0, 28, 28, 0, Math.PI, false);
      ctx.bezierCurveTo(-28, 16, -16, 6, 0, -14);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.55;
      circle(-10, 30, 6, paper);
      ctx.globalAlpha = 1;
      rrect(-34, -44, 36, 12, 4);                // tap body
      rrect(-8, -44, 14, 24, [0, 6, 0, 0]);      // spout bend
      rrect(-30, -54, 8, 12, 2); line(-38, -52, -18, -52, 5); // handle
      break;
    }
    case 'bag': {
      poly([[-16, -28], [-9, -46], [9, -46], [16, -28]]);
      rrect(-18, -32, 36, 10, 3);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(-13, -24);
      ctx.bezierCurveTo(-44, -6, -50, 46, 0, 46);
      ctx.bezierCurveTo(50, 46, 44, -6, 13, -24);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = paper;
      ctx.font = `700 44px ${FACE}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(currency, 0, 12);
      break;
    }
    case 'gem': {
      poly([[-42, -14], [-26, -40], [26, -40], [42, -14], [0, 44]]);
      ctx.strokeStyle = paper; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-42, -14); ctx.lineTo(42, -14);
      ctx.moveTo(-26, -40); ctx.lineTo(-14, -14); ctx.lineTo(0, 44); ctx.lineTo(14, -14); ctx.lineTo(26, -40);
      ctx.moveTo(0, -40); ctx.lineTo(-14, -14); ctx.moveTo(0, -40); ctx.lineTo(14, -14);
      ctx.stroke();
      break;
    }
    case 'car': {
      poly([[-48, 14], [-48, -2], [-32, -6], [-20, -28], [20, -28], [38, -6], [48, -2], [48, 14]]);
      rrect(-50, 6, 100, 12, 4);
      poly([[-16, -24], [-2, -24], [-2, -8], [-26, -8]], paper);  // rear window
      poly([[4, -24], [16, -24], [30, -8], [4, -8]], paper);       // windscreen
      circle(-26, 16, 12); circle(26, 16, 12);
      circle(-26, 16, 5, paper); circle(26, 16, 5, paper);
      circle(45, 2, 4, accent);                                     // headlight
      break;
    }
    case 'cop': {
      // Bust of an officer: shoulders, head and a peaked cap in the accent.
      rrect(-44, 20, 88, 30, [22, 22, 0, 0]);
      poly([[-5, 20], [5, 20], [0, 34]], paper);  // collar
      rrect(-8, 6, 16, 16, 3);
      circle(0, -6, 20);
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(0, -22, 25, Math.PI, 0); ctx.closePath(); ctx.fill();
      rrect(-27, -26, 54, 9, 3, accent);
      rrect(-30, -19, 60, 7, 3);                  // visor
      circle(0, -32, 4, paper);                   // badge
      break;
    }
    case 'chest': {
      rrect(-42, -4, 84, 42, 4);
      rrect(-42, -32, 84, 30, [14, 14, 0, 0]);
      line(-42, -3, 42, -3, 3, paper);
      line(-24, -32, -24, 38, 3, paper); line(24, -32, 24, 38, 3, paper);
      rrect(-9, -11, 18, 18, 3, paper);
      circle(0, -5, 3.5); rrect(-2, -5, 4, 8, 1);
      break;
    }
    case 'joystick': {
      rrect(-38, 14, 76, 28, [10, 10, 6, 6]);
      line(0, 18, -8, -20, 9);
      circle(-8, -30, 15, accent);
      circle(20, 20, 7, accent);
      break;
    }
  }
  ctx.restore();
}

/** Procedural linen grain, laid over the finished print at low opacity. */
function grain(ctx: CanvasRenderingContext2D) {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  let seed = 0x2545f491;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
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
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = ctx.createPattern(c, 'repeat')!;
  ctx.fillRect(0, 0, PX, PX);
  ctx.restore();
}

/** Soft shadow where the print meets the frame. */
function edgeShadow(ctx: CanvasRenderingContext2D) {
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

export function drawBoard(theme: Theme, logo?: HTMLImageElement | null): HTMLCanvasElement {
  FACE = theme.ui?.boardFont ?? theme.ui?.font ?? 'Oswald, Impact, sans-serif';
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const ctx = cv.getContext('2d')!;
  const pal = theme.palette;
  const money = (n: number) => `${theme.currency}${n}`;

  ctx.fillStyle = pal.board;
  ctx.fillRect(0, 0, PX, PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  // ---- centre ----
  ctx.save();
  ctx.translate(PX / 2, PX / 2);
  ctx.rotate(-Math.PI / 4);
  const title = theme.centerTitle;
  const banner = (y: number, maxW: number, size: number) => {
    fitFont(ctx, title, maxW, size, 700);
    const tw = ctx.measureText(title).width;
    const h = size * 1.25;
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.roundRect(-tw / 2 - 40, y - h / 2, tw + 80, h, logo ? h / 2 : 0);
    ctx.fill();
    ctx.strokeStyle = pal.boardLine;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(title, 0, y + size * 0.05);
    return tw;
  };

  const deck = (label: string, x: number, y: number, color: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.setLineDash([18, 12]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(-230, -120, 460, 240, 24);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    fitFont(ctx, label.toUpperCase(), 400, 64, 700);
    ctx.fillText(label.toUpperCase(), 0, 0);
    ctx.restore();
  };

  // Thin double rule with a lozenge at each corner and the middle of each side.
  const ornament = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.strokeStyle = pal.boardLine;
    ctx.fillStyle = pal.boardLine;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
    const lozenge = (cx: number, cy: number, r: number) => {
      ctx.fillStyle = pal.board;
      ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = pal.boardLine;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = pal.board;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.4); ctx.lineTo(cx + r * 0.4, cy); ctx.lineTo(cx, cy + r * 0.4); ctx.lineTo(cx - r * 0.4, cy);
      ctx.closePath(); ctx.fill();
    };
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) lozenge(cx, cy, 16);
    for (const [cx, cy] of [[x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) lozenge(cx, cy, 11);
    // Flourish ticks beside the mid-side lozenges, top and bottom.
    ctx.lineWidth = 2.5;
    for (const sy of [y, y + h]) {
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + w / 2 + dir * 34, sy);
        ctx.lineTo(x + w / 2 + dir * 110, sy);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x + w / 2 + dir * 118, sy, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  };

  if (logo) {
    // Artwork editions: the character sits in a glowing disc, the name on a
    // pill beneath it, and the two card piles flank it.
    const r = 270;
    const glow = ctx.createRadialGradient(0, -60, r * 0.4, 0, -60, r * 1.25);
    glow.addColorStop(0, pal.accent + '66');
    glow.addColorStop(1, pal.accent + '00');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, -60, r * 1.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.table;
    ctx.beginPath(); ctx.arc(0, -60, r, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, -60, r - 10, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(logo, -r, -60 - r + 20, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(0, -60, r, 0, Math.PI * 2); ctx.stroke();
    // A fine ring just outside the disc, like a foil-stamped seal.
    ctx.strokeStyle = pal.boardLine;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -60, r + 16, 0, Math.PI * 2); ctx.stroke();
    banner(330, 700, 150);
    deck(theme.deckNames.chest, -580, -60, pal.boardText);
    deck(theme.deckNames.chance, 580, -60, pal.accent);
  } else {
    // Printed editions: a ruled frame with lozenge corners around the banner.
    // The frame stays clear of the deck spots at y = ±430 (240px tall).
    ctx.save();
    ctx.font = `700 190px ${FACE}`;
    fitFont(ctx, title, PX * 0.55, 190, 700);
    const tw = ctx.measureText(title).width;
    ctx.restore();
    const fw = Math.min(tw + 80 + 220, 1500);
    ornament(-fw / 2, -205, fw, 410);
    banner(0, PX * 0.55, 190);
    deck(theme.deckNames.chest, 0, -430, pal.boardText);
    deck(theme.deckNames.chance, 0, 430, pal.accent);
  }
  ctx.restore();

  // ---- tiles ----
  let utilityN = 0;
  const n = theme.spaces.length;
  const T = tileWidth(n);
  // Narrow tiles (big maps) get smaller lettering.
  const scale = Math.min(1, T / 0.8889);
  const iconScale = Math.max(0.72, scale);
  const railIcon: IconKind = theme.id === 'tptv' ? 'camera' : 'train';
  theme.spaces.forEach((s, i) => {
    const g = tile(i, n);
    ctx.save();
    ctx.translate((g.x + W / 2) * S, (g.z + W / 2) * S);
    const w = (g.corner ? C : T) * S;
    const d = C * S;
    ctx.rotate(g.rot);
    // Outer rule on the tile edge, drawn before clipping so it keeps its full weight.
    ctx.strokeStyle = pal.boardLine;
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.beginPath();
    ctx.rect(-w / 2, -d / 2, w, d);
    ctx.clip();
    ctx.fillStyle = pal.boardText;
    const pad = 10;
    /** Hairline inside the outer rule, from `top` down to the tile's outer edge. */
    const hairline = (top: number) => {
      ctx.save();
      ctx.strokeStyle = pal.boardLine;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2 + 7, top + 7, w - 14, d / 2 - top - 14);
      ctx.restore();
    };

    const name = (y: number, size = Math.round(30 * scale)) => {
      ctx.fillStyle = pal.boardText;
      ctx.font = `600 ${size}px ${FACE}`;
      const lines = wrap(ctx, s.name.toUpperCase(), w - pad * 2 - 14);
      lines.forEach((l, k) => {
        fitFont(ctx, l, w - pad * 2 - 14, size);
        ctx.fillText(l, 0, y + k * (size + 4));
      });
      return lines.length;
    };
    // Prices share one baseline near the outer edge of every tile.
    const price = (text: string, color = pal.boardText) => {
      ctx.fillStyle = color;
      fitFont(ctx, text, w - pad * 2 - 14, Math.round(28 * Math.max(0.85, scale)), 500, 'Inter, sans-serif');
      ctx.fillText(text, 0, d / 2 - 34);
    };
    const icon = (kind: IconKind, y: number, size = 88) => {
      ctx.save();
      ctx.translate(0, y);
      drawIcon(ctx, kind, Math.round(size * iconScale), pal.boardText, pal.board, pal.accent, theme.currency);
      ctx.restore();
    };

    if (g.corner) {
      hairline(-d / 2);
      ctx.rotate(-Math.PI / 4);
      const big = (text: string, y: number, size: number, color = pal.boardText) => {
        ctx.fillStyle = color;
        fitFont(ctx, text, chord(y, size), size, 700);
        ctx.fillText(text, 0, y);
      };
      const cornerIcon = (kind: IconKind) => {
        ctx.save();
        drawIcon(ctx, kind, 100, pal.boardText, pal.board, pal.accent);
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
        big('COLLECT', -108, 30);
        big(`${money(200)} SALARY`, -72, 30);
        big(s.name.toUpperCase(), 30, 130, pal.accent);
        // Filled, outlined chevron pointing along the direction of play.
        ctx.fillStyle = pal.accent;
        ctx.strokeStyle = pal.boardLine;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(52, 112); ctx.lineTo(-18, 112); ctx.lineTo(-18, 100); ctx.lineTo(-54, 120);
        ctx.lineTo(-18, 140); ctx.lineTo(-18, 128); ctx.lineTo(52, 128);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (s.kind === 'jail') {
        ctx.restore();
        drawJail(ctx, i, theme, n);
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
        ctx.fillStyle = theme.groupColors[s.group!] ?? '#888';
        ctx.fillRect(-w / 2, -d / 2, w, b);
        ctx.strokeRect(-w / 2, -d / 2, w, b);
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
        ctx.fillStyle = pal.accent;
        ctx.font = `700 ${Math.round(150 * iconScale)}px ${FACE}`;
        ctx.fillText('?', 0, 44);
        break;
      case 'arcade':
        hairline(-d / 2);
        name(-d / 2 + 38);
        icon('joystick', 24);
        price('MINI-GAME', pal.accent);
        break;
      case 'chest':
        hairline(-d / 2);
        name(-d / 2 + 38);
        if (logo) {
          const l = Math.round(120 * iconScale);
          ctx.drawImage(logo, -l / 2, 30 - l / 2, l, l);
        } else icon('chest', 30);
        break;
    }
    ctx.restore();
  });

  // ---- print finish ----
  grain(ctx);
  edgeShadow(ctx);

  // Outer frame: a heavy rule with a hairline inside it.
  ctx.strokeStyle = pal.boardLine;
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, PX - 14, PX - 14);
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 26, PX - 52, PX - 52);
  // Inner frame around the centre, and its hairline.
  ctx.lineWidth = 6;
  ctx.strokeRect(C * S, C * S, PX - 2 * C * S, PX - 2 * C * S);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(C * S + 10, C * S + 10, PX - 2 * C * S - 20, PX - 2 * C * S - 20);
  return cv;
}

function drawJail(ctx: CanvasRenderingContext2D, i: number, theme: Theme, n: number) {
  const g = tile(i, n);
  const pal = theme.palette;
  const x0 = (g.x - C / 2 + W / 2) * S, z0 = (g.z - C / 2 + W / 2) * S;
  const size = C * S;
  const strip = 0.42 * S;
  const cell = size - strip;
  // Cell in the inner quadrant (towards board centre: +x, -z).
  ctx.fillStyle = pal.accent;
  ctx.fillRect(x0 + strip, z0, cell, cell);
  ctx.strokeStyle = pal.boardLine;
  ctx.lineWidth = 4;
  ctx.strokeRect(x0 + strip, z0, cell, cell);
  ctx.strokeRect(x0, z0, size, size);
  // Hairline along the "just visiting" L.
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 + 7, z0 + 7); ctx.lineTo(x0 + strip - 7, z0 + 7); ctx.lineTo(x0 + strip - 7, z0 + cell + 7);
  ctx.lineTo(x0 + size - 7, z0 + cell + 7); ctx.lineTo(x0 + size - 7, z0 + size - 7); ctx.lineTo(x0 + 7, z0 + size - 7);
  ctx.closePath(); ctx.stroke();
  ctx.restore();
  // Bars, with a cross rail.
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
  ctx.fillStyle = '#ffffff';
  fitFont(ctx, theme.spaces[i].name.toUpperCase(), size * 0.55, 60, 700);
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = pal.boardLine;
  ctx.strokeText(theme.spaces[i].name.toUpperCase(), 0, 0);
  ctx.fillText(theme.spaces[i].name.toUpperCase(), 0, 0);
  ctx.restore();
  // "Just visiting" along the outer L.
  ctx.fillStyle = pal.boardText;
  fitFont(ctx, 'VISITING', cell - 30, 36, 600);
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
