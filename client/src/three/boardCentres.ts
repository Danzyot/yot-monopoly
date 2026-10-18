// The middle of the board, one design per look. Everything is painted in the
// centre's 45° frame (see inCentre) and keeps clear of the two printed card
// spots CardDecks.tsx puts the piles on: (0, ±430) on printed boards,
// (±580, -60) on boards with a logo. Spots are 460 × 240.

import type { Theme } from '../../../shared/themes.ts';
import { getMap } from '../../../shared/maps.ts';
import { CENTRE_REACH, fitFont, IN, inCentre, PX, seeded, spacedText } from './boardPaint.ts';
import { oklch } from './oklch.ts';

type Ctx = CanvasRenderingContext2D;

const SPOT_W = 460, SPOT_H = 240;

/** A card spot: where a deck's pile sits, with its name printed under it. */
function spot(ctx: Ctx, label: string, x: number, y: number, color: string, face: string, style: 'dashed' | 'brackets' | 'neon' = 'dashed') {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  if (style === 'brackets') {
    // Camera viewfinder corners.
    ctx.lineWidth = 8;
    ctx.lineCap = 'square';
    const hw = SPOT_W / 2, hh = SPOT_H / 2, k = 46;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(sx * hw, sy * (hh - k)); ctx.lineTo(sx * hw, sy * hh); ctx.lineTo(sx * (hw - k), sy * hh);
      ctx.stroke();
    }
  } else {
    if (style === 'neon') { ctx.shadowColor = color; ctx.shadowBlur = 24; }
    ctx.setLineDash(style === 'neon' ? [] : [18, 12]);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(-SPOT_W / 2, -SPOT_H / 2, SPOT_W, SPOT_H, 24);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = color;
  fitFont(ctx, label.toUpperCase(), 400, 64, 700, face);
  ctx.fillText(label.toUpperCase(), 0, 0);
  ctx.restore();
}

