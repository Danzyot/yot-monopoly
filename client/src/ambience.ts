// Ambient sound beds: a quiet room tone for each 3D scene, looping under the
// music and the effects. Like everything else in sound.ts and music.ts it is
// synthesised live — filtered noise, a few oscillators and LFOs — so there is
// nothing to download and a bed costs a handful of nodes.
//
// A bed renders into the effects bus (sfxOutput()), so the sound-effects
// volume and mute govern it too — effects are on by default, music is not, so
// the room is heard without anyone finding a switch. The hook below also stops
// the bed outright while effects are off, so a silent bed does not keep the
// CPU warm.
import { useEffect } from 'react';
import { getMap } from '../../shared/maps.ts';
import type { GameView } from '../../shared/types.ts';
import { audioContext, hasGestured, noise, onFirstGesture, onSfxChange, readPref, sfxOutput, sfxState, writePref } from './sound.ts';

export type AmbienceScene = 'classic' | 'chog' | 'tptv' | 'speedway' | 'skyline';

/** Bed level relative to the music bus (which already carries the music volume). */
const LEVEL = 0.22;
/** Fade in on start, out on stop; two beds overlap for this long on a scene change. */
const FADE_S = 1.5;

// ---- preference (the music panel's "Ambience" switch) ----
const K = { on: 'yot:ambience.on' };
let enabled = readPref(K.on) !== '0';
const prefListeners = new Set<(on: boolean) => void>();
export function ambienceEnabled(): boolean { return enabled; }
export function setAmbienceEnabled(on: boolean): void {
  enabled = on;
  writePref(K.on, on ? '1' : '0');
  prefListeners.forEach(f => f(on));
}
export function onAmbienceChange(fn: (on: boolean) => void): () => void {
  prefListeners.add(fn);
  return () => { prefListeners.delete(fn); };
}

// ---- bookkeeping (so a test can prove nothing leaks across scene changes) ----
const stats = { beds: 0, nodes: 0, created: 0 };
/** Live beds and nodes right now, and nodes ever built. */
export function ambienceStats(): { beds: number; nodes: number; created: number } { return { ...stats }; }

// ---- a bed: its nodes, timers and master gain ----
interface Bed {
  ac: AudioContext;
  out: GainNode;
  nodes: Set<AudioNode>;
  timers: Set<number>;
  stopped: boolean;
}

/** Register a node with the bed so teardown can find it and the count stays honest. */
function mk<T extends AudioNode>(bed: Bed, node: T): T {
  bed.nodes.add(node);
  stats.nodes += 1;
  stats.created += 1;
  return node;
}
function drop(bed: Bed, node: AudioNode) {
  if (!bed.nodes.delete(node)) return;
  stats.nodes -= 1;
  try { node.disconnect(); } catch { /* already gone */ }
}

/** A looping noise source through one filter into a gain: the basis of every room tone. */
function hiss(bed: Bed, type: BiquadFilterType, freq: number, q: number, vol: number, buffer = noise(bed.ac)) {
  const src = mk(bed, bed.ac.createBufferSource());
  const bq = mk(bed, bed.ac.createBiquadFilter());
  const g = mk(bed, bed.ac.createGain());
  src.buffer = buffer;
  src.loop = true;
  bq.type = type;
  bq.frequency.value = freq;
  bq.Q.value = q;
  g.gain.value = vol;
  src.connect(bq).connect(g).connect(bed.out);
  src.start(0, Math.random() * (buffer.duration - 0.1));
  return { src, bq, g };
}

