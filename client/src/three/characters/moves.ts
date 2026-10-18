// The characters' moves, choreographed: every reaction and idle as key poses
// on a timeline in milliseconds, so each one has a wind-up (anticipation), a
// fast snappy action that overshoots, and a settle. `emotePose` fills the
// rig's PoseInput for a move at a moment in it, plus what moveFx.ts needs to
// show (the prop in hand, its particles) — the board pieces and the gallery
// both call it, so they play exactly the same move.
//
// Nothing here allocates per frame: key tables are module constants and the
// interpolators write into one scratch array.

import type { PoseInput } from './Figure.tsx';

export type EmoteKind =
  | 'cheer' | 'pump' | 'sad' | 'stomp' | 'wave' | 'look' | 'shrug' | 'stretch' | 'fidget' | 'taunt'
  | 'pay' | 'sold' | 'popper' | 'phone' | 'deal' | 'build' | 'rattle' | 'surrender';

/** Things a character can pull out for a move (moveFx.ts builds them). */
export type PropKind = 'wad' | 'bag' | 'coin' | 'sign' | 'phone' | 'contract' | 'hammer' | 'popper' | 'flag' | 'cup' | 'trophy';
/** Little things thrown off during a move. */
export type FxKind = 'bills' | 'confetti' | 'coins';

export const EMOTE_MS: Record<EmoteKind, number> = {
  cheer: 1500, pump: 1500, sad: 2600, stomp: 1900, wave: 1800, look: 2400, shrug: 1600, stretch: 2800, fidget: 3000,
  taunt: 2200, pay: 1900, sold: 1900, popper: 1800, phone: 2500, deal: 2200, build: 2000, rattle: 2600, surrender: 2400,
};
/** The moves a piece does by itself while nothing is happening. */
export const IDLE_EMOTES: ReadonlySet<EmoteKind> = new Set(['wave', 'look', 'shrug', 'stretch', 'fidget', 'rattle']);
/** One bar of the endless victory dance. */
export const WIN_MS = 1400;

/** Fade an emote in and out over its run (c = 0–1). */
export const envelope = (c: number) => Math.max(0, Math.min(1, c * 5, (1 - c) * 5));

/** Written by emotePose (reset by clearMove): the figure's lift and twirl, and the prop and particles to show. */
export const EMOTE_OUT = {
  lift: 0,
  spin: 0,
  prop: null as PropKind | null,
  /** Prop scale: pops in at the start of the move and away at the end. */
  propS: 0,
  /** Prop-specific progress (the coin's flight, the flag's flutter). */
  propT: 0,
  /** Hard hat on the head (0–1 scale). */
  hat: 0,
  fx: null as FxKind | null,
  /** Ms into the move, when each particle leaves, and where from (figure space, before mirroring). */
  fxMs: 0,
  fxAt: [] as readonly number[],
  fxFrom: [0, 0, 0] as readonly number[],
};

// ---- timing toolkit ---------------------------------------------------------

const TAU = Math.PI * 2;
const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
/** Progress 0–1 of `ms` through [a, b]. */
const seg = (ms: number, a: number, b: number) => clamp01((ms - a) / (b - a));
const lin = (t: number) => t;
const io = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const out3 = (t: number) => 1 - (1 - t) ** 3;
const in2 = (t: number) => t * t;
/** Ease out past the target and back: the snap of a fast move. */
const back = (t: number) => { const u = t - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; };
const EASE = [io, out3, in2, back, lin];
const IO = 0, OUT = 1, IN = 2, BACK = 3;

/** Up over [a, b] (snappy), held, down over [c, d] (eased). */
function bell(ms: number, a: number, b: number, c: number, d: number) {
  return ms < c ? out3(seg(ms, a, b)) : 1 - io(seg(ms, c, d));
}
/** A quick accent: up over [a, b], straight back down over [b, c]. */
function peak(ms: number, a: number, b: number, c: number) {
  return ms < b ? out3(seg(ms, a, b)) : 1 - io(seg(ms, b, c));
}
/** A hit at `t`: 1 at the moment of impact, dying away over ~0.2 s. */
function impact(ms: number, t: number) {
  return ms < t || ms > t + 320 ? 0 : Math.exp(-(ms - t) / 70);
}

const H = new Float32Array(5);
/**
 * Interpolate a key table of rows [ms, x, y, z, rx, rz, ease] (the ease is
 * how the row is arrived at) into H.
 */
