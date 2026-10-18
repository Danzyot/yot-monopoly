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
let musicComp: DynamicsCompressorNode | null = null;
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
      // The music is mastered quietly through a gentle compressor so a busy
      // bar (chords, drums and a lead stacking up) never clips or jumps out
      // over the effects; it also acts as a soft limiter for the loud tracks.
      musicComp = ctx.createDynamicsCompressor();
      musicComp.threshold.value = -18;
      musicComp.knee.value = 12;
      musicComp.ratio.value = 4;
      musicComp.attack.value = 0.01;
      musicComp.release.value = 0.2;
      musicBus.connect(musicComp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function audioContext(): AudioContext | null { return audio(); }
export function musicOutput(): GainNode | null { audio(); return musicBus; }
/** The effects bus: what the SFX volume and mute govern (the ambience beds render here). */
export function sfxOutput(): GainNode | null { audio(); return sfxBus; }

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

// ---- character foley (three/characters/moveFx.ts) ----
// The little sounds the pieces make as they move: footfalls, whooshes, the
// props they pull out. Each takes `at` (a delay in seconds) and `v`, a volume
// scale, so another player's piece can be quieter than your own. None of them
// repeats a game sound from useGameSounds.ts: those voice what happened (a
// purchase, rent, jail), these voice the character reacting to it.

/** A sung vowel: a buzzy source through two formant filters, gliding f0 → f1 and formants a → b. */
function voice(at: number, dur: number, f0: number, f1: number, form: [number, number, number, number], vol: number) {
  const a = sfx();
  if (!a) return;
  const { ac, out } = a;
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.04, dur / 4));
  g.gain.setValueAtTime(vol, t0 + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  for (const [i, q] of [[0, 6], [1, 9]] as const) {
    const bq = ac.createBiquadFilter();
    bq.type = 'bandpass';
    bq.Q.value = q;
    bq.frequency.setValueAtTime(form[i], t0);
    bq.frequency.linearRampToValueAtTime(form[i + 2], t0 + dur);
    osc.connect(bq).connect(g);
  }
  g.connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Struck metal: inharmonic partials ringing down at different rates. */
function metal(at: number, f: number, dur: number, vol: number, ratios: readonly number[] = [1, 2.76, 5.4, 8.93]) {
  ratios.forEach((r, i) => tone(f * r, at, dur / (1 + i * 0.6), vol / (1 + i * 0.8), 'sine'));
}

/** Noise swelling up and away through a moving band: whooshes and swishes. */
function swoosh(at: number, dur: number, vol: number, f0: number, f1: number) {
  const a = sfx();
  if (!a) return;
  const { ac, out } = a;
  const t0 = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  src.loop = true;
  const bq = ac.createBiquadFilter();
  bq.type = 'bandpass';
  bq.Q.value = 1.4;
  bq.frequency.setValueAtTime(f0, t0);
  bq.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bq).connect(g).connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

/** `x`, nudged a few percent either way so repeats don't sound machine-made. */
const jit = (x: number, by = 0.06) => x * (1 + (Math.random() * 2 - 1) * by);

/** A soft footfall: a padded thump and a tiny scuff (each hop landing). */
export function playStep(at = 0, v = 1) {
  tone(jit(150, 0.1), at, 0.07, 0.11 * v, 'sine', 80);
  burst(at, 0.045, 0.09 * v, 'lowpass', jit(1100, 0.15), 1);
  burst(at + 0.005, 0.02, 0.025 * v, 'bandpass', jit(3200, 0.2), 3);
}

/** A twirl or a flight through the air. */
export function playWhoosh(at = 0, v = 1, dur = 0.38) {
  swoosh(at, dur, 0.16 * v, jit(380), jit(2200));
}

/** A quick swish: a hand whipping round, a sign thrust up. */
export function playSwish(at = 0, v = 1) {
  swoosh(at, 0.16, 0.1 * v, jit(1400), jit(4200));
}

/** A happy "yay!" (cheers and pops). */
export function playYay(at = 0, v = 1) {
  voice(at, 0.34, jit(330), jit(520), [650, 1900, 380, 2400], 0.11 * v);
  voice(at, 0.34, jit(660), jit(1040), [650, 1900, 380, 2400], 0.03 * v);
}

/** A cheery "hey!" for a wave. */
export function playHey(at = 0, v = 1) {
  voice(at, 0.2, jit(300), jit(380), [550, 1800, 480, 2100], 0.08 * v);
}

/** A puzzled "huh?" for a shrug. */
export function playHuh(at = 0, v = 1) {
  voice(at, 0.24, jit(170), jit(290), [600, 1150, 650, 1300], 0.08 * v);
}

/** A closed-mouth "hmm" while looking around. */
export function playHmm(at = 0, v = 1) {
  voice(at, 0.32, jit(190), jit(170), [260, 900, 280, 950], 0.07 * v);
}

/** "Mm-hm" on the phone. */
export function playMurmur(at = 0, v = 1) {
  voice(at, 0.13, jit(200), jit(180), [280, 950, 300, 1000], 0.06 * v);
  voice(at + 0.17, 0.18, jit(170), jit(240), [300, 1000, 500, 1300], 0.06 * v);
}

/** A big yawn: "aaa-oh". */
export function playYawn(at = 0, v = 1) {
  voice(at, 0.85, jit(260), jit(170), [800, 1300, 450, 850], 0.07 * v);
}

/** A tired sigh: breath falling away. */
export function playSigh(at = 0, v = 1) {
  burst(at, 0.55, 0.07 * v, 'bandpass', 1300, 0.8, 500);
  voice(at, 0.45, 210, 150, [700, 1200, 500, 900], 0.025 * v);
}

/** An angry "hmph!". */
export function playHuff(at = 0, v = 1) {
  burst(at, 0.16, 0.14 * v, 'lowpass', 900, 1, 300);
  voice(at, 0.14, 150, 115, [300, 900, 280, 800], 0.05 * v);
}

/** A stamping foot: a hard thump with a dusty edge. */
export function playThud(at = 0, v = 1) {
  tone(jit(95), at, 0.18, 0.24 * v, 'sine', 42);
  burst(at, 0.12, 0.18 * v, 'lowpass', 420, 1);
  burst(at + 0.01, 0.08, 0.04 * v, 'bandpass', 2400, 1);
}

/** One coin's bright ting (caught, dropped). */
export function playTing(at = 0, v = 1) {
  metal(at, jit(2600, 0.08), 0.35, 0.05 * v, [1, 2.4, 4.1]);
}

/** A handful of coins jingling. */
export function playCoins(at = 0, v = 1) {
  let t = at;
  for (let i = 0; i < 6; i++) {
    metal(t, 2400 + Math.random() * 1600, 0.16, 0.035 * v * (1 - i * 0.1), [1, 2.4, 3.9]);
    t += 0.03 + Math.random() * 0.045;
  }
}

/** Paper money fluttering away. */
export function playFlutter(at = 0, v = 1) {
  for (let i = 0; i < 4; i++) burst(at + i * 0.028, 0.025, 0.06 * v * (1 - i * 0.18), 'bandpass', jit(3000, 0.25), 1.2);
}

/** A thumb riffling a wad of notes. */
export function playRiffle(at = 0, v = 1) {
  for (let i = 0; i < 9; i++) burst(at + i * 0.018, 0.016, 0.05 * v, 'bandpass', 2600 + i * 150, 1.5);
}

/** "Womp womp womp wommmp": the sad trombone (paying out big). Lasts ~1.5 s. */
export function playWomp(at = 0, v = 1) {
  const a = sfx();
  if (!a) return;
  const { ac, out } = a;
  [293.7, 277.2, 261.6, 246.9].forEach((f, i) => {
    const t0 = ac.currentTime + at + i * 0.25;
    const dur = i === 3 ? 0.75 : 0.22;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * 1.02, t0);
    osc.frequency.linearRampToValueAtTime(f, t0 + 0.05);
    if (i === 3) {
      // The last note sags and wobbles.
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t0);
      depth.gain.linearRampToValueAtTime(f * 0.03, t0 + 0.3);
      lfo.connect(depth).connect(osc.frequency);
      osc.frequency.linearRampToValueAtTime(f * 0.92, t0 + dur);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.02);
    }
    // The plunger mute: the filter opens and closes on every note ("wah").
    const bq = ac.createBiquadFilter();
    bq.type = 'lowpass';
    bq.Q.value = 4;
    bq.frequency.setValueAtTime(350, t0);
    bq.frequency.linearRampToValueAtTime(1300, t0 + Math.min(0.12, dur * 0.4));
    bq.frequency.linearRampToValueAtTime(500, t0 + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.09 * v, t0 + 0.03);
    g.gain.setValueAtTime(0.09 * v, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(bq).connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  });
}

