// Sign-In-With-Ethereum style challenges: one pending message per account,
// good for ten minutes, spent on first use (a wrong signature spends it too,
// so a guess costs a round trip). Kept in memory: a restart only means
// pressing Connect again.
import { randomBytes } from 'node:crypto';
import { BRAND } from '../../../shared/brand.ts';

export const NONCE_TTL_MS = 10 * 60_000;
const MAX_PENDING = 10_000;

export interface Challenge {
  nonce: string;
  message: string;
  expiresAt: number;
}

const pending = new Map<string, Challenge>();

export function linkMessage(name: string, nonce: string, issuedAt: number): string {
  return `${BRAND.name} wants to link this wallet to your account ${name}.\n\n`
    + 'Signing is free and sends no transaction.\n\n'
    + `Nonce: ${nonce}\nIssued: ${new Date(issuedAt).toISOString()}`;
}

/** A fresh challenge for this account; any earlier one is thrown away. */
export function issueNonce(user: { id: string; name: string }, now = Date.now()): Challenge {
  sweep(now);
  const nonce = randomBytes(16).toString('hex');
  const c: Challenge = { nonce, message: linkMessage(user.name, nonce, now), expiresAt: now + NONCE_TTL_MS };
  pending.set(user.id, c);
  return c;
}

/**
 * The account's pending challenge, removed as it is handed out. Null when
 * there is none, it expired, or `nonce` names a different one.
 */
export function consumeNonce(userId: string, nonce: string | undefined, now = Date.now()): Challenge | null {
  const c = pending.get(userId);
  if (!c) return null;
  pending.delete(userId);
  if (now >= c.expiresAt) return null;
  if (nonce !== undefined && nonce !== c.nonce) return null;
  return c;
}

export function pendingCount(): number {
  return pending.size;
}

function sweep(now: number) {
  if (pending.size < MAX_PENDING) return;
  for (const [id, c] of pending) if (now >= c.expiresAt) pending.delete(id);
  // Still full of live ones: drop the oldest so the map stays bounded.
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}
