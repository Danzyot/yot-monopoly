// Operator-uploaded site music. Files live on the persistent volume
// (DATA_DIR/music) so they survive deploys; an index.json beside them holds
// name/playlist metadata. The public /music/manifest.json merges these with
// anything shipped in the client build, so the player picks them up with no
// code changes.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DATA_DIR } from './paths.ts';

export const MUSIC_DIR = join(DATA_DIR, 'music');
const INDEX_FILE = join(MUSIC_DIR, 'index.json');

export const MAX_SONG_BYTES = 40 * 1024 * 1024;
export const MAX_SONGS = 300;

export interface SongRow {
  id: string;
  name: string;
  vibe: string; // playlist name; matching a built-in vibe replaces its songs
  file: string; // filename inside MUSIC_DIR
  size: number;
  addedAt: number;
}

let songs: SongRow[] = [];

export function loadSongs(): void {
  try {
    if (existsSync(INDEX_FILE)) {
      const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        // Drop rows whose audio file has vanished (volume wiped, manual delete).
        songs = parsed.filter((r: SongRow) => r?.file && existsSync(join(MUSIC_DIR, r.file)));
      }
    }
  } catch (e) {
    console.error('Could not load music index:', e);
  }
}

function saveIndex(): void {
  mkdirSync(MUSIC_DIR, { recursive: true });
  const tmp = `${INDEX_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(songs));
  renameSync(tmp, INDEX_FILE);
}

export function listSongs(): SongRow[] {
  return [...songs].sort((a, b) => a.vibe.localeCompare(b.vibe) || a.addedAt - b.addedAt);
}

// Only real audio gets stored — sniff the container's magic bytes rather
// than trusting a filename or content-type header.
export function sniffAudio(data: Buffer): string | null {
  if (data.length < 12) return null;
  if (data.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return 'mp3';
  if (data.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF'
    && data.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (data.subarray(4, 8).toString('latin1') === 'ftyp') return 'm4a';
  return null;
}

export function addSong(name: string, vibe: string, data: Buffer): SongRow {
  if (songs.length >= MAX_SONGS) throw new Error(`Library is full (${MAX_SONGS} songs)`);
  if (data.length === 0) throw new Error('The file arrived empty — try again');
  if (data.length > MAX_SONG_BYTES) {
    throw new Error(`File too large (max ${Math.round(MAX_SONG_BYTES / 1048576)} MB)`);
  }
  const ext = sniffAudio(data);
  if (!ext) throw new Error('Not a recognized audio file (mp3, m4a, ogg or wav)');
  const id = randomBytes(8).toString('hex');
  const file = `${id}.${ext}`;
  mkdirSync(MUSIC_DIR, { recursive: true });
  writeFileSync(join(MUSIC_DIR, file), data);
  const row: SongRow = {
    id,
    name: name.trim().slice(0, 80) || 'Untitled',
    vibe: vibe.trim().slice(0, 40) || 'Music',
    file, size: data.length, addedAt: Date.now(),
  };
  songs.push(row);
  saveIndex();
  return row;
}

export function updateSong(id: string, patch: { name?: string; vibe?: string }): SongRow | null {
  const row = songs.find(s => s.id === id);
  if (!row) return null;
  if (typeof patch.name === 'string' && patch.name.trim()) row.name = patch.name.trim().slice(0, 80);
  if (typeof patch.vibe === 'string' && patch.vibe.trim()) row.vibe = patch.vibe.trim().slice(0, 40);
  saveIndex();
  return row;
}

// Rename a whole playlist. The library is grouped by this name, so renaming it
// on every song at once is what "rename the playlist" actually means — there
// is no separate playlist record to keep in step.
export function renamePlaylist(from: string, to: string): number {
  const before = (from ?? '').trim();
  const after = (to ?? '').trim().slice(0, 40);
  if (!before || !after) throw new Error('Both names are required');
  let moved = 0;
  for (const row of songs) {
    if (row.vibe.toLowerCase() === before.toLowerCase()) { row.vibe = after; moved += 1; }
  }
  if (moved) saveIndex();
  return moved;
}

// Every playlist that currently has something in it, with its size.
export function listPlaylists(): { name: string; count: number }[] {
  const seen = new Map<string, { name: string; count: number }>();
  for (const row of songs) {
    const key = row.vibe.toLowerCase();
    const entry = seen.get(key);
    if (entry) entry.count += 1;
    else seen.set(key, { name: row.vibe, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeSong(id: string): boolean {
  const row = songs.find(s => s.id === id);
  if (!row) return false;
  songs = songs.filter(s => s.id !== id);
  try { rmSync(join(MUSIC_DIR, row.file), { force: true }); } catch { /* row is gone either way */ }
  saveIndex();
  return true;
}

// Resolve a public /music/lib/<file> request to a real path — the filename
// must be one we minted (hex id + known extension), never caller-shaped.
export function songFilePath(file: string): string | null {
  if (!/^[0-9a-f]{16}\.(mp3|m4a|ogg|wav)$/.test(file)) return null;
  if (!songs.some(s => s.file === file)) return null;
  const full = join(MUSIC_DIR, file);
  return existsSync(full) ? full : null;
}

// Rows for the public manifest, in the shape the client's music player reads.
export function manifestRows(): { name: string; url: string; vibe: string }[] {
  return listSongs().map(s => ({ name: s.name, url: `/music/lib/${s.file}`, vibe: s.vibe }));
}

// ---------- import a whole library from another deployment ----------
//
// The sibling sites publish two public routes — /music/manifest.json and
// /music/lib/<file> — so one site can read another's library directly. Doing
// the copy here rather than in a browser is not a convenience: an operator's
// machine sits behind whatever antivirus and TLS interception it happens to
// run, and a security suite rewriting CORS headers or substituting
// certificates makes a browser-side copy impossible to complete. The server
// talks to the other server, and none of that is in the path.
export interface ImportResult {
  added: number;
  skipped: number;
  failed: { name: string; why: string }[];
}

// Admin-only, but still worth bounding: an operator pasting a wrong address
// should get an error, not a request to something inside the private network.
function assertPublicHttp(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('That is not a URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('Only http and https addresses can be imported from');
  }
  const h = u.hostname.toLowerCase();
  const private_ = h === 'localhost' || h === '::1' || h.endsWith('.local')
    || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)
    || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (private_ && process.env.ALLOW_PRIVATE_IMPORT !== '1') {
    throw new Error('That address is on a private network');
  }
  return u;
}

export async function importFrom(
  from: string,
  rename: Record<string, string> = {},
): Promise<ImportResult> {
  const base = assertPublicHttp(from).toString().replace(/\/+$/, '');
  const res = await fetch(`${base}/music/manifest.json`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`The source answered HTTP ${res.status}`);
  const rows = await res.json() as { name?: string; url?: string; vibe?: string }[];
  if (!Array.isArray(rows)) throw new Error('The source did not return a song list');

  const have = new Set(songs.map(s => s.name));
  const out: ImportResult = { added: 0, skipped: 0, failed: [] };
  for (const r of rows.slice(0, MAX_SONGS)) {
    const name = String(r?.name ?? '').trim();
    const url = String(r?.url ?? '');
    if (!name || !url) continue;
    if (have.has(name)) { out.skipped++; continue; }
    try {
      const src = /^https?:\/\//.test(url) ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`;
      // Each file gets its own bound: one unreachable song must not hang the
      // whole import, and the operator is watching a spinner while this runs.
      const f = await fetch(src, { signal: AbortSignal.timeout(60_000) });
      if (!f.ok) throw new Error(`HTTP ${f.status}`);
      const buf = Buffer.from(await f.arrayBuffer());
      const vibe = rename[String(r.vibe ?? '')] ?? String(r.vibe ?? '') ?? '';
      addSong(name, vibe, buf);
      have.add(name);
      out.added++;
    } catch (e) {
      out.failed.push({ name, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
