// Background music engine (adapted from the poker room's music.ts).
//
// Two kinds of track share one transport:
//  - Built-in tracks are synthesized live in WebAudio — a slow lounge band of
//    chords, soft bass, a sparse keys line and brushed percussion. Nothing to
//    download or license, so music works on a fresh install with an empty
//    library, and it loops forever for the cost of a dozen oscillators a bar.
//  - Uploaded tracks come from the operator's library (/music/manifest.json,
//    managed in the dashboard) and play through an <audio> element.
// Uploaded playlists appear beside the built-in one; nothing replaces it.
import { audioContext, hasGestured, musicOutput, noise, onFirstGesture, readFraction, readPref, writePref } from './sound.ts';

interface SynthSpec {
  bpm: number;
  /** Base MIDI note of the key. */
  key: number;
  /** Chord roots as semitone offsets from the key, one chord per bar. */
  roots: number[];
  /** Chord shape per bar (intervals from its root). */
  shapes: number[][];
}

export interface Track {
  id: string;
  name: string;
  /** File-backed tracks play this; synth tracks have `synth` instead. */
  url?: string;
  synth?: SynthSpec;
}

export interface Playlist {
  id: string;
  name: string;
  builtIn: boolean;
  tracks: Track[];
}

const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const MIN9 = [0, 3, 7, 10, 14];
const MAJ9 = [0, 4, 7, 11, 14];
const DOM9 = [0, 4, 10, 14];

export const BUILTIN_ID = 'builtin:lounge';
const BUILTIN: Playlist = {
  id: BUILTIN_ID,
  name: 'Built-in · Lounge',
  builtIn: true,
  tracks: [
    { id: 'lounge-1', name: 'Boardwalk at Dusk', synth: { bpm: 76, key: 50, roots: [0, 5, -2, 3], shapes: [MIN9, MIN7, MAJ7, MAJ9] } },
    { id: 'lounge-2', name: 'Free Parking', synth: { bpm: 84, key: 53, roots: [0, 9, 2, 7], shapes: [MAJ9, MIN7, MIN9, DOM9] } },
    { id: 'lounge-3', name: 'Chance Encounter', synth: { bpm: 70, key: 45, roots: [0, 8, 5, 7], shapes: [MIN9, MAJ7, MIN7, DOM9] } },
  ],
};

// ---- persisted preferences ----
const K = { on: 'yot:music.on', vol: 'yot:music.vol', muted: 'yot:music.muted', playlist: 'yot:music.playlist' };

export interface MusicState {
  /** The player wants music (and the transport is running or about to). */
  playing: boolean;
  playlistId: string;
  trackIndex: number;
  trackName: string;
  volume: number;
  muted: boolean;
  playlists: Playlist[];
}

let uploaded: Playlist[] = [];
let playlistId = readPref(K.playlist) || BUILTIN_ID;
let trackIndex = 0;
let volume = readFraction(K.vol, 0.5);
let muted = readPref(K.muted) === '1';
let playing = false;
// Set while no widget is on screen (e.g. the home page): the player's
// preference stays "on", but nothing plays where they cannot turn it off.
let suspended = true;
let allowed = true;

const listeners = new Set<(s: MusicState) => void>();

export function allPlaylists(): Playlist[] {
  return [BUILTIN, ...uploaded].filter(p => p.tracks.length > 0);
}

function playlist(): Playlist {
  return allPlaylists().find(p => p.id === playlistId) ?? BUILTIN;
}

function currentTrack(): Track {
  const p = playlist();
  return p.tracks[Math.min(trackIndex, p.tracks.length - 1)];
}

export function musicState(): MusicState {
  return {
    playing, playlistId: playlist().id, trackIndex, trackName: currentTrack().name,
    volume, muted, playlists: allPlaylists(),
  };
}

function emit() {
  const s = musicState();
  listeners.forEach(f => f(s));
}

