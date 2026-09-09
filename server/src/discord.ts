// Discord integration: OAuth account linking, guild membership verification,
// and winner announcements via webhooks.
//
// Configuration (all optional — features degrade gracefully):
//   DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET  — OAuth app for "Connect Discord"
//   DISCORD_REDIRECT_URI — defaults to {PUBLIC_URL}/api/auth/discord/callback
//   DISCORD_BOT_TOKEN — bot invited to hosts' guilds; enables authoritative
//                       membership checks (otherwise a snapshot of the user's
//                       guild list from OAuth time is used).

import { BRAND } from '../../shared/brand.ts';

const API = 'https://discord.com/api/v10';

export interface DiscordIdentity {
  id: string;
  username: string;
  guildIds: Set<string>; // guilds at OAuth time (snapshot)
  // User OAuth token (in-memory only) — lets us read the member's roles in
  // ANY guild they belong to via guilds.members.read, even guilds without
  // the bot.
  accessToken: string | null;
  linkedAt: number;
}

// discord user id -> identity snapshot (in-memory, refreshed on each OAuth).
const identities = new Map<string, DiscordIdentity>();

export function discordEnabled(): boolean {
  return !!(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function botEnabled(): boolean {
  return !!process.env.DISCORD_BOT_TOKEN;
}

// Defaults for this deployment's own Discord application.
export function defaultGuildId(): string | null {
  return process.env.DISCORD_GUILD_ID?.trim() || null;
}

// No built-in invite. The sibling sites hardcode their community's, but a
// guessed invite code is worse than none: the header renders no Discord
// button at all when this is null, whereas a wrong one sends every player to
// a dead link. Set DISCORD_INVITE_URL and the button appears.
const DEFAULT_INVITE_URL: string | null = null;

export function defaultInviteUrl(): string | null {
  const v = (process.env.DISCORD_INVITE_URL ?? process.env.NEXT_PUBLIC_DISCORD_INVITE_URL)?.trim();
  if (!v) return DEFAULT_INVITE_URL;
  return /^https?:\/\//.test(v) ? v : `https://${v}`;
}

export function announceChannelId(): string | null {
  return process.env.DISCORD_ANNOUNCE_CHANNEL_ID?.trim() || null;
}

export interface GuildRole {
  id: string;
  name: string;
  position: number;
}

// List the guild's roles via the bot (for the operator's role-requirement picker).
export async function fetchGuildRoles(guildId: string): Promise<GuildRole[]> {
  if (!botEnabled()) throw new Error('Bot token not configured');
  const res = await fetch(`${API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Could not fetch roles (${res.status}) — is the bot in that server?`);
  const roles = await res.json() as { id: string; name: string; position: number; managed?: boolean }[];
  return roles
    .filter(r => r.name !== '@everyone' && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, position: r.position }));
}