function keys(ms: number, rows: readonly number[]): Float32Array {
  const n = rows.length / 7;
  let r = 1;
  while (r < n && ms >= rows[r * 7]) r++;
  if (ms <= rows[0] || r >= n) {
    const b = ms <= rows[0] ? 0 : (n - 1) * 7;
    for (let c = 0; c < 5; c++) H[c] = rows[b + 1 + c];
    return H;
  }
  const a = (r - 1) * 7, b = r * 7;
  const k = EASE[rows[b + 6]](seg(ms, rows[a], rows[b]));
  for (let c = 0; c < 5; c++) H[c] = rows[a + 1 + c] + (rows[b + 1 + c] - rows[a + 1 + c]) * k;
  return H;
}
/** The same for one value: rows [ms, v, ease]. */
function curve(ms: number, rows: readonly number[]): number {
  const n = rows.length / 3;
  if (ms <= rows[0]) return rows[1];
  let r = 1;
  while (r < n && ms >= rows[r * 3]) r++;
  if (r >= n) return rows[(n - 1) * 3 + 1];
  const a = (r - 1) * 3, b = r * 3;
  return rows[a + 1] + (rows[b + 1] - rows[a + 1]) * EASE[rows[b + 2]](seg(ms, rows[a], rows[b]));
}

/** Pull hand i (0 left, 1 right) to H, plus offsets, with weight w. */
function hand(o: PoseInput, i: 0 | 1, w: number, dx = 0, dy = 0, dz = 0, drx = 0, drz = 0) {
  const b = i * 5, at = o.reachAt!;
  o.reach![i] = w;
  at[b] = H[0] + dx; at[b + 1] = H[1] + dy; at[b + 2] = H[2] + dz; at[b + 3] = H[3] + drx; at[b + 4] = H[4] + drz;
}

/**
 * A jump with weight: a crouch for `pre` ms before take-off at t0 (the
 * anticipation), a gravity arc of height h landing at t1, a squash on landing
 * and a small rebound. Returns the lift; folds its squash into o.squash.
 */
function jump(o: PoseInput, ms: number, t0: number, t1: number, h: number, pre = 140): number {
  if (ms < t0 - pre || ms > t1 + 280) return 0;
  const amt = 0.55 + 0.45 * Math.min(1, h / 0.2);
  if (ms < t0) {
    const k = out3(seg(ms, t0 - pre, t0));
    o.squash *= 1 - 0.16 * amt * k;
    o.crouch = Math.max(o.crouch ?? 0, k);
    return 0;
  }
  if (ms <= t1) {
    const u = seg(ms, t0, t1);
    // Stretched off the ground, round at the top, stretching again to land.
    o.squash *= 1 + 0.17 * amt * (1 - 2 * u) ** 2;
    return h * 4 * u * (1 - u);
  }
  const d = ms - t1;
  o.squash *= d < 110 ? 1 - 0.2 * amt * Math.sin(Math.PI * d / 110) : 1 + 0.05 * amt * Math.sin(Math.PI * (d - 110) / 170);
  return 0;
}

/** Show `kind` in hand, popping in over `inMs` and away over the last `outMs` before `end`. */
function prop(kind: PropKind, ms: number, end: number, inMs = 180, outMs = 220) {
  EMOTE_OUT.prop = kind;
  EMOTE_OUT.propS = ms < end - outMs ? back(seg(ms, 0, inMs)) : 1 - in2(seg(ms, end - outMs, end));
}
function particles(kind: FxKind, ms: number, at: readonly number[], from: readonly number[]) {
  EMOTE_OUT.fx = kind;
  EMOTE_OUT.fxMs = ms;
  EMOTE_OUT.fxAt = at;
  EMOTE_OUT.fxFrom = from;
}

/** Reset the move channels (accents, reaches, EMOTE_OUT) before posing a frame. */
export function clearMove(o: PoseInput) {
  if (!o.reach) { o.reach = new Float32Array(2); o.reachAt = new Float32Array(10); }
  o.reach[0] = 0; o.reach[1] = 0;
  o.lean = 0; o.tilt = 0; o.twist = 0; o.nod = 0; o.cock = 0; o.liftL = 0; o.liftR = 0; o.lids = 0;
  EMOTE_OUT.lift = 0; EMOTE_OUT.spin = 0; EMOTE_OUT.prop = null; EMOTE_OUT.propS = 0; EMOTE_OUT.propT = 0;
  EMOTE_OUT.hat = 0; EMOTE_OUT.fx = null; EMOTE_OUT.fxMs = 0;
}

/**
 * One hop of a walk, k = 0–1. Returns the arc (a gravity parabola, 0 → 1 → 0)
 * and sets the squash: squat on contact, snap to a stretch, round at the top,
 * stretch again reaching for the ground (the landing squash follows).
 */
