// Background music: playlists of files the operator uploaded, and nothing else.
//
// This used to be a synthesiser — every note generated live from chord tables,
// with uploaded files bolted on beside it as one extra "Your tracks" playlist.
// The generated music is gone. A room that wants music plays the room's own
// music, so the whole engine is now an <audio> element working through
// playlists that come from the dashboard.
//
// The exported shape is unchanged so the player and the table keep working.
export type RepeatMode = 'off' | 'one' | 'all';

export interface Track {
  id: string;
  name: string;
  url: string;
}

export interface Vibe {
  id: string;
  name: string;
  tracks: Track[];
}

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

const K = {
  vibe: 'chog.music.vibe',
  vol: 'chog.music.vol',
  repeat: 'chog.music.repeat',
  shuffle: 'chog.music.shuffle',
};

const readNum = (k: string, fallback: number) => {
  const raw = Number(localStorage.getItem(k));
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
};

// Empty until the manifest lands. There is no built-in catalogue any more.
let playlists: Vibe[] = [];
let vibeId = localStorage.getItem(K.vibe) ?? '';
let trackIndex = 0;
let volume = readNum(K.vol, 0.5);
let repeat = (localStorage.getItem(K.repeat) as RepeatMode) || 'all';
let shuffle = localStorage.getItem(K.shuffle) === '1';
let playing = false;
let ducked = false;
let queue: string[] = [];

const listeners = new Set<(s: MusicState) => void>();

let el: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = 'none';
  el.volume = volume;
  // "Repeat one" is the element's own loop; everything else advances here.
  el.addEventListener('ended', () => { if (repeat !== 'one') advance(true); });
  // A file that will not play must not wedge the playlist on it.
  el.addEventListener('error', () => { if (playing) advance(true); });
  return el;
}

export function allVibes(): Vibe[] {
  return playlists;
}

function vibe(): Vibe | null {
  return playlists.find(v => v.id === vibeId) ?? playlists[0] ?? null;
}

function tracks(): Track[] {
  return vibe()?.tracks ?? [];
}

export function findTrack(id: string): { vibe: Vibe; index: number } | null {
  for (const v of playlists) {
    const i = v.tracks.findIndex(t => t.id === id);
    if (i >= 0) return { vibe: v, index: i };
  }
  return null;
}

export function musicState(): MusicState {
  const v = vibe();
  const list = v?.tracks ?? [];
  const t = list[trackIndex];
  return {
    playing,
    vibeId: v?.id ?? '',
    trackIndex,
    trackId: t?.id ?? '',
    trackName: t?.name ?? '',
    volume,
    repeat,
    shuffle,
    vibes: playlists,
    queue: queue.map(id => {
      const found = findTrack(id);
      return {
        id,
        name: found ? found.vibe.tracks[found.index].name : 'Unknown',
        vibeName: found ? found.vibe.name : '',
      };
    }),
  };
}

function emit(): void {
  const s = musicState();
  for (const fn of listeners) fn(s);
}

export function onMusicChange(fn: (s: MusicState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// The manifest is the whole library: playlists, in the order the server gives
// them, each holding the files the operator uploaded into it.
export async function loadCustomTracks(): Promise<void> {
  try {
    const res = await fetch('/music/manifest.json');
    if (!res.ok) return;
    const rows: { name: string; url: string; vibe: string }[] = await res.json();
    const byList = new Map<string, Track[]>();
    for (const r of rows) {
      const list = r.vibe || 'Music';
      if (!byList.has(list)) byList.set(list, []);
      byList.get(list)!.push({ id: `f:${r.url}`, name: r.name, url: r.url });
    }
    playlists = [...byList.entries()].map(([name, list]) => ({
      id: `p:${name.toLowerCase()}`,
      name,
      tracks: list,
    }));
    if (!playlists.some(v => v.id === vibeId)) {
      vibeId = playlists[0]?.id ?? '';
      trackIndex = 0;
    }
    emit();
  } catch { /* leave the library as it is */ }
}

function play(): void {
  const t = tracks()[trackIndex];
  const a = audio();
  if (!t) { playing = false; a.pause(); emit(); return; }
  if (a.src !== new URL(t.url, location.href).href) a.src = t.url;
  a.loop = repeat === 'one';
  a.volume = ducked ? volume * 0.25 : volume;
  void a.play().catch(() => { playing = false; emit(); });
  playing = true;
  emit();
}

function advance(auto: boolean): void {
  const list = tracks();
  if (!list.length) { playing = false; emit(); return; }

  // A queued track jumps the line before the playlist resumes.
  if (queue.length) {
    const next = queue.shift()!;
    const found = findTrack(next);
    if (found) { vibeId = found.vibe.id; trackIndex = found.index; play(); return; }
  }

  if (shuffle && list.length > 1) {
    let n = trackIndex;
    while (n === trackIndex) n = Math.floor(Math.random() * list.length);
    trackIndex = n;
  } else if (trackIndex + 1 < list.length) {
    trackIndex += 1;
  } else if (repeat === 'all' || !auto) {
    trackIndex = 0;
  } else {
    playing = false;
    audio().pause();
    emit();
    return;
  }
  play();
}

export function startMusic(vol?: number): void {
  if (typeof vol === 'number') volume = vol;
  if (!tracks().length) { emit(); return; }
  play();
}

export function resumeAfterReturn(): void {
  if (playing) void audio().play().catch(() => {});
}

export function stopMusic(): void {
  playing = false;
  audio().pause();
  emit();
}

export function setMusicOn(on: boolean, vol = volume): void {
  volume = vol;
  if (on) startMusic(vol); else stopMusic();
}

export function toggleMusic(): void { setMusicOn(!playing); }
export function nextTrack(): void { advance(false); }

export function prevTrack(): void {
  const list = tracks();
  if (!list.length) return;
  trackIndex = trackIndex > 0 ? trackIndex - 1 : list.length - 1;
  play();
}

export function setVibe(id: string): void {
  vibeId = id;
  trackIndex = 0;
  localStorage.setItem(K.vibe, id);
  if (playing) play(); else emit();
}

export function playTrack(index: number): void {
  trackIndex = index;
  play();
}

export function playTrackById(id: string): void {
  const found = findTrack(id);
  if (!found) return;
  vibeId = found.vibe.id;
  trackIndex = found.index;
  play();
}

export function queueTrack(id: string): void {
  if (!findTrack(id)) return;
  queue.push(id);
  emit();
}

export function removeQueued(index: number): void {
  queue.splice(index, 1);
  emit();
}

export function clearQueue(): void {
  queue = [];
  emit();
}

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem(K.vol, String(volume));
  audio().volume = ducked ? volume * 0.25 : volume;
  emit();
}

export function setRepeat(mode: RepeatMode): void {
  repeat = mode;
  localStorage.setItem(K.repeat, mode);
  audio().loop = mode === 'one';
  emit();
}

export function setShuffle(on: boolean): void {
  shuffle = on;
  localStorage.setItem(K.shuffle, on ? '1' : '0');
  emit();
}

// Music drops back at the table so it never competes with the turn alert.
export function duckForTable(atTable: boolean): void {
  ducked = atTable;
  if (el) el.volume = ducked ? volume * 0.25 : volume;
}
