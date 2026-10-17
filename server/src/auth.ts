// Signed session tokens and who is an operator. Ported from the poker room:
// Discord is the only way in (plus an explicit demo mode), tokens are HMAC
// signed with a secret on the data volume, and admin rights are re-derived
// from ADMIN_DISCORD_IDS on every read rather than trusted from the token.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerProfile } from '../../shared/types.ts';
import { DATA_DIR } from './paths.ts';

const SECRET_FILE = join(DATA_DIR, 'secret.key');

function loadSecret(): Buffer {
  const env = process.env.APP_SECRET;
  if (env) return Buffer.from(env, 'utf8');
  try {
    if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE);
    mkdirSync(DATA_DIR, { recursive: true });
    const secret = randomBytes(32);
    writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
    return secret;
  } catch {
    return randomBytes(32); // ephemeral fallback: sessions end at restart
  }
}

const SECRET = loadSecret();
const MAX_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString('base64url');
const mac = (s: string) => b64url(createHmac('sha256', SECRET).update(s).digest());

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function signToken(profile: PlayerProfile): string {
  const payload = b64url(Buffer.from(JSON.stringify({ ...profile, isAdmin: undefined, iat: Date.now() })));
  return `${payload}.${mac(payload)}`;
}

export function verifyToken(token: unknown): PlayerProfile | null {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  if (!sameString(token.slice(dot + 1), mac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.name) return null;
    // Checked on read, so switching demo mode off ends every demo session.
    const provider = data.provider === 'demo' && demoMode() ? 'demo'
      : data.provider === 'discord' ? 'discord' : null;
    if (!provider) return null;
    const iat = typeof data.iat === 'number' ? data.iat : 0;
    if (!iat || Date.now() - iat > MAX_TOKEN_AGE_MS) return null;
    const profile: PlayerProfile = {
      id: String(data.id),
      name: String(data.name).slice(0, 24),
      avatar: String(data.avatar ?? '🎩').slice(0, 200),
      provider,
    };
    if (data.discord?.id) {
      profile.discord = { id: String(data.discord.id), username: String(data.discord.username ?? '').slice(0, 40) };
    }
    return withAdminFlag(profile);
  } catch {
    return null;
  }
}

/** Short-lived HMAC state for the OAuth round trip. */
export function signState(data: Record<string, string>): string {
  const payload = b64url(Buffer.from(JSON.stringify({ ...data, ts: Date.now() })));
  return `${payload}.${mac(`state:${payload}`)}`;
}

export function verifyState(state: unknown): Record<string, string> | null {
  if (!state || typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  if (!sameString(state.slice(dot + 1), mac(`state:${payload}`))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - Number(data.ts ?? 0) > 15 * 60_000) return null;
    return data;
  } catch {
    return null;
  }
}

/** Sign-in without Discord, for local development and demos. Off unless DEMO_MODE=1. */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

export function makeDemoProfile(name: string): PlayerProfile {
  if (!demoMode()) throw new Error('Demo sign-in is not enabled');
  const clean = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20);
  if (clean.length < 2) throw new Error('Name must be at least 2 characters');
  return withAdminFlag({ id: `demo_${randomUUID().slice(0, 12)}`, name: clean, avatar: '🎩', provider: 'demo' });
}

export function makeDiscordProfile(d: { id: string; username: string; avatarUrl?: string | null }): PlayerProfile {
  return withAdminFlag({
    id: `dc_${d.id}`,
    name: d.username.slice(0, 24),
    avatar: d.avatarUrl ?? '🎩',
    provider: 'discord',
    discord: { id: d.id, username: d.username },
  });
}

export function adminDiscordIds(): Set<string> {
  return new Set((process.env.ADMIN_DISCORD_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean));
}

export function adminModeConfigured(): boolean {
  return adminDiscordIds().size > 0;
}

/** In production the operator list must be set explicitly (an unset one fails closed). */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * With no operators configured, local dev makes everyone an operator; in
 * production that fails closed and nobody is.
 */
export function withAdminFlag(p: PlayerProfile): PlayerProfile {
  if (!adminModeConfigured()) return { ...p, isAdmin: !isProduction() };
  return { ...p, isAdmin: !!p.discord && adminDiscordIds().has(p.discord.id) };
}