/** A steady oscillator into a gain: hums and drones. */
function drone(bed: Bed, freq: number, type: OscillatorType, vol: number, cutoff?: number) {
  const osc = mk(bed, bed.ac.createOscillator());
  const g = mk(bed, bed.ac.createGain());
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = vol;
  if (cutoff) {
    const lp = mk(bed, bed.ac.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    osc.connect(lp).connect(g).connect(bed.out);
  } else osc.connect(g).connect(bed.out);
  osc.start();
  return g;
}

/** Slow sine wobble on a parameter (gain or filter frequency). */
function lfo(bed: Bed, rate: number, depth: number, target: AudioParam) {
  const osc = mk(bed, bed.ac.createOscillator());
  const g = mk(bed, bed.ac.createGain());
  osc.frequency.value = rate;
  osc.start(Math.random() * 3);
  g.gain.value = depth;
  osc.connect(g).connect(target);
}

/** The bed's current level, falling back to its resting level when the engine hands back a non-finite value mid-ramp. */
function gainNow(bed: Bed): number {
  const v = bed.out.gain.value;
  return Number.isFinite(v) ? v : LEVEL;
}

/** Run `fn` at random intervals between `min` and `max` seconds while the bed lives. */
function every(bed: Bed, min: number, max: number, fn: (now: number) => void) {
  const arm = () => {
    const id = window.setTimeout(() => {
      bed.timers.delete(id);
      if (bed.stopped) return;
      // Background tabs do not need their one-shots scheduled (the bus is
      // silent anyway); just keep the clock going.
      if (!document.hidden && bed.ac.state === 'running') fn(bed.ac.currentTime + 0.03);
      arm();
    }, (min + Math.random() * (max - min)) * 1000);
    bed.timers.add(id);
  };
  arm();
}

/** A source that plays once and frees itself: registered so a stop mid-flight still finds it. */
function oneShot(bed: Bed, src: AudioScheduledSourceNode, chain: AudioNode[], at: number, until: number) {
  const all = [src, ...chain];
  for (const n of all) mk(bed, n);
  src.onended = () => { for (const n of all) drop(bed, n); };
  if (src instanceof AudioBufferSourceNode) src.start(at, Math.random() * 0.5);
  else src.start(at);
  src.stop(until);
}

/** A short filtered-noise burst with an attack/decay envelope. */
function burst(
  bed: Bed, at: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1,
  sweepTo?: number, attack = 0.006,
) {
  const { ac } = bed;
  const src = ac.createBufferSource();
  const bq = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise(ac);
  src.loop = true;
  bq.type = type;
  bq.frequency.setValueAtTime(freq, at);
  if (sweepTo) bq.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  bq.Q.value = q;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + Math.min(attack, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bq).connect(g).connect(bed.out);
  oneShot(bed, src, [bq, g], at, at + dur + 0.03);
}

/** A short tone with an envelope and an optional pitch glide. */
function ping(
  bed: Bed, at: number, dur: number, vol: number, freq: number, type: OscillatorType = 'sine',
  glideTo?: number, attack = 0.01,
) {
  const { ac } = bed;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + Math.min(attack, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(bed.out);
  oneShot(bed, osc, [g], at, at + dur + 0.03);
}

/** Two seconds of brown noise (a random walk): the deep, soft hum of a city or wind. */
let brownBuf: AudioBuffer | null = null;
function brown(ac: AudioContext): AudioBuffer {
  if (!brownBuf || brownBuf.sampleRate !== ac.sampleRate) {
    brownBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  return brownBuf;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---- the five rooms ----

/** Classic lounge: a fire in the grate, a clock on the mantel, the odd log settling. */
function classic(bed: Bed) {
  // The fire's low rumble, breathing slowly.
  const rumble = hiss(bed, 'lowpass', 140, 0.7, 0.22);
  lfo(bed, 0.13, 0.07, rumble.g.gain);
  // Crackle: a scatter of tiny bright snaps, a few each second, never regular.
  every(bed, 0.5, 1.1, now => {
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      burst(bed, now + Math.random() * 0.9, rnd(0.015, 0.05), rnd(0.05, 0.2), 'bandpass', rnd(1800, 4500), 4);
    }
  });
  // A soft tick every second, kept on the audio clock so it never drifts.
  let next = bed.ac.currentTime + 0.5;
  every(bed, 0.9, 1.0, now => {
    while (next < now) next += 1;
    while (next < now + 1.2) {
      burst(bed, next, 0.014, 0.045, 'bandpass', 3200, 6);
      ping(bed, next, 0.025, 0.012, 2400, 'triangle', 1800, 0.002);
      next += 1;
    }
  });
  // Wood pops: a log shifting, a dull knock with a bit of air.
  every(bed, 4, 14, now => {
    burst(bed, now, 0.05, 0.3, 'lowpass', 420, 1.2);
    ping(bed, now, 0.07, 0.08, 190, 'sine', 90, 0.003);
  });
}

/** Chog lounge: a casino floor heard through a door — murmur, a bass hum, distant slots. */
function chog(bed: Bed) {
  const murmur = hiss(bed, 'bandpass', 520, 0.7, 0.13);
  lfo(bed, 0.07, 0.04, murmur.g.gain);
  lfo(bed, 0.19, 140, murmur.bq.frequency);
  const hum = drone(bed, 55, 'sine', 0.07);
  lfo(bed, 0.1, 0.02, hum.gain);
  drone(bed, 110, 'triangle', 0.015, 400);
  // Slot chimes: a quick bright pentatonic run, rare and far away.
  const notes = [1568, 2093, 2637, 3136, 3951];
  every(bed, 9, 26, now => {
    const n = 3 + Math.floor(Math.random() * 3);
    let f = Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      ping(bed, now + i * 0.085, 0.3, 0.035, notes[f], 'sine');
      // Mostly climbing, sometimes a step back; never off either end of the run.
      f = Math.max(0, Math.min(notes.length - 1, f + (Math.random() < 0.7 ? 1 : -1)));
    }
  });
}

/** Takeprofit TV studio: mains hum, air handling, a ticker, a camera now and then. */
function tptv(bed: Bed) {
  const hum = drone(bed, 60, 'sine', 0.045);
  lfo(bed, 0.23, 0.008, hum.gain);
  drone(bed, 120, 'sine', 0.012);
  const air = hiss(bed, 'highpass', 3600, 0.5, 0.022);
  lfo(bed, 0.05, 0.006, air.g.gain);
  // Ticker blip: two tiny clicks, like a quote landing on the crawl.
  every(bed, 2.5, 6, now => {
    ping(bed, now, 0.035, 0.035, 1800, 'sine', undefined, 0.003);
    ping(bed, now + 0.07, 0.03, 0.025, 2400, 'sine', undefined, 0.003);
  });
  // Camera shutter: a sharp click and the mirror's clack.
  every(bed, 25, 70, now => {
    burst(bed, now, 0.015, 0.12, 'highpass', 4000, 1);
    burst(bed, now + 0.06, 0.03, 0.1, 'bandpass', 2400, 2);
  });
}

/** Speedway: a crowd along the fence, engines passing on the straight, a flag in the wind. */
function speedway(bed: Bed) {
  const crowd = hiss(bed, 'bandpass', 900, 0.6, 0.1);
  lfo(bed, 0.09, 0.035, crowd.g.gain);
  lfo(bed, 0.17, 220, crowd.bq.frequency);
  // An engine approaches (pitch rising, louder), passes (pitch falls) and fades.
  every(bed, 8, 20, now => {
    const { ac } = bed;
    const dur = rnd(2.2, 3.4);
    const base = rnd(70, 110);
    const osc = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    osc.type = 'sawtooth';
    osc2.type = 'sawtooth';
    for (const o of [osc, osc2]) {
      const d = o === osc2 ? 1.06 : 1;
      o.frequency.setValueAtTime(base * d, now);
      o.frequency.linearRampToValueAtTime(base * 1.8 * d, now + dur * 0.45);
      o.frequency.exponentialRampToValueAtTime(base * 0.9 * d, now + dur * 0.6);
      o.frequency.linearRampToValueAtTime(base * 0.75 * d, now + dur);
    }
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260, now);
    lp.frequency.exponentialRampToValueAtTime(1300, now + dur * 0.5);
    lp.frequency.exponentialRampToValueAtTime(220, now + dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.11, now + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(g).connect(bed.out);
    oneShot(bed, osc, [lp, g], now, now + dur + 0.05);
    oneShot(bed, osc2, [], now, now + dur + 0.05);
  });
  // Flag flap: a few quick slaps of cloth.
  every(bed, 3, 9, now => {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      burst(bed, now + i * rnd(0.1, 0.16), 0.06, rnd(0.05, 0.09), 'bandpass', rnd(900, 1500), 1);
    }
  });
}

/** Metropolis rooftop: the city's hum, traffic swelling below, wind, a siren streets away. */
function skyline(bed: Bed) {
  const city = hiss(bed, 'lowpass', 300, 0.5, 0.2, brown(bed.ac));
  lfo(bed, 0.05, 0.05, city.g.gain);
  // Traffic swells: a soft band of noise rising and falling over a few seconds.
  every(bed, 6, 15, now => {
    const dur = rnd(2.5, 4);
    burst(bed, now, dur, 0.07, 'bandpass', 420, 1.4, 900, dur * 0.45);
  });
  // Wind gusts: a higher, airier sweep.
  every(bed, 5, 14, now => {
    const dur = rnd(2, 4);
    burst(bed, now, dur, 0.055, 'bandpass', 800, 0.6, 2400, dur * 0.4);
  });
  // A siren, far off, once in a long while: a slow two-note wail through a lowpass.
  every(bed, 90, 240, now => {
    const { ac } = bed;
    const osc = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    const cycles = 4 + Math.floor(Math.random() * 3);
    const period = 1.3;
    const dur = cycles * period;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, now);
    for (let i = 0; i < cycles; i++) {
      osc.frequency.linearRampToValueAtTime(900, now + i * period + period / 2);
      osc.frequency.linearRampToValueAtTime(620, now + (i + 1) * period);
    }
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.012, now + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, now + dur);
    osc.connect(lp).connect(g).connect(bed.out);
    oneShot(bed, osc, [lp, g], now, now + dur + 0.05);
  });
}

