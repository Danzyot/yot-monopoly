// Table audio: every sound is synthesized in WebAudio — no downloads, no
// licensing, nothing to 404. Two independent switches: sound effects (cards,
// chips, alerts) and background music (a slow ambient bed for the lobby and
// a quieter one at the table).
const MUTE_KEY = 'chog.muted';
const MUSIC_KEY = 'chog.music';

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.9;
      sfxBus.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.value = 0;
      musicBus.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Browsers keep an AudioContext suspended until the user interacts with the
// page, so the very first turn alert — the one a new player most needs — is
// otherwise silently dropped. Arm once on the first gesture anywhere.
export function primeAudio() {
  const ac = audio();
  if (ac && ac.state === 'suspended') void ac.resume();
}

let primed = false;
export function armAudioOnFirstGesture() {
  if (primed) return;
  primed = true;
  let started = false;
  // These listeners stay attached for the life of the page. iOS suspends
  // (or "interrupts") the audio engine every time the player switches apps
  // or locks the screen; a one-shot unlock would leave every later sound —
  // including the turn alert — permanently silent. Any tap or keypress
  // re-wakes the engine.
  const wake = () => {
    primeAudio();
    if (!started) {
      started = true;
      // Music the player already opted into should come back with them.
      if (isMusicOn()) void import('./music').then(m => m.startMusic());
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(ev, wake, { passive: true });
  }
  // Returning to the tab: revive the engine and let the music engine put
  // itself back together (its clock froze while suspended).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    primeAudio();
    void import('./music').then(m => m.resumeAfterReturn());
  });
}

export function isMuted(): boolean {
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(muted: boolean) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

export function isMusicOn(): boolean {
  return localStorage.getItem(MUSIC_KEY) === '1';
}

// The music engine shares this context and its own output bus, so a single
// mute/volume path covers everything the page plays.
export function audioContext(): AudioContext | null { return audio(); }
export function musicOutput(): GainNode | null { audio(); return musicBus; }

// ---- building blocks ----

// One shared buffer of white noise, reused for every card/chip texture.
function noise(): AudioBuffer | null {
  const ac = audio();
  if (!ac) return null;
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function tone(
  freq: number, startIn: number, duration: number,
  volume = 0.12, type: OscillatorType = 'sine', glideTo?: number,
) {
  const ac = audio();
  if (!ac || !sfxBus) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime + startIn;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + duration);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(sfxBus);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// Filtered noise burst — the basis of card slides, chip clicks and knocks.
function burst(
  startIn: number, duration: number, volume: number,
  filter: BiquadFilterType, freq: number, q = 1, sweepTo?: number,
) {
  const ac = audio();
  const buf = noise();
  if (!ac || !buf || !sfxBus) return;
  const src = ac.createBufferSource();
  const bq = ac.createBiquadFilter();
  const gain = ac.createGain();
  const t0 = ac.currentTime + startIn;
  src.buffer = buf;
  src.loop = true;
  bq.type = filter;
  bq.frequency.setValueAtTime(freq, t0);
  if (sweepTo) bq.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
  bq.Q.value = q;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + Math.min(0.012, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(bq).connect(gain).connect(sfxBus);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

const off = () => isMuted();

// Game sounds note when they fire so the UI click tick can stay out of the
// way — a click never plays on top of (or right after) a real effect.
let lastGameSfxAt = 0;
const mark = () => { lastGameSfxAt = Date.now(); };

// ---- UI click sounds ----

// A tiny felt-soft tick for buttons and controls across the site. Quiet and
// ~30ms long, so even when a click triggers a real sound moments later
// (fold, chips, deal) the tick has already finished — nothing overlaps.
function playUiClick() {
  if (off()) return;
  if (Date.now() - lastGameSfxAt < 150) return; // a real sound owns this beat
  burst(0, 0.028, 0.06, 'bandpass', 2600, 3);
  tone(1500, 0, 0.025, 0.025, 'sine');
}

// One capture-phase listener covers every current and future control on the
// site — no per-component wiring. Typing fields and sliders stay silent.
let clicksArmed = false;
export function armUiClickSounds() {
  if (clicksArmed) return;
  clicksArmed = true;
  document.addEventListener('pointerdown', e => {
    const target = e.target as Element | null;
    const el = target?.closest?.(
      'button, [role="button"], a[href], select, summary, input[type="checkbox"], input[type="radio"], label.check-row',
    );
    if (!el) return;
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
    playUiClick();
  }, { capture: true, passive: true });
}

// ---- table sound effects ----

// A card sliding across felt: a short, soft noise sweep.
export function playCardSlide(index = 0) {
  if (off()) return;
  mark();
  const at = index * 0.075;
  burst(at, 0.13, 0.09, 'bandpass', 2600, 0.8, 1200);
  tone(180, at, 0.05, 0.02, 'triangle');
}

// Dealing a street: two or three cards in quick succession.
export function playDeal(cards = 1) {
  if (off()) return;
  for (let i = 0; i < Math.max(1, cards); i++) playCardSlide(i);
}

// A single chip landing — used for calls and bets.
export function playChip(index = 0) {
  if (off()) return;
  mark();
  const at = index * 0.055;
  burst(at, 0.05, 0.12, 'bandpass', 3400 + Math.random() * 600, 6);
  tone(2100 + Math.random() * 300, at, 0.04, 0.05, 'square');
}

// A stack of chips pushed in — bets, raises, pot collection.
export function playChips(count = 4) {
  if (off()) return;
  for (let i = 0; i < count; i++) playChip(i);
}

// Knuckles on the table: check.
export function playCheck() {
  if (off()) return;
  mark();
  burst(0, 0.08, 0.16, 'lowpass', 320, 1.2);
  tone(130, 0, 0.09, 0.06, 'sine');
}

// Cards mucked: a soft swish.
export function playFold() {
  if (off()) return;
  mark();
  burst(0, 0.2, 0.07, 'bandpass', 1500, 0.7, 500);
}

// All-in: a rising surge, the loudest moment at the table.
export function playAllIn() {
  if (off()) return;
  mark();
  tone(220, 0, 0.5, 0.1, 'sawtooth', 660);
  playChips(7);
}

// It's your turn — a friendly two-note chime.
export function playTurnAlert() {
  if (off()) return;
  mark();
  tone(660, 0, 0.14, 0.13);
  tone(880, 0.13, 0.2, 0.13);
}

// Final seconds ticking away.
export function playTick() {
  if (off()) return;
  mark();
  tone(1200, 0, 0.03, 0.05, 'square');
}

// You won the pot — arpeggio with a shimmer of chips.
export function playWin() {
  if (off()) return;
  mark();
  tone(523, 0, 0.14, 0.1);
  tone(659, 0.1, 0.14, 0.1);
  tone(784, 0.2, 0.16, 0.11);
  tone(1046, 0.3, 0.4, 0.12);
  playChips(6);
}

// Someone else took it down — quieter, no fanfare.
export function playPotAway() {
  if (off()) return;
  playChips(4);
}

// Tournament finished / you placed.
export function playFanfare() {
  if (off()) return;
  mark();
  const notes = [523, 659, 784, 1046, 1318];
  notes.forEach((f, i) => tone(f, i * 0.11, 0.5, 0.11, 'triangle'));
}

// Knocked out.
export function playBust() {
  if (off()) return;
  mark();
  tone(400, 0, 0.5, 0.1, 'sine', 120);
}

// Music lives in music.ts — a multi-vibe generative engine that shares this
// module's AudioContext and music bus.