export function hopPose(o: PoseInput, k: number): number {
  const air = (u: number) => 1 + 0.17 * (1 - 2 * u) ** 2;
  o.squash = k < 0.1 ? 0.84 + (air(0.1) - 0.84) * out3(k / 0.1) : air(k);
  return 4 * k * (1 - k);
}

// ---- key tables (hands: [ms, x, y, z, rx, rz, ease]; left hand is +x) -------

const RL = [0.11, 0.115, 0.015, 0, 0];
const RR = [-0.11, 0.115, 0.015, 0, 0];
const row = (ms: number, p: readonly number[], ease = IO) => [ms, ...p, ease];

const PUMP_R = [
  ...row(0, RR),
  180, -0.07, 0.17, 0.095, -0.2, -0.3, OUT,
  260, -0.07, 0.15, 0.1, 0.35, -0.3, IN, // dip before the flick
  330, -0.08, 0.215, 0.1, -0.5, -0.3, BACK, // flick
  620, -0.075, 0.2, 0.1, -0.2, -0.3, IO,
  700, -0.08, 0.165, 0.1, 0.15, -0.3, OUT, // catch
  1000, -0.09, 0.15, 0.07, 0, -0.2, IO,
  ...row(1400, RR),
];
const PUMP_L = [
  ...row(640, RL),
  740, 0.1, 0.1, 0.045, 0.2, 0.25, OUT, // cocked at the hip
  860, 0.105, 0.375, 0.03, -0.2, 0.55, BACK, // "Yes!"
  980, 0.1, 0.27, 0.04, 0, 0.45, IO,
  1080, 0.1, 0.33, 0.035, 0, 0.5, BACK,
  ...row(1450, RL),
];
const TAUNT_R = [
  ...row(0, RR),
  250, -0.1, 0.16, 0.07, 0.2, 0, OUT,
  420, -0.065, 0.25, 0.11, -0.3, -0.2, BACK, // the wad, up by the face
  1750, -0.065, 0.25, 0.11, -0.3, -0.2, IO,
  ...row(2150, RR),
];
const TAUNT_BILLS = [875, 1175, 1475];
const TAUNT_FROM = [-0.07, 0.29, 0.13];
const PAY_R = [
  ...row(0, RR),
  260, -0.105, 0.08, -0.01, 0.3, 0, IO, // hand to the back pocket
  480, -0.05, 0.17, 0.12, -0.45, -0.2, BACK, // out comes the wad
  1250, -0.05, 0.165, 0.12, -0.45, -0.2, IO,
  1550, -0.1, 0.1, 0.03, 0, 0, IO,
  ...row(1880, RR),
];
const PAY_PEELS = [640, 800, 960, 1120];
const PAY_FROM = [0.05, 0.21, 0.15];
const SAD_R = [
  ...row(0, RR),
  300, -0.04, 0.2, 0.125, 0, -0.1, BACK, // the money bag, held out
  420, -0.04, 0.21, 0.125, 0, -0.1, IO,
  680, -0.1, 0.27, 0.12, 3, -0.2, IO, // turned upside down, out to the side so we see it peer in
  1050, -0.1, 0.27, 0.12, 3, -0.2, IO,
  1300, -0.07, 0.11, 0.06, 2.2, -0.2, IO, // dangling
];
const SAD_COINS = [760, 900];
const SAD_FROM = [-0.1, 0.22, 0.13];
const SAD_SLUMP = [
  0, 0, IO, 1000, 0, IO, 1060, 0.3, OUT, 1250, 0.3, IO, 1310, 0.55, OUT, 1500, 0.55, IO,
  1560, 0.8, OUT, 1750, 0.8, IO, 1810, 1, OUT, 2350, 1, IO, 2600, 0, IO,
];
const STAMPS = [380, 720, 1040];
const STOMP_L = [
  ...row(0, RL),
  150, 0.095, 0.085, 0.03, 0, 0.3, OUT, // fists down
  1100, 0.095, 0.085, 0.03, 0, 0.3, IO,
  1320, -0.03, 0.175, 0.075, 0, 1.4, BACK, // arms folded
  1650, -0.03, 0.175, 0.075, 0, 1.4, IO,
  ...row(1880, RL),
];
const STOMP_R = [
  ...row(0, RR),
  150, -0.095, 0.085, 0.03, 0, -0.3, OUT,
  1100, -0.095, 0.085, 0.03, 0, -0.3, IO,
  1320, 0.03, 0.158, 0.088, 0, -1.4, BACK,
  1650, 0.03, 0.158, 0.088, 0, -1.4, IO,
  ...row(1880, RR),
];
const RATTLE_R = [
  ...row(0, RR),
  330, -0.04, 0.23, 0.13, -0.1, 0, BACK, // the cup, up to the bars
  470, -0.04, 0.23, 0.13, -0.1, 0, IO,
  720, 0.03, 0.235, 0.13, -0.1, 0.2, IO, // raked along them, back and forth
  970, -0.1, 0.235, 0.13, -0.1, -0.2, IO,
  1220, 0.03, 0.235, 0.13, -0.1, 0.2, IO,
  1470, -0.1, 0.235, 0.13, -0.1, -0.2, IO,
  1600, -0.05, 0.22, 0.08, -0.3, 0, OUT, // pulled back…
  1720, -0.045, 0.235, 0.155, 0.2, 0, IN, // …and banged
  1900, -0.05, 0.22, 0.12, 0, 0, OUT,
  ...row(2350, RR),
];
const RATTLE_L = [
  ...row(0, RL),
  400, 0.07, 0.25, 0.13, 0, 0.3, OUT, // gripping a bar
  1950, 0.07, 0.25, 0.13, 0, 0.3, IO,
  ...row(2400, RL),
];
const SOLD_R = [
  ...row(0, [-0.11, 0.115, 0.03, 0, 0]),
  230, -0.1, 0.075, 0, 0.3, 0.05, IO, // dipped and cocked back
  430, -0.085, 0.37, 0.035, -0.05, 0.06, BACK, // thrust overhead
  1350, -0.085, 0.37, 0.035, -0.05, 0.06, IO,
  1650, -0.11, 0.12, 0.03, 0, 0, IO,
  ...row(1880, RR),
];
const SOLD_L = [
  ...row(380, RL),
  540, 0.06, 0.2, 0.11, 0, 0.7, BACK, // thumbs up
  1300, 0.06, 0.2, 0.11, 0, 0.7, IO,
  ...row(1600, RL),
];
const POPPER_R = [
  ...row(0, RR),
  260, -0.06, 0.19, 0.11, 0.6, -0.2, OUT, // aimed up and out
  330, -0.06, 0.185, 0.115, 0.6, -0.2, IO,
  380, -0.07, 0.215, 0.075, 0.2, -0.2, OUT, // recoil
  650, -0.085, 0.31, 0.06, 0.1, -0.1, IO,
  1450, -0.085, 0.31, 0.06, 0.1, -0.1, IO,
  ...row(1780, RR),
];
const POPPER_L = [
  ...row(0, RL),
  220, -0.02, 0.165, 0.125, 0, 0, OUT, // pinching the string
  330, -0.02, 0.165, 0.125, 0, 0, IO,
  375, 0.085, 0.13, 0, 0, 0.4, OUT, // yank!
  650, 0.125, 0.37, 0.02, 0, 0.6, BACK,
  1450, 0.125, 0.37, 0.02, 0, 0.6, IO,
  ...row(1780, RL),
];
const POPPER_FX = [340];
const POPPER_FROM = [-0.075, 0.29, 0.2];
const PHONE_R = [
  ...row(0, RR),
  220, -0.05, 0.19, 0.12, -0.5, -0.1, BACK, // phone out, dialling
  520, -0.05, 0.19, 0.12, -0.5, -0.1, IO,
  720, -0.092, 0.27, 0.04, 0, -0.35, BACK, // to the ear
  2050, -0.092, 0.27, 0.04, 0, -0.35, IO,
  ...row(2400, RR),
];
const PHONE_L = [
  ...row(700, RL),
  900, 0.14, 0.18, 0.09, 0, 0.4, BACK, // talking with its hand
  1900, 0.14, 0.18, 0.09, 0, 0.4, IO,
  ...row(2200, RL),
];
const DEAL_R = [
  ...row(0, RR),
  280, -0.045, 0.15, 0.13, -1.1, -0.1, BACK, // the contract, read over
  1050, -0.045, 0.15, 0.13, -1.1, -0.1, IO,
  1250, -0.08, 0.37, 0.04, -0.1, 0.06, BACK, // held up high
  1800, -0.08, 0.37, 0.04, -0.1, 0.06, IO,
  ...row(2150, RR),
];
const DEAL_L = [
  ...row(0, RL),
  480, 0.05, 0.22, 0.12, 0, 0.2, IO,
  700, 0.02, 0.31, 0.11, 0.3, 0.2, OUT, // wind up
  820, -0.035, 0.185, 0.135, 0, 0, IN, // STAMP
  950, -0.025, 0.21, 0.13, 0, 0, OUT,
  1250, 0.125, 0.36, 0.02, 0, 0.6, BACK,
  1800, 0.125, 0.36, 0.02, 0, 0.6, IO,
  ...row(2150, RL),
];
const HAM_UP = [-0.13, 0.36, 0.03, -1.2, -0.35];
const HAM_HIT = [-0.06, 0.11, 0.12, 1.2, 0];
const HAM_REB = [-0.09, 0.2, 0.09, 0.1, -0.1];
const BUILD_STRIKES = [520, 900, 1280];
const BUILD_R = [
  ...row(0, RR),
  ...row(260, HAM_UP, BACK),
  ...row(520, HAM_HIT, IN), ...row(640, HAM_REB, OUT), ...row(780, HAM_UP, OUT),
  ...row(900, HAM_HIT, IN), ...row(1020, HAM_REB, OUT), ...row(1160, HAM_UP, OUT),
  ...row(1280, HAM_HIT, IN),
  1450, -0.08, 0.17, 0.09, 0.5, 0, OUT,
  1650, -0.11, 0.115, 0.03, 0, 0, IO,
  ...row(1990, RR),
];
const BUILD_L = [
  ...row(0, RL),
  400, -0.005, 0.11, 0.14, 0, 0.3, IO, // holding the nail
  1330, -0.005, 0.11, 0.14, 0, 0.3, IO,
  1560, 0, 0.36, 0.1, 0, 1.3, BACK, // to the brow…
  1760, 0.07, 0.37, 0.07, 0, 1.3, IO, // …and wipe
  ...row(1990, RL),
];
const FLAG_R = [
  ...row(0, RR),
  260, -0.1, 0.095, 0.05, 0.1, 0, IO,
  560, -0.09, 0.36, 0.03, 0, 0, OUT, // up goes the white flag (tired, no snap)
  1750, -0.09, 0.36, 0.03, 0, 0, IO,
  2150, -0.1, 0.16, 0.05, 0, 0, IO,
  ...row(2390, RR),
];
const WAVE_R = [
  ...row(0, RR),
  220, -0.115, 0.15, 0.06, 0, 0.1, IO,
  420, -0.135, 0.34, 0.05, 0, -0.5, BACK,
  1350, -0.135, 0.34, 0.05, 0, -0.5, IO,
  ...row(1700, RR),
];
const LOOK = [0, 0, IO, 200, -0.1, IO, 540, 0.8, BACK, 1050, 0.75, IO, 1500, -0.8, BACK, 1950, -0.75, IO, 2350, 0, BACK];
const SHRUG = [0, 0, IO, 160, -0.12, IO, 400, 1.06, BACK, 950, 1, IO, 1150, -0.06, IN, 1350, 0, OUT];
const STRETCH = [0, 0, IO, 300, 0, IO, 900, 1, OUT, 1700, 1, IO, 1900, 0.05, IN, 2150, 0, OUT];
const FIDGET = [0, 0, IO, 500, -0.06, IO, 1100, -0.06, IO, 1500, 0.06, IO, 2100, 0.06, IO, 2600, 0, IO];