export function onMusicChange(fn: (s: MusicState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ---- the operator's library ----
interface ManifestRow { id?: string; name?: string; url?: string; playlist?: string }

let loading: Promise<void> | null = null;
export function loadLibrary(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const res = await fetch('/music/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const rows = await res.json() as ManifestRow[];
      if (!Array.isArray(rows)) return;
      const groups = new Map<string, Playlist>();
      rows.forEach((r, i) => {
        // Only same-origin library files: the manifest is ours, but a player
        // should never be pointed at an arbitrary host by it.
        if (typeof r?.url !== 'string' || !r.url.startsWith('/music/lib/')) return;
        const name = (r.playlist ?? '').trim() || 'Music';
        const id = `up:${name.toLowerCase()}`;
        const pl = groups.get(id) ?? { id, name, builtIn: false, tracks: [] };
        pl.tracks.push({ id: `up:${r.id ?? i}`, name: r.name || `Track ${i + 1}`, url: r.url });
        groups.set(id, pl);
      });
      const wasTrack = currentTrack();
      uploaded = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
      // Keep whatever is playing in place if it still exists; otherwise the
      // library changed under us, so restart on what is now selected.
      const p = playlist();
      const at = p.tracks.findIndex(t => t.id === wasTrack.id);
      if (at >= 0) trackIndex = at;
      else {
        trackIndex = 0;
        if (playing && !suspended) startCurrent();
      }
      emit();
    } catch {
      // No manifest (offline, old server): the built-in playlist still works.
    }
  })();
  return loading;
}

// ---- synthesis ----
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Voice { src: AudioScheduledSourceNode; gain: GainNode }
let voices: Voice[] = [];

function track(src: AudioScheduledSourceNode, gain: GainNode, stopAt: number) {
  const v = { src, gain };
  voices.push(v);
  src.onended = () => { voices = voices.filter(x => x !== v); };
  src.stop(stopAt);
}

function note(
  ac: AudioContext, out: GainNode, freq: number, at: number, dur: number, vol: number,
  type: OscillatorType, cutoff: number, attack = 0.01,
) {
  const osc = ac.createOscillator();
  const lp = ac.createBiquadFilter();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(lp).connect(g).connect(out);
  osc.start(at);
  track(osc, g, at + dur + 0.05);
}

function hit(ac: AudioContext, out: GainNode, at: number, dur: number, vol: number, type: BiquadFilterType, freq: number) {
  const src = ac.createBufferSource();
  const bq = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = noise(ac);
  bq.type = type;
  bq.frequency.value = freq;
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(bq).connect(g).connect(out);
  src.start(at, Math.random() * 0.5);
  track(src, g, at + dur + 0.02);
}

function kick(ac: AudioContext, out: GainNode, at: number, vol: number) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.frequency.setValueAtTime(110, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.14);
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  osc.connect(g).connect(out);
  osc.start(at);
  track(osc, g, at + 0.3);
}

