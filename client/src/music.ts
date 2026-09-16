// Background music engine: every vibe is a playlist of named songs, any song
// is searchable and playable directly, and a "play next" queue jumps the line.
//
// Two kinds of track share one player.
//
// The built-in vibes are synthesized live — nothing to download, nothing to
// license, and no two sittings sound identical, because each track is a seeded
// arrangement (chords, bass, arpeggio, drums) rather than a recording. This
// fork had stripped them out on the reasoning that a room should play its own
// music; the catalogue is back because "its own music" and "silence until
// somebody uploads something" turned out to be the same thing in practice.
//
// Uploaded tracks come from the dashboard (Music → upload), which stores the
// files on the persistent volume and publishes /music/manifest.json. A
// manifest playlist whose name matches a built-in vibe REPLACES that vibe's
// generated songs, so uploading a set called "LARP" quietly takes the synth's
// place rather than sitting beside it. Anything else is added as its own vibe.
//
// Files committed to client/public/music/ with a manifest beside them work the
// same way, for a deployment that would rather ship its music than upload it.
import { audioContext, musicOutput } from './sound';

export type RepeatMode = 'off' | 'one' | 'all';

export interface Track {
  id: string;
  name: string;
  bpm: number;
  /** Chord roots as semitone offsets from the vibe's key. */
  progression: number[];
  /** Chord shape per degree — minor 7th, major 9th, etc. */
  chord: number[];
  drums: 'none' | 'soft' | 'driving';
  arp: boolean;
  bass: boolean;
  /** File-backed track (a "Your tracks" entry) plays instead of synthesis. */
  url?: string;
}

export interface Vibe {
  id: string;
  name: string;
  blurb: string;
  key: number; // base MIDI note
  tracks: Track[];
}

const MIN7 = [0, 3, 7, 10];
const MAJ7 = [0, 4, 7, 11];
const MAJ9 = [0, 4, 7, 14];
const MIN9 = [0, 3, 10, 14];
const SUS = [0, 5, 7, 12];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Deterministic per-track randomness: the same track always arranges the same
// way, so "repeat one" really repeats the same piece.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const VIBES: Vibe[] = [
  {
    id: 'larp',
    name: 'LARP',
    blurb: 'Tavern lutes and questing drums. Roll for initiative, then shove.',
    key: 52, // E — dorian-leaning progressions for that medieval modal color
    tracks: [
      { id: 'larp-1', name: 'Tavern Stakes', bpm: 84, progression: [0, -2, 3, -2], chord: MIN7, drums: 'soft', arp: true, bass: true },
      { id: 'larp-2', name: "Bard's Bluff", bpm: 92, progression: [0, 5, -2, 3], chord: SUS, drums: 'soft', arp: true, bass: true },
      { id: 'larp-3', name: "Dragon's Hoard", bpm: 76, progression: [0, -4, 3, 7], chord: MIN9, drums: 'driving', arp: true, bass: true },
      { id: 'larp-4', name: 'Quest for the Pot', bpm: 100, progression: [0, 3, -2, 5], chord: MIN7, drums: 'driving', arp: true, bass: true },
      { id: 'larp-5', name: 'Mead & Muck', bpm: 80, progression: [0, -2, -4, 3], chord: SUS, drums: 'soft', arp: true, bass: true },
      { id: 'larp-6', name: 'Castle Felt', bpm: 68, progression: [0, 7, 5, 3], chord: MIN9, drums: 'none', arp: true, bass: true },
      { id: 'larp-7', name: 'Goblin Gold', bpm: 96, progression: [0, 3, 5, -2], chord: MIN7, drums: 'driving', arp: true, bass: true },
      { id: 'larp-8', name: 'The Long March', bpm: 72, progression: [0, -5, -2, 3], chord: SUS, drums: 'soft', arp: false, bass: true },
    ],
  },
  {
    id: 'lofi',
    name: 'LoFi',
    blurb: 'Dusty beats and warm tape hiss. Study poker, not for it.',
    key: 50, // D
    tracks: [
      { id: 'lofi-1', name: 'Rainy Session', bpm: 72, progression: [0, -3, 5, 3], chord: MIN9, drums: 'soft', arp: false, bass: true },
      { id: 'lofi-2', name: 'Coffee & Chips', bpm: 68, progression: [0, 5, -2, 3], chord: MIN7, drums: 'soft', arp: true, bass: true },
      { id: 'lofi-3', name: 'Slow Roll', bpm: 76, progression: [0, 7, 5, 2], chord: MAJ9, drums: 'soft', arp: true, bass: true },
      { id: 'lofi-4', name: 'Window Seat', bpm: 64, progression: [0, -4, -2, 3], chord: MIN9, drums: 'none', arp: false, bass: true },
      { id: 'lofi-5', name: 'Dusty Felt', bpm: 70, progression: [0, 3, -2, 5], chord: MIN7, drums: 'soft', arp: false, bass: true },
      { id: 'lofi-6', name: 'Blinds at Dawn', bpm: 66, progression: [0, -5, 3, 2], chord: MAJ9, drums: 'none', arp: true, bass: true },
      { id: 'lofi-7', name: 'Tape Hiss Call', bpm: 74, progression: [0, 5, 7, 3], chord: MIN9, drums: 'soft', arp: true, bass: true },
      { id: 'lofi-8', name: 'Green Baize', bpm: 62, progression: [0, -3, -5, 2], chord: SUS, drums: 'soft', arp: false, bass: true },
    ],
  },
  {
    id: 'rockpop',
    name: 'Rock & Pop',
    blurb: 'Driving drums and big hooks. Play every hand like an encore.',
    key: 52, // E
    // No generated placeholders — this vibe plays only uploaded songs.
    tracks: [],
  },
  {
    id: 'hiphop',
    name: 'Hiphop & Rap',
    blurb: 'Boom-bap knock and heavy low end. Talk your chips up.',
    key: 46, // Bb
    // No generated placeholders — this vibe plays only uploaded songs.
    tracks: [],
  },
];