// Build the OAuth callback URL from a base origin (missing scheme tolerated).
// The base comes from the incoming request, so sign-in works on every domain
// the site is served from — each just needs its redirect registered in the
// Discord portal. DISCORD_REDIRECT_URI env still overrides everything.
export function redirectUriFor(base: string): string {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  let b = base.trim();
  if (!/^https?:\/\//.test(b)) b = `https://${b}`;
  return `${b.replace(/\/$/, '')}/api/auth/discord/callback`;
}

export function authorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds guilds.members.read',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

// The last few exchanges, kept so a duplicated callback does not fail.
//
// An OAuth code is single-use, but the callback that carries it is a plain
// GET, and phones hit those twice more often than anyone expects — a link
// preview, a pull-to-refresh, Discord's in-app browser re-requesting the page
// when it comes back to the foreground. The first request signs the player
// in; the second used to reach Discord with a spent code and put "token
// exchange failed" on the screen of somebody who was, at that moment,
// successfully signed in.
const recentCodes = new Map<string, { id: string; username: string; avatarUrl: string | null }>();
const CODE_CACHE_MS = 5 * 60_000;

// Exchange the OAuth code and snapshot the user's identity + guild list.
export async function completeOAuth(code: string, redirectUri: string): Promise<{ id: string; username: string; avatarUrl: string | null }> {
  const replay = recentCodes.get(code);
  if (replay) return replay;

  const exchange = () => fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    // Without a bound, a bad hop between us and Discord leaves the player
    // staring at a spinner for as long as the socket takes to die.
    signal: AbortSignal.timeout(10_000),
  });

  let tokenRes: Response;
  try {
    tokenRes = await exchange();
  } catch (err) {
    // A network-level failure never even got Discord's opinion — the code is
    // still unspent, so a second attempt is safe and usually all it takes.
    console.error(`Discord token exchange network error, retrying once: ${String(err)}`);
    tokenRes = await exchange();
  }
  // Registration opens and a room full of players signs in within the same
  // minute — every exchange leaving through the one server address. Discord
  // rate-limits that, and a 429 is not a failure, it is "ask again shortly":
  // so ask again shortly, once, before involving the player.
  if (tokenRes.status === 429) {
    const after = Number(tokenRes.headers.get('retry-after') ?? 1);
    await new Promise(r => setTimeout(r, Math.min(4_000, Math.max(500, after * 1000))));
    tokenRes = await exchange();
  }
  if (!tokenRes.ok) {
    // The reason has to reach the operator, or this stays "how does this keep
    // happening". The body names it: invalid_grant is a spent or expired
    // code, invalid_client is a wrong secret, 429 is rate limiting.
    const body = await tokenRes.text().catch(() => '');
    console.error(`Discord token exchange failed: HTTP ${tokenRes.status} ${body.slice(0, 300)}`);
    let reason = 'Discord sign-in failed — please try again';
    if (tokenRes.status === 429) {
      reason = 'Discord is busy — wait a few seconds and press Sign in again';
    } else if (body.includes('invalid_grant')) {
      reason = 'That sign-in link was already used or expired — press Sign in again';
    } else if (body.includes('invalid_client')) {
      reason = 'Discord sign-in is misconfigured on our side — tell the host';
    } else if (body.includes('redirect_uri')) {
      reason = 'Discord sign-in is misconfigured for this domain — tell the host';
    }
    throw new Error(reason);
  }
  const token = await tokenRes.json() as { access_token: string };

  const auth = { Authorization: `Bearer ${token.access_token}` };
  const userRes = await fetch(`${API}/users/@me`, { headers: auth });
  if (!userRes.ok) throw new Error('Could not fetch Discord profile');
  const user = await userRes.json() as { id: string; username: string; global_name?: string; avatar?: string | null };
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : null;

  const guildIds = new Set<string>();
  const guildsRes = await fetch(`${API}/users/@me/guilds`, { headers: auth });
  if (guildsRes.ok) {
    const guilds = await guildsRes.json() as { id: string }[];
    for (const g of guilds) guildIds.add(g.id);
  }

  identities.set(user.id, {
    id: user.id,
    username: user.global_name || user.username,
    guildIds,
    accessToken: token.access_token,
    linkedAt: Date.now(),
  });
  const result = { id: user.id, username: user.global_name || user.username, avatarUrl };
  recentCodes.set(code, result);
  setTimeout(() => recentCodes.delete(code), CODE_CACHE_MS).unref?.();
  return result;
}

export interface MembershipInfo {
  member: boolean;
  roleIds: string[]; // only populated by the bot check
  authoritative: boolean; // true when the bot performed the check
}