/** One bar of lounge: pad chord, walking-ish bass, a few keys, brushes. */
function scheduleBar(spec: SynthSpec, when: number, bar: number) {
  const ac = audioContext();
  const out = musicOutput();
  if (!ac || !out) return;
  const beat = 60 / spec.bpm;
  const barLen = beat * 4;
  const i = bar % spec.roots.length;
  const root = spec.key + spec.roots[i];
  const shape = spec.shapes[i % spec.shapes.length];

  // Pad: the chord held across the bar with a slow swell — the warm bed.
  for (const iv of shape) {
    const osc = ac.createOscillator();
    const lp = ac.createBiquadFilter();
    const g = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midi(root + iv);
    osc.detune.value = (Math.random() - 0.5) * 10;
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.035, when + barLen * 0.3);
    g.gain.setValueAtTime(0.035, when + barLen * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, when + barLen + 0.05);
    osc.connect(lp).connect(g).connect(out);
    osc.start(when);
    track(osc, g, when + barLen + 0.1);
  }

  // Soft bass: root on 1, a chord tone or fifth on the "and" of 2 / on 3.
  const bass = root - 12;
  note(ac, out, midi(bass), when, beat * 1.6, 0.16, 'sine', 500, 0.02);
  const pick = Math.random() < 0.5 ? 7 : shape[1];
  note(ac, out, midi(bass + pick), when + beat * 2.5, beat * 1.2, 0.12, 'sine', 500, 0.02);

  // Keys: a sparse, lazy line on chord tones an octave up — the only part
  // that changes every time round, so the loop never feels like a loop.
  if (bar % 2 === 1 || Math.random() < 0.5) {
    for (let s = 0; s < 8; s++) {
      if (Math.random() > 0.28) continue;
      const iv = shape[Math.floor(Math.random() * shape.length)] + 12;
      note(ac, out, midi(root + iv), when + (beat / 2) * s, beat * 1.3, 0.045, 'sine', 2400, 0.005);
    }
  }

  // Brushes: soft kick on 1 (and a ghost later), swung hats, rim on 3.
  kick(ac, out, when, 0.22);
  if (Math.random() < 0.5) kick(ac, out, when + beat * 2.5, 0.12);
  for (let s = 0; s < 8; s++) {
    const swing = s % 2 === 1 ? beat * 0.16 : 0;
    hit(ac, out, when + (beat / 2) * s + swing, 0.06, s % 2 === 0 ? 0.03 : 0.018, 'highpass', 6500);
  }
  hit(ac, out, when + beat * 2, 0.09, 0.05, 'bandpass', 1900);
}

// ---- transport ----
const BARS_PER_TRACK = 32; // ~1.5–2 minutes, then on to the next tune
let timer: number | null = null;
let nextBarAt = 0;
let bar = 0;
let audioEl: HTMLAudioElement | null = null;
let fileErrors = 0;

function applyVolume() {
  const out = musicOutput();
  const ac = audioContext();
  const live = playing && !suspended && allowed && !muted;
  if (out && ac) out.gain.setTargetAtTime(live ? volume * 0.6 : 0, ac.currentTime, 0.15);
  if (audioEl) {
    audioEl.volume = volume;
    audioEl.muted = muted;
  }
}

function tick() {
  const ac = audioContext();
  const t = currentTrack();
  if (!ac || !t?.synth || !playing || suspended) return;
  const barLen = (60 / t.synth.bpm) * 4;
  // After the tab slept the clock jumped: skip ahead rather than firing every
  // missed bar at once.
  if (nextBarAt < ac.currentTime - 1) nextBarAt = ac.currentTime + 0.05;
  // The last bar is already queued: move on once it has played out, not the
  // moment it is scheduled (which would cut it off).
  if (bar >= BARS_PER_TRACK) {
    if (ac.currentTime >= nextBarAt - 0.05) advance();
    return;
  }
  while (bar < BARS_PER_TRACK && nextBarAt < ac.currentTime + barLen * 1.2) {
    scheduleBar(t.synth, Math.max(nextBarAt, ac.currentTime + 0.02), bar);
    nextBarAt += barLen;
    bar += 1;
  }
}

function silenceVoices() {
  const ac = audioContext();
  const now = ac?.currentTime ?? 0;
  for (const v of voices) {
    // A quick fade, not an instant stop, so switching never clicks.
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.03);
      v.src.stop(now + 0.2);
    } catch { /* already stopped */ }
  }
  voices = [];
}

function stopTransport() {
  if (timer !== null) { clearInterval(timer); timer = null; }
  silenceVoices();
  if (audioEl) audioEl.pause();
}

