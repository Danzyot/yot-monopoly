// Per-room table looks: the host picks a table finish, and optionally a
// centre logo and a backdrop image from the operator's graphics library.
//
// Shared so the server can pin whatever arrives over the wire to something
// real, and the client can draw the same presets it offers as swatches.

export interface TableStyle {
  /** One of TABLE_PRESETS' ids. 'edition' = the edition's own table colour. */
  table: string;
  /** Replaces the edition's centre artwork on the board face. */
  boardLogoUrl: string | null;
  /** Shown behind the whole scene instead of the edition's sky colour. */
  backgroundUrl: string | null;
}

export interface TablePreset {
  id: string;
  name: string;
  /** null = use the edition's palette.table. */
  color: string | null;
  roughness: number;
  metalness: number;
  /** CSS background for the lobby swatch. */
  swatch: string;
}

export const TABLE_PRESETS: readonly TablePreset[] = [
  { id: 'edition', name: 'Default', color: null, roughness: 0.85, metalness: 0, swatch: 'linear-gradient(135deg, #555 0 50%, #999 50% 100%)' },
  { id: 'walnut', name: 'Walnut', color: '#5a3a22', roughness: 0.55, metalness: 0.05, swatch: 'linear-gradient(135deg, #6e4a2c, #3e2615)' },
  { id: 'felt', name: 'Felt green', color: '#1d6b3a', roughness: 1, metalness: 0, swatch: 'radial-gradient(circle at 40% 35%, #2a8a4d, #145028)' },
  { id: 'midnight', name: 'Midnight', color: '#16203a', roughness: 0.5, metalness: 0.2, swatch: 'radial-gradient(circle at 40% 35%, #26345c, #0b1122)' },
  { id: 'royal', name: 'Royal purple', color: '#4b1f7a', roughness: 0.7, metalness: 0.1, swatch: 'radial-gradient(circle at 40% 35%, #6a33a8, #2e0f4f)' },
  { id: 'marble', name: 'Marble white', color: '#e8e6e1', roughness: 0.25, metalness: 0.05, swatch: 'linear-gradient(135deg, #f4f3ef 0%, #d9d6cf 45%, #f7f6f2 55%, #cfcbc2 100%)' },
  { id: 'carbon', name: 'Carbon', color: '#1c1d20', roughness: 0.35, metalness: 0.6, swatch: 'repeating-linear-gradient(45deg, #26282c 0 4px, #16171a 4px 8px)' },
];

export const DEFAULT_TABLE_STYLE: TableStyle = { table: 'edition', boardLogoUrl: null, backgroundUrl: null };

export function getTablePreset(id: string | null | undefined): TablePreset {
  return TABLE_PRESETS.find(p => p.id === id) ?? TABLE_PRESETS[0];
}

/** Files the server mints for the graphics library: 16 hex chars + image extension. */
export const LIBRARY_FILE_RE = /^[0-9a-f]{16}\.(png|jpg|webp|gif)$/;
const LIBRARY_PREFIX = '/graphics/lib/';

/**
 * An image a room may point at: one of ours (by its minted name) or a plain
 * https URL. Anything else — javascript:, data:, relative paths, http — is
 * dropped, since every viewer's browser will fetch it.
 */
export function cleanAssetUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 500) return null;
  if (s.startsWith(LIBRARY_PREFIX)) return LIBRARY_FILE_RE.test(s.slice(LIBRARY_PREFIX.length)) ? s : null;
  if (!s.startsWith('https://')) return null;
  try {
    const u = new URL(s);
    // No credentials in the URL, and no characters that would need escaping
    // when the client puts it into CSS.
    if (u.protocol !== 'https:' || u.username || u.password || /[\s"'()\\<>]/.test(s)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Library file name inside a /graphics/lib/ URL, or null for anything else. */
export function libraryFileOf(url: string | null): string | null {
  return url && url.startsWith(LIBRARY_PREFIX) ? url.slice(LIBRARY_PREFIX.length) : null;
}

/** Pin a style from the wire (or an old snapshot) to something safe to store and show. */
export function sanitizeTableStyle(raw: unknown): TableStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    table: TABLE_PRESETS.some(p => p.id === r.table) ? String(r.table) : DEFAULT_TABLE_STYLE.table,
    boardLogoUrl: cleanAssetUrl(r.boardLogoUrl),
    backgroundUrl: cleanAssetUrl(r.backgroundUrl),
  };
}
