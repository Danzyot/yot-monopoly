// Game audio plumbing and sound effects (adapted from the poker room's
// sound.ts). Every effect is synthesized in WebAudio: nothing to download,
// nothing to license, nothing to 404.
//
// One AudioContext feeds two buses — effects and music — so the player's two
// switches (SFX, music) are independent gains rather than two engines that
// fight over the output. music.ts renders into musicOutput().

const K = { sfxVol: 'yot:sfx.vol', sfxMuted: 'yot:sfx.muted' };

// Storage can throw (private mode, blocked site data): preferences are a
// convenience, so a failure just means the defaults.
export function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* not remembered, still applied */ }
}
/** A 0..1 fraction from storage; absent or garbage means `dflt`, never 0. */
export function readFraction(key: string, dflt: number): number {
  const raw = readPref(key);
  if (raw === null || raw.trim() === '') return dflt;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : dflt;
}

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

let sfxVolume = readFraction(K.sfxVol, 0.7);
let sfxMuted = readPref(K.sfxMuted) === '1';

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      // Building a context before any gesture only produces a suspended one
      // (and a console warning); wait until the page has been interacted with.
      const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
      if (ua && !ua.hasBeenActive) return null;
      const AC = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxMuted ? 0 : sfxVolume;
      sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function audioContext(): AudioContext | null { return audio(); }
export function musicOutput(): GainNode | null { audio(); return musicBus; }

/** Call from inside a click handler: this is when browsers let audio start. */
export function primeAudio(): void { if (audio()) gestured = true; }

// Browsers keep audio locked until the user interacts with the page, and iOS
// re-suspends the context whenever the app is backgrounded. These listeners
// stay for the life of the page so any later tap wakes it again. The callbacks
// given to onFirstGesture run once, on the first gesture (music uses it to
// resume for a player who had music on last visit).
let armed = false;
const firstGesture: ((e: Event | null) => void)[] = [];
let gestured = false;
export function onFirstGesture(fn: (e: Event | null) => void): void {
  if (gestured) { fn(null); return; }
  firstGesture.push(fn);
  if (armed) return;
  armed = true;
  const wake = (e: Event) => {
    // Only some events grant activation (a touch counts on touchend, not
    // touchstart), so the first-gesture work waits until audio really opens.
    if (!audio() || gestured) return;
    gestured = true;
    for (const f of firstGesture.splice(0)) f(e);
  };
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
    window.addEventListener(ev, wake, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  });
}
/**
 * Has the player clicked or typed on this page yet? Deliberately our own flag
 * rather than the browser's sticky activation, which some browsers carry
 * over from the previous page: music must never start on load by itself.
 */
export function hasGestured(): boolean { return gestured; }

// ---- SFX preferences (the UI subscribes to redraw its toggle) ----
export interface SfxState { volume: number; muted: boolean }
const sfxListeners = new Set<(s: SfxState) => void>();
export function sfxState(): SfxState { return { volume: sfxVolume, muted: sfxMuted }; }
export function onSfxChange(fn: (s: SfxState) => void): () => void {
  sfxListeners.add(fn);
  return () => { sfxListeners.delete(fn); };
}
function applySfx() {
  if (ctx && sfxBus) sfxBus.gain.setTargetAtTime(sfxMuted ? 0 : sfxVolume, ctx.currentTime, 0.02);
  const s = sfxState();
  sfxListeners.forEach(f => f(s));
}
export function setSfxVolume(v: number): void {
  sfxVolume = Math.max(0, Math.min(1, v));
  writePref(K.sfxVol, String(sfxVolume));
  applySfx();
}
export function setSfxMuted(m: boolean): void {
  sfxMuted = m;
  writePref(K.sfxMuted, m ? '1' : '0');
  applySfx();
}

// ---- building blocks ----

/** One shared second of white noise, reused by every rattle, click and thud. */
export function noise(ac: AudioContext): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Ready to play effects? Muted or locked audio skips building any nodes. */
function sfx(): { ac: AudioContext; out: GainNode } | null {
  if (sfxMuted || sfxVolume === 0) return null;
  const ac = audio();
  if (!ac || !sfxBus || ac.state !== 'running') return null;
  return { ac, out: sfxBus };
}

