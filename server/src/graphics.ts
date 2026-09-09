// Operator-uploaded table graphics (felt backgrounds, center logos). Same
// shape as the music library: files on the persistent volume, an index.json
// beside them, magic-byte sniffing so only real images are stored.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { TableTheme } from '../../shared/types.ts';
import { DATA_DIR } from './paths.ts';

export const GRAPHICS_DIR = join(DATA_DIR, 'graphics');
const INDEX_FILE = join(GRAPHICS_DIR, 'index.json');

export const MAX_GRAPHIC_BYTES = 8 * 1024 * 1024;
export const MAX_GRAPHICS = 100;

// Felt presets the client knows how to render. Kept here so a theme coming
// in over the wire can be pinned to a real one.
export const FELT_IDS = ['chog', 'green', 'midnight', 'wine', 'carbon', 'royal'] as const;

export interface GraphicRow {
  id: string;
  name: string;
  file: string;
  size: number;
  addedAt: number;
}

let graphics: GraphicRow[] = [];

export function loadGraphics(): void {
  try {
    if (existsSync(INDEX_FILE)) {
      const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        graphics = parsed.filter((r: GraphicRow) => r?.file && existsSync(join(GRAPHICS_DIR, r.file)));
      }
    }
  } catch (e) {
    console.error('Could not load graphics index:', e);
  }
}

function saveIndex(): void {
  mkdirSync(GRAPHICS_DIR, { recursive: true });
  const tmp = `${INDEX_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(graphics));
  renameSync(tmp, INDEX_FILE);
}

export function listGraphics(): GraphicRow[] {
  return [...graphics].sort((a, b) => a.addedAt - b.addedAt);
}

// Real images only — sniff container magic, never trust names or headers.
export function sniffImage(data: Buffer): string | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF'
    && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (data.subarray(0, 6).toString('latin1') === 'GIF87a'
    || data.subarray(0, 6).toString('latin1') === 'GIF89a') return 'gif';
  return null;
}

export function addGraphic(name: string, data: Buffer): GraphicRow {
  if (graphics.length >= MAX_GRAPHICS) throw new Error(`Graphics library is full (${MAX_GRAPHICS})`);
  if (data.length === 0) throw new Error('The file arrived empty — try again');
  if (data.length > MAX_GRAPHIC_BYTES) {
    throw new Error(`Image too large (max ${Math.round(MAX_GRAPHIC_BYTES / 1048576)} MB)`);
  }
  const ext = sniffImage(data);
  if (!ext) throw new Error('Not a recognized image (png, jpg, webp or gif)');
  const id = randomBytes(8).toString('hex');
  const file = `${id}.${ext}`;
  mkdirSync(GRAPHICS_DIR, { recursive: true });
  writeFileSync(join(GRAPHICS_DIR, file), data);
  const row: GraphicRow = {
    id, name: name.trim().slice(0, 80) || 'Untitled', file, size: data.length, addedAt: Date.now(),
  };
  graphics.push(row);
  saveIndex();
  return row;
}

export function removeGraphic(id: string): boolean {
  const row = graphics.find(g => g.id === id);
  if (!row) return false;
  graphics = graphics.filter(g => g.id !== id);
  try { rmSync(join(GRAPHICS_DIR, row.file), { force: true }); } catch { /* row is gone either way */ }
  saveIndex();
  return true;
}

// Public serving: only server-minted filenames resolve.
export function graphicFilePath(file: string): string | null {
  if (!/^[0-9a-f]{16}\.(png|jpg|webp|gif)$/.test(file)) return null;
  if (!graphics.some(g => g.file === file)) return null;
  const full = join(GRAPHICS_DIR, file);
  return existsSync(full) ? full : null;
}

// Pin a theme from the wire to something safe to store and serve: a known
// felt preset, and image urls that are either ours or plain https.
export function sanitizeTheme(raw: unknown): TableTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { felt?: unknown; logoUrl?: unknown; backgroundUrl?: unknown };
  const felt = FELT_IDS.includes(r.felt as typeof FELT_IDS[number])
    ? String(r.felt)
    : 'chog';
  const url = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim().slice(0, 300);
    if (s.startsWith('/graphics/lib/') || s.startsWith('https://')) return s;
    return null;
  };
  const logoUrl = url(r.logoUrl);
  const backgroundUrl = url(r.backgroundUrl);
  if (felt === 'chog' && !logoUrl && !backgroundUrl) return null; // default look
  return { felt, logoUrl, backgroundUrl };
}