// Guild membership (and roles) for a linked user, across any server:
//  1. Bot check (authoritative, includes roles) — any guild the bot is in.
//  2. The user's own OAuth token (guilds.members.read) — any guild THEY are
//     in, even without the bot; also returns their roles there.
//  3. Guild-list snapshot from OAuth time (membership only, no roles).
export async function guildMembership(discordUserId: string, guildId: string): Promise<MembershipInfo> {
  if (botEnabled()) {
    try {
      const res = await fetch(`${API}/guilds/${guildId}/members/${discordUserId}`, {
        headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
      });
      if (res.ok) {
        const member = await res.json() as { roles?: string[] };
        return { member: true, roleIds: member.roles ?? [], authoritative: true };
      }
      // 404 = not a member of this guild; 403 = bot isn't in this guild, so
      // fall through to the user-token check instead of concluding anything.
      if (res.status === 404) return { member: false, roleIds: [], authoritative: true };
    } catch {
      // fall through
    }
  }
  const identity = identities.get(discordUserId);
  if (identity?.accessToken) {
    try {
      const res = await fetch(`${API}/users/@me/guilds/${guildId}/member`, {
        headers: { Authorization: `Bearer ${identity.accessToken}` },
      });
      if (res.ok) {
        const member = await res.json() as { roles?: string[] };
        return { member: true, roleIds: member.roles ?? [], authoritative: true };
      }
      if (res.status === 404) return { member: false, roleIds: [], authoritative: true };
    } catch {
      // fall through to snapshot
    }
  }
  const snap = identity?.guildIds.has(guildId) ?? false;
  return { member: snap, roleIds: [], authoritative: false };
}

export async function isGuildMember(discordUserId: string, guildId: string): Promise<boolean> {
  return (await guildMembership(discordUserId, guildId)).member;
}

export function knownIdentity(discordUserId: string): DiscordIdentity | null {
  return identities.get(discordUserId) ?? null;
}

// Register an identity discovered outside OAuth (e.g. code verification in the
// Discord channel). Membership snapshot only — role checks go through the bot.
export function registerIdentity(id: string, username: string, guildIds: string[]) {
  const existing = identities.get(id);
  identities.set(id, {
    id,
    username,
    guildIds: new Set([...(existing?.guildIds ?? []), ...guildIds]),
    accessToken: existing?.accessToken ?? null,
    linkedAt: Date.now(),
  });
}

// ---- verification message (button that opens the code modal) ----

// Post the "Verify" panel into a channel. Players click the button and type
// the code the poker site gave them — they never send a chat message.
export async function postVerifyMessage(channelId: string, siteUrl: string | null): Promise<void> {
  if (!botEnabled()) throw new Error('Bot token not configured');
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      embeds: [{
        title: `♠ ${BRAND.name} — verify your account`,
        description:
          `**1.** Get your code on ${siteUrl ? `[the poker site](${siteUrl})` : 'the poker site'} ` +
          '— *Sign in → Verify with a code*\n' +
          '**2.** Click **Verify** below and paste it in\n' +
          '**3.** You are signed in automatically — no login needed',
        color: 0xe8b64c,
        footer: { text: 'Codes look like POKER-XXXX and last 10 minutes.' },
      }],
      components: [{
        type: 1,
        components: [{
          type: 2, // button
          style: 3, // green
          label: 'Verify',
          custom_id: 'poker_verify_button',
          emoji: { name: '♠️' },
        }],
      }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Discord rejected the message (${res.status}): ${detail.slice(0, 200)}`);
  }
}

// ---- integrity alerts ----
// Where flagged hands are reported. Operator-only channel: these are
// suspicions, not verdicts, and must never be visible to players.
// Send a player a direct message from the bot.
//
// Two calls: open (or reuse) the DM channel with that user, then post into it.
// It can fail for reasons that are nobody's bug — the player has DMs from
// server members switched off, or shares no server with the bot — so the
// error says which, rather than a bare 403.
export async function sendDirectMessage(discordUserId: string, content: string): Promise<void> {
  if (!botEnabled()) throw new Error('No bot token configured — DMs need DISCORD_BOT_TOKEN');
  const body = content.trim();
  if (!body) throw new Error('Nothing to send');
  if (body.length > 1900) throw new Error('Message is too long for Discord (1900 characters max)');

  const auth = {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN!.trim()}`,
    'Content-Type': 'application/json',
  };
  const chanRes = await fetch(`${API}/users/@me/channels`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ recipient_id: discordUserId }),
  });
  if (!chanRes.ok) {
    throw new Error(chanRes.status === 403
      ? 'Discord refused to open a DM — the bot and that player share no server'
      : `Could not open a DM (Discord returned ${chanRes.status})`);
  }
  const chan = await chanRes.json() as { id?: string };
  if (!chan.id) throw new Error('Discord did not return a DM channel');

  const msgRes = await fetch(`${API}/channels/${chan.id}/messages`, {
    method: 'POST', headers: auth, body: JSON.stringify({ content: body }),
  });
  if (!msgRes.ok) {
    throw new Error(msgRes.status === 403
      ? 'That player has direct messages from server members turned off'
      : `Discord rejected the message (${msgRes.status})`);
  }
}