function tone(
  freq: number, at: number, dur: number, vol = 0.12,
  type: OscillatorType = 'sine', glideTo?: number,
) {
  const a = sfx();
  if (!a) return;
  const { ac, out } = a;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.012, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Filtered noise burst: the basis of rattles, clicks and knocks. */
function burst(
  at: number, dur: number, vol: number,
  filter: BiquadFilterType, freq: number, q = 1, sweepTo?: number,
) {
  const a = sfx();
  if (!a) return;
  const { ac, out } = a;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  const bq = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise(ac);
  src.loop = true;
  bq.type = filter;
  bq.frequency.setValueAtTime(freq, t0);
  if (sweepTo) bq.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  bq.Q.value = q;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.008, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq).connect(g).connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

// ---- game effects ----
// Every effect takes `at`, a delay in seconds, so the hook can line sounds up
// with the animation (money changes hands when the token lands, not when the
// dice leave the hand).

/** Dice shaken and thrown: a burst of irregular clacks that thins out. */
export function playDiceRoll(at = 0) {
  if (!sfx()) return;
  let t = at;
  for (let i = 0; i < 11; i++) {
    const loud = 1 - i / 13;
    burst(t, 0.035, 0.22 * loud, 'bandpass', 2400 + Math.random() * 1800, 5);
    tone(700 + Math.random() * 500, t, 0.03, 0.03 * loud, 'triangle');
    t += 0.035 + Math.random() * 0.05 + i * 0.012;
  }
}

/** One tile hopped: a small wooden tick. */
export function playHop(at = 0) {
  burst(at, 0.03, 0.1, 'bandpass', 1500, 4);
  tone(900, at, 0.035, 0.035, 'triangle');
}

/** Bought a deed: cash-register "cha-ching" — a drawer clunk and a bell. */
export function playBuy(at = 0) {
  burst(at, 0.07, 0.18, 'lowpass', 600, 1);
  tone(1320, at + 0.08, 0.35, 0.09, 'triangle');
  tone(1760, at + 0.14, 0.5, 0.08, 'triangle');
  tone(2640, at + 0.14, 0.4, 0.03, 'sine');
}

/** Paid rent, tax or a fee: a few coins dropping away, falling in pitch. */
export function playPay(at = 0) {
  [0, 0.07, 0.15].forEach((d, i) => {
    tone(2200 - i * 350, at + d, 0.12, 0.07, 'triangle', 1500 - i * 250);
    burst(at + d, 0.03, 0.06, 'highpass', 5000, 1);
  });
}

/** Money came in: a bright rising coin shimmer. */
export function playReceive(at = 0) {
  [0, 0.06, 0.12, 0.18].forEach((d, i) => tone(1400 + i * 260, at + d, 0.16, 0.06, 'triangle'));
}

/** A Chance / Community Chest card turned over: a papery flick. */
export function playCardFlip(at = 0) {
  burst(at, 0.09, 0.14, 'bandpass', 3200, 1.2, 1400);
  burst(at + 0.07, 0.05, 0.07, 'bandpass', 1800, 2);
}

/** A house or hotel set down on its lot: a little plastic clack and a knock. */
export function playBuild(at = 0) {
  burst(at, 0.04, 0.16, 'bandpass', 2600, 3);
  tone(520, at, 0.09, 0.07, 'triangle', 380);
  burst(at + 0.05, 0.06, 0.08, 'lowpass', 700, 1);
}

/** Let out of jail: the cell door swinging open with a creak. */
export function playJailOpen(at = 0) {
  burst(at, 0.12, 0.14, 'lowpass', 900, 3);
  tone(330, at + 0.05, 0.35, 0.04, 'sawtooth', 520);
}

/** Go to jail: a low, sour buzz with a cell-door clank. */
export function playJail(at = 0) {
  tone(110, at, 0.55, 0.12, 'sawtooth', 70);
  tone(116, at, 0.55, 0.08, 'square', 74);
  burst(at + 0.45, 0.18, 0.2, 'lowpass', 900, 3);
}

/** Your turn: a friendly two-note chime. */
export function playYourTurn(at = 0) {
  tone(660, at, 0.18, 0.11);
  tone(990, at + 0.14, 0.32, 0.11);
}

/** An auction bid landed. */
export function playBid(at = 0) {
  tone(1250, at, 0.05, 0.06, 'square');
  burst(at, 0.025, 0.05, 'highpass', 4000, 1);
}

/** Doubles: a quick sparkle of high notes. */
export function playDoubles(at = 0) {
  [2093, 2637, 3136, 4186].forEach((f, i) => tone(f, at + i * 0.045, 0.22, 0.04, 'sine'));
}

/** Someone won the game. */
export function playWin(at = 0) {
  const notes = [523, 659, 784, 1046, 784, 1046];
  const times = [0, 0.12, 0.24, 0.36, 0.56, 0.68];
  notes.forEach((f, i) => tone(f, at + times[i], i === notes.length - 1 ? 0.9 : 0.2, 0.1, 'triangle'));
  tone(262, at + 0.36, 1.1, 0.07, 'sine');
}

/** A player went bankrupt: a heavy thud. */
export function playBankrupt(at = 0) {
  tone(140, at, 0.5, 0.2, 'sine', 40);
  burst(at, 0.25, 0.22, 'lowpass', 300, 1);
}

// ---- table social ----

/** Someone poked you: an insistent double knock and a rising "hey!". */
export function playPoke(at = 0) {
  for (const d of [0, 0.16]) {
    burst(at + d, 0.07, 0.3, 'lowpass', 700, 2);
    tone(180, at + d, 0.09, 0.12, 'sine', 120);
  }
  tone(700, at + 0.36, 0.14, 0.1, 'square', 1050);
  tone(1050, at + 0.5, 0.22, 0.09, 'triangle');
}

/** A reaction popped up: a soft bubble blip, quiet enough to ignore. */
export function playReaction(at = 0) {
  tone(520, at, 0.09, 0.035, 'sine', 900);
}

// ---- arcade mini-games (MinigamePanel.tsx / useGameSounds.ts) ----

/** The wheel's pointer clicking over a wedge: a tiny wooden tick. */
export function playTick(at = 0) {
  burst(at, 0.02, 0.12, 'bandpass', 2600, 6);
  tone(1500, at, 0.025, 0.03, 'triangle', 900);
}

/** A mini-game opens: a short rising arcade sting. */
export function playArcadeStart(at = 0) {
  [523, 659, 784].forEach((f, i) => tone(f, at + i * 0.07, 0.14, 0.07, 'square'));
  tone(1046, at + 0.21, 0.3, 0.08, 'triangle');
}

/** Won the round: a bright fanfare with a sparkle on top. */
export function playArcadeWin(at = 0) {
  [784, 988, 1175, 1568].forEach((f, i) => tone(f, at + i * 0.09, i === 3 ? 0.6 : 0.16, 0.09, 'triangle'));
  [2093, 2637, 3136].forEach((f, i) => tone(f, at + 0.36 + i * 0.06, 0.25, 0.035, 'sine'));
}

/** Lost the round: a soft descending "wah". */
export function playArcadeLose(at = 0) {
  tone(392, at, 0.18, 0.07, 'triangle', 330);
  tone(294, at + 0.17, 0.4, 0.07, 'triangle', 220);
}

/** Right answer / good guess: a quick two-note ding. */
export function playRight(at = 0) {
  tone(1046, at, 0.1, 0.08, 'sine');
  tone(1568, at + 0.08, 0.25, 0.08, 'sine');
}

/** Wrong answer / false start: a flat buzzer. */
export function playBuzz(at = 0) {
  tone(130, at, 0.3, 0.12, 'square', 110);
  tone(196, at, 0.3, 0.06, 'sawtooth', 160);
}

/** The light turns green: a sharp starter beep. */
export function playGoLight(at = 0) {
  tone(880, at, 0.08, 0.1, 'square');
  tone(1760, at + 0.06, 0.28, 0.1, 'square');
}

/** A countdown second ticking by. */
export function playCountdownBeep(at = 0, final = false) {
  tone(final ? 1320 : 880, at, final ? 0.3 : 0.08, 0.07, 'sine');
}
