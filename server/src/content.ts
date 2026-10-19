// Operator content overrides (dashboard → Content): space names, card text,
// look names and currency, character and mini-game names. One JSON file on the
// data volume, like the site-text edits; applied to the shared catalogues on
// load and on every save, so new games resolve their theme with them and the
// engine's log lines use the new names.
import { stripInvisible } from './auth.ts';
import { readJson, writeJson } from './jsonstore.ts';
import { applyContentOverrides, checkContentItem, contentDefault, contentLimit } from '../../shared/content.ts';
import {
  CONTENT_KINDS, boardKey, cardKey, currentContent, emptyContent, withOverride,
  type ContentItem, type ContentKind, type ContentOverrides,
} from '../../shared/contentOverrides.ts';
import { getMap } from '../../shared/maps.ts';

const FILE = 'content-overrides.json';

/** Invisible, control and bidi characters out; whitespace collapsed. */
export function normaliseContent(s: string): string {
  return stripInvisible(s.normalize('NFC')).replace(/\s+/g, ' ').trim();
}

/**
 * Throws a user-readable error unless `raw` is fit to store for `item`;
 * returns the cleaned text, or null when it is blank (= reset).
 */
export function cleanContent(item: ContentItem, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new Error('The text must be a string');
  const s = normaliseContent(raw);
  if (!s) return null;
  const max = contentLimit(item);
  if (Array.from(s).length > max) throw new Error(`Too long (max ${max} characters)`);
  if (item.kind === 'card') {
    // {12} means "the name of space 12"; anything else in braces is a typo.
    const n = getMap(item.map).spaces.length;
    for (const m of s.matchAll(/\{([^}]*)\}/g)) {
      const k = m[1];
      if (k === 'jail') continue;
      if (!/^\d+$/.test(k) || Number(k) >= n) throw new Error(`{${k}} is not a space on this board (use {0}–{${n - 1}} or {jail})`);
    }
  }
  return s;
}

/** Re-check every stored row; a bad one is dropped rather than failing the load. */
function sanitise(raw: unknown): ContentOverrides {
  const x = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ContentOverrides, unknown>>;
  let out = emptyContent();
  const rows = (t: unknown) => Object.entries(t && typeof t === 'object' ? t as Record<string, unknown> : {})
    .flatMap(([outer, row]) => Object.entries(row && typeof row === 'object' ? row as Record<string, unknown> : {})
      .map(([inner, v]) => ({ outer, inner, v })));
  const add = (item: Record<string, unknown>, v: unknown) => {
    try {
      const it = checkContentItem(item);
      const text = cleanContent(it, v);
      if (text !== null && text !== contentDefault(it)) out = withOverride(out, it, text);
    } catch { /* skip a bad row */ }
  };
  for (const { outer, inner, v } of rows(x.spaces)) {
    const [theme, map] = outer.split(':');
    add({ kind: 'space', theme, map, index: Number(inner) }, v);
  }
  for (const { outer, inner, v } of rows(x.cards)) {
    const [theme, map] = outer.split(':');
    const [deck, index] = inner.split(':');
    add({ kind: 'card', theme, map, deck, index: Number(index) }, v);
  }
  for (const { outer, inner, v } of rows(x.editions)) add({ kind: 'edition', id: outer, field: inner }, v);
  for (const { outer, inner, v } of rows(x.characters)) add({ kind: 'character', id: outer, field: inner }, v);
  for (const { outer, inner, v } of rows(x.minigames)) add({ kind: 'minigame', id: outer, field: inner }, v);
  return out;
}

export function loadContent(): void {
  applyContentOverrides(sanitise(readJson<unknown>(FILE, {})));
}

export function getContent(): ContentOverrides {
  return currentContent();
}

/** Write first, believe it second: a failed write throws and nothing changes. */
function commit(next: ContentOverrides): ContentOverrides {
  writeJson(FILE, next);
  applyContentOverrides(next);
  return currentContent();
}

/**
 * Set (text) or reset (null / blank / the default text) one item. Returns the
 * whole set and a short description for the operator log.
 */
export function setContent(rawItem: unknown, rawText: unknown): { overrides: ContentOverrides; item: ContentItem; text: string | null } {
  const item = checkContentItem(rawItem);
  let text = cleanContent(item, rawText);
  if (text !== null && text === contentDefault(item)) text = null;
  return { overrides: commit(withOverride(currentContent(), item, text)), item, text };
}

/** Reset everything, or one kind (all space names, all cards, …). */
export function resetContent(kind?: unknown): ContentOverrides {
  if (kind === undefined || kind === null || kind === 'all') return commit(emptyContent());
  if (!CONTENT_KINDS.includes(kind as ContentKind)) throw new Error('Unknown kind of content');
  const next: ContentOverrides = { ...currentContent() };
  const field = ({ space: 'spaces', card: 'cards', edition: 'editions', character: 'characters', minigame: 'minigames' } as const)[kind as ContentKind];
  next[field] = {};
  return commit(next);
}

/** "space classic:classic #39", for the operator log. */
export function describeItem(item: ContentItem): string {
  switch (item.kind) {
    case 'space': return `space ${boardKey(item.theme, item.map)} #${item.index}`;
    case 'card': return `card ${boardKey(item.theme, item.map)} ${cardKey(item.deck, item.index)}`;
    default: return `${item.kind} ${item.id}.${item.field}`;
  }
}
