import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import SHEET from './sheet.gen.json';
import { DISMISSED_KEY, HIDDEN_KEY } from './storage.ts';
import './roamer.css';

// The home page's roaming Chog: a little 3/4-top-down Chog (sprite frames
// rendered from the game's 3D model by tools/blender/chog_roamer.py) that runs
// about the page on smooth curves, stops to look around, hop, spin, sit, wave
// or sniff, and now and then (or when clicked) pops a speech bubble about the
// Chog Genesis collection.
//
// Cheap by design: one small sprite sheet, a transform and a background
// position per frame, requestAnimationFrame only while something moves (held
// poses wait on a timer), nothing at all while the tab is hidden. It lives in a
// layer over the page that takes no clicks; only the Chog and its bubble do. It
// stops only where nothing clickable or readable is under it (the header, the
// title, the Play now hero, the live ticker, the game cards, the Chog of the
// Day, links and buttons), and runs round them when it can.
// With reduced motion it sits still in a free spot and is clickable all the same.

const OPENSEA = 'https://opensea.io/collection/chog-genesis';
const DAY = 24 * 3600 * 1000;
/** It pops its message by itself on its third stop, or after this long, whichever comes first. */
const AUTO_POP_MS = 25000;
const AUTO_POP_STOPS = 3;
/** The figure's feet, as a fraction of the cell (the shadow sits there). */
const FEET = 0.9;

// Never stops over these (the Play now hero, the live ticker and the Chog of the Day card
// included, on any screen); strict also keeps it off what people read.
const LOOSE = 'a, button:not(.roamer-chog), input, select, textarea, .hub-actions, .signin-bar, [role="dialog"], .qp, .ticker, .cotd-card';
const STRICT = `${LOOSE}, h1, h2, .home-tag, .hub-game, .panel, .cast, .hero-howto`;

type Sheet = { url: string; cell: number; cols: number; rows: number; runFrames: number; frames: Record<string, number> };
const S = SHEET as Sheet;

// Screen sectors (0 = east, clockwise with y down) → the sprite heading drawn, and whether it is mirrored.
const SECTORS: [string, boolean][] = [['e', false], ['se', false], ['s', false], ['se', true], ['e', true], ['ne', true], ['n', false], ['ne', false]];
const FACING_VIEWER = 2;