const BUILD: Record<AmbienceScene, (bed: Bed) => void> = { classic, chog, tptv, speedway, skyline };

// ---- start / stop ----

function build(scene: AmbienceScene): Bed | null {
  const ac = audioContext();
  const bus = sfxOutput();
  if (!ac || !bus) return null;
  const out = ac.createGain();
  const bed: Bed = { ac, out, nodes: new Set(), timers: new Set(), stopped: false };
  mk(bed, out);
  out.gain.setValueAtTime(0, ac.currentTime);
  out.gain.linearRampToValueAtTime(LEVEL, ac.currentTime + FADE_S);
  out.connect(bus);
  BUILD[scene](bed);
  stats.beds += 1;
  return bed;
}

function teardown(bed: Bed) {
  if (bed.stopped) return;
  bed.stopped = true;
  for (const id of bed.timers) clearTimeout(id);
  bed.timers.clear();
  const now = bed.ac.currentTime;
  bed.out.gain.cancelScheduledValues(now);
  bed.out.gain.setValueAtTime(gainNow(bed), now);
  bed.out.gain.linearRampToValueAtTime(0, now + FADE_S);
  // Let the fade run, then silence the sources and unhook everything.
  window.setTimeout(() => {
    for (const n of [...bed.nodes]) {
      try { if ('stop' in n) (n as AudioScheduledSourceNode).stop(); } catch { /* never started or already stopped */ }
      drop(bed, n);
    }
    stats.beds -= 1;
  }, FADE_S * 1000 + 100);
}

