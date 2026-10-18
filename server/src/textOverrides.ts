// Demo-mode text edits. Overrides are keyed by the ORIGINAL on-page string, so
// the client can apply them to any text node without knowing which component
// rendered it. Stored as one small JSON file on the data volume.
import { readJson, writeJson } from './jsonstore.ts';

const FILE = 'text-overrides.json';
export const MAX_TEXT_LEN = 300;
export const MAX_OVERRIDES = 400;

let overrides: Record<string, string> = {};

/** Collapse whitespace and drop control characters; the client matches on this form. */
export function normaliseText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Throws a user-readable error unless this is plain text of a sensible size. */
export function cleanText(raw: unknown, what: string): string {
  if (typeof raw !== 'string') throw new Error(`${what} must be text`);
  const s = normaliseText(raw);
  if (!s) throw new Error(`${what} is empty`);
  if (s.length > MAX_TEXT_LEN) throw new Error(`${what} is too long (max ${MAX_TEXT_LEN} characters)`);
  if (/[<>]/.test(s)) throw new Error(`${what} must be plain text — no HTML`);
  return s;
}

export function loadTextOverrides(): void {
  const raw = readJson<Record<string, unknown>>(FILE, {});
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    try { next[cleanText(k, 'original')] = cleanText(v, 'text'); } catch { /* skip a bad row */ }
  }
  overrides = next;
}

export function getTextOverrides(): Record<string, string> {
  return { ...overrides };
}

/**
 * Set (text is a string) or reset (text is null/empty) one override.
 * Write first, believe it second, like the feature switches.
 */
export function setTextOverride(originalRaw: unknown, textRaw: unknown): Record<string, string> {
  const original = cleanText(originalRaw, 'The original text');
  const next = { ...overrides };
  if (textRaw === null || textRaw === undefined || (typeof textRaw === 'string' && !normaliseText(textRaw))) {
    delete next[original];
  } else {
    const text = cleanText(textRaw, 'The new text');
    if (text === original) delete next[original];
    else {
      if (!(original in next) && Object.keys(next).length >= MAX_OVERRIDES) {
        throw new Error(`Too many edits (max ${MAX_OVERRIDES}) — reset some first`);
      }
      next[original] = text;
    }
  }
  writeJson(FILE, next);
  overrides = next;
  return { ...overrides };
}