type Emote = '!' | '♥' | '?' | '♪';
/** One held pose: a frame name (`@k` stands facing sector k), for ms; `hop` jumps it, `emote` pops a symbol over it. */
interface Step { f: string; ms: number; hop?: number; emote?: Emote; dx?: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function turnSteps(from: number, to: number, ms = 55): Step[] {
  const out: Step[] = [];
  let d = ((to - from) % 8 + 8) % 8;
  const dir = d > 4 ? -1 : 1;
  if (d > 4) d = 8 - d;
  for (let k = 1; k <= d; k++) out.push({ f: `@${(((from + dir * k) % 8) + 8) % 8}`, ms });
  return out;
}

const ST = 'stand_s';
const ROUTINES: Record<string, () => Step[]> = {
  look: () => [{ f: ST, ms: 350 }, { f: 'lookL', ms: 700 }, { f: ST, ms: 180 }, { f: 'lookR', ms: 700 }, { f: ST, ms: 160 },
    { f: 'blink', ms: 120 }, { f: ST, ms: 400 }],
  hop: () => {
    const out: Step[] = [{ f: ST, ms: 200 }];
    for (let i = 0; i < 2; i++) out.push({ f: 'crouch', ms: 140 }, { f: 'air', ms: 340, hop: 1 }, { f: 'crouch', ms: 110 });
    out.push({ f: ST, ms: 400, emote: '♪' });
    return out;
  },
  spin: () => {
    const out: Step[] = [{ f: 'crouch', ms: 120 }];
    for (let k = 1; k <= 16; k++) out.push({ f: `@${(FACING_VIEWER + k) % 8}`, ms: 60, hop: k === 8 ? 0.4 : undefined });
    out.push({ f: 'surprise', ms: 500, emote: '!' }, { f: ST, ms: 300 });
    return out;
  },
  sit: () => [{ f: 'crouch', ms: 120 }, { f: 'sit', ms: rand(1300, 2200) }, { f: 'sitBlink', ms: 130 }, { f: 'sit', ms: rand(1200, 2000) },
    { f: 'sitBlink', ms: 130 }, { f: 'sit', ms: 700 }, { f: 'crouch', ms: 120 }, { f: ST, ms: 250 }],
  wave: () => {
    const out: Step[] = [{ f: ST, ms: 200 }];
    for (let i = 0; i < 4; i++) out.push({ f: 'wave1', ms: 170 }, { f: 'wave2', ms: 170 });
    out.push({ f: ST, ms: 300 });
    return out;
  },
  sniff: () => {
    const out: Step[] = [{ f: ST, ms: 150 }];
    for (let i = 0; i < 3; i++) out.push({ f: 'sniff1', ms: 230, dx: -1 }, { f: 'sniff2', ms: 230, dx: 1 });
    out.push({ f: ST, ms: 200, emote: '?' }, { f: 'lookL', ms: 500 }, { f: ST, ms: 400 });
    return out;
  },
  heart: () => [{ f: ST, ms: 150, emote: '♥' }, { f: 'blink', ms: 260 }, { f: ST, ms: 500 }, { f: 'wave1', ms: 170 }, { f: 'wave2', ms: 170 },
    { f: 'wave1', ms: 170 }, { f: ST, ms: 500 }],
  surprise: () => [{ f: 'surprise', ms: 800, emote: '!' }, { f: ST, ms: 300 }],
};
/** While its message is open: mostly standing there, blinking, now and then a little wave. */
const popLoop = (): Step[] => [{ f: ST, ms: rand(1600, 2600) }, { f: 'blink', ms: 130 }, { f: ST, ms: rand(900, 1500) },
  { f: 'wave1', ms: 170 }, { f: 'wave2', ms: 170 }, { f: 'wave1', ms: 170 }, { f: 'wave2', ms: 170 }];

interface Box { l: number; t: number; r: number; b: number }
interface Path { pts: { x: number; y: number; d: number }[]; len: number; T: number; ta: number; vmax: number; t: number }

function storageGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function storageSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export default function Roamer() {
  const layerRef = useRef<HTMLDivElement>(null);
  const chogRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const emoteRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [gone, setGone] = useState(false);
  const [pop, setPop] = useState<null | { auto: boolean }>(null);
  const [reduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [small] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches);
  const size = small ? 52 : 80;
  // Everything the animation loop changes lives here, outside React: no re-render per frame.
  const sim = useRef({
    x: -size, y: 0, sector: FACING_VIEWER, mode: 'idle' as 'idle' | 'run' | 'steps',
    path: null as Path | null, dist: 0, steps: [] as Step[], stepEnd: 0, then: null as null | (() => void),
    stops: 0, born: 0, autoDone: false, held: false, popOpen: false, leaving: false,
    frame: '', flip: false, hop: 0, dx: 0,
  });
  const api = useRef<{ openPop: (auto: boolean) => void; closed: () => void; leave: () => void } | null>(null);

  // Fetch the sheet first; nothing shows until it is in.
  useEffect(() => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => setLoaded(true);
    img.src = S.url;
    return () => { img.onload = null; };
  }, []);

