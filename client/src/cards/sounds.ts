// Chog Cards sound effects, synthesized in WebAudio like every Monopoly effect
// (../sound.ts): nothing to download, nothing to license. They render into
// the shared effects bus, so the Sounds switch and volume govern them too.
// Each takes `at`, a delay in seconds, so the table can line a sound up with
// the moment a card lands, and `v`, a volume scale (another player's plays
// are a little quieter than your own).

import { noise, sfxOutput, sfxState } from '../sound.ts';

/** Ready to play? Muted or locked audio skips building any nodes. */
function sfx(): { ac: AudioContext; out: GainNode } | null {
  const s = sfxState();
  if (s.muted || s.volume === 0) return null;
  const out = sfxOutput();
  const ac = out?.context as AudioContext | undefined;
  if (!out || !ac || ac.state !== 'running') return null;
  return { ac, out };
}

function tone(freq: number, at: number, dur: number, vol = 0.12, type: OscillatorType = 'sine', glideTo?: number) {
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

/** Filtered noise burst: card edges, slaps and clicks. */
function burst(at: number, dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, sweepTo?: number) {
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

/** Noise swelling up and away through a moving band: a card through the air. */
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
  bq.Q.value = 1.3;
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

/** A card slapped down on the pile: a padded thump with a papery snap on top. */
export function playCardSlap(at = 0, v = 1) {
  burst(at, 0.03, 0.14 * v, 'highpass', jit(3200, 0.2), 0.8);
  burst(at + 0.004, 0.07, 0.2 * v, 'lowpass', jit(900, 0.15), 1);
  tone(jit(170, 0.1), at + 0.004, 0.08, 0.14 * v, 'sine', 70);
}

/** A card flicked off the pile and through the air. */
export function playCardWhoosh(at = 0, v = 1, dur = 0.3) {
  burst(at, 0.025, 0.08 * v, 'bandpass', jit(2800, 0.2), 2);
  swoosh(at, dur, 0.11 * v, jit(500), jit(2600));
}

/** A card turned over: a papery flick. */
export function playCardFlip(at = 0, v = 1) {
  burst(at, 0.09, 0.12 * v, 'bandpass', 3000, 1.2, 1300);
  burst(at + 0.07, 0.05, 0.06 * v, 'bandpass', 1800, 2);
}

/** A thumb riffling the deck: a run of card edges, quickening then slowing. `n` cards. */
export function playRiffle(at = 0, v = 1, n = 14) {
  let t = at;
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1);
    burst(t, 0.016, 0.06 * v * (0.7 + 0.3 * Math.sin(Math.PI * k)), 'bandpass', 2200 + Math.random() * 1400, 1.6);
    t += 0.022 + 0.03 * Math.abs(k - 0.5);
  }
}

/** The deal: a shuffle, then a card for everyone (one tick per card). */
export function playDeal(at = 0, cards = 28, over = 1.2) {
  playRiffle(at, 0.9, 16);
  const gap = Math.max(0.025, (over - 0.45) / Math.max(1, cards));
  for (let i = 0; i < Math.min(cards, 40); i++) {
    burst(at + 0.45 + i * gap, 0.02, 0.07, 'bandpass', jit(2600, 0.2), 2);
  }
}

/** Skipped: a flat two-note "nope". */
export function playSkip(at = 0, v = 1) {
  tone(392, at, 0.12, 0.09 * v, 'square', 370);
  tone(294, at + 0.13, 0.26, 0.1 * v, 'square', 262);
  burst(at, 0.04, 0.05 * v, 'bandpass', 1800, 2);
}

/** Reverse: a whoosh that swings down and back up, like something turning round. */
export function playReverse(at = 0, v = 1) {
  swoosh(at, 0.3, 0.14 * v, 2600, 420);
  swoosh(at + 0.26, 0.34, 0.14 * v, 420, 2800);
  tone(330, at + 0.1, 0.4, 0.04 * v, 'triangle', 660);
}

/** A Wild named its colour: a sparkle climbing, with a shimmer on top. */
export function playWild(at = 0, v = 1) {
  [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, at + i * 0.06, 0.28, 0.07 * v, 'triangle'));
  for (let i = 0; i < 6; i++) tone(2400 + Math.random() * 2600, at + 0.18 + i * 0.05, 0.2, 0.025 * v, 'sine');
}

/** Draw Two / Draw Four: a sting, then each penalty card snapping off the pile is played by the flights. */
export function playPenalty(at = 0, v = 1) {
  tone(220, at, 0.2, 0.1 * v, 'sawtooth', 165);
  tone(330, at, 0.2, 0.05 * v, 'square', 247);
  burst(at, 0.06, 0.1 * v, 'lowpass', 700, 1);
}

/** "Last card!": a bright rising sting with a tambourine hit. */
export function playLastCard(at = 0, v = 1) {
  [784, 988, 1175].forEach((f, i) => tone(f, at + i * 0.07, 0.14, 0.09 * v, 'triangle'));
  tone(1568, at + 0.21, 0.5, 0.1 * v, 'triangle');
  burst(at + 0.21, 0.12, 0.08 * v, 'highpass', 5000, 0.7);
  for (let i = 0; i < 3; i++) burst(at + 0.26 + i * 0.045, 0.02, 0.04 * v, 'bandpass', 7000, 3);
}

/** Caught without calling: a harsh buzzer. */
export function playCatch(at = 0, v = 1) {
  tone(130, at, 0.45, 0.13 * v, 'square', 110);
  tone(196, at, 0.45, 0.07 * v, 'sawtooth', 160);
  tone(98, at, 0.45, 0.06 * v, 'sawtooth', 82);
}

/** A challenge called: a dramatic low hit and a rising "ooh". */
export function playChallenge(at = 0, v = 1) {
  tone(110, at, 0.5, 0.16 * v, 'sine', 55);
  burst(at, 0.3, 0.16 * v, 'lowpass', 400, 1);
  tone(440, at + 0.3, 0.5, 0.05 * v, 'triangle', 660);
}

/** The round is won: a short fanfare. */
export function playRoundWin(at = 0, v = 1) {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, at + i * 0.1, i === 3 ? 0.7 : 0.18, 0.1 * v, 'triangle'));
  tone(262, at + 0.3, 0.9, 0.06 * v, 'sine');
}

/** The match is won: the full fanfare with a sparkle, then a chord that rings. */
export function playMatchWin(at = 0, v = 1) {
  const notes = [523, 659, 784, 1046, 784, 1046];
  const times = [0, 0.12, 0.24, 0.36, 0.56, 0.68];
  notes.forEach((f, i) => tone(f, at + times[i], i === notes.length - 1 ? 1.2 : 0.2, 0.1 * v, 'triangle'));
  [262, 330, 392].forEach(f => tone(f, at + 0.68, 1.4, 0.05 * v, 'sine'));
  for (let i = 0; i < 8; i++) tone(2600 + Math.random() * 2200, at + 0.8 + i * 0.07, 0.25, 0.03 * v, 'sine');
}

/** Hands swapped or passed round: a double whoosh. */
export function playSwap(at = 0, v = 1) {
  swoosh(at, 0.32, 0.12 * v, 600, 2400);
  swoosh(at + 0.18, 0.32, 0.12 * v, 2400, 600);
}

/** A thrown-away turn (pass, time's up): a soft tick. */
export function playSoft(at = 0, v = 1) {
  tone(660, at, 0.08, 0.05 * v, 'sine', 520);
}