/**
 * Pose `o` for `kind` at progress c (0–1 through EMOTE_MS[kind]); for 'win',
 * c is the seconds since the dance began. Call clearMove(o) first each frame.
 */
export function emotePose(o: PoseInput, kind: EmoteKind | 'win', c: number, _time?: number) {
  if (!o.reach) clearMove(o);
  let lift = 0, spin = 0;
  const ms = kind === 'win' ? c * 1000 : c * EMOTE_MS[kind];
  switch (kind) {
    case 'win': {
      // Endless: wind up, a big bounce with a full twirl (so every landing
      // faces front), land, bob; the trophy pumps overhead on every landing.
      const bar = Math.floor(ms / WIN_MS), u = ms - bar * WIN_MS;
      lift = jump(o, u, 260, 780, 0.22, 200);
      spin = TAU * (bar + io(seg(u, 280, 760)));
      o.handsUp = 1;
      H[0] = -0.065; H[1] = 0.37 + 0.025 * Math.sin(Math.PI * seg(u, 260, 780)) - 0.05 * impact(u, 780); H[2] = 0.05; H[3] = 0; H[4] = 0.12;
      hand(o, 1, Math.min(1, ms / 200));
      o.lean = -0.06; o.nod = -0.15; o.lids = 0.4;
      EMOTE_OUT.prop = 'trophy';
      EMOTE_OUT.propS = back(seg(ms, 0, 250));
      break;
    }
    case 'cheer': {
      // Wind up, a big jump with a full twirl and the money bag thrown up,
      // land, a little skip, settle.
      lift = jump(o, ms, 200, 640, 0.24) + jump(o, ms, 780, 1010, 0.08, 120);
      o.handsUp = ms < 1150 ? back(seg(ms, 150, 330)) : 1 - io(seg(ms, 1150, 1450));
      o.cheer = ms < 700 ? 0.5 * seg(ms, 200, 640) : 0.5 + 0.5 * seg(ms, 780, 1010);
      spin = TAU * io(seg(ms, 220, 620));
      o.lean = -0.12 * bell(ms, 220, 420, 560, 700);
      o.nod = -0.18 * Math.min(1, o.handsUp);
      prop('bag', ms, EMOTE_MS.cheer);
      break;
    }
    case 'pump': {
      // Flick a coin, catch it, "Yes!" with the other fist and a hop.
      keys(ms, PUMP_R); hand(o, 1, bell(ms, 0, 150, 1250, 1480));
      keys(ms, PUMP_L); hand(o, 0, bell(ms, 600, 700, 1350, 1480));
      lift = jump(o, ms, 860, 1100, 0.1);
      o.nod = -0.22 * bell(ms, 820, 900, 1100, 1300);
      o.lids = 0.45 * bell(ms, 820, 900, 1150, 1350);
      o.lean = 0.06 * peak(ms, 150, 260, 400) - 0.08 * bell(ms, 840, 900, 1100, 1300);
      prop('coin', ms, EMOTE_MS.pump, 150, 250);
      EMOTE_OUT.propT = seg(ms, 320, 690);
      break;
    }
    case 'taunt': {
      // Hand on hip, fanning itself with the rent it just took.
      o.taunt = bell(ms, 80, 380, 1900, 2180);
      const sw = Math.sin(seg(ms, 500, 1700) * TAU * 4) * bell(ms, 450, 600, 1550, 1750);
      keys(ms, TAUNT_R);
      hand(o, 1, bell(ms, 0, 150, 1950, 2180), 0.012 * sw, 0, 0, 0.1 * sw, 0.55 * sw);
      const smug = bell(ms, 200, 450, 1800, 2100);
      o.lean = -0.07 * smug; o.nod = -0.08 * smug; o.lids = 0.3 * smug;
      prop('wad', ms, EMOTE_MS.taunt);
      particles('bills', ms, TAUNT_BILLS, TAUNT_FROM);
      break;
    }
    case 'pay': {
      // Out comes the wad; bills peeled off one at a time and flicked away;
      // deflate.
      keys(ms, PAY_R); hand(o, 1, bell(ms, 0, 150, 1650, 1880));
      let flick = 0;
      for (const p of PAY_PEELS) flick = Math.max(flick, peak(ms, p - 50, p, p + 110));
      H[0] = -0.015 + 0.09 * flick; H[1] = 0.185 + 0.03 * flick; H[2] = 0.135 + 0.01 * flick; H[3] = 0; H[4] = 0.4 * flick;
      hand(o, 0, bell(ms, 450, 580, 1180, 1350));
      const look = bell(ms, 200, 450, 1250, 1500);
      o.nod = 0.28 * look; o.cock = 0.08 * look;
      o.sad = 0.55 * bell(ms, 1250, 1450, 1650, 1880);
      o.squash *= 1 - 0.04 * o.sad;
      prop('wad', ms, 1700);
      particles('bills', ms, PAY_PEELS, PAY_FROM);
      break;
    }
    case 'sad': {
      // Paying out big: the money bag held out, turned over, shaken — two
      // coins drop out — and the slump sinks a notch on every "womp".
      const shake = Math.sin((ms - 700) / 1000 * TAU * 7) * bell(ms, 680, 720, 980, 1050);
      keys(ms, SAD_R); hand(o, 1, bell(ms, 0, 150, 1350, 1550), 0, 0.018 * shake, 0, 0, 0.1 * shake);
      o.sad = curve(ms, SAD_SLUMP);
      let note = 0;
      for (let k = 0; k < 4; k++) note = Math.max(note, impact(ms, 1000 + k * 250));
      o.squash = 1 - 0.06 * o.sad - 0.04 * note;
      const peer = bell(ms, 650, 750, 950, 1100);
      o.nod = 0.3 * peer; o.cock = 0.15 * peer;
      prop('bag', ms, 1450);
      particles('coins', ms, SAD_COINS, SAD_FROM);
      break;
    }
    case 'stomp': {
      // Three stamps (foot up slow, down hard), fists shaking; then arms
      // folded, chin up, looking away: "hmph".
      let lifted = 0, hit = 0;
      for (const s of STAMPS) {
        if (ms > s - 280 && ms < s) lifted = ms < s - 100 ? out3(seg(ms, s - 280, s - 100)) : 1 - in2(seg(ms, s - 100, s));
        hit = Math.max(hit, impact(ms, s));
      }
      o.liftR = 0.085 * lifted;
      o.lean = 0.1 * bell(ms, 100, 300, 1050, 1250);
      o.tilt = -0.06 * lifted + 0.05 * hit * Math.sin(ms * 0.09);
      o.squash *= 1 - 0.09 * hit;
      const fists = ms < 1100 ? 0.02 * hit : 0;
      keys(ms, STOMP_L); hand(o, 0, bell(ms, 0, 80, 1800, 1890), 0, fists);
      keys(ms, STOMP_R); hand(o, 1, bell(ms, 0, 80, 1800, 1890), 0, fists);
      o.lids = 0.35 * bell(ms, 100, 200, 1100, 1200);
      const huff = bell(ms, 1250, 1400, 1650, 1850);
      o.look = 0.4 * huff; o.nod = -0.15 * huff; o.cock = -0.1 * huff;
      break;
    }
    case 'rattle': {
      // In jail: up off the slump, the tin cup raked along the bars, one
      // bang for good measure, and back down.
      const up = bell(ms, 0, 300, 2100, 2550);
      o.lean = -0.24 * up; o.nod = -0.38 * up;
      keys(ms, RATTLE_R); hand(o, 1, bell(ms, 0, 150, 2300, 2580));
      keys(ms, RATTLE_L); hand(o, 0, bell(ms, 150, 300, 2200, 2550));
      o.squash *= 1 - 0.06 * impact(ms, 1720);
      prop('cup', ms, 2450);
      break;
    }
    case 'sold': {
      // Dip, then the SOLD sign thrust overhead on a hop; a proud wiggle, a
      // thumbs up, and down.
      const wig = Math.sin((ms - 650) / 1000 * TAU * 2.5) * bell(ms, 600, 700, 1150, 1300);
      keys(ms, SOLD_R); hand(o, 1, bell(ms, 0, 120, 1700, 1890), 0, 0, 0, 0, 0.14 * wig);
      keys(ms, SOLD_L); hand(o, 0, bell(ms, 330, 420, 1500, 1650));
      lift = jump(o, ms, 300, 560, 0.09, 150);
      const proud = bell(ms, 380, 500, 1300, 1600);
      o.lean = -0.08 * proud; o.nod = -0.14 * proud; o.lids = 0.35 * proud;
      prop('sign', ms, EMOTE_MS.sold);
      break;
    }
    case 'popper': {
      // Passing GO: aim the party popper, yank the string — pop! — recoil,
      // both arms up and a hop.
      keys(ms, POPPER_R); hand(o, 1, bell(ms, 0, 100, 1550, 1790));
      keys(ms, POPPER_L); hand(o, 0, bell(ms, 100, 200, 1550, 1790));
      o.crouch = 0.6 * bell(ms, 120, 300, 330, 420);
      o.lean = 0.05 * bell(ms, 150, 300, 330, 360) - 0.12 * bell(ms, 340, 400, 450, 600);
      o.squash *= 1 - 0.07 * impact(ms, 340);
      lift = jump(o, ms, 560, 860, 0.13);
      const joy = bell(ms, 400, 500, 1300, 1500);
      o.lids = 0.4 * joy; o.nod = -0.15 * joy;
      prop('popper', ms, EMOTE_MS.popper);
      particles('confetti', ms, POPPER_FX, POPPER_FROM);
      break;
    }
    case 'phone': {
      // Proposing a trade: dial, phone to the ear, "mm-hm", talking with its hands.
      let tap = 0;
      for (let k = 0; k < 4; k++) tap = Math.max(tap, peak(ms, 260 + k * 60, 280 + k * 60, 310 + k * 60));
      keys(ms, PHONE_R); hand(o, 1, bell(ms, 0, 120, 2100, 2380), 0, -0.006 * tap);
      const gest = bell(ms, 900, 1000, 1800, 1950);
      keys(ms, PHONE_L);
      hand(o, 0, bell(ms, 650, 800, 1900, 2150), 0.015 * Math.sin(ms * 0.011) * gest, 0.012 * Math.sin(ms * 0.017) * gest);
      const call = bell(ms, 650, 800, 2050, 2350);
      let nods = 0;
      for (const t of [950, 1350, 1750]) nods = Math.max(nods, peak(ms, t, t + 80, t + 220));
      o.nod = 0.25 * bell(ms, 150, 250, 550, 700) + 0.12 * nods;
      o.cock = 0.22 * call;
      o.twist = 0.12 * call;
      o.tilt = 0.035 * Math.sin(ms / 1000 * TAU * 0.7) * call;
      prop('phone', ms, 2350);
      break;
    }
    case 'deal': {
      // A trade done: read the contract, stamp it with a fist, hold it up high.
      keys(ms, DEAL_R); hand(o, 1, bell(ms, 0, 120, 1900, 2180));
      keys(ms, DEAL_L); hand(o, 0, bell(ms, 350, 480, 1950, 2180));
      o.nod = 0.3 * bell(ms, 200, 400, 950, 1150) - 0.15 * bell(ms, 1150, 1300, 1700, 1900);
      o.squash *= 1 - 0.08 * impact(ms, 820);
      lift = jump(o, ms, 1150, 1400, 0.08, 130);
      o.lids = 0.35 * bell(ms, 1150, 1250, 1700, 1900);
      prop('contract', ms, EMOTE_MS.deal);
      break;
    }
    case 'build': {
      // Hard hat on; three swings of the hammer (wind up, strike fast,
      // rebound); wipe the brow.
      EMOTE_OUT.hat = ms < 1800 ? back(seg(ms, 0, 250)) : 1 - in2(seg(ms, 1800, 2000));
      keys(ms, BUILD_R); hand(o, 1, bell(ms, 0, 120, 1850, 1990));
      keys(ms, BUILD_L); hand(o, 0, bell(ms, 250, 400, 1850, 1990));
      let hit = 0;
      for (const s of BUILD_STRIKES) hit = Math.max(hit, impact(ms, s));
      const work = bell(ms, 300, 450, 1300, 1450);
      o.lean = 0.1 * work + 0.05 * hit;
      o.nod = 0.28 * work - 0.12 * bell(ms, 1550, 1650, 1750, 1900);
      o.squash *= 1 - 0.06 * hit;
      prop('hammer', ms, EMOTE_MS.build);
      break;
    }
    case 'surrender': {
      // Bankrupt: the white flag goes up, waves slowly, and comes down; then
      // the piece keels over (Pieces).
      const w = Math.sin((ms - 560) / 1000 * TAU * 1.2) * bell(ms, 560, 700, 1650, 1800);
      keys(ms, FLAG_R); hand(o, 1, bell(ms, 0, 150, 2200, 2390), -0.03 * w, 0, 0, 0, 0.38 * w);
      const low = bell(ms, 300, 900, 2100, 2400);
      o.nod = 0.35 * low; o.sad = 0.4 * bell(ms, 600, 1000, 2100, 2400); o.lean = 0.08 * low;
      o.squash *= 1 - 0.04 * low;
      prop('flag', ms, EMOTE_MS.surrender);
      EMOTE_OUT.propT = ms / 1000;
      break;
    }
    case 'wave': {
      const sw = Math.sin((ms - 420) / 1000 * TAU * 2.6) * bell(ms, 420, 520, 1250, 1400);
      keys(ms, WAVE_R); hand(o, 1, bell(ms, 0, 100, 1600, 1790), 0.028 * sw, 0, 0, 0, 0.45 * sw);
      const hi = bell(ms, 300, 450, 1300, 1500);
      o.tilt = -0.05 * hi; o.cock = -0.1 * hi; o.lids = 0.3 * hi;
      break;
    }
    case 'look': {
      // Over there… over there… with a little counter-turn first; the body
      // follows the head a beat behind, and it blinks as it turns.
      o.look = curve(ms, LOOK);
      o.twist = 0.3 * curve(ms - 150, LOOK);
      o.lids = Math.max(peak(ms, 330, 380, 450), peak(ms, 1280, 1330, 1400));
      break;
    }
    case 'shrug':
      o.shrug = curve(ms, SHRUG);
      o.look = 0.2 * bell(ms, 200, 450, 950, 1300);
      o.squash *= 1 - 0.035 * peak(ms, 0, 160, 400) + 0.02 * peak(ms, 160, 400, 600);
      o.nod = -0.06 * o.shrug;
      break;
    case 'stretch':
      o.crouch = 0.45 * peak(ms, 0, 250, 450);
      o.stretch = curve(ms, STRETCH);
      lift = 0.014 * bell(ms, 850, 1050, 1650, 1800); // up on its toes
      o.tilt = 0.012 * Math.sin(ms * 0.05) * bell(ms, 900, 1000, 1650, 1700);
      break;
    case 'fidget':
      // Weight onto one foot, shuffle the other; across; back to the middle and a toe tap.
      o.tilt = curve(ms, FIDGET);
      o.twist = -0.6 * o.tilt;
      o.liftR = 0.02 * peak(ms, 650, 740, 860) + 0.015 * peak(ms, 2650, 2720, 2800);
      o.liftL = 0.02 * peak(ms, 1650, 1740, 1860);
      o.look = 0.12 * Math.sin(ms / 1000 * TAU * 0.4);
      break;
  }
  EMOTE_OUT.lift = lift;
  EMOTE_OUT.spin = spin;
}