  useEffect(() => {
    if (!loaded || gone) return;
    const layer = layerRef.current, chog = chogRef.current, body = bodyRef.current, sprite = spriteRef.current;
    if (!layer || !chog || !body || !sprite) return;
    const s = sim.current;
    s.born = performance.now();
    s.autoDone = Number(storageGet(DISMISSED_KEY) ?? 0) > Date.now() - DAY;
    const cell = (name: string) => S.frames[name] ?? S.frames[ST];
    const runSpeed = small ? 105 : 150;

    const setFrame = (name: string, flip = false) => {
      if (name.startsWith('@')) {
        const [h, f] = SECTORS[Number(name.slice(1))];
        name = `stand_${h}`;
        flip = f;
      }
      if (name !== s.frame) {
        const i = cell(name);
        sprite.style.backgroundPosition = `${-(i % S.cols) * size}px ${-Math.floor(i / S.cols) * size}px`;
        s.frame = name;
      }
      if (flip !== s.flip) {
        sprite.style.transform = flip ? 'scaleX(-1)' : '';
        s.flip = flip;
      }
    };
    const place = () => {
      chog.style.transform = `translate3d(${(s.x + s.dx).toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
      body.style.transform = s.hop ? `translateY(${(-s.hop).toFixed(1)}px)` : '';
    };

    // ---- where it may go ----------------------------------------------------
    const view = () => {
      const lr = layer.getBoundingClientRect();
      const header = document.querySelector('.site-header')?.getBoundingClientRect();
      const top = Math.max(0, header ? header.bottom : 0);
      return { lr, l: 8, r: lr.width - size - 8, t: top - lr.top + 6, b: Math.min(lr.height, innerHeight - lr.top) - size - 8 };
    };
    const obstacles = (sel: string, lr: DOMRect): Box[] => {
      const out: Box[] = [];
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (layer.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        out.push({ l: r.left - lr.left - 6, t: r.top - lr.top - 6, r: r.right - lr.left + 6, b: r.bottom - lr.top + 6 });
      }
      return out;
    };
    // The part of the cell the figure fills.
    const figure = (x: number, y: number): Box => ({ l: x + size * 0.18, t: y + size * 0.12, r: x + size * 0.82, b: y + size * 0.95 });
    const hits = (f: Box, obs: Box[]) => obs.some(o => f.l < o.r && f.r > o.l && f.t < o.b && f.b > o.t);
    const free = (x: number, y: number, obs: Box[]) => !hits(figure(x, y), obs);

    const makePath = (x1: number, y1: number, curve = 0.3): Path => {
      const x0 = s.x, y0 = s.y;
      const dx = x1 - x0, dy = y1 - y0;
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const k1 = rand(-curve, curve) * L, k2 = Math.random() < 0.5 ? k1 : rand(-curve, curve) * L;
      const c1x = x0 + dx / 3 + nx * k1, c1y = y0 + dy / 3 + ny * k1;
      const c2x = x0 + (2 * dx) / 3 + nx * k2, c2y = y0 + (2 * dy) / 3 + ny * k2;
      const pts = [{ x: x0, y: y0, d: 0 }];
      for (let i = 1; i <= 32; i++) {
        const t = i / 32;
        const x = cubic(x0, c1x, c2x, x1, t), y = cubic(y0, c1y, c2y, y1, t);
        const p = pts[i - 1];
        pts.push({ x, y, d: p.d + Math.hypot(x - p.x, y - p.y) });
      }
      const len = pts[32].d;
      // Speeds up over the first moment and slows into the stop.
      const ta = Math.min(0.32, len / runSpeed);
      const T = len / runSpeed + ta;
      return { pts, len, T, ta, vmax: len / Math.max(1e-3, T - ta), t: 0 };
    };
    const pathClear = (p: Path, obs: Box[]) => p.pts.every((q, i) => i % 3 !== 0 || !hits(figure(q.x, q.y), obs));

    /** A stopping place in view, free of what it must not cover, reached on a path that runs round it (if it can). */
    const chooseTarget = (): Path | null => {
      const v = view();
      if (v.r <= v.l || v.b <= v.t) return null;
      const strict = obstacles(STRICT, v.lr), loose = obstacles(LOOSE, v.lr);
      const far = small ? 300 : 640;
      // Every free spot on a 10 px grid (a phone's free strips can be thin), then a few tried at random.
      const spots = (obs: Box[]) => {
        const out: [number, number][] = [];
        for (let y = v.t; y <= v.b; y += 10) {
          for (let x = v.l; x <= v.r; x += 10) {
            if (free(x, y, obs) && Math.hypot(x - s.x, y - s.y) >= size * 0.8) out.push([x, y]);
          }
        }
        return out;
      };
      // First choice: somewhere clear of everything, on a clear path, a good run away.
      const clear = spots(strict);
      let fallback: Path | null = null;
      for (let i = 0; i < 40 && clear.length; i++) {
        const [x, y] = pick(clear);
        const d = Math.hypot(x - s.x, y - s.y);
        const p = makePath(x, y);
        if (!pathClear(p, strict)) {
          // Hemmed in (it stands in a narrow free strip): any clear spot will do, over the top.
          fallback ??= p;
          continue;
        }
        if (d > size * 2 && d < far) return p;
        if (!fallback || !pathClear(fallback, strict)) fallback = p;
      }
      if (fallback) return fallback;
      // A crowded screen: never over anything clickable, and over as little of what people read as it can.
      const ok = spots(loose);
      let best: Path | null = null, bestScore = Infinity;
      for (let i = 0; i < 40 && ok.length; i++) {
        const [x, y] = pick(ok);
        const f = figure(x, y);
        let cover = 0;
        for (const o of strict) cover += Math.max(0, Math.min(f.r, o.r) - Math.max(f.l, o.l)) * Math.max(0, Math.min(f.b, o.b) - Math.max(f.t, o.t));
        const p = makePath(x, y);
        const score = cover / (size * size) + (pathClear(p, loose) ? 0 : 0.5) + (Math.hypot(x - s.x, y - s.y) < far ? 0 : 0.2);
        if (score < bestScore) { best = p; bestScore = score; }
      }
      return best;
    };

    // ---- the loop -----------------------------------------------------------
    let raf = 0, timer = 0, last = 0;
    const wake = () => {
      clearTimeout(timer);
      timer = 0;
      if (!raf && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const play = (steps: Step[], then: (() => void) | null) => {
      s.mode = 'steps';
      s.steps = steps;
      s.stepEnd = performance.now();
      s.then = then;
      startStep();
    };
    /** Show the first queued step; steps run on the clock, so a timer or a hidden tab loses no time. */
    const startStep = () => {
      const st = s.steps[0];
      if (!st) return;
      s.stepEnd += st.ms;
      setFrame(st.f);
      s.dx = st.dx ?? 0;
      if (st.emote) emote(st.emote);
    };
    const emote = (e: Emote) => {
      const el = emoteRef.current;
      if (!el || reduced) return;
      el.textContent = e;
      el.dataset.e = e === '♥' ? 'heart' : 'mark';
      el.animate([
        { opacity: 0, transform: 'translate(-50%, 6px) scale(0.4)' },
        { opacity: 1, transform: 'translate(-50%, -4px) scale(1.1)', offset: 0.18 },
        { opacity: 1, transform: 'translate(-50%, -6px) scale(1)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, -14px) scale(0.9)' },
      ], { duration: 1300, easing: 'ease-out' });
    };

    const tick = () => {
      const now = performance.now();
      raf = 0;
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      let again = false;
      if (s.mode === 'run' && s.path) {
        const p = s.path;
        p.t = Math.min(p.T, p.t + dt);
        const { t, T, ta, vmax, len } = p;
        const d = t < ta ? 0.5 * vmax * t * t / ta : t < T - ta ? 0.5 * vmax * ta + vmax * (t - ta) : len - 0.5 * vmax * (T - t) * (T - t) / ta;
        let i = 1;
        while (i < p.pts.length - 1 && p.pts[i].d < d) i++;
        const a = p.pts[i - 1], b = p.pts[i];
        const k = b.d > a.d ? Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d))) : 1;
        const nx = a.x + (b.x - a.x) * k, ny = a.y + (b.y - a.y) * k;
        s.dist += Math.hypot(nx - s.x, ny - s.y);
        s.x = nx; s.y = ny;
        // Face along the path (with a little hysteresis so it does not flicker between two headings).
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const centre = (s.sector * Math.PI) / 4;
        let diff = Math.abs(ang - centre) % (2 * Math.PI);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        if (diff > (Math.PI / 8) * 1.25) s.sector = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
        const [h, flip] = SECTORS[s.sector];
        setFrame(`run_${h}_${Math.floor(s.dist / (size * 0.95) * S.runFrames) % S.runFrames}`, flip);
        if (p.t >= p.T) arrive();
        // Arrived: one more tick sets the first pose's timer going.
        again = true;
      } else if (s.mode === 'steps') {
        // Back from a long pause: carry on from now rather than racing through the backlog.
        if (now - s.stepEnd > 1000) s.stepEnd = now;
        while (s.steps.length && now >= s.stepEnd) {
          s.steps.shift();
          startStep();
        }
        const st = s.steps[0];
        if (!st) {
          s.mode = 'idle';
          s.hop = 0;
          s.dx = 0;
          const then = s.then;
          s.then = null;
          if (then) then();
          again = s.mode !== 'idle';
        } else {
          const k = 1 - (s.stepEnd - now) / st.ms;
          s.hop = st.hop ? Math.sin(Math.PI * Math.min(1, Math.max(0, k))) * size * 0.32 * st.hop : 0;
          if (st.hop) again = true;
          else timer = window.setTimeout(wake, Math.max(0, s.stepEnd - now));
        }
      }
      place();
      if (again && !raf) raf = requestAnimationFrame(tick);
    };

    // ---- what it does -------------------------------------------------------
    const run = (p: Path) => {
      const sector = ((Math.round(Math.atan2(p.pts[2].y - p.pts[0].y, p.pts[2].x - p.pts[0].x) / (Math.PI / 4)) % 8) + 8) % 8;
      const turn = turnSteps(s.sector, sector);
      const go = () => { s.sector = sector; s.mode = 'run'; s.path = p; wake(); };
      if (turn.length) play(turn, go);
      else go();
      wake();
    };
    const next = () => {
      if (s.held || s.popOpen) return;
      if (s.leaving) return;
      const p = chooseTarget();
      if (p) run(p);
      else play(ROUTINES[pick(['look', 'sit', 'wave'])](), next);
      wake();
    };
    const arrive = () => {
      s.path = null;
      s.mode = 'idle';
      if (s.leaving) {
        setGone(true);
        return;
      }
      s.stops++;
      const turn = turnSteps(s.sector, FACING_VIEWER, 60);
      s.sector = FACING_VIEWER;
      const due = !s.autoDone && (s.stops >= AUTO_POP_STOPS || performance.now() - s.born > AUTO_POP_MS);
      if (due) {
        play(turn, () => api.current?.openPop(true));
        return;
      }
      const routine = ROUTINES[pick(['look', 'hop', 'spin', 'sit', 'wave', 'sniff', 'heart', 'surprise', 'look', 'sit'])]();
      // On a phone it stays put longer between runs.
      const rest: Step[] = small ? [{ f: ST, ms: rand(1500, 4000) }, { f: 'blink', ms: 130 }, { f: ST, ms: rand(800, 2000) }] : [{ f: ST, ms: rand(200, 900) }];
      play([...turn, ...routine, ...rest], next);
    };

    api.current = {
      openPop: (auto: boolean) => {
        if (auto) s.autoDone = true;
        s.popOpen = true;
        setPop({ auto });
        if (reduced) {
          setFrame(ST);
          return;
        }
        s.path = null;
        const turn = turnSteps(s.sector, FACING_VIEWER, 45);
        s.sector = FACING_VIEWER;
        play([...turn, { f: 'surprise', ms: 600, emote: '!' }], function loop() { play(popLoop(), loop); });
        wake();
      },
      closed: () => {
        s.popOpen = false;
        if (reduced) {
          setFrame('sit');
          return;
        }
        play([{ f: 'wave1', ms: 170 }, { f: 'wave2', ms: 170 }, { f: ST, ms: 900 }], next);
        wake();
      },
      leave: () => {
        // Sent away: a wave, then it runs off the nearer side for good.
        s.popOpen = false;
        s.leaving = true;
        const v = view();
        const x = s.x + size / 2 < v.lr.width / 2 ? -size * 1.5 : v.lr.width + size * 0.5;
        play([{ f: 'wave1', ms: 170 }, { f: 'wave2', ms: 170 }, { f: 'wave1', ms: 170 }], () => run(makePath(x, s.y)));
        wake();
      },
    };

    if (reduced) {
      // Still: sat in a free spot on the first screen, clickable.
      const v = view();
      // The free spot nearest the bottom right of the first screen (else one off anything clickable).
      let x = v.r, y = v.b;
      search: for (const obs of [obstacles(STRICT, v.lr), obstacles(LOOSE, v.lr)]) {
        for (let cy = v.b; cy >= v.t; cy -= 4) {
          for (let cx = v.r; cx >= v.l; cx -= 8) {
            if (free(cx, cy, obs)) { x = cx; y = cy; break search; }
          }
        }
      }
      s.x = x; s.y = y;
      setFrame('sit');
      place();
      return () => { api.current = null; };
    }

    // Runs in from one side of the screen, level with where it is going, so it crosses nothing on the way.
    const v0 = view();
    const fromLeft = Math.random() < 0.5;
    s.x = fromLeft ? -size : v0.lr.width;
    s.y = rand(v0.t, v0.b);
    s.sector = fromLeft ? 0 : 4;
    const first = chooseTarget();
    if (first) {
      const end = first.pts[first.pts.length - 1];
      s.y = end.y;
      place();
      run(makePath(end.x, end.y, 0.05));
    } else {
      place();
      next();
    }

    // Paused while the tab is hidden.
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        clearTimeout(timer);
        timer = 0;
      } else {
        wake();
      }
    };
    // Scrolled away from it: when the scrolling stops, it runs back into view (or out from under a button).
    let scrollTimer = 0;
    const onScroll = () => {
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        if (s.mode === 'run' || s.popOpen || s.held || s.leaving) return;
        const v = view();
        const offscreen = s.y < v.t - size * 0.5 || s.y > v.b + size * 0.5;
        if (!offscreen && free(s.x, s.y, obstacles(LOOSE, v.lr))) return;
        if (offscreen) {
          // Far away: come in from just outside the nearer edge.
          s.y = s.y < v.t ? v.t - size : v.b + size;
          place();
        }
        s.steps = [];
        s.then = null;
        next();
      }, 260);
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(scrollTimer);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('scroll', onScroll);
      api.current = null;
    };
  }, [loaded, gone, reduced, small, size]);

  // The bubble sits over the Chog (under it near the top of the screen), kept on screen.
  useLayoutEffect(() => {
    const el = popRef.current, layer = layerRef.current;
    if (!pop || !el || !layer) return;
    const s = sim.current;
    const lr = layer.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const header = document.querySelector('.site-header')?.getBoundingClientRect();
    const minTop = (header ? header.bottom : 0) - lr.top + 8;
    const cx = s.x + size / 2;
    let top = s.y + size * 0.08 - h - 12;
    const below = top < minTop;
    if (below) top = s.y + size * FEET + 12;
    const left = Math.min(Math.max(8, cx - w / 2), lr.width - w - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.setProperty('--tail', `${Math.min(Math.max(18, cx - left), w - 18)}px`);
    el.dataset.below = below ? '1' : '';
    if (!pop.auto) el.querySelector<HTMLElement>('.roamer-go')?.focus({ preventScroll: true });
  }, [pop, size]);

  const close = useCallback(() => {
    storageSet(DISMISSED_KEY, String(Date.now()));
    // Focus goes back to the Chog when it was in the bubble (Escape, the ×), not when it was elsewhere.
    const inside = !!popRef.current?.contains(document.activeElement);
    setPop(null);
    api.current?.closed();
    if (inside) chogRef.current?.focus({ preventScroll: true });
  }, []);
  const hide = () => {
    storageSet(HIDDEN_KEY, '1');
    setPop(null);
    if (reduced) setGone(true);
    else api.current?.leave();
  };

  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pop, close]);

  if (gone) return null;
  return (
    <div ref={layerRef} className="roamer" data-ready={loaded ? '1' : undefined}
      style={{ '--size': `${size}px`, '--sheet': `url("${S.url}")`, '--cols': S.cols, '--rows': S.rows } as CSSProperties}>
      <button ref={chogRef} type="button" className="roamer-chog" aria-label="Chog, the Chog Games mascot: say hi"
        aria-haspopup="dialog" aria-expanded={!!pop}
        onClick={() => { if (pop) close(); else if (!sim.current.leaving) api.current?.openPop(false); }}
        // Held still while it has the keyboard's focus, so it is not a moving target.
        onFocus={e => { if (e.currentTarget.matches(':focus-visible')) sim.current.held = true; }}
        onBlur={() => {
          const s = sim.current;
          if (!s.held) return;
          s.held = false;
          // Resume if it was left standing while focused.
          if (s.mode === 'idle' && !s.popOpen && !s.leaving) api.current?.closed();
        }}>
        <span className="roamer-shadow" aria-hidden />
        <span ref={bodyRef} className="roamer-body" aria-hidden>
          <span ref={spriteRef} className="roamer-sprite" />
        </span>
        <span ref={emoteRef} className="roamer-emote" aria-hidden />
      </button>
      {pop && (
        <div ref={popRef} className="roamer-pop" role="dialog" aria-label="Chog Genesis">
          <button type="button" className="roamer-x" aria-label="Close" onClick={close}>×</button>
          <p className="roamer-hi">Psst… want your own Chog?</p>
          <p className="roamer-text">1,969 Chog Genesis live on Monad. Holders play as their very own Chog here.</p>
          <a className="btn gold small roamer-go" href={OPENSEA} target="_blank" rel="noopener noreferrer" onClick={close}>
            See them on OpenSea ↗
          </a>
          <button type="button" className="roamer-hide" onClick={hide}>Hide the Chog</button>
        </div>
      )}
    </div>
  );
}
