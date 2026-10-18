// Background music engine (adapted from the poker room's music.ts).
//
// Two kinds of track share one transport:
//  - Built-in tracks are synthesized live in WebAudio (music/tracks.ts): one
//    generative piece per scene — the Study's lounge band, the Poker Room's
//    purple synths, the Ticker's bumper electronica, Pit Lane's rock, the
//    Rooftop's lo-fi — each written bar by bar on the audio clock. Nothing to
//    download or license, so music works on a fresh install with an empty
//    library, and a piece loops forever for the cost of a few dozen nodes.
//  - Uploaded tracks come from the operator's library (/music/manifest.json,
//    managed in the dashboard) and play through an <audio> element.
// The default choice, "Scene soundtrack (auto)", follows the game on screen
// and cross-fades between pieces when the scene changes; the player can pin
// any built-in piece or an uploaded playlist instead. Music is off until the
// player presses play — nothing here autoplays.
import { useEffect } from 'react';
import type { GameView } from '../../shared/types.ts';
import { sceneFor, type AmbienceScene } from './ambience.ts';
import { audioContext, hasGestured, musicOutput, onFirstGesture, readFraction, readPref, writePref } from './sound.ts';
import { PIECES, pieceById, type Piece } from './music/tracks.ts';
import { drop, mk, stats, type Layer } from './music/synth.ts';

export interface Track {
  id: string;
  name: string;
  /** File-backed tracks play this; synth tracks name a built-in piece instead. */
  url?: string;
  synth?: string;
}

export interface Playlist {
  id: string;
  name: string;
  builtIn: boolean;
  tracks: Track[];
}

/** The automatic playlist: one built-in piece per scene, picked by the game on screen. */
export const AUTO_ID = 'builtin:auto';
/** @deprecated the old single built-in playlist; kept so stored preferences still resolve. */
export const BUILTIN_ID = AUTO_ID;

const pieceTrack = (p: Piece): Track => ({ id: `synth:${p.id}`, name: p.name, synth: p.id });
const AUTO: Playlist = { id: AUTO_ID, name: 'Scene soundtrack (auto)', builtIn: true, tracks: PIECES.map(pieceTrack) };
const PINNED: Playlist[] = PIECES.map(p => ({ id: `builtin:${p.id}`, name: `${p.name} · ${p.blurb}`, builtIn: true, tracks: [pieceTrack(p)] }));

/** Which piece plays for which room (music/tracks.ts). */
const SCENE_PIECE: Record<AmbienceScene, string> = {
  classic: 'study', chog: 'poker', tptv: 'ticker', speedway: 'pitlane', skyline: 'rooftop',
};

/** Two pieces overlap for this long when the scene (or the pick) changes. */
const CROSSFADE_S = 2;

// ---- persisted preferences ----
const K = { on: 'yot:music.on', vol: 'yot:music.vol', muted: 'yot:music.muted', playlist: 'yot:music.playlist' };

export interface MusicState {
  /** The player wants music (and the transport is running or about to). */
  playing: boolean;
  playlistId: string;
  trackIndex: number;
  trackName: string;
  /** The scene the automatic playlist is following (null off the game screen). */
  scene: AmbienceScene | null;
  volume: number;
  muted: boolean;
  playlists: Playlist[];
}

let uploaded: Playlist[] = [];
let playlistId = readPref(K.playlist) || AUTO_ID;
if (playlistId === 'builtin:lounge') playlistId = AUTO_ID;
let trackIndex = 0;
let volume = readFraction(K.vol, 0.5);
let muted = readPref(K.muted) === '1';
let playing = false;
// Set while no widget is on screen (e.g. the home page): the player's
// preference stays "on", but nothing plays where they cannot turn it off.
let suspended = true;
let allowed = true;
let scene: AmbienceScene | null = null;
// In the automatic playlist "next" steps off the scene's piece until the
// scene changes again.
let autoPick: number | null = null;

const listeners = new Set<(s: MusicState) => void>();

export function allPlaylists(): Playlist[] {
  return [AUTO, ...PINNED, ...uploaded].filter(p => p.tracks.length > 0);
}

function playlist(): Playlist {
  return allPlaylists().find(p => p.id === playlistId) ?? AUTO;
}

function sceneTrackIndex(): number {
  const id = SCENE_PIECE[scene ?? 'classic'];
  return Math.max(0, AUTO.tracks.findIndex(t => t.synth === id));
}

function currentTrack(): Track {
  const p = playlist();
  if (p.id === AUTO_ID) return p.tracks[autoPick ?? sceneTrackIndex()];
  return p.tracks[Math.min(trackIndex, p.tracks.length - 1)];
}

export function musicState(): MusicState {
  const p = playlist();
  return {
    playing, playlistId: p.id, trackIndex: p.id === AUTO_ID ? (autoPick ?? sceneTrackIndex()) : trackIndex,
    trackName: currentTrack().name, scene, volume, muted, playlists: allPlaylists(),
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
      if (at >= 0) { if (p.id !== AUTO_ID) trackIndex = at; }
      else {
        trackIndex = 0;
        if (playing && !suspended) startCurrent();
      }
      emit();
    } catch {
      // No manifest (offline, old server): the built-in pieces still work.
    }
  })();
  return loading;
}

// ---- the synth transport ----
// A running piece is a Layer (its own gain into the music bus, a register of
// every node it owns) plus its place in the bar count. Switching pieces
// starts a new layer and fades the old one out underneath it.
interface Running extends Layer {
  piece: Piece;
  bar: number;
  nextBarAt: number;
}

let live: Running | null = null;
const fading = new Set<Running>();
let timer: number | null = null;
let audioEl: HTMLAudioElement | null = null;
let fileErrors = 0;

