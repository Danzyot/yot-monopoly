// Email addresses and notification choices, by account, in email.json on the
// data volume. Kept apart from accounts.json on purpose: nothing that builds a
// public answer (profiles, the leaderboard, cards, the ticker, bot replies, the
// dashboard's Players tab) reads this file, so none of it can leak an address.
//
// The address comes only from Discord sign-in (the `email` scope) and is
// refreshed on every Discord sign-in. Code-verify and the Verify button get no
// address from Discord; those players add one by signing in with Discord once.
import { debouncedWriter, readJson, writeJson } from '../jsonstore.ts';
import { EMAIL_TOPICS, EMAIL_TOPIC_IDS, defaultTopics, isEmailTopic, type EmailTopic, type EmailTopics } from '../../../shared/email.ts';

export interface EmailRecord {
  email: string | null;
  /** Discord's `verified` flag for that address. */
  verified: boolean;
  /** When Discord last told us (a sign-in). */
  updatedAt: number;
  /** Only the topics the player chose; the rest are their defaults. */
  topics: Partial<EmailTopics>;
  /** When each topic was last switched on (the record of the opt-in). */
  consentAt: Partial<Record<EmailTopic, number>>;
  bouncedAt?: number;
  complainedAt?: number;
}

const FILE = 'email.json';
let records: Record<string, EmailRecord> = {};
let save = debouncedWriter(FILE, () => records, 1_000);
let dirty = false;
const changed = () => { dirty = true; save(); };
process.once('exit', () => {
  if (!dirty) return;
  try { writeJson(FILE, records); } catch (e) { console.error(`Could not save ${FILE}:`, e); }
});

/** Plausible, bounded, lower-cased. Discord has checked it already; this only keeps junk out of the file. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e)) return null;
  return e;
}

export function loadEmailStore(): void {
  const raw = readJson<Record<string, Partial<EmailRecord>>>(FILE, {});
  records = {};
  for (const [id, r] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!r || typeof r !== 'object') continue;
    const topics: Partial<EmailTopics> = {};
    for (const [k, v] of Object.entries(r.topics ?? {})) if (isEmailTopic(k) && typeof v === 'boolean') topics[k] = v;
    records[id] = {
      email: cleanEmail(r.email),
      verified: r.verified === true,
      updatedAt: Number(r.updatedAt) || 0,
      topics,
      consentAt: r.consentAt && typeof r.consentAt === 'object' ? { ...r.consentAt } : {},
      ...(r.bouncedAt ? { bouncedAt: Number(r.bouncedAt) } : {}),
      ...(r.complainedAt ? { complainedAt: Number(r.complainedAt) } : {}),
    };
  }
}

/** For tests: start empty, saving nowhere. */
export function resetEmailStore(): void {
  records = {};
  dirty = false;
}

function row(id: string): EmailRecord {
  return records[id] ??= { email: null, verified: false, updatedAt: 0, topics: {}, consentAt: {} };
}

/**
 * A Discord sign-in: keep the address and its verified flag. A new address
 * clears a bounce recorded against the old one. Choices are the player's and stay.
 */
export function recordDiscordEmail(id: string, rawEmail: unknown, verified: unknown, now = Date.now()): void {
  const email = cleanEmail(rawEmail);
  const r = records[id];
  if (!email && !r) return; // nothing to keep, and no row to make
  const x = row(id);
  if (x.email !== email) delete x.bouncedAt;
  x.email = email;
  x.verified = !!email && verified === true;
  x.updatedAt = now;
  changed();
}

export function emailRecord(id: string): Readonly<EmailRecord> | null {
  return records[id] ?? null;
}

export function topicsOf(id: string): EmailTopics {
  return { ...defaultTopics(), ...(records[id]?.topics ?? {}) };
}

/**
 * The player's own choice. Turning anything on records when (consent) and lifts a
 * spam-report stop; a bounce stays until Discord gives a different address.
 */
export function setTopics(id: string, input: unknown, now = Date.now()): EmailTopics {
  const x = row(id);
  const before = topicsOf(id);
  const obj = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  for (const t of EMAIL_TOPIC_IDS) {
    if (typeof obj[t] !== 'boolean') continue;
    const on = obj[t] as boolean;
    x.topics[t] = on;
    if (on && !before[t]) x.consentAt[t] = now;
  }
  if (EMAIL_TOPIC_IDS.some(t => obj[t] === true)) delete x.complainedAt;
  changed();
  return topicsOf(id);
}

/** One-click unsubscribe: one topic, or every one ('all'). */
export function unsubscribe(id: string, topic: EmailTopic | 'all'): void {
  const x = row(id);
  for (const t of topic === 'all' ? EMAIL_TOPIC_IDS : [topic]) x.topics[t] = false;
  changed();
}

/** Resend reported a hard bounce or a spam report for this address. Returns the accounts it applied to. */
export function markDelivery(email: string, kind: 'bounced' | 'complained', now = Date.now()): string[] {
  const e = cleanEmail(email);
  if (!e) return [];
  const hit: string[] = [];
  for (const [id, r] of Object.entries(records)) {
    if (r.email !== e) continue;
    if (kind === 'bounced') r.bouncedAt = now;
    else {
      r.complainedAt = now;
      // A spam report means "stop": everything optional goes off.
      for (const t of EMAIL_TOPIC_IDS) if (t !== 'account') r.topics[t] = false;
    }
    hit.push(id);
  }
  if (hit.length) changed();
  return hit;
}

export function suppression(id: string): 'bounced' | 'complained' | null {
  const r = records[id];
  return r?.bouncedAt ? 'bounced' : r?.complainedAt ? 'complained' : null;
}

/** The address mail for `topic` may go to now, or null: verified, not stopped, topic on. */
export function deliverableAddress(id: string, topic: EmailTopic): string | null {
  const r = records[id];
  if (!r?.email || !r.verified || r.bouncedAt || r.complainedAt) return null;
  return topicsOf(id)[topic] ? r.email : null;
}

/** Everyone who would get `topic` right now. */
export function subscribers(topic: EmailTopic): string[] {
  return Object.keys(records).filter(id => deliverableAddress(id, topic));
}

export function emailStats(): { accounts: number; withEmail: number; verified: number; suppressed: number; topics: Record<EmailTopic, number> } {
  const all = Object.keys(records);
  return {
    accounts: all.length,
    withEmail: all.filter(id => records[id].email).length,
    verified: all.filter(id => records[id].email && records[id].verified).length,
    suppressed: all.filter(id => suppression(id)).length,
    topics: Object.fromEntries(EMAIL_TOPICS.map(t => [t.id, subscribers(t.id).length])) as Record<EmailTopic, number>,
  };
}

/** The operator's CSV export: verified, deliverable addresses with at least one optional topic on. */
export function exportRows(): { id: string; email: string; topics: EmailTopic[] }[] {
  const out: { id: string; email: string; topics: EmailTopic[] }[] = [];
  for (const id of Object.keys(records)) {
    const topics = EMAIL_TOPIC_IDS.filter(t => t !== 'account' && deliverableAddress(id, t));
    if (topics.length) out.push({ id, email: records[id].email!, topics });
  }
  return out;
}

/** A deleted player (erase.ts): the address and every choice go. */
export function eraseEmail(id: string): boolean {
  if (!records[id]) return false;
  delete records[id];
  changed();
  return true;
}

/** For tests: write now, on a fresh debounce. */
export function flushEmailStore(): void {
  writeJson(FILE, records);
  save = debouncedWriter(FILE, () => records, 1_000);
}