/** Thin double rule with a lozenge at each corner and the middle of each side. */
function ornament(ctx: Ctx, x: number, y: number, w: number, h: number, ink: string, paper: string) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
  const lozenge = (cx: number, cy: number, r: number) => {
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.4); ctx.lineTo(cx + r * 0.4, cy); ctx.lineTo(cx, cy + r * 0.4); ctx.lineTo(cx - r * 0.4, cy);
    ctx.closePath(); ctx.fill();
  };
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) lozenge(cx, cy, 16);
  for (const [cx, cy] of [[x + w / 2, y], [x + w / 2, y + h], [x, y + h / 2], [x + w, y + h / 2]]) lozenge(cx, cy, 11);
  ctx.fillStyle = ink;
  ctx.lineWidth = 2.5;
  for (const sy of [y, y + h]) {
    for (const dir of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + w / 2 + dir * 34, sy); ctx.lineTo(x + w / 2 + dir * 110, sy); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + w / 2 + dir * 118, sy, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/** Heritage: a banknote rosette behind a ruled frame and the red title banner. */
export function centreHeritage(ctx: Ctx, theme: Theme, face: string) {
  const pal = theme.palette;
  inCentre(ctx, () => {
    // Guilloche: interleaved sine-modulated loops, like the border of a banknote.
    ctx.save();
    ctx.strokeStyle = 'rgba(160, 120, 52, 0.30)';
    ctx.lineWidth = 1.6;
    for (let k = 0; k < 18; k++) {
      const phase = (k / 18) * Math.PI * 2;
      ctx.beginPath();
      for (let t = 0; t <= 720; t++) {
        const a = (t / 720) * Math.PI * 2;
        const r = 600 + 34 * Math.sin(9 * a + phase) + 12 * Math.sin(27 * a - phase);
        const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.86;
        if (t) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    const title = theme.centerTitle;
    const size = fitFont(ctx, title, PX * 0.5, 190, 700, face);
    const tw = ctx.measureText(title).width;
    const fw = Math.min(tw + 300, 1500);
    ornament(ctx, -fw / 2, -205, fw, 410, pal.boardLine, pal.board);
    // The banner: deep red, lit from above, with a gold hairline inset.
    const h = size * 1.25, bw = tw + 90;
    ctx.save();
    ctx.shadowColor = 'rgba(40, 20, 10, 0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, oklch(0.58, 0.19, 27));
    g.addColorStop(1, oklch(0.47, 0.17, 25));
    ctx.fillStyle = g;
    ctx.fillRect(-bw / 2, -h / 2, bw, h);
    ctx.restore();
    ctx.strokeStyle = pal.boardLine;
    ctx.lineWidth = 8;
    ctx.strokeRect(-bw / 2, -h / 2, bw, h);
    ctx.strokeStyle = 'rgba(236, 200, 120, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeRect(-bw / 2 + 14, -h / 2 + 14, bw - 28, h - 28);
    ctx.fillStyle = '#fffaf0';
    ctx.font = `700 ${size}px ${face}`;
    ctx.fillText(title, 0, size * 0.05);

    spot(ctx, theme.deckNames.chest, 0, -430, pal.boardText, face);
    spot(ctx, theme.deckNames.chance, 0, 430, pal.accent, face);
  });
}

/** Stars over a night sky; `below` keeps them out of the lower part of the frame. */
function stars(ctx: Ctx, rnd: () => number, count: number, below = CENTRE_REACH) {
  ctx.save();
  for (let k = 0; k < count; k++) {
    const x = (rnd() * 2 - 1) * CENTRE_REACH, y = (rnd() * 2 - 1) * CENTRE_REACH;
    if (Math.abs(x) + Math.abs(y) > CENTRE_REACH || y > below) continue;
    const r = rnd() < 0.08 ? 3.2 : 1 + rnd() * 1.6;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + rnd() * 0.6})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (r > 3) {
      // A four-point glint on the brightest.
      ctx.fillRect(x - 14, y - 0.8, 28, 1.6);
      ctx.fillRect(x - 0.8, y - 14, 1.6, 28);
    }
  }
  ctx.restore();
}

/** The S-bend of the centre's rainbow road, at height offset `dy`. */
function roadPath(ctx: Ctx, dy: number) {
  ctx.beginPath();
  ctx.moveTo(-1100, 140 + dy);
  ctx.bezierCurveTo(-480, 380 + dy, 480, -380 + dy, 1100, -140 + dy);
}

/** The centre ribbon's hues: OKLCH at one lightness and chroma, so no stripe shouts over the others. */
const ROAD_HUES = [350, 40, 85, 140, 200, 255, 305];

/** Rainbow Road: a starfield, a glossy rainbow ribbon through it, light streaks and a chrome title. */
export function centreRainbow(ctx: Ctx, theme: Theme, face: string, logo: HTMLImageElement | null) {
  const pal = theme.palette;
  // Deep-space wash, brightest behind the title.
  const sky = ctx.createRadialGradient(PX / 2, PX / 2, 60, PX / 2, PX / 2, PX * 0.55);
  sky.addColorStop(0, oklch(0.34, 0.13, 300));
  sky.addColorStop(0.55, oklch(0.22, 0.09, 285));
  sky.addColorStop(1, oklch(0.16, 0.06, 275));
  ctx.fillStyle = sky;
  ctx.fillRect(IN, IN, PX - 2 * IN, PX - 2 * IN);

  inCentre(ctx, () => {
    const rnd = seeded(0x5eed);
    stars(ctx, rnd, 420);
    // Light streaks: long thin flares crossing the sky.
    for (let k = 0; k < 9; k++) {
      const y = -700 + rnd() * 1400, x = -500 + rnd() * 600, len = 500 + rnd() * 700;
      const g = ctx.createLinearGradient(x, y, x + len, y - len * 0.35);
      const hue = ROAD_HUES[k % ROAD_HUES.length];
      g.addColorStop(0, oklch(0.85, 0.12, hue, 0));
      g.addColorStop(0.7, oklch(0.9, 0.1, hue, 0.55));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2 + rnd() * 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - len * 0.35); ctx.stroke();
    }
    // The road: a soft glow, seven stripes, a gloss highlight and bright kerbs.
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.shadowColor = oklch(0.75, 0.2, 320, 0.8);
    ctx.shadowBlur = 60;
    ctx.strokeStyle = 'rgba(30, 15, 70, 0.9)';
    ctx.lineWidth = 250;
    roadPath(ctx, 0); ctx.stroke();
    ctx.restore();
    ROAD_HUES.forEach((h, k) => {
      ctx.strokeStyle = oklch(0.7, 0.22, h);
      ctx.lineWidth = 34;
      roadPath(ctx, (k - 3) * 31); ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 36;
    roadPath(ctx, -62); ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 7;
    ctx.setLineDash([46, 30]);
    roadPath(ctx, 0); ctx.stroke();
    ctx.setLineDash([]);
    for (const dy of [-112, 112]) {
      ctx.save();
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 6;
      roadPath(ctx, dy); ctx.stroke();
      ctx.restore();
    }
    // Sparkles along the kerbs.
    for (let k = 0; k < 26; k++) {
      const t = rnd();
      const x = -1100 + t * 2200;
      const u = (x + 1100) / 2200;
      const y = (1 - u) ** 3 * 140 + 3 * (1 - u) ** 2 * u * 380 + 3 * (1 - u) * u * u * -380 + u ** 3 * -140 + (rnd() < 0.5 ? -120 : 120);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(x, y, 2 + rnd() * 3, 0, Math.PI * 2); ctx.fill();
    }

    if (logo) {
      logoDisc(ctx, theme, logo, face);
      return;
    }
    // Chrome title, italic like a racing logo, with a neon halo.
    const title = theme.centerTitle;
    ctx.save();
    ctx.transform(1, 0, -0.2, 1, 0, 0);
    const size = fitFont(ctx, title, PX * 0.5, 210, 400, '"Lilita One", Impact, sans-serif');
    const fill = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
    fill.addColorStop(0, '#ffffff');
    fill.addColorStop(0.48, oklch(0.93, 0.05, 300));
    fill.addColorStop(0.52, oklch(0.78, 0.12, 300));
    fill.addColorStop(1, oklch(0.9, 0.08, 220));
    ctx.lineJoin = 'round';
    ctx.shadowColor = pal.accent;
    ctx.shadowBlur = 50;
    ctx.strokeStyle = oklch(0.2, 0.1, 290);
    ctx.lineWidth = 26;
    ctx.strokeText(title, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = fill;
    ctx.fillText(title, 0, 0);
    ctx.restore();
    // Map name on a checkered tag.
    const tag = getMap(theme.mapId).name.toUpperCase();
    ctx.font = `700 46px Oswald, Impact, sans-serif`;
    const tw = ctx.measureText(tag).width + 14 * tag.length + 70;
    ctx.fillStyle = oklch(0.92, 0.17, 100);
    ctx.beginPath(); ctx.roundRect(-tw / 2, 120, tw, 70, 35); ctx.fill();
    ctx.fillStyle = oklch(0.2, 0.1, 290);
    spacedText(ctx, tag, 0, 157, 14);

    spot(ctx, theme.deckNames.chest, 0, -430, oklch(0.86, 0.12, 212), face, 'neon');
    spot(ctx, theme.deckNames.chance, 0, 430, pal.accent, face, 'neon');
  });
}

/** One building of a skyline, standing on y = 0, `w` wide and `h` tall. */
function tower(ctx: Ctx, x: number, w: number, h: number, kind: number) {
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, -h);
  if (kind === 1) {
    // Setbacks.
    ctx.lineTo(x + w * 0.15, -h); ctx.lineTo(x + w * 0.15, -h - 40); ctx.lineTo(x + w * 0.3, -h - 40);
    ctx.lineTo(x + w * 0.3, -h - 80); ctx.lineTo(x + w * 0.7, -h - 80); ctx.lineTo(x + w * 0.7, -h - 40);
    ctx.lineTo(x + w * 0.85, -h - 40); ctx.lineTo(x + w * 0.85, -h);
  } else if (kind === 2) {
    // Spire.
    ctx.lineTo(x + w * 0.3, -h); ctx.lineTo(x + w * 0.5, -h - w * 1.1); ctx.lineTo(x + w * 0.7, -h);
  } else if (kind === 3) {
    // Dome.
    ctx.arc(x + w / 2, -h, w / 2, Math.PI, 0);
  }
  ctx.lineTo(x + w, -h);
  ctx.lineTo(x + w, 0);
  ctx.closePath();
  ctx.fill();
}

/** Night City: a moonlit skyline under a gold Art Deco title plate. */
export function centreNight(ctx: Ctx, theme: Theme, face: string, logo: HTMLImageElement | null) {
  const pal = theme.palette;
  inCentre(ctx, () => {
    const ground = 50;
    const sky = ctx.createLinearGradient(0, -CENTRE_REACH, 0, ground);
    sky.addColorStop(0, oklch(0.16, 0.05, 268));
    sky.addColorStop(0.62, oklch(0.24, 0.08, 285));
    sky.addColorStop(1, oklch(0.36, 0.13, 330));
    ctx.fillStyle = sky;
    ctx.fillRect(-CENTRE_REACH, -CENTRE_REACH, CENTRE_REACH * 2, CENTRE_REACH + ground);
    ctx.fillStyle = oklch(0.14, 0.045, 268);
    ctx.fillRect(-CENTRE_REACH, ground, CENTRE_REACH * 2, CENTRE_REACH);

    const rnd = seeded(0xc17e);
    stars(ctx, rnd, 260, -140);
    // Moon, with a halo.
    const mx = -420, my = -300;
    const halo = ctx.createRadialGradient(mx, my, 40, mx, my, 220);
    halo.addColorStop(0, 'rgba(255, 236, 190, 0.45)');
    halo.addColorStop(1, 'rgba(255, 236, 190, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, 220, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff3d6';
    ctx.beginPath(); ctx.arc(mx, my, 62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(200, 180, 140, 0.35)';
    for (const [x, y, r] of [[-18, -10, 14], [16, 18, 9], [20, -22, 7]]) {
      ctx.beginPath(); ctx.arc(mx + x, my + y, r, 0, Math.PI * 2); ctx.fill();
    }

    // The skyline, then its reflection in the river: same seed, flipped and faded.
    const skyline = (rnd: () => number) => {
      // Far row: hazy, no windows, for depth.
      ctx.fillStyle = oklch(0.3, 0.08, 280);
      for (let x = -1000; x < 1000;) {
        const w = 50 + rnd() * 70;
        tower(ctx, x, w, 120 + rnd() * 200, Math.floor(rnd() * 4));
        x += w - 6;
      }
      // Near row: dark silhouettes with lit windows, tallest towards the middle.
      const windows: [number, number, string][] = [];
      const lit = [oklch(0.88, 0.12, 85), oklch(0.88, 0.12, 85), oklch(0.88, 0.12, 85), oklch(0.85, 0.13, 205), oklch(0.72, 0.2, 350)];
      for (let x = -1000; x < 1000;) {
        const w = 60 + rnd() * 80;
        const centre = 1 - Math.min(1, Math.abs(x + w / 2) / 900);
        const h = 90 + rnd() * 140 + centre * 190;
        ctx.fillStyle = oklch(0.13, 0.04, 268);
        tower(ctx, x, w, h, Math.floor(rnd() * 4));
        for (let wy = 18; wy < h - 16; wy += 26) {
          for (let wx = x + 12; wx < x + w - 16; wx += 20) {
            if (rnd() < 0.3) windows.push([wx, -wy, lit[Math.floor(rnd() * lit.length)]]);
          }
        }
        x += w + 4 + rnd() * 10;
      }
      for (const [x, y, c] of windows) {
        ctx.fillStyle = c;
        ctx.fillRect(x, y - 12, 9, 12);
      }
    };
    ctx.save();
    ctx.translate(0, ground);
    ctx.save();
    ctx.scale(1, -0.55);
    ctx.globalAlpha = 0.22;
    skyline(seeded(0xb1d));
    ctx.restore();
    // Ripples across the reflection.
    ctx.fillStyle = 'rgba(11, 20, 48, 0.5)';
    for (let y = 8; y < 260; y += 14) ctx.fillRect(-1000, y, 2000, 5);
    skyline(seeded(0xb1d));
    // A neon horizon line where the street lights are.
    const neon = ctx.createLinearGradient(-900, 0, 900, 0);
    neon.addColorStop(0, oklch(0.8, 0.14, 205, 0));
    neon.addColorStop(0.3, oklch(0.8, 0.14, 205));
    neon.addColorStop(0.7, oklch(0.7, 0.22, 350));
    neon.addColorStop(1, oklch(0.7, 0.22, 350, 0));
    ctx.fillStyle = neon;
    ctx.shadowColor = oklch(0.7, 0.22, 350);
    ctx.shadowBlur = 20;
    ctx.fillRect(-1000, -3, 2000, 6);
    ctx.restore();

    if (logo) {
      logoDisc(ctx, theme, logo, face);
      return;
    }
    // The title plate: navy, stepped Deco corners, a gold double rule.
    const title = theme.centerTitle;
    const size = fitFont(ctx, title, 980, 130, 700, face);
    const tw = Math.min(1080, ctx.measureText(title).width + 8 * title.length);
    const pw = tw + 150, top = 72, ph = 220, k = 22;
    const plate = () => {
      ctx.beginPath();
      ctx.moveTo(-pw / 2 + k, top); ctx.lineTo(pw / 2 - k, top); ctx.lineTo(pw / 2 - k, top + k); ctx.lineTo(pw / 2, top + k);
      ctx.lineTo(pw / 2, top + ph - k); ctx.lineTo(pw / 2 - k, top + ph - k); ctx.lineTo(pw / 2 - k, top + ph);
      ctx.lineTo(-pw / 2 + k, top + ph); ctx.lineTo(-pw / 2 + k, top + ph - k); ctx.lineTo(-pw / 2, top + ph - k);
      ctx.lineTo(-pw / 2, top + k); ctx.lineTo(-pw / 2 + k, top + k); ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = oklch(0.2, 0.06, 266);
    plate(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = pal.boardLine;
    ctx.lineWidth = 6;
    plate(); ctx.stroke();
    ctx.save();
    ctx.translate(0, top + ph / 2);
    ctx.scale((pw - 30) / pw, (ph - 30) / ph);
    ctx.translate(0, -(top + ph / 2));
    ctx.lineWidth = 2.5;
    plate(); ctx.stroke();
    ctx.restore();
    const gold = ctx.createLinearGradient(0, top + 30, 0, top + 30 + size);
    gold.addColorStop(0, '#fff1c2');
    gold.addColorStop(0.5, pal.boardLine);
    gold.addColorStop(1, oklch(0.62, 0.11, 75));
    ctx.fillStyle = gold;
    ctx.font = `700 ${size}px ${face}`;
    spacedText(ctx, title, 0, top + 92, 8);
    ctx.font = `500 34px ${face}`;
    ctx.fillStyle = pal.boardLine;
    const cap = getMap(theme.mapId).name.toUpperCase();
    const cw = spacedText(ctx, cap, 0, top + 178, 16);
    for (const dir of [-1, 1]) {
      const x = dir * (cw / 2 + 40);
      ctx.beginPath(); ctx.moveTo(x, top + 166); ctx.lineTo(x + 10, top + 178); ctx.lineTo(x, top + 190); ctx.lineTo(x - 10, top + 178); ctx.closePath(); ctx.fill();
      ctx.fillRect(x + dir * 18, top + 177, dir * 70, 2);
    }

    spot(ctx, theme.deckNames.chest, 0, -430, pal.boardText, face);
    spot(ctx, theme.deckNames.chance, 0, 430, pal.accent, face);
  });
}

/** Artwork editions and room logos: the picture in a glowing disc, the name on a pill, the piles either side. */
function logoDisc(ctx: Ctx, theme: Theme, logo: HTMLImageElement, face: string) {
  const pal = theme.palette;
  const r = 270, cy = -60;
  const glow = ctx.createRadialGradient(0, cy, r * 0.4, 0, cy, r * 1.3);
  glow.addColorStop(0, pal.accent + '70');
  glow.addColorStop(1, pal.accent + '00');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, cy, r * 1.3, 0, Math.PI * 2); ctx.fill();
  const disc = ctx.createRadialGradient(0, cy - r * 0.4, r * 0.1, 0, cy, r);
  disc.addColorStop(0, shade(pal.table, 1.5));
  disc.addColorStop(1, pal.table);
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(0, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(0, cy, r - 10, 0, Math.PI * 2); ctx.clip();
  // Fit the picture inside the disc (a square image's corners would be cut by a full-size draw).
  const side = (r - 24) * Math.SQRT2;
  const k = Math.min(side / logo.naturalWidth, side / logo.naturalHeight) || 1;
  const w = logo.naturalWidth * k * 1.18, h = logo.naturalHeight * k * 1.18;
  ctx.drawImage(logo, -w / 2, cy - h / 2 + 12, w, h);
  ctx.restore();
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(0, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = pal.boardLine;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, cy, r + 18, 0, Math.PI * 2); ctx.stroke();
  // Name pill.
  const title = theme.centerTitle;
  const size = fitFont(ctx, title, 700, 150, 700, face);
  const tw = ctx.measureText(title).width;
  const h2 = size * 1.25, y = 330;
  const pill = ctx.createLinearGradient(0, y - h2 / 2, 0, y + h2 / 2);
  pill.addColorStop(0, shade(pal.accent, 1.15));
  pill.addColorStop(1, shade(pal.accent, 0.85));
  ctx.fillStyle = pill;
  ctx.beginPath(); ctx.roundRect(-tw / 2 - 40, y - h2 / 2, tw + 80, h2, h2 / 2); ctx.fill();
  ctx.strokeStyle = pal.boardLine;
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, 0, y + size * 0.05);
  spot(ctx, theme.deckNames.chest, -580, -60, pal.boardText, face);
  spot(ctx, theme.deckNames.chance, 580, -60, pal.accent, face);
}

/** Chog and any room logo on a printed board. */
export function centreLogo(ctx: Ctx, theme: Theme, face: string, logo: HTMLImageElement) {
  inCentre(ctx, () => logoDisc(ctx, theme, logo, face));
}

/** Lighten (k > 1) or darken (k < 1) a #rrggbb colour. */
function shade(hex: string, k: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const out = k >= 1 ? c.map(v => v + (255 - v) * (k - 1)) : c.map(v => v * k);
  return '#' + out.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

// ---- Takeprofit TV ----
// From the takeprofit-tv site's design system (src/app/globals.css): ink
// grounds, bone type, amber for the mark, REC red, SMPTE bars at 75% as the
// decorative palette, Big Shoulders against Space Mono. Scanlines only inside
// a screen frame, never over the copy.

export const TPTV = {
  ink: '#0b0b0d', ink2: '#131317', ink3: '#1a1a20', bone: '#f2f0ea', dim: '#8e8b84',
  rule: 'rgba(242, 240, 234, 0.14)', amber: '#ff9e2c', rec: '#ff3b30', screen: '#c9ccd1',
  bars: ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'],
  display: "'Big Shoulders', Impact, sans-serif",
  mono: "'Space Mono', ui-monospace, monospace",
};

/** The TPTV mark (public/tptv-logo.svg on the site), as vector paths in its 64 × 64 box. */
export const TPTV_MARK = {
  screen: 'M15 9h34a11 11 0 0 1 11 11v18a11 11 0 0 1-11 11H15a11 11 0 0 1-11-11V20a11 11 0 0 1 11-11z',
  stand: 'M32 49v7M22 56h20',
  trend: 'M16 38l9-9 7 5 13-14',
  arrow: 'M37 20h8v8',
};

/** The mark, `k` canvas px per logo unit, with the logo box's (32, 32) at the origin. */
export function drawTptvMark(ctx: Ctx, k: number, opts: { screenFill?: (inner: Path2D) => void } = {}) {
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(-32, -32);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const screen = new Path2D(TPTV_MARK.screen);
  if (opts.screenFill) {
    ctx.save();
    ctx.clip(screen);
    ctx.scale(1 / k, 1 / k);
    opts.screenFill(screen);
    ctx.restore();
  }
  ctx.strokeStyle = TPTV.amber;
  ctx.lineWidth = 3;
  ctx.stroke(screen);
  ctx.stroke(new Path2D(TPTV_MARK.stand));
  ctx.strokeStyle = TPTV.bone;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 3.2;
  ctx.stroke(new Path2D(TPTV_MARK.trend));
  ctx.stroke(new Path2D(TPTV_MARK.arrow));
  ctx.restore();
}

/** "TAKEPROFIT" in Big Shoulders with "TV" knocked out of a bone box, as on the site's header. */
function tptvWordmark(ctx: Ctx, y: number, size: number) {
  ctx.font = `900 ${size}px ${TPTV.display}`;
  const a = 'TAKEPROFIT', b = 'TV';
  const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
  const padX = size * 0.14, gap = size * 0.16;
  const total = wa + gap + wb + padX * 2;
  const x0 = -total / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = TPTV.bone;
  ctx.fillText(a, x0, y);
  ctx.fillRect(x0 + wa + gap, y - size * 0.5, wb + padX * 2, size * 0.98);
  ctx.fillStyle = TPTV.ink;
  ctx.fillText(b, x0 + wa + gap + padX, y);
  ctx.textAlign = 'center';
  return total;
}

/** SMPTE colour bars at 75%: the site's divider "that means something here". */
function colourBars(ctx: Ctx, cx: number, y: number, w: number, h: number) {
  TPTV.bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(cx - w / 2 + (i * w) / 7, y, w / 7 + 0.5, h);
  });
}

/** Takeprofit TV: the mark as a giant studio monitor, live on air, with the wordmark and the bars beneath. */
export function centreTptv(ctx: Ctx, theme: Theme, roomLogo: HTMLImageElement | null) {
  inCentre(ctx, () => {
    const k = 10.6; // canvas px per logo unit: the screen is 594 px wide
    const cy = -120; // where the logo box's (32, 32) sits
    ctx.save();
    ctx.translate(0, cy);
    // Studio light falling on the set behind the monitor.
    const pool = ctx.createRadialGradient(0, 0, 80, 0, 0, 720);
    pool.addColorStop(0, 'rgba(255, 158, 44, 0.16)');
    pool.addColorStop(1, 'rgba(255, 158, 44, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath(); ctx.arc(0, 0, 720, 0, Math.PI * 2); ctx.fill();
    drawTptvMark(ctx, k, {
      screenFill: () => {
        // Inside the monitor: a dark phosphor field, a faint chart grid,
        // candles, then scanlines, the RGB triad and a glass sheen on top.
        const x0 = 4 * k, y0 = 9 * k, w = 56 * k, h = 40 * k;
        const field = ctx.createRadialGradient(32 * k, 26 * k, 40, 32 * k, 29 * k, w * 0.7);
        field.addColorStop(0, '#1d1e24');
        field.addColorStop(1, TPTV.ink);
        ctx.fillStyle = field;
        ctx.fillRect(x0, y0, w, h);
        ctx.strokeStyle = 'rgba(201, 204, 209, 0.07)';
        ctx.lineWidth = 2;
        for (let gx = x0 + 37; gx < x0 + w; gx += 37) { ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y0 + h); ctx.stroke(); }
        for (let gy = y0 + 37; gy < y0 + h; gy += 37) { ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0 + w, gy); ctx.stroke(); }
        if (roomLogo) {
          const s = Math.min((w * 0.62) / roomLogo.naturalWidth, (h * 0.62) / roomLogo.naturalHeight) || 1;
          ctx.drawImage(roomLogo, 32 * k - (roomLogo.naturalWidth * s) / 2, 29 * k - (roomLogo.naturalHeight * s) / 2,
            roomLogo.naturalWidth * s, roomLogo.naturalHeight * s);
        } else {
          const rnd = seeded(0x7b7b);
          let p = 0;
          for (let c = 0; c < 18; c++) {
            const x = x0 + 40 + c * 29;
            const o = p, cl = p + (rnd() - 0.38) * 40;
            p = cl;
            const up = cl < o;
            ctx.fillStyle = up ? 'rgba(0, 192, 0, 0.34)' : 'rgba(255, 59, 48, 0.3)';
            const top = y0 + h * 0.62 + Math.min(o, cl) - c * 6;
            ctx.fillRect(x - 1.5, top - 16, 3, Math.abs(cl - o) + 32);
            ctx.fillRect(x - 8, top, 16, Math.max(6, Math.abs(cl - o)));
          }
        }
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        for (let sy = y0; sy < y0 + h; sy += 6) ctx.fillRect(x0, sy + 3, w, 3);
        for (let sx = x0; sx < x0 + w; sx += 9) {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.035)'; ctx.fillRect(sx, y0, 3, h);
          ctx.fillStyle = 'rgba(0, 0, 255, 0.035)'; ctx.fillRect(sx + 6, y0, 3, h);
        }
        const sheen = ctx.createLinearGradient(x0, y0, x0 + w * 0.6, y0 + h);
        sheen.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
        sheen.addColorStop(0.35, 'rgba(255, 255, 255, 0.02)');
        sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(x0, y0, w, h);
        // REC light and timecode, top left; the channel bug, top right.
        ctx.textBaseline = 'middle';
        ctx.fillStyle = TPTV.rec;
        ctx.beginPath(); ctx.arc(x0 + 70, y0 + 52, 11, 0, Math.PI * 2); ctx.fill();
        ctx.textAlign = 'left';
        ctx.font = `700 26px ${TPTV.mono}`;
        ctx.fillStyle = TPTV.bone;
        ctx.fillText('REC 00:00:00:00', x0 + 92, y0 + 53);
        ctx.textAlign = 'right';
        ctx.font = `900 34px ${TPTV.display}`;
        ctx.fillStyle = TPTV.amber;
        ctx.fillText('CH 03', x0 + w - 62, y0 + 53);
        ctx.textAlign = 'center';
      },
    });
    ctx.restore();

    // ON AIR lamp above the monitor.
    ctx.save();
    ctx.shadowColor = TPTV.rec;
    ctx.shadowBlur = 36;
    ctx.fillStyle = TPTV.rec;
    ctx.beginPath(); ctx.roundRect(-112, -500, 224, 70, 10); ctx.fill();
    ctx.restore();
    ctx.fillStyle = TPTV.bone;
    ctx.font = `900 46px ${TPTV.display}`;
    spacedText(ctx, 'ON AIR', 0, -463, 9);

    const ww = tptvWordmark(ctx, 300, 112);
    colourBars(ctx, 0, 372, Math.max(ww, 700), 18);
    ctx.fillStyle = TPTV.dim;
    ctx.font = `400 26px ${TPTV.mono}`;
    spacedText(ctx, `${getMap(theme.mapId).name.toUpperCase()} · CODE TP`, 0, 430, 4);

    spot(ctx, theme.deckNames.chest, -580, -60, TPTV.bone, TPTV.display, 'brackets');
    spot(ctx, theme.deckNames.chance, 580, -60, TPTV.amber, TPTV.display, 'brackets');
  });
}
