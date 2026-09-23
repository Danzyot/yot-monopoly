// "Verify with a code" sign-in: the player posts a short code in the room's
// Discord verify channel; the bot reads the channel and links the author's
// Discord identity — no OAuth login needed. Mirrors the giveaway site's flow.
import { randomInt } from 'node:crypto';
import { BRAND } from '../../shared/brand.ts';
import { botEnabled, defaultGuildId } from './discord.ts';

const API = 'https://discord.com/api/v10';
const CODE_TTL_MS = 10 * 60_000;
const POLL_MS = 4_000;

// Unambiguous alphabet (no 0/O/1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// A distinct prefix so another product's bot on the same guild cannot have its own
// button/modal verification. A distinct prefix stops players pasting a poker
// code into the prop bot's Verify modal (which rejects it as expired).
const PREFIX = BRAND.codePrefix;

export interface CodeResolution {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface PendingCode {
  createdAt: number;
  resolved: CodeResolution | null;
}

const codes = new Map<string, PendingCode>();
let poller: NodeJS.Timeout | null = null;

export function verifyChannelId(): string | null {
  return process.env.DISCORD_VERIFY_CHANNEL_ID?.trim() || null;
}

// The button/modal flow (preferred) needs the interactions endpoint; the
// legacy channel-poll flow needs a readable channel. Either one enables
// "Verify with a code" on the site.
export function buttonFlowAvailable(): boolean {
  return !!process.env.DISCORD_PUBLIC_KEY?.trim();
}

export function codeVerifyAvailable(): boolean {
  return buttonFlowAvailable() || (botEnabled() && !!verifyChannelId());
}

// Channel name for the sign-in instructions ("post it in #poker-verify").
// Cached — resolved once at boot so /api/config stays synchronous.
let channelName: string | null = null;

export function verifyChannelName(): string | null {
  return channelName;
}

export async function primeVerifyChannel(): Promise<void> {
  const channel = verifyChannelId();
  if (!channel || !botEnabled()) return;
  try {
    const res = await fetch(`${API}/channels/${channel}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) {
      console.warn(`[verify] cannot read channel ${channel} (${res.status}) — ` +
        'check the bot has View Channel + Read Message History there');
      return;
    }
    const data = await res.json() as { name?: string };
    channelName = data.name ?? null;
  } catch {
    // Non-fatal: the instructions just fall back to "the verify channel".
  }
}

export function startCode(): { code: string; expiresAt: number } {
  if (!codeVerifyAvailable()) throw new Error('Code verification is not configured');
  if (codes.size > 5_000) throw new Error('Too many pending codes — try again in a minute');
  let code = PREFIX;
  for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  codes.set(code, { createdAt: Date.now(), resolved: null });
  ensurePoller();
  return { code, expiresAt: Date.now() + CODE_TTL_MS };
}

// Resolve a pending code from outside the channel poller (the Discord modal).
// Returns false when the code is unknown or already expired.
export function resolveCode(rawCode: string, who: CodeResolution): boolean {
  const code = normalizeCode(rawCode);
  const entry = codes.get(code);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > CODE_TTL_MS) {
    codes.delete(code);
    return false;
  }
  if (!entry.resolved) entry.resolved = who;
  return true;
}

// Accepts "mono-ab12", "AB12", " MONO-AB12 " — all become "MONO-AB12".
export function normalizeCode(input: string): string {
  let code = String(input).toUpperCase().replace(/\s/g, '');
  if (code && !code.startsWith(PREFIX)) code = PREFIX + code.replace(new RegExp(`^${PREFIX.replace('-', '')}-?`), '');
  return code;
}

export function looksLikeCode(input: string): boolean {
  return new RegExp(`^${PREFIX}[A-Z2-9]{4}$`).test(normalizeCode(input));
}

export function codeStatus(code: string): { pending: boolean; resolution: CodeResolution | null } {
  const entry = codes.get(code.trim().toUpperCase());
  if (!entry) return { pending: false, resolution: null };
  if (entry.resolved) {
    codes.delete(code);
    return { pending: false, resolution: entry.resolved };
  }
  if (Date.now() - entry.createdAt > CODE_TTL_MS) {
    codes.delete(code);
    return { pending: false, resolution: null };
  }
  return { pending: true, resolution: null };
}

function ensurePoller() {
  if (poller) return;
  poller = setInterval(() => void sweep(), POLL_MS);
  poller.unref?.();
}

async function sweep() {
  // Expire old codes; stop polling when nothing is pending.
  const now = Date.now();
  for (const [code, entry] of codes) {
    if (now - entry.createdAt > CODE_TTL_MS && !entry.resolved) codes.delete(code);
  }
  const hasPending = [...codes.values()].some(e => !e.resolved);
  if (!hasPending) {
    if (poller) { clearInterval(poller); poller = null; }
    return;
  }
  const channel = verifyChannelId();
  if (!channel || !botEnabled()) return;

  try {
    const res = await fetch(`${API}/channels/${channel}/messages?limit=30`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) return;
    const messages = await res.json() as {
      id: string;
      content?: string;
      author?: { id: string; username: string; global_name?: string; avatar?: string | null; bot?: boolean };
    }[];
    for (const msg of messages) {
      if (!msg.author || msg.author.bot || !msg.content) continue;
      const text = msg.content.toUpperCase();
      for (const [code, entry] of codes) {
        if (entry.resolved || !text.includes(code)) continue;
        entry.resolved = {
          id: msg.author.id,
          username: msg.author.global_name || msg.author.username,
          avatarUrl: msg.author.avatar
            ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png?size=128`
            : null,
        };
        // Best-effort ✅ reaction so the member sees it worked.
        void fetch(`${API}/channels/${channel}/messages/${msg.id}/reactions/${encodeURIComponent('✅')}/@me`, {
          method: 'PUT',
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
        }).catch(() => {});
      }
    }
  } catch {
    // transient — next sweep retries
  }
}

// Posting in the verify channel proves membership of the guild.
export function impliedGuildIds(): string[] {
  const g = defaultGuildId();
  return g ? [g] : [];
}