/**
 * Start the bed for a scene; the returned function fades it out and frees its
 * nodes. Before the player's first click nothing is built: the bed waits for
 * the gesture, and a stop in the meantime simply cancels it. While the tab is
 * hidden the bed fades to silence and its one-shots pause.
 */
export function startAmbience(scene: AmbienceScene): () => void {
  let bed: Bed | null = null;
  let cancelled = false;
  const onVisibility = () => {
    if (!bed || bed.stopped) return;
    const now = bed.ac.currentTime;
    bed.out.gain.cancelScheduledValues(now);
    bed.out.gain.setValueAtTime(gainNow(bed), now);
    bed.out.gain.linearRampToValueAtTime(document.hidden ? 0 : LEVEL, now + (document.hidden ? 0.4 : FADE_S));
  };
  const go = () => {
    if (cancelled) return;
    bed = build(scene);
    if (!bed) return;
    document.addEventListener('visibilitychange', onVisibility);
    if (document.hidden) onVisibility();
  };
  if (hasGestured() && audioContext()) go();
  else onFirstGesture(go);
  return () => {
    cancelled = true;
    document.removeEventListener('visibilitychange', onVisibility);
    if (bed) teardown(bed);
    bed = null;
  };
}

// ---- which room is this game in? ----

/** The lounge belongs to whichever edition is playing; the other maps have their own rooms. */
export function sceneFor(game: Pick<GameView, 'mapId' | 'themeId'>): AmbienceScene {
  const env = getMap(game.mapId).environment;
  if (env === 'speedway') return 'speedway';
  if (env === 'skyline') return 'skyline';
  if (game.themeId === 'chog') return 'chog';
  if (game.themeId === 'tptv') return 'tptv';
  return 'classic';
}

/**
 * Keep the right bed running for the game on screen. It follows the music
 * entirely: while the effects are muted or at zero the bed is torn down,
 * and when the scene changes the old bed fades out under the new one.
 */
export function useAmbience(game: Pick<GameView, 'mapId' | 'themeId'> | null): void {
  const scene = game ? sceneFor(game) : null;
  useEffect(() => {
    if (!scene) return;
    let stop: (() => void) | null = null;
    const sync = () => {
      const fx = sfxState();
      const want = enabled && !fx.muted && fx.volume > 0;
      if (want && !stop) stop = startAmbience(scene);
      else if (!want && stop) { stop(); stop = null; }
    };
    sync();
    const offSfx = onSfxChange(sync);
    const offPref = onAmbienceChange(sync);
    return () => { offSfx(); offPref(); stop?.(); };
  }, [scene]);
}

// Like the renderer's __yotGl: with ?perf in the URL the bed can be driven and
// counted from the console (and from the e2e check).
if (typeof window !== 'undefined' && location.search.includes('perf')) {
  Object.assign(window, {
    __yotAmbience: { start: startAmbience, enable: setAmbienceEnabled, stats: ambienceStats, context: audioContext },
  });
}
