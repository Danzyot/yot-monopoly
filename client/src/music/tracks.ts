// The built-in generative tracks: one per scene, each a looping piece written
// bar by bar on the audio clock. A piece is a bpm plus a `bar(L, when, n)`
// that schedules everything that happens in bar n, and optionally a `setup`
// that builds the persistent nodes it renders through. Each one is a few
// phrases of chords, bass, lead and drums with enough chance in the
// arrangement (which bars the lead plays, which fills land, which chord
// tones the arp picks) that the loop never quite repeats.
import {
  chance, chord, driveCurve, hit, keep, kick, midi, note, pick, rnd, snare, swing, type Layer,
} from './synth.ts';
import { noise } from '../sound.ts';

export interface Piece {
  id: string;
  name: string;
  /** What it is, for the picker. */
  blurb: string;
  bpm: number;
  setup?: (L: Layer) => void;
  bar: (L: Layer, when: number, bar: number) => void;
}

const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const MIN9 = [0, 3, 7, 10, 14];
const MAJ9 = [0, 4, 7, 11, 14];
const DOM9 = [0, 4, 10, 14];
const MIN = [0, 3, 7];
const MAJ = [0, 4, 7];
const SUS2 = [0, 2, 7];

// ---------------------------------------------------------------------------
// Study — the Classic lounge: slow jazz-lounge band, three progressions that
// take turns every eight bars. D minor 9 territory, 76 BPM, brushed drums.
// ---------------------------------------------------------------------------
const STUDY_SECTIONS = [
  { key: 50, roots: [0, 5, -2, 3], shapes: [MIN9, MIN7, MAJ7, MAJ9] },
  { key: 53, roots: [0, 9, 2, 7], shapes: [MAJ9, MIN7, MIN9, DOM9] },
  { key: 45, roots: [0, 8, 5, 7], shapes: [MIN9, MAJ7, MIN7, DOM9] },
];

const study: Piece = {
  id: 'study', name: 'Study', blurb: 'lounge jazz by the fire', bpm: 76,
  bar(L, when, bar) {
    const beat = 60 / this.bpm;
    const barLen = beat * 4;
    const sec = STUDY_SECTIONS[Math.floor(bar / 8) % STUDY_SECTIONS.length];
    const i = bar % sec.roots.length;
    const root = sec.key + sec.roots[i];
    const shape = sec.shapes[i % sec.shapes.length];

    // Pad: the chord held across the bar with a slow swell — the warm bed.
    chord(L, shape.map(iv => midi(root + iv)), when, barLen + 0.05, 0.035, {
      type: 'triangle', cutoff: 900, attack: barLen * 0.3, release: barLen * 0.25,
    });

    // Soft bass: root on 1, a chord tone or fifth on the "and" of 2.
    const bass = root - 12;
    note(L, midi(bass), when, beat * 1.6, 0.16, { cutoff: 500, attack: 0.02 });
    const next = chance(0.5) ? 7 : shape[1];
    note(L, midi(bass + next), when + beat * 2.5, beat * 1.2, 0.12, { cutoff: 500, attack: 0.02 });

    // Keys: a sparse, lazy line on chord tones an octave up — the part that
    // changes every time round, so the loop never feels like a loop.
    if (bar % 2 === 1 || chance(0.5)) {
      for (let s = 0; s < 8; s++) {
        if (!chance(0.28)) continue;
        const iv = pick(shape) + 12;
        note(L, midi(root + iv), when + (beat / 2) * s, beat * 1.3, 0.045, { cutoff: 2400, attack: 0.005 });
      }
    }

    // Brushes: soft kick on 1 (and a ghost later), swung hats, rim on 3.
    kick(L, when, 0.22);
    if (chance(0.5)) kick(L, when + beat * 2.5, 0.12);
    for (let s = 0; s < 8; s++) {
      hit(L, when + (beat / 2) * s + swing(s, beat, 0.16), 0.06, s % 2 === 0 ? 0.03 : 0.018, 'highpass', 6500);
    }
    hit(L, when + beat * 2, 0.09, 0.05, 'bandpass', 1900);
  },
};

