import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayerProfile } from '../../shared/types.ts';
import { DATA_DIR } from './paths.ts';

const SECRET_FILE = join(DATA_DIR, 'secret.key');

function loadSecret(): Buffer {
  const env = process.env.CHOG_SECRET ?? process.env.APP_SECRET;
  if (env) return Buffer.from(env, 'utf8');
  try {
    if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE);
    mkdirSync(DATA_DIR, { recursive: true });
    const secret = randomBytes(32);
    writeFileSync(SECRET_FILE, secret);
    return secret;
  } catch {
    return randomBytes(32); // ephemeral fallback
  }
}

const SECRET = loadSecret();

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signToken(profile: PlayerProfile): string {
  const payload = b64url(Buffer.from(JSON.stringify({ ...profile, iat: Date.now() })));
  const sig = b64url(createHmac('sha256', SECRET).update(payload).digest());
  return `${payload}.${sig}`;
}

// A signed-in session is good for this long. `iat` was being stamped into
// every token and then never looked at, which meant a token was valid forever
// — one copied off a shared laptop stayed good indefinitely.
const MAX_TOKEN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function verifyToken(token: string | undefined | null): PlayerProfile | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = b64url(createHmac('sha256', SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.name) return null;
    // Discord is the only way in. Tokens minted before that was true are
    // still validly signed, so they are rejected here rather than trusted.
    // Discord is the only way in, unless this deployment is explicitly a demo.
    // Checking the flag here rather than at sign-in means an existing demo
    // token stops working the moment the flag comes off.
    const provider = data.provider === 'demo' && demoMode() ? 'demo'
      : data.provider === 'discord' ? 'discord'
      : null;
    if (!provider) return null;
    const iat = typeof data.iat === 'number' ? data.iat : 0;
    if (!iat || Date.now() - iat > MAX_TOKEN_AGE_MS) return null;
    const profile: PlayerProfile = {
      id: String(data.id),
      name: String(data.name).slice(0, 24),
      // Avatar is either a short emoji or a Discord CDN image URL.
      avatar: String(data.avatar ?? '🙂').slice(0, 200),
      provider,
      // Deliberately not `data.isAdmin`. Operator rights are re-derived below
      // from the CURRENT operator list, so the payload's own claim is never
      // the thing that decides — and taking someone out of ADMIN_DISCORD_IDS
      // takes effect on their next request rather than whenever their token
      // happens to expire.
      isAdmin: false,
    };
    if (data.discord && data.discord.id) {
      profile.discord = {
        id: String(data.discord.id),
        username: String(data.discord.username ?? '').slice(0, 40),
      };
    }
    return withAdminFlag(profile);
  } catch {
    return null;
  }
}

// Attach a Discord identity to an existing profile (returns updated profile).
// The Discord avatar becomes the player's picture when available.
export function withDiscord(profile: PlayerProfile, discord: { id: string; username: string; avatarUrl?: string | null }): PlayerProfile {
  return {
    ...profile,
    avatar: discord.avatarUrl ?? profile.avatar,
    discord: { id: discord.id, username: discord.username },
  };
}

// Short-lived HMAC state for the OAuth redirect round-trip.
export function signState(data: Record<string, string>): string {
  const payload = b64url(Buffer.from(JSON.stringify({ ...data, ts: Date.now() })));
  const sig = b64url(createHmac('sha256', SECRET).update(`state:${payload}`).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string | undefined | null): Record<string, string> | null {
  if (!state) return null;
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const expect = b64url(createHmac('sha256', SECRET).update(`state:${payload}`).digest());
  const a = Buffer.from(state.slice(dot + 1));
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - Number(data.ts ?? 0) > 15 * 60_000) return null; // 15 min window
    return data;
  } catch {
    return null;
  }
}

// A demo deployment: sign-in without a Discord application, for showing the
// room to someone before any of it is set up. Off unless asked for by name.
export function demoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

export function makeDemoProfile(name: string): PlayerProfile {
  if (!demoMode()) throw new Error('Demo sign-in is not enabled');
  const clean = name.trim().slice(0, 24);
  if (clean.length < 2) throw new Error('Name must be at least 2 characters');
  return withAdminFlag({
    id: `demo_${randomUUID().slice(0, 12)}`,
    name: clean,
    avatar: '♠️',
    provider: 'demo',
  });
}

// ---- site operator (single-owner platform) ----
// The platform belongs to one operator. Admin rights come from
// ADMIN_DISCORD_IDS: comma-separated Discord user ids (matched at sign-in).
// With none configured (local dev), every profile is an admin.
export function adminDiscordIds(): Set<string> {
  return new Set((process.env.ADMIN_DISCORD_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean));
}

export function adminModeConfigured(): boolean {
  return adminDiscordIds().size > 0;
}

export function isAdminDiscordId(discordId: string): boolean {
  return adminDiscordIds().has(discordId);
}

// Recompute the admin flag for a profile (used at token issue time).
export function withAdminFlag(profile: PlayerProfile): PlayerProfile {
  if (!adminModeConfigured()) return { ...profile, isAdmin: true };
  if (profile.discord && isAdminDiscordId(profile.discord.id)) return { ...profile, isAdmin: true };
  return { ...profile, isAdmin: profile.isAdmin === true };
}

// Fresh profile created by signing in with Discord directly.
export function makeDiscordProfile(discord: { id: string; username: string; avatarUrl?: string | null }): PlayerProfile {
  return withAdminFlag({
    id: `dc_${discord.id}`,
    name: discord.username.slice(0, 24),
    avatar: discord.avatarUrl ?? '♠️',
    provider: 'discord',
    discord: { id: discord.id, username: discord.username },
  });
}
