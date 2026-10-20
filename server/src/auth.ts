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

/**
 * A MAC for server-to-server calls between Chog Games services (poker asking the hub who may
 * host). Same secret as sessions, but every caller prefixes its own purpose, so a request
 * signature can never pass as a session token or OAuth state (those MAC base64url text, which has
 * no ':').
 */
export function serviceMac(message: string): string {
  return mac(`svc:${message}`);
}

/** Constant-time comparison of two MACs. */
export function sameMac(a: string, b: string): boolean {
  return sameString(a, b);
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
    // Re-cleaned on every read, so tokens signed before cleanName still render safely.
    // A name that cleans to nothing keeps the session, as Discord sign-in does.
    const name = cleanName(data.name) || 'Player';
    const profile: PlayerProfile = {
      id: String(data.id),
      name,
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

// ---- names -------------------------------------------------------------------

/** Blank-looking letters (Hangul fillers, the braille blank) that pass as nothing. */
const BLANK_LETTERS = /[\u115f\u1160\u3164\uffa0\u2800]/g;

/**
 * Removes characters that change nothing on screen: format characters
 * (zero-width spaces and joiners, bidi overrides and isolates, the BOM),
 * controls (as a space, so "a\nb" stays two words), private-use and lone
 * surrogates. Kept where they do draw something: a joiner between two emoji
 * (👨‍👩‍👧, 👩🏾‍💻 stay one), a joiner or non-joiner between two letters of a
 * script that needs them (Sinhala, Persian…; not Latin, Greek or Cyrillic,
 * where it would only make a lookalike), and the tags of a subdivision flag.
 */
export function stripInvisible(s: string): string {
  return s.replace(
    /(\p{Extended_Pictographic}[\p{M}\p{Emoji_Modifier}]*)\u200d(?=\p{Extended_Pictographic})|((?![\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{L}\p{M}*[\u200c\u200d])(?=\p{L})|(\u{1F3F4}[\u{E0020}-\u{E007F}]+)|[\p{Cc}]|[\p{Cf}\p{Co}\p{Cs}]/gu,
    (m, emoji?: string, letter?: string, flag?: string) =>
      emoji ? `${emoji}\u200d` : letter ?? flag ?? (/\p{Cc}/u.test(m) ? ' ' : ''),
  );
}

/**
 * A display name that cannot pass for someone else's: NFKC (fullwidth and
 * styled letters become plain ones), invisible characters removed, at most three
 * stacked (non-spacing) marks in a row, whitespace collapsed, `max` characters. Returns ''
 * when fewer than two visible characters are left; callers refuse or fall back.
 */
export function cleanName(raw: unknown, max = 24): string {
  const s = stripInvisible(String(raw ?? '').normalize('NFKC'))
    .replace(BLANK_LETTERS, '')
    .replace(/([\p{Mn}\p{Me}]{3})[\p{Mn}\p{Me}]+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // By code point, so an emoji is never cut in half.
  const name = Array.from(s).slice(0, max).join('').trim();
  const visible = name.replace(/[\s\p{M}]/gu, '');
  return Array.from(visible).length >= 2 ? name : '';
}

/** Sign-in without Discord, for local development and demos. Off unless DEMO_MODE=1. */
export function demoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

export function makeDemoProfile(name: string): PlayerProfile {
  if (!demoMode()) throw new Error('Demo sign-in is not enabled');
  const clean = cleanName(name, 20);
  if (!clean) throw new Error('Name must be at least 2 characters');
  return withAdminFlag({ id: `demo_${randomUUID().slice(0, 12)}`, name: clean, avatar: '🎩', provider: 'demo' });
}

export function makeDiscordProfile(d: { id: string; username: string; avatarUrl?: string | null }): PlayerProfile {
  return withAdminFlag({
    id: `dc_${d.id}`,
    name: cleanName(d.username) || 'Player',
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
 * Whether a profile id belongs to an operator, without a token in hand (the hosting check is
 * asked about ids). Same rule as withAdminFlag: Discord accounts are `dc_<discord id>`.
 */
export function isAdminId(playerId: string): boolean {
  if (!adminModeConfigured()) return !isProduction();
  return playerId.startsWith('dc_') && adminDiscordIds().has(playerId.slice(3));
}

/**
 * With no operators configured, local dev makes everyone an operator; in
 * production that fails closed and nobody is.
 */
export function withAdminFlag(p: PlayerProfile): PlayerProfile {
  if (!adminModeConfigured()) return { ...p, isAdmin: !isProduction() };
  return { ...p, isAdmin: !!p.discord && adminDiscordIds().has(p.discord.id) };
}
