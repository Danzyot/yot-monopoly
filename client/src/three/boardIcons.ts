// Vector icons and colour-set glyphs for the printed board (boardTexture.ts).

/** Pencil-sketched icons, drawn in a 100×100 box centred on the origin. */
export type IconKind = 'train' | 'camera' | 'bulb' | 'water' | 'bag' | 'gem' | 'car' | 'cop' | 'chest' | 'joystick';

export function drawIcon(
  ctx: CanvasRenderingContext2D, kind: IconKind, size: number, ink: string, paper: string, accent: string,
  currency = '$', face = 'Oswald, Impact, sans-serif',
) {
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
      ctx.font = `700 44px ${face}`;
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

export type GlyphKind = 'circle' | 'triangle' | 'diamond' | 'square' | 'star' | 'hexagon' | 'plus' | 'crown' | 'ring' | 'wedge';

/**
 * Every colour set also has a shape, printed in its colour band, so sets stay
 * apart when their colours do not (colour-blind players, dim screens, a phone
 * in sunlight). Neighbouring sets on every map get clearly different shapes.
 */
export const SET_GLYPHS: Record<string, GlyphKind> = {
  brown: 'circle', lightblue: 'triangle', pink: 'diamond', orange: 'square', red: 'star',
  yellow: 'hexagon', green: 'plus', darkblue: 'crown', teal: 'ring', purple: 'wedge',
};

/** A set glyph `r` px in radius, centred on the origin, filled with the current fillStyle. */
export function drawGlyph(ctx: CanvasRenderingContext2D, kind: GlyphKind, r: number) {
  const poly = (pts: [number, number][]) => {
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x * r, y * r) : ctx.moveTo(x * r, y * r)));
    ctx.closePath();
    ctx.fill();
  };
  switch (kind) {
    case 'circle': ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.fill(); break;
    case 'ring':
      ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2, true); ctx.fill();
      break;
    case 'triangle': poly([[0, -0.95], [0.95, 0.7], [-0.95, 0.7]]); break;
    case 'diamond': poly([[0, -1], [0.78, 0], [0, 1], [-0.78, 0]]); break;
    case 'square': ctx.fillRect(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44); break;
    case 'hexagon':
      poly(Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3) * 0.92, Math.sin((i * Math.PI) / 3) * 0.92] as [number, number]));
      break;
    case 'star':
      poly(Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.44 : 1;
        return [Math.cos(a) * k, Math.sin(a) * k + 0.08] as [number, number];
      }));
      break;
    case 'plus': ctx.fillRect(-r * 0.28, -r * 0.9, r * 0.56, r * 1.8); ctx.fillRect(-r * 0.9, -r * 0.28, r * 1.8, r * 0.56); break;
    case 'wedge': poly([[0, 0.95], [0.95, -0.7], [-0.95, -0.7]]); break;
    case 'crown': poly([[-0.95, 0.7], [-0.95, -0.55], [-0.48, -0.05], [0, -0.85], [0.48, -0.05], [0.95, -0.55], [0.95, 0.7]]); break;
  }
}