// ---- persisted preferences ----
const K = {
  on: 'chog.music',
  vibe: 'chog.music.vibe',
  vol: 'chog.music.vol',
  repeat: 'chog.music.repeat',
  shuffle: 'chog.music.shuffle',
};

const readNum = (key: string, dflt: number) => {
  // Read the absence before converting it. localStorage.getItem returns null
  // when nothing is stored, and Number(null) is 0 — finite, and >= 0 — so the
  // guard below passed, the fallback was unreachable, and every first-time
  // visitor got the player at zero volume: press play, hear nothing, conclude
  // the music is broken. The upper bound matters too, since volume is a 0..1
  // fraction and a stored 50 would deafen whoever loaded it.
  const raw = localStorage.getItem(key);
  if (raw === null || raw.trim() === '') return dflt;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : dflt;
};

export interface QueueItem {
  id: string;
  name: string;
  vibeName: string;
}

export interface MusicState {
  playing: boolean;
  vibeId: string;
  trackIndex: number;
  trackId: string;
  trackName: string;
  volume: number; // 0..1
  repeat: RepeatMode;
  shuffle: boolean;
  vibes: Vibe[];
  queue: QueueItem[];
}

let customVibes: Vibe[] = [];
let vibeId = localStorage.getItem(K.vibe) || 'lofi';
let trackIndex = 0;
let volume = readNum(K.vol, 0.5);
let repeat = (localStorage.getItem(K.repeat) as RepeatMode) || 'all';
let shuffle = localStorage.getItem(K.shuffle) === '1';
let playing = false;
// Player-queued track ids, played in order before the playlist resumes.
let queue: string[] = [];

const listeners = new Set<(s: MusicState) => void>();

// Custom playlists whose name matches a built-in vibe REPLACE that vibe's
// generated songs — name a manifest playlist "LARP" and your files become
// the LARP playlist. Anything else is added as its own vibe.
export function allVibes(): Vibe[] {
  const overrides = new Map(
    customVibes.map(v => [v.name.trim().toLowerCase(), v] as const),
  );
  const merged = VIBES.map(v => {
    const own = overrides.get(v.name.trim().toLowerCase());
    if (!own) return v;
    overrides.delete(v.name.trim().toLowerCase());
    return { ...v, tracks: own.tracks, blurb: 'Your playlist.' };
  });
  // An empty playlist is a slot waiting to be filled, not something to offer:
  // "Rock & Pop — 0 tracks" in the picker is a row that cannot play and reads
  // as a broken player. The two built-in slots that ship with no generated
  // songs stay invisible until an upload named after them arrives, at which
  // point they appear already full.
  return [...merged, ...customVibes.filter(v => overrides.has(v.name.trim().toLowerCase()))]
    .filter(v => v.tracks.length > 0);
}