/** A tin cup banged on iron bars. */
export function playClank(at = 0, v = 1) {
  metal(at, jit(520, 0.1), 0.45, 0.07 * v, [1, 2.57, 4.32, 6.8]);
  burst(at, 0.03, 0.12 * v, 'bandpass', 3500, 2);
}

/** The cup raked along the bars: clang-clang-clang. */
export function playRake(at = 0, v = 1) {
  for (let i = 0; i < 3; i++) {
    metal(at + i * 0.065, jit(560 + i * 40, 0.05), 0.22, 0.045 * v, [1, 2.57, 4.32]);
    burst(at + i * 0.065, 0.02, 0.07 * v, 'bandpass', 3800, 2);
  }
}

/** A hammer on a nail. */
export function playTink(at = 0, v = 1) {
  metal(at, jit(1700, 0.04), 0.2, 0.06 * v, [1, 2.3, 3.9]);
  burst(at, 0.025, 0.12 * v, 'highpass', 3000, 1);
  tone(140, at, 0.05, 0.06 * v, 'sine', 90);
}

/** Wood knocking: a sign stopping overhead. */
export function playKnock(at = 0, v = 1) {
  tone(jit(320), at, 0.08, 0.1 * v, 'triangle', 190);
  burst(at, 0.05, 0.1 * v, 'bandpass', 950, 3);
}