let errors = 0;
/** Live layers / nodes right now, nodes and bars ever built, scheduling errors. */
export function musicStats(): { layers: number; nodes: number; created: number; bars: number; errors: number; piece: string | null } {
  return { ...stats, errors, piece: live?.piece.id ?? null };
}

function startLayer(piece: Piece, fadeIn: number): Running | null {
  const ac = audioContext();
  const bus = musicOutput();
  if (!ac || !bus) return null;
  const L: Running = {
    ac, out: null as unknown as GainNode, nodes: new Set(), persistent: [], stopped: false, send: {},
    piece, bar: 0, nextBarAt: ac.currentTime + 0.1,
  };
  L.out = mk(L, ac.createGain());
  L.persistent.push(L.out);
  L.out.gain.setValueAtTime(0.0001, ac.currentTime);
  L.out.gain.linearRampToValueAtTime(1, ac.currentTime + fadeIn);
  L.out.connect(bus);
  stats.layers += 1;
  try { piece.setup?.(L); } catch (e) { errors += 1; console.error('music: setup failed', e); }
  return L;
}

/** Fade a layer out and free everything it built once it is silent. */
function teardown(L: Running, fade: number) {
  if (L.stopped) return;
  L.stopped = true;
  fading.add(L);
  const now = L.ac.currentTime;
  L.out.gain.cancelScheduledValues(now);
  L.out.gain.setValueAtTime(L.out.gain.value, now);
  L.out.gain.linearRampToValueAtTime(0.0001, now + fade);
  window.setTimeout(() => {
    fading.delete(L);
    for (const n of [...L.nodes]) {
      try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* not a source, or never started */ }
      drop(L, n);
    }
    L.persistent.length = 0;
    stats.layers -= 1;
  }, fade * 1000 + 80);
}

function scheduleAhead(L: Running) {
  const { ac, piece } = L;
  const barLen = (60 / piece.bpm) * 4;
  // After the tab slept the clock jumped: skip ahead rather than firing every
  // missed bar at once.
  if (L.nextBarAt < ac.currentTime - 1) L.nextBarAt = ac.currentTime + 0.05;
  while (!L.stopped && L.nextBarAt < ac.currentTime + barLen * 1.2) {
    try { piece.bar(L, Math.max(L.nextBarAt, ac.currentTime + 0.02), L.bar); } catch (e) {
      errors += 1;
      if (errors < 4) console.error('music: bar failed', e);
    }
    L.nextBarAt += barLen;
    L.bar += 1;
    stats.bars += 1;
  }
}

function tick() {
  if (!live || !playing || suspended) return;
  scheduleAhead(live);
}

/** Make `piece` the live layer, cross-fading from whatever was playing. */
function switchTo(piece: Piece) {
  if (live && !live.stopped && live.piece.id === piece.id) return;
  const old = live;
  const fade = old ? CROSSFADE_S : 0.4;
  live = startLayer(piece, fade);
  if (old) teardown(old, fade);
  if (live) {
    if (timer === null) timer = window.setInterval(tick, 250);
    scheduleAhead(live);
  }
}

function applyVolume() {
  const out = musicOutput();
  const ac = audioContext();
  const on = playing && !suspended && allowed && !muted;
  if (out && ac) out.gain.setTargetAtTime(on ? volume * 0.6 : 0, ac.currentTime, 0.15);
  if (audioEl) {
    audioEl.volume = volume;
    audioEl.muted = muted;
  }
}

function stopSynth(fade = 0.25) {
  if (timer !== null) { clearInterval(timer); timer = null; }
  if (live) teardown(live, fade);
  live = null;
}

function stopTransport() {
  stopSynth();
  if (audioEl) audioEl.pause();
}

/** `resume`: carry on from where a paused file left off instead of restarting it. */
function startCurrent(resume = false) {
  if (!playing || suspended || !allowed) { stopTransport(); applyVolume(); return; }
  const ac = audioContext();
  const t = currentTrack();
  if (!ac || !t) { stopTransport(); return; }
  if (t.url) {
    stopSynth();
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
    if (audioEl) audioEl.pause();
    const piece = pieceById(t.synth ?? '') ?? PIECES[0];
    switchTo(piece);
  }
  applyVolume();
  emit();
}

function advance() {
  const p = playlist();
  if (p.id === AUTO_ID) autoPick = ((autoPick ?? sceneTrackIndex()) + 1) % p.tracks.length;
  else trackIndex = (trackIndex + 1) % p.tracks.length;
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
  autoPick = null;
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

// ---- the scene ----

/** Tell the automatic playlist which room is on screen (null: none, e.g. the lobby). */
export function setMusicScene(s: AmbienceScene | null): void {
  if (scene === s) return;
  scene = s;
  autoPick = null;
  if (playing && !suspended && playlist().id === AUTO_ID) startCurrent(true);
  emit();
}

/** Follow the game on screen: the automatic playlist cross-fades to its room's piece. */
export function useMusicScene(game: Pick<GameView, 'mapId' | 'themeId'> | null): void {
  const s = game ? sceneFor(game) : null;
  useEffect(() => {
    setMusicScene(s);
    return () => setMusicScene(null);
  }, [s]);
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

// Like the renderer's __yotGl and the ambience's __yotAmbience: with ?perf in
// the URL the engine can be driven and counted from the console (and the e2e
// check).
if (typeof window !== 'undefined' && location.search.includes('perf')) {
  Object.assign(window, {
    __yotMusic: {
      stats: musicStats, state: musicState, play, pause, setPlaylist, setScene: setMusicScene,
      pieces: PIECES.map(p => p.id), context: audioContext,
    },
  });
}
