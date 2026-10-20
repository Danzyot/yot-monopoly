// Operator edits to the info pages (/terms, /privacy, /fair-play). The
// defaults live in shared/legal.ts; an edit replaces a page's title and body
// and stamps today's date. Kept in one small JSON file on the data volume.
import { DEFAULT_LEGAL, LEGAL_LIMITS, LEGAL_SLUGS, isLegalSlug, type LegalPage, type LegalSlug } from '../../shared/legal.ts';
import { readJson, writeJson } from './jsonstore.ts';

const FILE = 'legal-pages.json';
type Edit = { title: string; body: string; updated: string };
let edits: Partial<Record<LegalSlug, Edit>> = {};

function clean(raw: unknown, what: string, max: number, multiline: boolean): string {
  if (typeof raw !== 'string') throw new Error(`${what} must be text`);
  // eslint-disable-next-line no-control-regex
  let s = raw.replace(/\r\n?/g, '\n').replace(multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, ' ');
  s = multiline ? s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() : s.replace(/\s+/g, ' ').trim();
  if (!s) throw new Error(`${what} is empty`);
  if (s.length > max) throw new Error(`${what} is too long (max ${max.toLocaleString('en')} characters)`);
  return s;
}

export function loadLegal(): void {
  const raw = readJson<Record<string, unknown>>(FILE, {});
  const next: typeof edits = {};
  for (const slug of LEGAL_SLUGS) {
    const e = raw[slug] as Partial<Edit> | undefined;
    if (!e) continue;
    try {
      next[slug] = {
        title: clean(e.title, 'title', LEGAL_LIMITS.title, false),
        body: clean(e.body, 'body', LEGAL_LIMITS.body, true),
        updated: typeof e.updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.updated) ? e.updated : DEFAULT_LEGAL[slug].updated,
      };
    } catch { /* a bad row: the default stands */ }
  }
  edits = next;
}

export function getLegal(slug: LegalSlug): LegalPage & { edited: boolean } {
  const e = edits[slug];
  return e ? { slug, ...e, edited: true } : { ...DEFAULT_LEGAL[slug], edited: false };
}

/** Save an operator's version (stamped today). Throws a readable error on bad input. */
export function setLegal(slugRaw: unknown, titleRaw: unknown, bodyRaw: unknown, now = new Date()): LegalPage & { edited: boolean } {
  if (!isLegalSlug(slugRaw)) throw new Error('Unknown page');
  const edit: Edit = {
    title: clean(titleRaw, 'The title', LEGAL_LIMITS.title, false),
    body: clean(bodyRaw, 'The text', LEGAL_LIMITS.body, true),
    updated: now.toISOString().slice(0, 10),
  };
  const next = { ...edits, [slugRaw]: edit };
  writeJson(FILE, next);
  edits = next;
  return getLegal(slugRaw);
}

/** Back to the built-in words. */
export function resetLegal(slugRaw: unknown): LegalPage & { edited: boolean } {
  if (!isLegalSlug(slugRaw)) throw new Error('Unknown page');
  const next = { ...edits };
  delete next[slugRaw];
  writeJson(FILE, next);
  edits = next;
  return getLegal(slugRaw);
}
