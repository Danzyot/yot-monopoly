// Paints an edition's whole board face onto one canvas, used as the texture on
// top of the board mesh. Everything the edition renames or recolours shows up
// here automatically.

import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Theme } from '../../../shared/themes.ts';
import { BAND, C, T, W, tile } from './layout.ts';

const PX = 2048;
const S = PX / W; // pixels per world unit

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

export function drawBoard(theme: Theme, logo?: HTMLImageElement | null): HTMLCanvasElement {
  FACE = theme.ui?.font ?? 'Oswald, Impact, sans-serif';
  const cv = document.createElement('canvas');
  cv.width = cv.height = PX;
  const ctx = cv.getContext('2d')!;
  const pal = theme.palette;
  const money = (n: number) => `${theme.currency}${n}`;

  ctx.fillStyle = pal.board;
  ctx.fillRect(0, 0, PX, PX);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

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
    banner(330, 700, 150);
    deck(theme.deckNames.chest, -580, -60, pal.boardText);
    deck(theme.deckNames.chance, 580, -60, pal.accent);
  } else {
    banner(0, PX * 0.55, 190);
    deck(theme.deckNames.chest, 0, -430, pal.boardText);
    deck(theme.deckNames.chance, 0, 430, pal.accent);
  }
  ctx.restore();

  // ---- tiles ----
  const chanceIcon = '?';
  let utilityN = 0;
  theme.spaces.forEach((s, i) => {
    const g = tile(i);
    ctx.save();
    ctx.translate((g.x + W / 2) * S, (g.z + W / 2) * S);
    const w = (g.corner ? C : T) * S;
    const d = C * S;
    ctx.rotate(g.rot);
    ctx.strokeStyle = pal.boardLine;
    ctx.lineWidth = 4;
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    ctx.fillStyle = pal.boardText;
    const pad = 10;

    const name = (y: number, size = 30) => {
      ctx.font = `600 ${size}px ${FACE}`;
      const lines = wrap(ctx, s.name.toUpperCase(), w - pad * 2);
      lines.forEach((l, k) => {
        fitFont(ctx, l, w - pad * 2, size);
        ctx.fillText(l, 0, y + k * (size + 4));
      });
      return lines.length;
    };
    const price = (text: string) => {
      ctx.font = `500 28px Inter, sans-serif`;
      ctx.fillText(text, 0, d / 2 - 30);
    };
    const icon = (glyph: string, y: number, size = 90) => {
      ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(glyph, 0, y);
    };

    if (g.corner) {
      ctx.rotate(-Math.PI / 4);
      const big = (text: string, y: number, size: number, color = pal.boardText) => {
        ctx.fillStyle = color;
        fitFont(ctx, text, C * S * 1.1, size, 700);
        ctx.fillText(text, 0, y);
      };
      if (s.kind === 'go') {
        big('COLLECT', -70, 34);
        big(`${money(200)} SALARY`, -30, 34);
        big(s.name.toUpperCase(), 45, 110, pal.accent);
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.moveTo(-110, 115); ctx.lineTo(80, 115); ctx.lineTo(80, 95); ctx.lineTo(125, 125);
        ctx.lineTo(80, 155); ctx.lineTo(80, 135); ctx.lineTo(-110, 135);
        ctx.fill();
      } else if (s.kind === 'jail') {
        ctx.restore();
        drawJail(ctx, i, theme);
        return;
      } else if (s.kind === 'parking') {
        big('FREE', -70, 50);
        icon('🚗', 10, 100);
        big('PARKING', 90, 50);
        if (s.name.toUpperCase() !== 'FREE PARKING') big(s.name.toUpperCase(), 140, 30, pal.accent);
      } else {
        big('GO TO', -70, 50);
        icon('👮', 10, 100);
        big('JAIL', 90, 50);
        if (s.name.toUpperCase() !== 'GO TO JAIL') big(s.name.toUpperCase(), 140, 30, pal.accent);
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
        ctx.fillStyle = pal.boardText;
        name(-d / 2 + b + 34);
        price(money(s.price!));
        break;
      }
      case 'railroad':
        name(-d / 2 + 36);
        icon('🚂', 20);
        price(money(s.price!));
        break;
      case 'utility':
        name(-d / 2 + 36);
        icon(utilityN++ === 0 ? '💡' : '🚰', 20);
        price(money(s.price!));
        break;
      case 'tax':
        name(-d / 2 + 36);
        icon('💎', 10, 70);
        price(`PAY ${money(s.tax!)}`);
        break;
      case 'chance':
        name(-d / 2 + 36);
        ctx.fillStyle = pal.accent;
        ctx.font = `700 150px ${FACE}`;
        ctx.fillText(chanceIcon, 0, 40);
        break;
      case 'chest':
        name(-d / 2 + 36);
        if (logo) ctx.drawImage(logo, -60, -25, 120, 120);
        else icon('🧰', 30);
        break;
    }
    ctx.restore();
  });

  // Outer frame.
  ctx.strokeStyle = pal.boardLine;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, PX - 10, PX - 10);
  ctx.lineWidth = 6;
  ctx.strokeRect(C * S, C * S, PX - 2 * C * S, PX - 2 * C * S);
  return cv;
}

function drawJail(ctx: CanvasRenderingContext2D, i: number, theme: Theme) {
  const g = tile(i);
  const pal = theme.palette;
  const x0 = (g.x - C / 2 + W / 2) * S, z0 = (g.z - C / 2 + W / 2) * S;
  const size = C * S;
  const strip = 0.42 * S;
  // Cell in the inner quadrant (towards board centre: +x, -z).
  ctx.fillStyle = pal.accent;
  ctx.fillRect(x0 + strip, z0, size - strip, size - strip);
  ctx.strokeStyle = pal.boardLine;
  ctx.lineWidth = 4;
  ctx.strokeRect(x0 + strip, z0, size - strip, size - strip);
  ctx.strokeRect(x0, z0, size, size);
  ctx.lineWidth = 6;
  for (let k = 1; k < 5; k++) {
    const x = x0 + strip + ((size - strip) * k) / 5;
    ctx.beginPath(); ctx.moveTo(x, z0 + 10); ctx.lineTo(x, z0 + size - strip - 10); ctx.stroke();
  }
  ctx.save();
  ctx.translate(x0 + strip + (size - strip) / 2, z0 + (size - strip) / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#ffffff';
  fitFont(ctx, theme.spaces[i].name.toUpperCase(), size * 0.55, 60, 700);
  ctx.lineWidth = 8;
  ctx.strokeStyle = pal.boardLine;
  ctx.strokeText(theme.spaces[i].name.toUpperCase(), 0, 0);
  ctx.fillText(theme.spaces[i].name.toUpperCase(), 0, 0);
  ctx.restore();
  // "Just visiting" along the outer L.
  ctx.fillStyle = pal.boardText;
  ctx.font = `600 34px ${FACE}`;
  ctx.fillText('JUST', x0 + (size + strip) / 2, z0 + size - strip / 2);
  ctx.save();
  ctx.translate(x0 + strip / 2, z0 + (size - strip) / 2);
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
