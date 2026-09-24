// Chat rules shared by every room: rate limit, length, blocked language and
// per-player mutes (set by operators).
import { CHAT_COOLDOWN_MS } from '../../shared/types.ts';
import { readJson, writeJson } from './jsonstore.ts';

const SEP = '[^a-z0-9]{0,3}';
const BLOCKED = [
  new RegExp(`n${SEP}[i1!|]${SEP}g${SEP}g+${SEP}[e3]*${SEP}r`, 'i'),
  new RegExp(`n${SEP}[i1!|]${SEP}g${SEP}g+${SEP}a(?!rd)`, 'i'),
  new RegExp(`f${SEP}[a@4]${SEP}g${SEP}g?${SEP}[o0]${SEP}t`, 'i'),
];

export function isBlocked(text: string): boolean {
  return BLOCKED.some(re => re.test(text.toLowerCase()));
}

/** A refusal the sender should read (muted, too fast, blocked), not a server fault. */
export class ChatError extends Error {}

const lastSent = new Map<string, number>();

/** Throws with a human-readable reason when the message may not be sent. */
export function checkChat(playerId: string, raw: unknown): string {
  if (isMuted(playerId)) throw new ChatError('You are muted');
  const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  if (!text) throw new ChatError('Empty message');
  if (isBlocked(text)) throw new ChatError('That message was blocked');
  const now = Date.now();
  const last = lastSent.get(playerId) ?? 0;
  if (now - last < CHAT_COOLDOWN_MS) throw new ChatError('Slow down');
  lastSent.set(playerId, now);
  if (lastSent.size > 50_000) lastSent.clear();
  return text;
}

// ---- mutes ----
const FILE = 'mutes.json';
let mutes: Record<string, { name: string; until: number | null; by: string }> = {};

export function loadMutes(): void {
  mutes = readJson(FILE, {});
}

export function isMuted(id: string): boolean {
  const m = mutes[id];
  return !!m && (m.until === null || m.until > Date.now());
}

export function setMute(id: string, name: string, minutes: number | null, by: string): void {
  if (minutes === 0) delete mutes[id];
  else mutes[id] = { name, until: minutes ? Date.now() + minutes * 60_000 : null, by };
  writeJson(FILE, mutes);
}

export function listMutes() {
  return Object.entries(mutes)
    .filter(([id]) => isMuted(id))
    .map(([id, m]) => ({ id, ...m }));
}