export function auditChannelId(): string | null {
  return process.env.DISCORD_AUDIT_CHANNEL_ID?.trim() || '1537898893990432879';
}

// Flags arrive one hand at a time but a dump is a burst, so they are batched
// into a single message rather than ten pings in ten seconds.
const pendingAlerts: string[] = [];
let alertTimer: NodeJS.Timeout | null = null;

export function reportFlaggedHands(lines: string[]): void {
  if (lines.length === 0 || !botEnabled() || !auditChannelId()) return;
  pendingAlerts.push(...lines);
  if (alertTimer) return;
  alertTimer = setTimeout(() => {
    alertTimer = null;
    const batch = pendingAlerts.splice(0, 12);
    const extra = pendingAlerts.length;
    pendingAlerts.length = 0;
    void flushAlerts(batch, extra);
  }, 8_000);
  alertTimer.unref?.();
}

async function flushAlerts(lines: string[], extra: number): Promise<void> {
  const channel = auditChannelId();
  if (!channel) return;
  try {
    const res = await fetch(`${API}/channels/${channel}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: '⚠️ Possible chip dumping',
          description: lines.join('\n').slice(0, 3800)
            + (extra > 0 ? `\n…and ${extra} more` : ''),
          color: 0xe05d5d,
          footer: { text: 'Advisory only — read the hand in Dashboard → Audit before acting.' },
        }],
      }),
    });
    if (!res.ok) {
      console.error('Audit alert rejected by Discord:', res.status, (await res.text().catch(() => '')).slice(0, 160));
    }
  } catch (e) {
    console.error('Audit alert failed:', e instanceof Error ? e.message : e);
  }
}

// ---- winner announcements ----

export interface WinnerRow {
  place: number;
  name: string;
  prize: number;
  discordId: string | null;
  discordTag: string | null;
  discordVerified: boolean;
}

export interface AnnounceTarget {
  webhookUrl?: string | null; // per-tournament override
  channelId?: string | null; // posted via the bot
}

export async function announceWinners(
  target: AnnounceTarget,
  tournamentName: string,
  entrants: number,
  prizeText: string | null,
  winners: WinnerRow[],
): Promise<void> {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = winners.map(w => {
    const medal = medals[w.place - 1] ?? `**${w.place}.**`;
    let who = w.name;
    if (w.discordId) {
      who += ` (<@${w.discordId}>${w.discordVerified ? ' ✅ verified' : ''})`;
    } else if (w.discordTag) {
      who += ` (@${w.discordTag})`;
    }
    return `${medal} ${who}`;
  });
  if (prizeText) lines.push('', `**Prizes:** ${prizeText}`);
  const embed = {
    title: `🏆 ${tournamentName} — Final Results`,
    description: lines.join('\n'),
    color: 0xe8b64c,
    footer: { text: `${entrants} entrants` },
    timestamp: new Date().toISOString(),
  };

  try {
    if (target.webhookUrl) {
      await fetch(target.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: BRAND.name, embeds: [embed] }),
      });
      return;
    }
    if (target.channelId && botEnabled()) {
      await fetch(`${API}/channels/${target.channelId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
        body: JSON.stringify({ embeds: [embed] }),
      });
    }
  } catch (e) {
    console.error('Discord winner announcement failed:', e);
  }
}