function vibe(): Vibe {
  return allVibes().find(v => v.id === vibeId) ?? VIBES[0];
}

function currentTrack(): Track {
  const v = vibe();
  return v.tracks[Math.min(trackIndex, v.tracks.length - 1)];
}

// Locate any track across every vibe (including "Your tracks") by id.
export function findTrack(id: string): { vibe: Vibe; index: number } | null {
  for (const v of allVibes()) {
    const i = v.tracks.findIndex(t => t.id === id);
    if (i >= 0) return { vibe: v, index: i };
  }
  return null;
}

export function musicState(): MusicState {
  return {
    playing, vibeId, trackIndex,
    trackId: currentTrack()?.id ?? '',
    trackName: currentTrack()?.name ?? '',
    volume, repeat, shuffle, vibes: allVibes(),
    queue: queue
      .map(id => {
        const found = findTrack(id);
        return found
          ? { id, name: found.vibe.tracks[found.index].name, vibeName: found.vibe.name }
          : null;
      })
      .filter((q): q is QueueItem => !!q),
  };
}

function emit() {
  const s = musicState();
  for (const l of listeners) l(s);
}

export function onMusicChange(fn: (s: MusicState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Load the operator's own tracks, if any were dropped in. Manifest rows:
//   { "name": "Song title", "url": "/music/song.mp3", "vibe": "LARP" }
// "vibe" (or "playlist") is optional — it groups songs into a named playlist.
// Matching a built-in vibe's name replaces that vibe's generated songs; any
// other name becomes its own vibe. Songs without one land in "Your tracks".
export async function loadCustomTracks(): Promise<void> {
  try {
    const res = await fetch('/music/manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const rows = (await res.json()) as { name?: string; url?: string; vibe?: string; playlist?: string }[];
    const candidates = rows.filter(r => typeof r?.url === 'string').slice(0, 200);
    // The manifest may list songs before their files are uploaded — check
    // each same-origin url actually resolves to audio, not the SPA fallback
    // page, and skip the ones that don't. External urls are taken on faith
    // (their hosts may not answer cross-origin HEADs even when audio plays).
    const present = await Promise.all(candidates.map(async r => {
      const url = r.url as string;
      if (!url.startsWith('/')) return true;
      try {
        const head = await fetch(url, { method: 'HEAD' });
        return head.ok && !(head.headers.get('content-type') ?? '').includes('text/html');
      } catch {
        return false;
      }
    }));
    const groups = new Map<string, Track[]>();
    candidates
      .filter((_, i) => present[i])
      .forEach((r, i) => {
        const group = (r.vibe || r.playlist || 'Your tracks').trim() || 'Your tracks';
        const tracks = groups.get(group) ?? [];
        tracks.push({
          id: `custom-${i}`,
          name: r.name || `Track ${i + 1}`,
          bpm: 90, progression: [0], chord: MIN7,
          drums: 'none' as const, arp: false, bass: false,
          url: r.url as string,
        });
        groups.set(group, tracks);
      });
    if (groups.size === 0) return;
    customVibes = [...groups.entries()].map(([name, tracks], gi) => ({
      id: `custom-vibe-${gi}`,
      name,
      blurb: 'Music you added to this site.',
      key: 48, tracks,
    }));
    emit();
  } catch {
    // No manifest — generative vibes only.
  }
}

// ---- playback ----
let audioEl: HTMLAudioElement | null = null;
let schedulerTimer: number | null = null;
let nextNoteTime = 0;
let bar = 0;
let voices: OscillatorNode[] = [];

function bus(): GainNode | null {
  const g = musicOutput();
  if (g) {
    const ac = audioContext();
    if (ac) {
      g.gain.cancelScheduledValues(ac.currentTime);
      g.gain.linearRampToValueAtTime(playing ? volume * 0.5 : 0, ac.currentTime + 0.4);
    }
  }
  return g;
}

function blip(
  freq: number, at: number, dur: number, vol: number,
  type: OscillatorType, cutoff = 1200,
) {
  const ac = audioContext();
  const out = musicOutput();
  if (!ac || !out) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(vol, at + Math.min(0.08, dur * 0.3));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(lp).connect(gain).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  voices.push(osc);
  osc.onended = () => { voices = voices.filter(v => v !== osc); };
}

function drum(kind: 'kick' | 'hat' | 'snare', at: number, vol: number) {
  const ac = audioContext();
  const out = musicOutput();
  if (!ac || !out) return;
  if (kind === 'kick') {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    osc.connect(gain).connect(out);
    osc.start(at); osc.stop(at + 0.25);
    return;
  }
  const len = kind === 'hat' ? 0.05 : 0.16;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ac.createBufferSource();
  const hp = ac.createBiquadFilter();
  const gain = ac.createGain();
  src.buffer = buf;
  hp.type = kind === 'hat' ? 'highpass' : 'bandpass';
  hp.frequency.value = kind === 'hat' ? 7000 : 1800;
  gain.gain.value = vol;
  src.connect(hp).connect(gain).connect(out);
  src.start(at);
}

// Each vibe plays through its own instruments — different waveforms, filter
// colors, bass rhythm, drum feel — so Chill and Intense are different BANDS,
// not the same synth at two tempos.
interface Palette {
  padWave: OscillatorType; padCutoff: number; padGain: number;
  arpWave: OscillatorType; arpSteps: number; arpOctave: number;
  arpGate: number; arpCutoff: number; arpGain: number; arpRest: number;
  bass: 'held' | 'walk' | 'pulse' | 'rootFifth';
  drumFeel: 'brush' | 'swing' | 'four' | 'march' | 'boom';
  lead: boolean; leadWave: OscillatorType; leadCutoff: number; leadGain: number;
}

const PALETTES: Record<string, Palette> = {
  // Plucked-string arp (short bright triangle), root-fifth drone bass,
  // march drums. The lute section.
  larp: {
    padWave: 'triangle', padCutoff: 1000, padGain: 0.04,
    arpWave: 'triangle', arpSteps: 8, arpOctave: 12, arpGate: 0.18, arpCutoff: 4200, arpGain: 0.065, arpRest: 0.18,
    bass: 'rootFifth', drumFeel: 'march', lead: true, leadWave: 'square', leadCutoff: 1900, leadGain: 0.035,
  },
  // Warm dark pad, lazy sparse keys, long bass notes, brushed drums with a
  // slight swing — the dusty study-beats feel.
  lofi: {
    padWave: 'triangle', padCutoff: 850, padGain: 0.07,
    arpWave: 'sine', arpSteps: 8, arpOctave: 12, arpGate: 0.5, arpCutoff: 1700, arpGain: 0.045, arpRest: 0.35,
    bass: 'held', drumFeel: 'swing', lead: true, leadWave: 'sine', leadCutoff: 1500, leadGain: 0.05,
  },
  // Sawtooth power-chord pad, driving 8th bass, four-on-the-floor kick with
  // backbeat snares, bright square hook.
  rockpop: {
    padWave: 'sawtooth', padCutoff: 800, padGain: 0.034,
    arpWave: 'square', arpSteps: 8, arpOctave: 12, arpGate: 0.4, arpCutoff: 2600, arpGain: 0.032, arpRest: 0.2,
    bass: 'pulse', drumFeel: 'four', lead: true, leadWave: 'sawtooth', leadCutoff: 2000, leadGain: 0.04,
  },
  // Dark sparse pad, heavy sub bass, boom-bap kick/snare knock, minimal
  // melodic movement — the head-nod section.
  hiphop: {
    padWave: 'sine', padCutoff: 700, padGain: 0.055,
    arpWave: 'triangle', arpSteps: 8, arpOctave: 12, arpGate: 0.3, arpCutoff: 1400, arpGain: 0.035, arpRest: 0.5,
    bass: 'held', drumFeel: 'boom', lead: true, leadWave: 'triangle', leadCutoff: 1300, leadGain: 0.04,
  },
};

// Stable per-song seed so every track keeps its own melody forever.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Schedule one bar of the current track.
function scheduleBar(t: Track, when: number, index: number) {
  const beat = 60 / t.bpm;
  const barLen = beat * 4;
  const rand = rng((index + 1) * 9176 + hashStr(t.id));
  const root = vibe().key + t.progression[index % t.progression.length];
  const pal = PALETTES[vibe().id] ?? PALETTES.lofi;

  // Pad: the chord, held across the bar, in this vibe's color.
  for (const iv of t.chord) {
    for (const detune of [-5, 5]) {
      const osc = audioContext()?.createOscillator();
      if (!osc) break;
      const ac = audioContext()!;
      const gain = ac.createGain();
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = pal.padCutoff;
      osc.type = pal.padWave;
      osc.frequency.value = midi(root + iv);
      osc.detune.value = detune;
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(pal.padGain, when + barLen * 0.25);
      gain.gain.setValueAtTime(pal.padGain, when + barLen * 0.7);
      gain.gain.linearRampToValueAtTime(0.0001, when + barLen);
      osc.connect(lp).connect(gain).connect(musicOutput()!);
      osc.start(when);
      osc.stop(when + barLen + 0.1);
      voices.push(osc);
      osc.onended = () => { voices = voices.filter(v => v !== osc); };
    }
  }

  if (t.bass) {
    const b = midi(root - 12);
    if (pal.bass === 'held') {
      blip(b, when, beat * 1.4, 0.13, 'sine', 400);
      blip(b, when + beat * 2, beat * 1.2, 0.1, 'sine', 400);
    } else if (pal.bass === 'walk') {
      // Quarter-note walk: root, a chord tone, the fifth, a leading tone.
      const steps = [0, t.chord[1] ?? 3, 7, rand() < 0.5 ? 5 : 10];
      steps.forEach((iv, i) => {
        blip(midi(root - 12 + iv), when + beat * i, beat * 0.85, 0.11, 'triangle', 500);
      });
    } else if (pal.bass === 'pulse') {
      // Driving 8ths, accented on the beat.
      for (let i = 0; i < 8; i++) {
        blip(b, when + (beat / 2) * i, beat * 0.4, i % 2 === 0 ? 0.13 : 0.07, 'sawtooth', 300);
      }
    } else { // rootFifth — the medieval drone
      blip(b, when, beat * 1.9, 0.12, 'triangle', 450);
      blip(midi(root - 12 + 7), when + beat * 2, beat * 0.9, 0.09, 'triangle', 450);
      blip(b, when + beat * 3, beat * 0.9, 0.1, 'triangle', 450);
    }
  }

  if (t.arp) {
    for (let i = 0; i < pal.arpSteps; i++) {
      if (rand() < pal.arpRest) continue; // leave gaps so it breathes
      const iv = t.chord[Math.floor(rand() * t.chord.length)];
      blip(
        midi(root + pal.arpOctave + iv), when + (barLen / pal.arpSteps) * i,
        beat * pal.arpGate, pal.arpGain, pal.arpWave, pal.arpCutoff,
      );
    }
  }

  // Lead: a two-bar motif seeded by the song id — the reason "Slow Roll"
  // and "Deep Stack" are different tunes, not just different chords. It
  // answers the pad in the back half of each four-bar phrase.
  if (pal.lead && index % 4 >= 2) {
    const motif = rng(hashStr(t.id) * 7 + (index % 8 >= 4 ? 1 : 0));
    const scale = [...t.chord, 12, t.chord[1] + 12];
    for (let i = 0; i < 4; i++) {
      if (motif() < 0.35) continue;
      const iv = scale[Math.floor(motif() * scale.length)];
      blip(
        midi(root + 12 + iv), when + beat * i + (motif() < 0.3 ? beat / 2 : 0),
        beat * 0.7, pal.leadGain, pal.leadWave, pal.leadCutoff,
      );
    }
  }

  if (t.drums !== 'none') {
    const soft = t.drums === 'soft';
    if (pal.drumFeel === 'swing') {
      // Lazy jazz ride: swung 8ths, brushed kick, ghost snare.
      drum('kick', when, soft ? 0.16 : 0.24);
      drum('snare', when + beat * 2, soft ? 0.045 : 0.09);
      for (let i = 0; i < 8; i++) {
        const swingLate = i % 2 === 1 ? beat * 0.17 : 0;
        drum('hat', when + (beat / 2) * i + swingLate, i % 2 === 0 ? 0.035 : 0.02);
      }
    } else if (pal.drumFeel === 'four') {
      // Four-on-the-floor with backbeat snares and offbeat hats.
      for (let i = 0; i < 4; i++) drum('kick', when + beat * i, soft ? 0.2 : 0.3);
      drum('snare', when + beat, soft ? 0.06 : 0.11);
      drum('snare', when + beat * 3, soft ? 0.06 : 0.12);
      for (let i = 0; i < 8; i++) {
        drum('hat', when + (beat / 2) * i, i % 2 === 1 ? 0.055 : 0.025);
      }
    } else if (pal.drumFeel === 'boom') {
      // Boom-bap knock: heavy kick on 1 with a late double, cracking snare
      // backbeat on 2 & 4, lightly swung 8th hats.
      drum('kick', when, soft ? 0.24 : 0.32);
      drum('kick', when + beat * 2.5, soft ? 0.16 : 0.24);
      drum('snare', when + beat, soft ? 0.08 : 0.13);
      drum('snare', when + beat * 3, soft ? 0.08 : 0.13);
      for (let i = 0; i < 8; i++) {
        drum('hat', when + (beat / 2) * i + (i % 2 === 1 ? beat * 0.09 : 0), i % 2 === 0 ? 0.032 : 0.02);
      }
    } else if (pal.drumFeel === 'march') {
      // Field-drum march: kick 1 & 3, snare answers with a drag on 2 & 4.
      drum('kick', when, soft ? 0.2 : 0.28);
      drum('kick', when + beat * 2, soft ? 0.16 : 0.24);
      for (const b of [1, 3]) {
        drum('snare', when + beat * b, soft ? 0.06 : 0.1);
        drum('snare', when + beat * b + beat * 0.25, soft ? 0.03 : 0.05);
      }
      if (!soft) drum('snare', when + beat * 3.75, 0.04);
    } else { // brush — the original soft feel
      drum('kick', when, soft ? 0.18 : 0.32);
      if (!soft) drum('kick', when + beat * 2, 0.26);
      drum('snare', when + beat * 2, soft ? 0.05 : 0.12);
      for (let i = 0; i < (soft ? 4 : 8); i++) {
        drum('hat', when + (barLen / (soft ? 4 : 8)) * i, soft ? 0.025 : 0.05);
      }
    }
  }
}

const BARS_PER_TRACK = 16;

function scheduler() {
  const ac = audioContext();
  if (!ac || !playing) return;
  const t = currentTrack();
  if (!t || t.url) return;
  const barLen = (60 / t.bpm) * 4;
  // After a suspension (app switch, screen lock) the clock has jumped: don't
  // burst-schedule every missed bar into one blast — skip to now.
  if (nextNoteTime < ac.currentTime - 1) nextNoteTime = ac.currentTime + 0.05;
  // Keep roughly a bar queued ahead of the clock.
  while (nextNoteTime < ac.currentTime + barLen) {
    scheduleBar(t, Math.max(nextNoteTime, ac.currentTime + 0.05), bar);
    nextNoteTime += barLen;
    bar += 1;
    if (bar >= BARS_PER_TRACK) {
      bar = 0;
      if (repeat === 'one') continue; // same track again
      advance(true);
      return;
    }
  }
}

function stopVoices() {
  for (const v of voices) { try { v.stop(); } catch { /* already stopped */ } }
  voices = [];
}

let fileErrorStreak = 0;

function playFile(t: Track) {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.addEventListener('ended', () => {
      if (repeat === 'one') { void audioEl?.play(); return; }
      advance(true);
    });
    audioEl.addEventListener('playing', () => { fileErrorStreak = 0; });
    // A missing or broken file must not freeze the player: skip ahead, but
    // give up after a full lap of failures so this can't spin forever.
    audioEl.addEventListener('error', () => {
      if (!playing) return;
      fileErrorStreak += 1;
      if (fileErrorStreak > vibe().tracks.length) { stopMusic(); return; }
      advance(true);
    });
  }
  audioEl.src = t.url!;
  audioEl.volume = Math.min(1, volume);
  audioEl.loop = false;
  void audioEl.play().catch(() => { /* needs a gesture; the toggle provides one */ });
}

function stopFile() {
  if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
}

function startCurrent() {
  const ac = audioContext();
  if (!ac) return;
  stopVoices();
  stopFile();
  const t = currentTrack();
  if (!t) return;
  if (t.url) { playFile(t); }
  else {
    bar = 0;
    nextNoteTime = ac.currentTime + 0.1;
    if (schedulerTimer === null) schedulerTimer = window.setInterval(scheduler, 250);
    scheduler();
  }
  bus();
  emit();
}

function advance(auto: boolean) {
  // Anything the player queued jumps the playlist — after the queue drains,
  // normal play resumes inside whichever vibe the last queued track lives in.
  while (queue.length > 0) {
    const found = findTrack(queue.shift()!);
    if (!found) continue; // a custom track that has since disappeared
    vibeId = found.vibe.id;
    localStorage.setItem(K.vibe, vibeId);
    trackIndex = found.index;
    startCurrent();
    return;
  }
  const v = vibe();
  if (shuffle && v.tracks.length > 1) {
    let next = trackIndex;
    while (next === trackIndex) next = Math.floor(Math.random() * v.tracks.length);
    trackIndex = next;
  } else if (trackIndex + 1 >= v.tracks.length) {
    if (auto && repeat === 'off') { stopMusic(); return; }
    trackIndex = 0;
  } else {
    trackIndex += 1;
  }
  startCurrent();
}

// ---- public transport ----
export function startMusic(vol?: number) {
  if (vol !== undefined) volume = Math.max(0, Math.min(1, vol));
  // An empty vibe (no uploads yet) can't play — hop to one that can rather
  // than sitting in fake-playing silence.
  if (vibe().tracks.length === 0) {
    const playable = allVibes().find(v => v.tracks.length > 0);
    if (!playable) return;
    vibeId = playable.id;
    trackIndex = 0;
    localStorage.setItem(K.vibe, vibeId);
  }
  playing = true;
  localStorage.setItem(K.on, '1');
  startCurrent();
}

// Coming back from another app: iOS froze the audio engine and paused any
// <audio> element, but our state still says "playing" — actually resume
// everything so the music comes back instead of pretending.
export function resumeAfterReturn(): void {
  if (!playing) return;
  const ac = audioContext();
  if (!ac) return;
  if (ac.state !== 'running') void ac.resume();
  const t = currentTrack();
  if (t?.url) {
    if (audioEl && audioEl.paused) void audioEl.play().catch(() => { /* needs a tap */ });
  } else {
    nextNoteTime = ac.currentTime + 0.15;
  }
  bus();
  emit();
}

export function stopMusic() {
  playing = false;
  if (schedulerTimer !== null) { clearInterval(schedulerTimer); schedulerTimer = null; }
  bus();
  stopFile();
  setTimeout(stopVoices, 700);
  emit();
}

export function setMusicOn(on: boolean, vol = volume) {
  localStorage.setItem(K.on, on ? '1' : '0');
  if (on) startMusic(vol);
  else stopMusic();
}

export function toggleMusic() { setMusicOn(!playing); }
export function nextTrack() { advance(false); }
export function prevTrack() {
  const v = vibe();
  trackIndex = (trackIndex - 1 + v.tracks.length) % v.tracks.length;
  startCurrent();
}

export function setVibe(id: string) {
  vibeId = id;
  trackIndex = 0;
  localStorage.setItem(K.vibe, id);
  if (playing) startCurrent(); else emit();
}

export function playTrack(index: number) {
  trackIndex = Math.max(0, Math.min(index, vibe().tracks.length - 1));
  playing = true;
  localStorage.setItem(K.on, '1');
  startCurrent();
}

// Play a specific song immediately, wherever it lives (search results).
export function playTrackById(id: string) {
  const found = findTrack(id);
  if (!found) return;
  vibeId = found.vibe.id;
  localStorage.setItem(K.vibe, vibeId);
  trackIndex = found.index;
  playing = true;
  localStorage.setItem(K.on, '1');
  startCurrent();
}

// "Play next": append to the player's queue without touching what's on.
export function queueTrack(id: string) {
  if (!findTrack(id)) return;
  queue.push(id);
  emit();
}

export function removeQueued(index: number) {
  queue.splice(index, 1);
  emit();
}

export function clearQueue() {
  queue = [];
  emit();
}

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem(K.vol, String(volume));
  if (audioEl) audioEl.volume = volume;
  bus();
  emit();
}

export function setRepeat(mode: RepeatMode) {
  repeat = mode;
  localStorage.setItem(K.repeat, mode);
  emit();
}

export function setShuffle(on: boolean) {
  shuffle = on;
  localStorage.setItem(K.shuffle, on ? '1' : '0');
  emit();
}

// Quieter at a live table than in the lobby: music must never bury the
// turn alert.
export function duckForTable(atTable: boolean) {
  const out = musicOutput();
  const ac = audioContext();
  if (!out || !ac) return;
  out.gain.cancelScheduledValues(ac.currentTime);
  out.gain.linearRampToValueAtTime(
    playing ? volume * (atTable ? 0.28 : 0.5) : 0, ac.currentTime + 0.8,
  );
}
