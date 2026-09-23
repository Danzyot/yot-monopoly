// Operator-uploaded site music (ported from the poker room's library).
//
// Files live on the data volume (DATA_DIR/music) so they survive deploys; an
// index.json beside them holds the name/playlist metadata. The public
// /music/manifest.json lists them and the client's player merges them with
// its built-in generative playlist, so an upload reaches every player without
// a code change or a rebuild.
//
// A playlist is nothing more than the name its songs carry. That keeps the
// store to one list of rows, and it is why "rename a playlist" rewrites every
// matching song at once and an emptied playlist simply stops existing.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './paths.ts';

export const MUSIC_DIR = join(DATA_DIR, 'music');
const INDEX_FILE = join(MUSIC_DIR, 'index.json');

export const MAX_SONG_BYTES = 40 * 1024 * 1024;
export const MAX_SONGS = 300;
const MAX_NAME = 80;
const MAX_PLAYLIST = 40;

export interface SongRow {
  id: string;
  name: string;
  playlist: string;
  /** Server-minted filename inside MUSIC_DIR: `<16 hex>.<ext>`. */
  file: string;
  size: number;
  addedAt: number;
}

let songs: SongRow[] = [];

export function loadSongs(): void {
  songs = [];
  try {
    if (!existsSync(INDEX_FILE)) return;
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    // Drop rows whose audio has vanished (volume wiped, file removed by hand)
    // and anything whose filename we would refuse to serve anyway.
    songs = parsed.filter((r: SongRow) =>
      r && typeof r.file === 'string' && FILE_RE.test(r.file) && existsSync(join(MUSIC_DIR, r.file)));
  } catch (e) {
    console.error('Could not load music index:', e);
  }
}

// Temp file + rename, like jsonstore.ts: a crash mid-write never leaves a
// half-written index that would orphan every file on the volume.
function saveIndex(): void {
  mkdirSync(MUSIC_DIR, { recursive: true });
  const tmp = `${INDEX_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(songs));
  renameSync(tmp, INDEX_FILE);
}

export function listSongs(): SongRow[] {
  return [...songs].sort((a, b) => a.playlist.localeCompare(b.playlist) || a.addedAt - b.addedAt);
}

// Only real audio gets stored — sniff the container's magic bytes rather than
// trusting a filename or Content-Type, both of which the uploader controls.
export function sniffAudio(data: Buffer): 'mp3' | 'ogg' | 'wav' | 'm4a' | null {
  if (data.length < 12) return null;
  if (data.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  // Bare MPEG frame sync: 11 set bits. Layer bits 00 are "reserved", which
  // rules out random bytes that merely start with 0xFF.
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0) return 'mp3';
  if (data.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF'
    && data.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (data.subarray(4, 8).toString('latin1') === 'ftyp') return 'm4a';
  return null;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// "lounge" typed into the upload box joins the existing "Lounge" rather than
// starting a second playlist that differs only in case.
function canonicalPlaylist(name: string): string {
  const hit = songs.find(s => s.playlist.toLowerCase() === name.toLowerCase());
  return hit ? hit.playlist : name;
}

export function addSong(name: string, playlist: string, data: Buffer): SongRow {
  if (songs.length >= MAX_SONGS) throw new Error(`Library is full (${MAX_SONGS} songs)`);
  if (data.length === 0) throw new Error('The file arrived empty — try again');
  if (data.length > MAX_SONG_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_SONG_BYTES / 1048576)} MB)`);
  }
  const ext = sniffAudio(data);
  if (!ext) throw new Error('Not a recognised audio file (mp3, m4a, ogg or wav)');
  const id = randomBytes(8).toString('hex');
  const file = `${id}.${ext}`;
  mkdirSync(MUSIC_DIR, { recursive: true });
  writeFileSync(join(MUSIC_DIR, file), data);
  const row: SongRow = {
    id,
    name: clean(name, MAX_NAME) || 'Untitled',
    playlist: canonicalPlaylist(clean(playlist, MAX_PLAYLIST) || 'Music'),
    file, size: data.length, addedAt: Date.now(),
  };
  songs.push(row);
  try { saveIndex(); } catch (e) {
    // Unwind so the library never holds a file the index does not know about.
    songs = songs.filter(s => s !== row);
    rmSync(join(MUSIC_DIR, file), { force: true });
    throw e;
  }
  return row;
}

export function getSong(id: string): SongRow | null {
  return songs.find(s => s.id === id) ?? null;
}

/** Rename a song and/or move it to another playlist. */
export function updateSong(id: string, patch: { name?: string; playlist?: string }): SongRow | null {
  const row = songs.find(s => s.id === id);
  if (!row) return null;
  const name = clean(patch.name, MAX_NAME);
  const playlist = clean(patch.playlist, MAX_PLAYLIST);
  if (name) row.name = name;
  if (playlist) row.playlist = canonicalPlaylist(playlist);
  saveIndex();
  return row;
}

// Case-insensitive, so "lounge" and "Lounge" are one playlist, not two that
// look identical in the picker.
export function renamePlaylist(from: string, to: string): number {
  const before = clean(from, 200);
  const after = clean(to, MAX_PLAYLIST);
  if (!before || !after) throw new Error('Both names are required');
  let moved = 0;
  for (const row of songs) {
    if (row.playlist.toLowerCase() === before.toLowerCase()) { row.playlist = after; moved += 1; }
  }
  if (moved) saveIndex();
  return moved;
}

export function listPlaylists(): { name: string; count: number }[] {
  const seen = new Map<string, { name: string; count: number }>();
  for (const row of songs) {
    const key = row.playlist.toLowerCase();
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { name: row.playlist, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeSong(id: string): SongRow | null {
  const row = songs.find(s => s.id === id);
  if (!row) return null;
  songs = songs.filter(s => s.id !== id);
  saveIndex();
  try { rmSync(join(MUSIC_DIR, row.file), { force: true }); } catch { /* the row is gone either way */ }
  return row;
}

// The only filenames ever served: ones we minted (hex id + known extension).
// Anything caller-shaped — "../", encoded slashes, index.json — fails here.
const FILE_RE = /^[0-9a-f]{16}\.(mp3|m4a|ogg|wav)$/;

export function isSafeSongFile(file: string): boolean {
  return FILE_RE.test(file);
}

/** Resolve a public /music/lib/<file> request to a real path, or null. */
export function songFilePath(file: string): string | null {
  if (!isSafeSongFile(file)) return null;
  if (!songs.some(s => s.file === file)) return null;
  const full = join(MUSIC_DIR, file);
  return existsSync(full) ? full : null;
}

export interface ManifestRow { id: string; name: string; url: string; playlist: string }

/** Rows for the public manifest, in the shape the client's player reads. */
export function manifestRows(): ManifestRow[] {
  return listSongs().map(s => ({ id: s.id, name: s.name, url: `/music/lib/${s.file}`, playlist: s.playlist }));
}