/** A fist stamped down on a contract. */
export function playStamp(at = 0, v = 1) {
  tone(120, at, 0.12, 0.18 * v, 'sine', 65);
  burst(at, 0.08, 0.16 * v, 'lowpass', 600, 1);
  burst(at, 0.03, 0.06 * v, 'highpass', 4000, 1);
}

/** A party popper going off. */
export function playPop(at = 0, v = 1) {
  burst(at, 0.05, 0.32 * v, 'highpass', 1200, 0.7);
  tone(240, at, 0.11, 0.16 * v, 'sine', 60);
  for (let i = 0; i < 4; i++) burst(at + 0.04 + i * 0.03 + Math.random() * 0.02, 0.012, 0.05 * v, 'bandpass', 5000, 3);
}

/** Confetti twinkling down. */
export function playSparkle(at = 0, v = 1) {
  for (let i = 0; i < 5; i++) tone(2600 + Math.random() * 2200, at + i * 0.055, 0.18, 0.025 * v, 'sine');
}

/** A trophy catching the light: a rising glassy run. */
export function playShimmer(at = 0, v = 1) {
  [1568, 1976, 2349, 3136, 3951].forEach((f, i) => tone(f, at + i * 0.05, 0.4, 0.035 * v, 'sine'));
}

/** Dialling a phone: four quick touch-tone beeps. */
export function playDial(at = 0, v = 1) {
  const pairs = [[770, 1336], [852, 1209], [697, 1477], [941, 1336]];
  pairs.forEach(([lo, hi], i) => {
    tone(lo, at + i * 0.06, 0.045, 0.03 * v, 'sine');
    tone(hi, at + i * 0.06, 0.045, 0.03 * v, 'sine');
  });
}

/** A slide whistle falling: giving up. */
export function playSlide(at = 0, v = 1) {
  tone(1400, at, 0.7, 0.06 * v, 'sine', 260);
}

/** A cloth flag flapping. */
export function playFlap(at = 0, v = 1) {
  burst(at, 0.07, 0.08 * v, 'lowpass', 1300, 1);
  burst(at + 0.06, 0.05, 0.05 * v, 'lowpass', 1600, 1);
}