/** `resume`: carry on from where a paused file left off instead of restarting it. */
function startCurrent(resume = false) {
  stopTransport();
  if (!playing || suspended || !allowed) { applyVolume(); return; }
  const ac = audioContext();
  const t = currentTrack();
  if (!ac || !t) return;
  if (t.url) {
    if (!audioEl) {
      audioEl = new Audio();
      audioEl.preload = 'auto';
      audioEl.addEventListener('ended', () => advance());
      audioEl.addEventListener('playing', () => { fileErrors = 0; });
      // A missing or broken file must not freeze the player: skip on, but
      // give up after a full lap of failures so it cannot spin forever.
      audioEl.addEventListener('error', () => {
        if (!playing || !currentTrack().url) return;
        fileErrors += 1;
        if (fileErrors > playlist().tracks.length) { pause(); return; }
        advance();
      });
    }
    if (!resume || audioEl.getAttribute('src') !== t.url || audioEl.ended) audioEl.src = t.url;
    applyVolume();
    void audioEl.play().catch(() => { /* needs a gesture; the next click provides one */ });
  } else {
    bar = 0;
    nextBarAt = ac.currentTime + 0.1;
    timer = window.setInterval(tick, 250);
    tick();
  }
  applyVolume();
  emit();
}

function advance() {
  const p = playlist();
  trackIndex = (trackIndex + 1) % p.tracks.length;
  startCurrent();
  emit();
}

// ---- public controls ----
export function play(): void {
  if (!allowed) return;
  playing = true;
  writePref(K.on, '1');
  startCurrent(true);
  emit();
}

export function pause(): void {
  playing = false;
  writePref(K.on, '0');
  if (audioEl) audioEl.pause();
  applyVolume();
  // Let the bus fade out before cutting the voices.
  window.setTimeout(() => { if (!playing) stopTransport(); }, 400);
  emit();
}

export function togglePlay(): void { if (playing) pause(); else play(); }

export function nextTrack(): void { advance(); }

export function setPlaylist(id: string): void {
  if (!allPlaylists().some(p => p.id === id)) return;
  playlistId = id;
  trackIndex = 0;
  writePref(K.playlist, id);
  if (playing) startCurrent();
  emit();
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  writePref(K.vol, String(volume));
  if (volume > 0 && muted) { muted = false; writePref(K.muted, '0'); }
  applyVolume();
  emit();
}

export function setMuted(m: boolean): void {
  muted = m;
  writePref(K.muted, m ? '1' : '0');
  applyVolume();
  emit();
}

/** The site's music switch: off stops everything and refuses to start. */
export function setMusicAllowed(on: boolean): void {
  if (allowed === on) return;
  allowed = on;
  if (!on) { stopTransport(); applyVolume(); }
  else if (playing && !suspended) startCurrent();
}

// A widget on screen keeps the music alive; with none mounted (home page,
// admin) it pauses without forgetting the player wanted it. The lobby and
// the game screen each mount their own widget, so the release is deferred a
// moment — a page change hands over without restarting the tune.
let mounted = 0;
let releaseTimer: number | null = null;
export function attachPlayer(): () => void {
  mounted += 1;
  if (releaseTimer !== null) { clearTimeout(releaseTimer); releaseTimer = null; }
  if (suspended) {
    suspended = false;
    const wanted = readPref(K.on) === '1';
    // Never autoplay on load: browsers block it, and it is rude. Resume only
    // for a player who had it on — at once if they already clicked something
    // this visit, otherwise on their first click anywhere.
    if (wanted) {
      if (hasGestured() && audioContext()) play();
      else {
        onFirstGesture(e => {
          // A click on the music controls themselves speaks for itself
          // (resuming here and then toggling would cancel out).
          if ((e?.target as Element | null)?.closest?.('.audio-ctl')) return;
          if (!suspended && !playing && readPref(K.on) === '1') play();
        });
      }
    }
  }
  return () => {
    mounted -= 1;
    if (mounted > 0) return;
    releaseTimer = window.setTimeout(() => {
      releaseTimer = null;
      if (mounted > 0) return;
      suspended = true;
      playing = false; // the stored preference still says "on"
      applyVolume();
      window.setTimeout(() => { if (suspended) stopTransport(); }, 400);
      emit();
    }, 600);
  };
}
