// Shared instruments for the built-in generative tracks (music/tracks.ts).
//
// A track renders into a Layer: its own gain into the music bus (so two
// layers can cross-fade), a register of every node it has built (so a stop
// finds them all and a test can prove nothing leaks) and a few persistent
// nodes — a distortion stage, a crackle loop — that live as long as it does.
// Everything else is one-shot: an oscillator or noise burst with its own
// envelope, started on the audio clock and freed when it ends. A bar costs a
// few dozen short-lived nodes; only a handful are alive at any moment.
import { noise } from '../sound.ts';

export interface Layer {
  ac: AudioContext;
  /** The layer's master gain, into the music bus. */
  out: GainNode;
  /** Where instruments render: `out`, or a persistent effect chain before it. */
  nodes: Set<AudioNode>;
  persistent: AudioNode[];
  stopped: boolean;
  /** Optional per-track persistent sends (built in the track's `setup`). */
  send: Record<string, AudioNode>;
}

export const stats = { layers: 0, nodes: 0, created: 0, bars: 0 };

export function mk<T extends AudioNode>(L: Layer, node: T): T {
  L.nodes.add(node);
  stats.nodes += 1;
  stats.created += 1;
  return node;
}
export function drop(L: Layer, node: AudioNode) {
  if (!L.nodes.delete(node)) return;
  stats.nodes -= 1;
  try { node.disconnect(); } catch { /* already gone */ }
}

export const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
export const chance = (p: number) => Math.random() < p;
export const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Start a one-shot source with its chain; everything is freed when it ends. */
export function voice(L: Layer, src: AudioScheduledSourceNode, chain: AudioNode[], at: number, until: number, offset?: number) {
  if (L.stopped) return;
  const all = [src, ...chain];
  for (const n of all) mk(L, n);
  src.onended = () => { for (const n of all) drop(L, n); };
  if (src instanceof AudioBufferSourceNode) src.start(at, offset ?? Math.random() * 0.5);
  else src.start(at);
  src.stop(until);
}

export interface NoteOpts {
  type?: OscillatorType;
  /** Lowpass cutoff (Hz); omit for none. */
  cutoff?: number;
  q?: number;
  attack?: number;
  /** Hold at full level for this long before the decay (plucks: 0). */
  hold?: number;
  detune?: number;
  /** Pitch glide target (Hz) over the note. */
  glideTo?: number;
  /** Render into this node instead of the layer output (e.g. a distortion send). */
  into?: AudioNode;
}

/** One oscillator note with an attack / hold / exponential-decay envelope. */
export function note(L: Layer, freq: number, at: number, dur: number, vol: number, o: NoteOpts = {}) {
  const { ac } = L;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, at);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, at + dur);
  if (o.detune) osc.detune.value = o.detune;
  const attack = o.attack ?? 0.01;
  const hold = o.hold ?? 0;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  if (hold > 0) g.gain.setValueAtTime(vol, at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  const chain: AudioNode[] = [g];
  if (o.cutoff) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.cutoff;
    if (o.q) lp.Q.value = o.q;
    osc.connect(lp).connect(g);
    chain.push(lp);
  } else osc.connect(g);
  g.connect(o.into ?? L.out);
  voice(L, osc, chain, at, at + dur + 0.05);
}

/**
 * A chord: several oscillators (optionally a detuned pair per tone) through
 * one filter and one gain, so a five-note pad is seven nodes, not fifteen.
 * Returns the gain so the caller can shape it further (side-chain pumps).
 */
export function chord(
  L: Layer, freqs: number[], at: number, dur: number, vol: number,
  o: { type?: OscillatorType; cutoff?: number; q?: number; attack?: number; release?: number; spread?: number; into?: AudioNode; env?: (g: AudioParam) => void },
): GainNode | null {
  if (L.stopped) return null;
  const { ac } = L;
  const g = mk(L, ac.createGain());
  const lp = mk(L, ac.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? 1200;
  if (o.q) lp.Q.value = o.q;
  lp.connect(g).connect(o.into ?? L.out);
  const attack = o.attack ?? 0.02;
  const release = o.release ?? 0.1;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  if (o.env) o.env(g.gain);
  else {
    g.gain.setValueAtTime(vol, at + dur - release);
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
  }
  const oscs: OscillatorNode[] = [];
  for (const f of freqs) {
    const copies = o.spread ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      const osc = mk(L, ac.createOscillator());
      osc.type = o.type ?? 'triangle';
      osc.frequency.value = f;
      osc.detune.value = o.spread ? (c === 0 ? -o.spread : o.spread) + rnd(-3, 3) : rnd(-4, 4);
      osc.connect(lp);
      osc.start(at);
      osc.stop(at + dur + 0.05);
      oscs.push(osc);
    }
  }
  // Free the whole bundle when the last oscillator ends.
  const last = oscs[oscs.length - 1];
  if (last) last.onended = () => { for (const n of [...oscs, lp, g]) drop(L, n); };
  else { drop(L, lp); drop(L, g); }
  return g;
}

/** A filtered noise burst: hats, snares, claps, shakers, crackle pops. */
export function hit(
  L: Layer, at: number, dur: number, vol: number, type: BiquadFilterType, freq: number,
  o: { q?: number; sweepTo?: number; attack?: number; into?: AudioNode } = {},
) {
  const { ac } = L;
  const src = ac.createBufferSource();
  const bq = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise(ac);
  src.loop = true;
  bq.type = type;
  bq.frequency.setValueAtTime(freq, at);
  if (o.sweepTo) bq.frequency.exponentialRampToValueAtTime(o.sweepTo, at + dur);
  if (o.q) bq.Q.value = o.q;
  const attack = o.attack ?? 0.003;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bq).connect(g).connect(o.into ?? L.out);
  voice(L, src, [bq, g], at, at + dur + 0.02);
}

/** A kick drum: a sine dropping in pitch, with a short click on top for the hard ones. */
export function kick(L: Layer, at: number, vol: number, o: { from?: number; to?: number; dur?: number; click?: number } = {}) {
  const { ac } = L;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const dur = o.dur ?? 0.25;
  osc.frequency.setValueAtTime(o.from ?? 110, at);
  osc.frequency.exponentialRampToValueAtTime(o.to ?? 45, at + dur * 0.55);
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(L.out);
  voice(L, osc, [g], at, at + dur + 0.05);
  if (o.click) hit(L, at, 0.02, o.click, 'highpass', 2500);
}

/** A snare: a noise body plus a short tonal knock. */
export function snare(L: Layer, at: number, vol: number, o: { tone?: number; bright?: number; dur?: number } = {}) {
  const dur = o.dur ?? 0.16;
  hit(L, at, dur, vol, 'bandpass', o.bright ?? 1800, { q: 0.7 });
  hit(L, at, dur * 0.6, vol * 0.5, 'highpass', 5000);
  note(L, o.tone ?? 190, at, 0.09, vol * 0.6, { type: 'triangle', glideTo: (o.tone ?? 190) * 0.6 });
}

/** A soft-clipping curve for the waveshaper (guitar-amp style). */
export function driveCurve(k = 40): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

/** Register a persistent node: alive until the layer is torn down. */
export function keep<T extends AudioNode>(L: Layer, node: T): T {
  mk(L, node);
  L.persistent.push(node);
  return node;
}

/** The common swing offset: delay odd eighths by a fraction of a beat. */
export const swing = (step: number, beat: number, amount: number) => (step % 2 === 1 ? beat * amount : 0);
