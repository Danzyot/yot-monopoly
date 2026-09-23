// Operator-uploaded images (board-centre logos, scene backdrops) that hosts
// pick for their room's table style. Files live on the data volume next to an
// index.json; only real images are stored (magic bytes, never names or
// headers), and each gets a random server-minted file name, which is the
// only thing the public route will ever serve.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIBRARY_FILE_RE } from '../../shared/tableStyles.ts';
import { DATA_DIR } from './paths.ts';

export const GRAPHICS_DIR = join(DATA_DIR, 'graphics');
const INDEX_FILE = join(GRAPHICS_DIR, 'index.json');

export const MAX_GRAPHIC_BYTES = 8 * 1024 * 1024;
export const MAX_GRAPHICS = 200;

export interface GraphicRow {
  id: string;
  name: string;
  /** Server-minted: `<id>.<ext>`. */
  file: string;
  size: number;
  type: 'png' | 'jpg' | 'webp' | 'gif';
  addedAt: number;
  addedBy: string;
}

let graphics: GraphicRow[] = [];

export function loadGraphics(): void {
  graphics = [];
  try {
    if (!existsSync(INDEX_FILE)) return;
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    // A row whose file vanished (volume restored from an older backup, say)
    // would list an image nobody can load — drop it.
    graphics = parsed.filter((r: GraphicRow) =>
      typeof r?.file === 'string' && LIBRARY_FILE_RE.test(r.file) && existsSync(join(GRAPHICS_DIR, r.file)));
  } catch (e) {
    console.error('Could not load the graphics index:', e);
  }
}

function saveIndex(): void {
  mkdirSync(GRAPHICS_DIR, { recursive: true });
  const tmp = `${INDEX_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(graphics, null, 1));
  renameSync(tmp, INDEX_FILE);
}

export const graphicUrl = (g: GraphicRow) => `/graphics/lib/${g.file}`;

/** Newest first — the image just uploaded is the one the operator is looking for. */
export function listGraphics(): GraphicRow[] {
  return [...graphics].sort((a, b) => b.addedAt - a.addedAt);
}

export function getGraphic(id: string): GraphicRow | null {
  return graphics.find(g => g.id === id) ?? null;
}

/** Real images only: sniff the container's magic bytes. SVG is refused on purpose (it can carry script). */
export function sniffImage(data: Buffer): GraphicRow['type'] | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const gif = data.subarray(0, 6).toString('latin1');
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  return null;
}

const cleanName = (name: string) => name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);

export function addGraphic(name: string, data: Buffer, by: string): GraphicRow {
  if (graphics.length >= MAX_GRAPHICS) throw new Error(`The library is full (${MAX_GRAPHICS} images) — delete some first`);
  if (data.length === 0) throw new Error('The file arrived empty — try again');
  if (data.length > MAX_GRAPHIC_BYTES) throw new Error(`Image too large (max ${MAX_GRAPHIC_BYTES / 1048576} MB)`);
  const type = sniffImage(data);
  if (!type) throw new Error('Not a supported image (png, jpg, webp or gif)');
  const id = randomBytes(8).toString('hex');
  const file = `${id}.${type}`;
  mkdirSync(GRAPHICS_DIR, { recursive: true });
  writeFileSync(join(GRAPHICS_DIR, file), data);
  const row: GraphicRow = {
    id, name: cleanName(name) || 'Untitled', file, size: data.length, type, addedAt: Date.now(), addedBy: by.slice(0, 60),
  };
  graphics.push(row);
  try {
    saveIndex();
  } catch (e) {
    // Unlisted files would be unreachable forever; undo rather than half-save.
    graphics = graphics.filter(g => g !== row);
    rmSync(join(GRAPHICS_DIR, file), { force: true });
    throw e;
  }
  return row;
}

export function renameGraphic(id: string, name: string): GraphicRow {
  const row = getGraphic(id);
  if (!row) throw new Error('No such image');
  const clean = cleanName(name);
  if (!clean) throw new Error('Give it a name');
  row.name = clean;
  saveIndex();
  return row;
}

export function removeGraphic(id: string): GraphicRow | null {
  const row = getGraphic(id);
  if (!row) return null;
  graphics = graphics.filter(g => g !== row);
  saveIndex();
  try { rmSync(join(GRAPHICS_DIR, row.file), { force: true }); } catch { /* unlisted either way */ }
  return row;
}

/** Absolute path for a public request, or null. Only minted names that are in the index resolve. */
export function graphicFilePath(file: string): string | null {
  if (!LIBRARY_FILE_RE.test(file)) return null;
  if (!graphics.some(g => g.file === file)) return null;
  const full = join(GRAPHICS_DIR, file);
  return existsSync(full) ? full : null;
}

export function isLibraryFile(file: string): boolean {
  return graphics.some(g => g.file === file);
}
