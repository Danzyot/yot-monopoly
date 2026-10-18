// Shared bits for painting the board face: canvas size, text fitting and a
// seeded random source so procedural art (stars, skylines) never changes
// between repaints.

import { C, W } from './layout.ts';

/**
 * The board face is one 2048² canvas: 16 MB as a texture, sharp enough for
 * tile names at phone resolution. CardDecks and JailCell measure in these
 * pixels too. A smaller canvas (the lobby preview) paints the same art scaled.
 */
export const PX = 2048;
export const S = PX / W; // pixels per world unit
/** Edge of the inner square (the board centre), from the board edge. */
export const IN = C * S;
/** Half the diagonal of a corner tile: the room a line of rotated text has at the centre. */
export const HALF_DIAG = (C * S) / Math.SQRT2;
/** Half the inner square's diagonal: in the centre's 45° frame, |x| + |y| stays under this. */
export const CENTRE_REACH = ((PX - 2 * IN) / 2) * Math.SQRT2;

export function fitFont(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight: number | string, family: string) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    s -= 1;
  } while (ctx.measureText(text).width > max && s > 8);
  return s + 1;
}

export function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
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

/** Deterministic 0–1 random numbers (an LCG): the same art on every repaint. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Paint in the board centre's 45° frame (text there reads from the GO corner), clipped to the centre. */
export function inCentre(ctx: CanvasRenderingContext2D, paint: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(IN, IN, PX - 2 * IN, PX - 2 * IN);
  ctx.clip();
  ctx.translate(PX / 2, PX / 2);
  ctx.rotate(-Math.PI / 4);
  paint();
  ctx.restore();
}

/** Text with wide tracking, centred on x (canvas letterSpacing is not everywhere yet). */
export function spacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, stroke = false) {
  const chars = [...text];
  const widths = chars.map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  const align = ctx.textAlign;
  ctx.textAlign = 'left';
  let cx = x - total / 2;
  chars.forEach((c, i) => {
    if (stroke) ctx.strokeText(c, cx, y);
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = align;
  return total;
}