// ---------------------------------------------------------------------------
// Poker Room — the Chog lounge: purple-night synth. F minor, 92 BPM with a
// lazy swing; lush detuned saw pads on minor 9ths, a plucky arp, a soft
// kick and hats, and now and then a glittering bell run across the top.
// ---------------------------------------------------------------------------
const POKER = {
  key: 53, // F
  prog: [
    { roots: [0, 8, 3, 5], shapes: [MIN9, MAJ9, MAJ7, MIN7] },   // Fm9 Dbmaj9 Abmaj7 Bbm7
    { roots: [0, 8, 10, 5], shapes: [MIN9, MAJ7, DOM9, MIN9] },  // Fm9 Dbmaj7 Eb9 Bbm9
  ],
};

const pokerRoom: Piece = {
  id: 'poker', name: 'Poker Room', blurb: 'purple-night synth', bpm: 92,
  bar(L, when, bar) {
    const beat = 60 / this.bpm;
    const barLen = beat * 4;
    const prog = POKER.prog[Math.floor(bar / 4) % 2];
    const i = bar % 4;
    const root = POKER.key + prog.roots[i];
    const shape = prog.shapes[i];
    const sw = 0.2;

    // Pad: a warm detuned pair per tone, opening slowly, closed down low.
    chord(L, shape.map(iv => midi(root + iv)), when, barLen + 0.1, 0.028, {
      type: 'sawtooth', cutoff: 620 + (bar % 8) * 30, q: 0.8, attack: beat * 0.9, release: beat * 0.6, spread: 7,
    });

    // Bass: a round sine with a little triangle for edge; root, then the
    // fifth or seventh under the back half.
    const bass = root - 24;
    note(L, midi(bass), when, beat * 1.9, 0.2, { type: 'sine', attack: 0.015 });
    note(L, midi(bass), when, beat * 1.9, 0.05, { type: 'triangle', cutoff: 300, attack: 0.015 });
    const back = pick([7, 10, 12]);
    note(L, midi(bass + back), when + beat * 2.5 + beat * sw * 0.5, beat * 1.3, 0.15, { type: 'sine', attack: 0.015 });

    // Arp: plucky eighths on the chord tones, up and down, swung; a few
    // steps drop out so the pattern breathes.
    const arpTones = [...shape, shape[1] + 12, shape[0] + 12];
    const dir = bar % 2 === 0 ? 1 : -1;
    for (let s = 0; s < 8; s++) {
      if (chance(0.18)) continue;
      const idx = dir > 0 ? s % arpTones.length : (arpTones.length - 1 - s) % arpTones.length;
      const t = when + (beat / 2) * s + swing(s, beat, sw);
      note(L, midi(root + 12 + arpTones[idx]), t, beat * 0.55, 0.05, { type: 'square', cutoff: 1800, q: 2, attack: 0.004 });
    }

    // Drums: soft kick on 1 and 3 (and a swung "and of 2" every other bar),
    // closed hats on the swung eighths, a hushed clap on 2 and 4.
    kick(L, when, 0.26, { from: 95, to: 42, dur: 0.3 });
    kick(L, when + beat * 2, 0.2, { from: 95, to: 42, dur: 0.3 });
    if (bar % 2 === 1 && chance(0.7)) kick(L, when + beat * 1.5 + beat * sw * 0.5, 0.13, { from: 95, to: 42, dur: 0.25 });
    for (let s = 0; s < 8; s++) {
      hit(L, when + (beat / 2) * s + swing(s, beat, sw), 0.05, s % 2 === 0 ? 0.022 : 0.014, 'highpass', 7500);
    }
    hit(L, when + beat, 0.1, 0.04, 'bandpass', 1400, { q: 1.2 });
    hit(L, when + beat * 3, 0.1, 0.04, 'bandpass', 1400, { q: 1.2 });
    if (bar % 8 === 7) hit(L, when + beat * 3.5, 0.3, 0.03, 'bandpass', 3000, { q: 0.6, sweepTo: 9000 });

    // Glitter: a rising bell run, two octaves up, on the last beat of a bar
    // every so often — the sparkle on the felt.
    if (bar % 4 === 3 && chance(0.6)) {
      const run = [...shape, shape[0] + 12, shape[1] + 12, shape[2] + 12].slice(0, 5 + Math.floor(rnd(0, 3)));
      run.forEach((iv, k) => {
        const t = when + beat * 2.5 + (beat / 4) * k;
        const f = midi(root + 24 + iv);
        note(L, f, t, beat * 1.6, 0.03, { type: 'sine', attack: 0.003 });
        note(L, f * 2.76, t, beat * 0.5, 0.008, { type: 'sine', attack: 0.003 });
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Ticker — Takeprofit TV: broadcast-bumper electronica. A minor, straight
// 118 BPM; a saw pad pumped by a side-chain on every beat, a confident
// eighth-note bass, a staccato lead motif, four-on-the-floor and bright hats.
// ---------------------------------------------------------------------------
const TICKER = {
  key: 57, // A
  roots: [0, 8, 3, 10],      // Am F C G
  shapes: [MIN7, MAJ7, MAJ, SUS2],
  // The hook: a two-bar staccato motif on scale degrees (A minor), as
  // [sixteenth-step, semitone-from-key, length-in-sixteenths].
  motif: [
    [0, 12, 1], [2, 12, 1], [4, 15, 1], [6, 12, 1], [8, 19, 2], [12, 17, 1], [14, 15, 1],
    [16, 12, 1], [18, 12, 1], [20, 10, 1], [22, 12, 1], [24, 7, 2], [28, 10, 1], [30, 12, 1],
  ] as [number, number, number][],
  bassPatterns: [
    [0, 0, 0, 7, 0, 0, 12, 0],
    [0, 0, 7, 0, 0, 12, 0, 7],
    [0, 12, 0, 0, 7, 0, 0, 0],
  ],
};

const ticker: Piece = {
  id: 'ticker', name: 'Ticker', blurb: 'newsroom electronic', bpm: 118,
  bar(L, when, bar) {
    const beat = 60 / this.bpm;
    const barLen = beat * 4;
    const i = bar % 4;
    const root = TICKER.key + TICKER.roots[i];
    const shape = TICKER.shapes[i];
    const phrase = Math.floor(bar / 8) % 2; // alternating 8-bar sections

    // Side-chained pad: a detuned saw chord whose gain drops on every beat
    // and swells back — the pump that makes a bumper feel like it moves.
    const pumpTo = 0.03;
    chord(L, shape.map(iv => midi(root + iv)), when, barLen + 0.05, pumpTo, {
      type: 'sawtooth', cutoff: 1500 + (phrase ? 600 : 0), q: 0.5, attack: 0.01, spread: 9,
      env: g => {
        for (let b = 0; b < 4; b++) {
          const t = when + beat * b;
          g.setValueAtTime(pumpTo * 0.12, t);
          g.linearRampToValueAtTime(pumpTo, t + beat * 0.45);
        }
        g.setValueAtTime(pumpTo, when + barLen - 0.05);
        g.linearRampToValueAtTime(0.0001, when + barLen + 0.05);
      },
    });

    // Bass: driving eighths, square through a lowpass, pattern rotating.
    const bass = root - 24;
    const bp = TICKER.bassPatterns[(bar + Math.floor(bar / 4)) % TICKER.bassPatterns.length];
    for (let s = 0; s < 8; s++) {
      const iv = bp[s];
      note(L, midi(bass + iv), when + (beat / 2) * s, beat * 0.42, iv === 0 ? 0.17 : 0.13, { type: 'square', cutoff: 420, q: 1.5, attack: 0.004 });
      note(L, midi(bass + iv), when + (beat / 2) * s, beat * 0.42, 0.1, { type: 'sine', attack: 0.004 });
    }

    // Lead motif: the second half of each eight-bar section, with a quieter
    // echo one sixteenth later; the first time through it sits an octave down.
    if (bar % 8 >= 4) {
      const half = (bar % 8 - 4) % 2; // which bar of the two-bar motif
      const oct = phrase ? 12 : 0;
      for (const [step, semi, len] of TICKER.motif) {
        if (Math.floor(step / 16) !== half) continue;
        const t = when + (beat / 4) * (step % 16);
        const f = midi(TICKER.key + 12 + oct + semi);
        note(L, f, t, (beat / 4) * len * 0.85, 0.06, { type: 'square', cutoff: 2600, attack: 0.003 });
        note(L, f, t, (beat / 4) * len * 0.85, 0.035, { type: 'triangle', attack: 0.003 });
        note(L, f, t + beat / 4, (beat / 4) * 0.8, 0.018, { type: 'square', cutoff: 2000, attack: 0.003 });
      }
    } else if (bar % 8 === 3 && chance(0.7)) {
      // A pick-up: three rising stabs into the motif.
      [7, 10, 12].forEach((semi, k) => note(L, midi(TICKER.key + 12 + semi), when + beat * 3 + (beat / 4) * k, beat * 0.2, 0.05, { type: 'square', cutoff: 2600, attack: 0.003 }));
    }

    // Drums: kick on every beat, clap on 2 and 4, sixteenth hats with the
    // off-beats accented, an open hat on the "and" of 4 every other bar.
    for (let b = 0; b < 4; b++) kick(L, when + beat * b, 0.3, { from: 150, to: 48, dur: 0.22, click: 0.05 });
    for (const b of [1, 3]) {
      hit(L, when + beat * b, 0.12, 0.07, 'bandpass', 2200, { q: 0.9 });
      hit(L, when + beat * b + 0.012, 0.09, 0.04, 'bandpass', 2600, { q: 0.9 });
    }
    for (let s = 0; s < 16; s++) {
      const off = s % 4 === 2;
      hit(L, when + (beat / 4) * s, off ? 0.07 : 0.035, off ? 0.035 : s % 2 === 0 ? 0.02 : 0.012, 'highpass', 8500);
    }
    if (bar % 2 === 1) hit(L, when + beat * 3.5, 0.22, 0.03, 'highpass', 7000);
    // A riser into each new eight-bar section.
    if (bar % 8 === 7) hit(L, when, barLen, 0.02, 'bandpass', 500, { q: 1.5, sweepTo: 7000, attack: barLen * 0.6 });
  },
};

// ---------------------------------------------------------------------------
// Pit Lane — Speedway: driving rock. E minor at 140 BPM; sawtooth power
// chords through a waveshaper, a chugging bass, kick / snare / hats, and a
// short pentatonic hook that comes round every sixteen bars.
// ---------------------------------------------------------------------------
const PIT = {
  key: 40, // E2
  riffs: [
    [0, 0, 3, 5],   // E  E  G  A
    [0, 0, 7, 5],   // E  E  B  A
    [3, 3, 5, 0],   // G  G  A  E
    [0, 5, 3, -2],  // E  A  G  D
  ],
  // Chug pattern per bar, as eighth steps: 1 = short chug, 2 = long stab, 0 = rest.
  chugs: [
    [2, 1, 1, 1, 2, 1, 1, 1],
    [2, 1, 1, 2, 0, 1, 1, 1],
    [2, 0, 1, 1, 2, 0, 1, 1],
  ],
  // The hook: [eighth-step, semitone above key (E minor pentatonic), eighths long].
  hook: [
    [0, 12, 1], [1, 15, 1], [2, 17, 2], [4, 19, 1], [5, 17, 1], [6, 15, 2],
    [8, 12, 1], [9, 15, 1], [10, 17, 2], [12, 22, 1], [13, 19, 1], [14, 17, 2],
  ] as [number, number, number][],
};

const pitLane: Piece = {
  id: 'pitlane', name: 'Pit Lane', blurb: 'driving rock', bpm: 140,
  setup(L) {
    // The amp: everything with a guitar in it goes through this soft clipper
    // and a cabinet-ish lowpass, then into the layer.
    const shaper = keep(L, L.ac.createWaveShaper());
    shaper.curve = driveCurve(35);
    shaper.oversample = '2x';
    const cab = keep(L, L.ac.createBiquadFilter());
    cab.type = 'lowpass';
    cab.frequency.value = 3200;
    cab.Q.value = 0.7;
    const amp = keep(L, L.ac.createGain());
    amp.gain.value = 0.42;
    shaper.connect(cab).connect(amp).connect(L.out);
    L.send.amp = shaper;
  },
  bar(L, when, bar) {
    const beat = 60 / this.bpm;
    const barLen = beat * 4;
    const riff = PIT.riffs[Math.floor(bar / 4) % PIT.riffs.length];
    const root = PIT.key + riff[bar % 4];
    const amp = L.send.amp;
    const pattern = PIT.chugs[(bar + Math.floor(bar / 8)) % PIT.chugs.length];

    // Power chords (root, fifth, octave) through the amp: short palm-muted
    // chugs on the eighths, longer stabs where the pattern says so.
    for (let s = 0; s < 8; s++) {
      const kind = pattern[s];
      if (!kind) continue;
      const t = when + (beat / 2) * s;
      const dur = kind === 2 ? beat * 0.95 : beat * 0.28;
      chord(L, [root, root + 7, root + 12].map(midi), t, dur, kind === 2 ? 0.3 : 0.2, {
        type: 'sawtooth', cutoff: 5000, attack: 0.004, release: kind === 2 ? 0.1 : 0.05, spread: 6, into: amp,
      });
    }

    // Bass: chugging eighths an octave under the guitars, tight and dark.
    for (let s = 0; s < 8; s++) {
      const iv = s === 7 && chance(0.5) ? 7 : 0;
      note(L, midi(root - 12 + iv), when + (beat / 2) * s, beat * 0.4, 0.2, { type: 'sawtooth', cutoff: 320, q: 1.2, attack: 0.004 });
    }

    // Drums: kick on 1 and 3 and the "and" of 4, snare on 2 and 4, driving
    // eighth hats; a crash on the top of every eight bars and a snare fill
    // at the end of every section.
    kick(L, when, 0.34, { from: 160, to: 50, dur: 0.2, click: 0.06 });
    kick(L, when + beat * 2, 0.3, { from: 160, to: 50, dur: 0.2, click: 0.05 });
    kick(L, when + beat * 3.5, 0.26, { from: 160, to: 50, dur: 0.18, click: 0.04 });
    if (bar % 4 === 1 && chance(0.5)) kick(L, when + beat * 1.5, 0.22, { from: 160, to: 50, dur: 0.18 });
    snare(L, when + beat, 0.11, { tone: 200, bright: 1900 });
    snare(L, when + beat * 3, 0.11, { tone: 200, bright: 1900 });
    for (let s = 0; s < 8; s++) hit(L, when + (beat / 2) * s, 0.06, s % 2 === 0 ? 0.035 : 0.022, 'highpass', 7000);
    if (bar % 8 === 0) hit(L, when, 1.4, 0.05, 'highpass', 4500, { attack: 0.005 });
    if (bar % 8 === 7) {
      for (let s = 0; s < 4; s++) snare(L, when + beat * 3 + (beat / 4) * s, 0.06 + s * 0.015, { tone: 210, bright: 2000, dur: 0.1 });
    }

    // The hook: bars 8–11 of every sixteen, a bright lead over the riff.
    if (bar % 16 >= 8 && bar % 16 < 12) {
      const half = (bar % 16 - 8) % 2;
      for (const [step, semi, len] of PIT.hook) {
        if (Math.floor(step / 8) !== half) continue;
        const t = when + (beat / 2) * (step % 8);
        const f = midi(PIT.key + 24 + semi);
        note(L, f, t, (beat / 2) * len * 0.9, 0.11, { type: 'square', cutoff: 2800, q: 1, attack: 0.005, into: amp });
        note(L, f, t, (beat / 2) * len * 0.9, 0.06, { type: 'sawtooth', cutoff: 2200, attack: 0.005, detune: 8, into: amp });
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Rooftop — Metropolis: lo-fi hip-hop at 82 BPM. D major 7ths and 9ths on a
// detuned-triangle electric piano, a mellow sine bass, dusty drums (noise
// snare, soft kick, lazy hats), vinyl crackle, and a melody that only comes
// out every so often.
// ---------------------------------------------------------------------------
const ROOF = {
  key: 50, // D
  prog: [
    { roots: [0, -3, 2, 7], shapes: [MAJ7, MIN9, MIN7, DOM9] },  // Dmaj7 Bm9 Em7 A9
    { roots: [4, -3, 5, 7], shapes: [MIN7, MIN9, MAJ7, DOM9] },  // F#m7 Bm9 Gmaj7 A9
  ],
  phrase: [[0, 14], [1, 12], [2, 9], [4, 7], [6, 9], [7, 12]] as [number, number][],
};

const rooftop: Piece = {
  id: 'rooftop', name: 'Rooftop', blurb: 'lo-fi hip-hop', bpm: 82,
  setup(L) {
    // Vinyl: a constant dust hiss (the pops are scheduled per bar).
    const src = keep(L, L.ac.createBufferSource());
    const hp = keep(L, L.ac.createBiquadFilter());
    const g = keep(L, L.ac.createGain());
    src.buffer = noise(L.ac);
    src.loop = true;
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    g.gain.value = 0.006;
    src.connect(hp).connect(g).connect(L.out);
    src.start(0, Math.random() * 0.5);
  },
  bar(L, when, bar) {
    const beat = 60 / this.bpm;
    const barLen = beat * 4;
    const prog = ROOF.prog[Math.floor(bar / 8) % 2];
    const i = bar % 4;
    const root = ROOF.key + prog.roots[i];
    const shape = prog.shapes[i];
    const sw = 0.14;
    const lazy = 0.02; // the drummer sits a touch behind the beat

    // Electric piano: detuned triangle pairs through a soft lowpass, struck
    // on the 1 and again somewhere in the back half of the bar.
    const voicing = shape.map(iv => midi(root + 12 + iv));
    const strike = (t: number, vol: number) => chord(L, voicing, t, beat * 2.2, vol, {
      type: 'triangle', cutoff: 1700, attack: 0.012, release: beat * 1.4, spread: 6,
    });
    strike(when, 0.07);
    strike(when + beat * pick([2, 2.5, 3]) + beat * sw * 0.5, 0.05);

    // Bass: a mellow sine — root on 1, the fifth or seventh late in the bar.
    const bass = root - 12;
    note(L, midi(bass), when, beat * 1.8, 0.2, { type: 'sine', attack: 0.02 });
    note(L, midi(bass), when, beat * 1.8, 0.03, { type: 'triangle', cutoff: 350, attack: 0.02 });
    if (chance(0.85)) note(L, midi(bass + pick([7, 10, 5])), when + beat * 2.5, beat * 1.3, 0.15, { type: 'sine', attack: 0.02 });

    // Dusty drums: soft kick on 1 and the "and" of 2, noise snare on 2 and
    // 4 (a hair late), lazy swung hats, the odd ghost kick.
    kick(L, when, 0.26, { from: 90, to: 40, dur: 0.3 });
    kick(L, when + beat * 1.5 + beat * sw * 0.5, 0.17, { from: 90, to: 40, dur: 0.26 });
    if (chance(0.3)) kick(L, when + beat * 3.5, 0.1, { from: 90, to: 40, dur: 0.2 });
    for (const b of [1, 3]) {
      hit(L, when + beat * b + lazy, 0.14, 0.09, 'bandpass', 1500, { q: 0.8 });
      hit(L, when + beat * b + lazy, 0.05, 0.05, 'highpass', 4000);
    }
    for (let s = 0; s < 8; s++) {
      if (s % 2 === 1 && chance(0.2)) continue;
      hit(L, when + (beat / 2) * s + swing(s, beat, sw) + lazy, 0.05, s % 2 === 0 ? 0.02 : 0.013, 'bandpass', 5500, { q: 0.7 });
    }

    // Vinyl pops.
    const pops = 2 + Math.floor(rnd(0, 4));
    for (let p = 0; p < pops; p++) hit(L, when + rnd(0, barLen), 0.012, rnd(0.01, 0.03), 'bandpass', rnd(1800, 3200), { q: 2 });

    // The melody, when it comes: a pentatonic phrase on the piano an
    // octave up, once in a while at the top of an eight-bar turn.
    if (bar % 8 === 4 && chance(0.55)) {
      for (const [step, semi] of ROOF.phrase) {
        const t = when + (beat / 2) * step + swing(step, beat, sw);
        chord(L, [midi(root + 24 + semi)], t, beat * 1.4, 0.05, { type: 'triangle', cutoff: 2200, attack: 0.01, release: beat * 0.9, spread: 5 });
      }
    }
  },
};

export const PIECES: Piece[] = [study, pokerRoom, ticker, pitLane, rooftop];
export const pieceById = (id: string) => PIECES.find(p => p.id === id);
