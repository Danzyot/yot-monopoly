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

// DISCORD_API_BASE points the bot at a stand-in Discord for tests. Honoured
// only on loopback: a stray value in production must never be able to send
// the bot token to some other host.
const API = (() => {
  const o = process.env.DISCORD_API_BASE?.trim();
  if (o && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(o)) return o.replace(/\/$/, '');
  return 'https://discord.com/api/v10';
})();

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

// The public keys this server accepts interaction signatures from.
//
// More than one, because more than one Discord application sends interactions
// here: this site's own bot (the poker Verify button) and, when forwarding is
// on, the main site's application whose casino, giveaways and slash commands
// this server relays. Each signs with its own key, so a server holding only
// one of them rejects the other's every interaction as forged. Comma or space
// separated in DISCORD_PUBLIC_KEY, or listed in DISCORD_PUBLIC_KEYS.
export function discordPublicKeys(): string[] {
  const raw = `${process.env.DISCORD_PUBLIC_KEY ?? ''},${process.env.DISCORD_PUBLIC_KEYS ?? ''}`;
  return [...new Set(raw.split(/[\s,]+/).map(k => k.trim().toLowerCase()).filter(Boolean))];
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

// ---------- banning from the Discord server ----------
//
// The site's ban list and a Discord server are two different doors, and a
// cheat thrown out of one walks straight back in through the other. An
// operator banning someone can now close both at once.
//
// Failures here are reported, never swallowed. A Discord ban that silently
// did not happen is worse than one that was never attempted: the operator
// believes the person is gone.
function guildBanUrl(discordUserId: string): string {
  const guild = defaultGuildId();
  if (!guild) throw new Error('No DISCORD_GUILD_ID configured — there is no server to ban them from');
  return `${API}/guilds/${guild}/bans/${encodeURIComponent(discordUserId)}`;
}

// The audit-log reason, as a header Discord will accept.
//
// Discord wants it URL-encoded, and Node's fetch will not even SEND a header
// holding a character above U+00FF: a reason with an em dash or an emoji
// threw "Cannot convert argument to a ByteString" before the request left,
// and the operator was told the Discord ban failed with no idea why. Encoded,
// every reason is plain ASCII. Discord's cap is 512 characters, so the raw
// text is shortened until its ENCODED form fits, never cut mid-escape.
//
// Shortened by whole characters, not UTF-16 units: slicing one unit at a time
// splits an emoji's surrogate pair, and encodeURIComponent throws on the half
// left behind — so the fix for one crash would have been a new one.
export function auditReasonHeader(reason: string): string {
  const chars = Array.from(reason.replace(/[\u0000-\u001f\u007f]/g, ' '));
  let enc = encodeURIComponent(chars.join(''));
  while (enc.length > 512 && chars.length > 0) {
    chars.pop();
    enc = encodeURIComponent(chars.join(''));
  }
  return enc;
}

function botAuth(reason?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN!.trim()}`,
    'Content-Type': 'application/json',
  };
  // Shows up in the server's audit log, so a moderator reading it later can
  // see this came from the poker room and why.
  if (reason) h['X-Audit-Log-Reason'] = auditReasonHeader(reason);
  return h;
}

// What Discord said, in words an operator can act on.
//
// This used to answer every 403 with "the bot needs Ban Members, and its role
// must sit above theirs" — Discord's own reason thrown away and a guess put in
// its place. An operator who had checked Ban Members was then told to check
// Ban Members. A 403 is several different refusals, and Discord's error code
// says which, so the code and Discord's own words are always kept.
export function discordErrorText(status: number, body: unknown, verb: string): string {
  const b = (body && typeof body === 'object' ? body : {}) as { code?: unknown; message?: unknown };
  const code = typeof b.code === 'number' ? b.code : null;
  const said = typeof b.message === 'string' ? b.message : '';
  const tag = `Discord ${status}${code !== null ? `/${code}` : ''}${said ? ` "${said}"` : ''}`;
  const hint = (() => {
    switch (code) {
      // Discord gives this one code for every cause below, so the hint lists
      // them all — including the two that look fine from the server settings
      // page: a token belonging to a different bot, and a server id pointing
      // at a different server. The ban route runs the live check on a 403 and
      // replaces this with the actual cause; this text is the fallback.
      case 50013: return 'Discord says the same thing for all of these: the bot this site\'s token signs in as '
        + 'is not the bot you set up, DISCORD_GUILD_ID is a different server, that bot lacks Ban Members there, '
        + 'the player\'s highest role is at or above the bot\'s, they own the server, or the bot is timed out. '
        + '"Check Discord setup" on the dashboard (Bans panel) says which.';
      case 50001: return 'the bot cannot see the server DISCORD_GUILD_ID points at — it is not in that server, '
        + 'or the id is a different server.';
      case 60003: return 'this server requires 2FA for moderation actions, so the Discord account that OWNS '
        + 'the bot application must have two-factor authentication turned on.';
      case 10004: return 'DISCORD_GUILD_ID is not a server this bot can see.';
      case 10013: return 'there is no Discord account with that id.';
      case 30035: return 'the server has reached Discord\'s limit on bans for people who are not members.';
      case 0: return 'the bot token was rejected.';
      default: break;
    }
    if (status === 401) return 'the bot token was rejected — check DISCORD_BOT_TOKEN.';
    if (status === 429) return 'rate limited by Discord — try again in a minute.';
    return '';
  })();
  return `Discord refused to ${verb} them (${tag})${hint ? `: ${hint}` : ''}`;
}

export type DiscordError = Error & { status: number; code: number | null };

async function discordError(res: Response, verb: string): Promise<DiscordError> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON — the status is all there is */ }
  const e = new Error(discordErrorText(res.status, body, verb)) as DiscordError;
  e.status = res.status;
  const c = (body as { code?: unknown } | null)?.code;
  e.code = typeof c === 'number' ? c : null;
  return e;
}

export async function banFromGuild(discordUserId: string, reason: string): Promise<void> {
  if (!botEnabled()) throw new Error('No bot token configured — a Discord ban needs DISCORD_BOT_TOKEN');
  const res = await fetch(guildBanUrl(discordUserId), {
    method: 'PUT',
    headers: botAuth(`Poker ban: ${reason || 'no reason given'}`),
    // Nothing is deleted: a ban is about access, and wiping someone's message
    // history takes evidence with it.
    body: JSON.stringify({ delete_message_seconds: 0 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw await discordError(res, 'ban');
}

export async function unbanFromGuild(discordUserId: string): Promise<void> {
  if (!botEnabled()) throw new Error('No bot token configured — DISCORD_BOT_TOKEN');
  const res = await fetch(guildBanUrl(discordUserId), {
    method: 'DELETE',
    headers: botAuth('Poker ban lifted'),
    signal: AbortSignal.timeout(10_000),
  });
  // Already gone is the outcome we wanted, not a failure.
  if (res.status === 404) return;
  if (!res.ok) throw await discordError(res, 'unban');
}

// ---- "Check Discord ban setup" ----
//
// Everything that decides whether a ban can go through, checked live against
// the server the bot will ban in, and against one particular player if given.
// The answer to "perms are set correctly, why does it fail" is almost always
// one of these, and each is invisible from the settings page it lives on:
// the bot's role is BELOW a role the players hold, the test account owns the
// server, or the server demands 2FA of the bot's owner.

const ADMINISTRATOR = 1n << 3n;
const BAN_MEMBERS = 1n << 2n;

export interface DiscordRole { id: string; name: string; permissions: string; position: number }

// The pure part: given the guild's roles, who owns it, and two members' role
// ids, can the one ban the other — and if not, exactly why not.
export function banAbility(p: {
  guildId: string;
  ownerId: string;
  roles: DiscordRole[];
  bot: { id: string; roleIds: string[] };
  target?: { id: string; roleIds: string[] | null } | null; // roleIds null = not in the server
}): {
  hasBanMembers: boolean;
  botTop: { name: string; position: number };
  targetTop: { name: string; position: number } | null;
  targetIsOwner: boolean;
  canBanTarget: boolean | null; // null when no target was given
  reason: string | null;
} {
  const byId = new Map(p.roles.map(r => [r.id, r]));
  const everyone = byId.get(p.guildId);
  const top = (ids: string[]) => {
    let best = { name: '@everyone', position: 0 };
    for (const id of ids) {
      const r = byId.get(id);
      if (r && r.position > best.position) best = { name: r.name, position: r.position };
    }
    return best;
  };
  let perms = BigInt(everyone?.permissions ?? '0');
  for (const id of p.bot.roleIds) perms |= BigInt(byId.get(id)?.permissions ?? '0');
  const hasBanMembers = p.bot.id === p.ownerId || (perms & ADMINISTRATOR) !== 0n || (perms & BAN_MEMBERS) !== 0n;
  const botTop = top(p.bot.roleIds);

  if (!p.target) {
    return { hasBanMembers, botTop, targetTop: null, targetIsOwner: false, canBanTarget: null,
      reason: hasBanMembers ? null : 'the bot has no role granting Ban Members (or Administrator)' };
  }
  const targetIsOwner = p.target.id === p.ownerId;
  const targetTop = p.target.roleIds ? top(p.target.roleIds) : null;
  let reason: string | null = null;
  if (!hasBanMembers) reason = 'the bot has no role granting Ban Members (or Administrator)';
  else if (targetIsOwner) reason = 'they own the server — nobody can ban a server owner';
  else if (targetTop && targetTop.position >= botTop.position) {
    reason = `their highest role "${targetTop.name}" is ${targetTop.position === botTop.position ? 'level with' : 'above'} `
      + `the bot's highest role "${botTop.name}" — drag the bot's role above it in Server Settings → Roles`;
  }
  return { hasBanMembers, botTop, targetTop, targetIsOwner, canBanTarget: reason === null, reason };
}

export interface BanCheckLine { ok: boolean; label: string; detail: string }

export async function checkBanSetup(targetId?: string | null): Promise<BanCheckLine[]> {
  const lines: BanCheckLine[] = [];
  const add = (ok: boolean, label: string, detail: string) => { lines.push({ ok, label, detail }); return ok; };

  if (!add(botEnabled(), 'Bot token', botEnabled() ? 'set' : 'DISCORD_BOT_TOKEN is not set')) return lines;
  const guildId = defaultGuildId();
  if (!add(!!guildId, 'Server id', guildId ? guildId : 'DISCORD_GUILD_ID is not set')) return lines;

  const get = async (path: string) => {
    const res = await fetch(`${API}${path}`, { headers: botAuth(), signal: AbortSignal.timeout(10_000) });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { res, body };
  };

  // WHICH bot. Every site here has its own Discord application, and WAWA's
  // token is shared with the giveaway site — so the bot whose role was
  // dragged up and given Ban Members is not necessarily the bot this token
  // signs in as. That mismatch is invisible from the server settings and
  // produces exactly "Missing Permissions", so the name is always shown.
  let me: { id: string; username: string };
  try {
    const r = await get('/users/@me');
    if (!add(r.res.ok, 'Bot this site uses', r.res.ok
      ? `${(r.body as { username: string }).username} (id ${(r.body as { id: string }).id}) — this must be the bot you gave Ban Members to`
      : discordErrorText(r.res.status, r.body, 'sign in as'))) return lines;
    me = r.body as { id: string; username: string };
  } catch (e) {
    add(false, 'Bot this site uses', `could not reach Discord: ${e instanceof Error ? e.message : 'network error'}`);
    return lines;
  }

  // WHICH server. DISCORD_GUILD_ID names the server the ban lands in; a bot
  // in two servers can hold Ban Members in one and not the other.
  const g = await get(`/guilds/${guildId}`);
  if (!add(g.res.ok, 'Server the ban goes to', g.res.ok
    ? `"${(g.body as { name: string }).name}" (id ${guildId}) — this must be the server you set the bot up in`
    : discordErrorText(g.res.status, g.body, 'read the server for'))) return lines;
  const guild = g.body as { id: string; name: string; owner_id: string; roles: DiscordRole[]; mfa_level?: number };
  const roleById = new Map(guild.roles.map(r => [r.id, r]));
  const listRoles = (ids: string[]) => {
    const rs = ids.map(id => roleById.get(id)).filter((r): r is DiscordRole => !!r)
      .sort((x, y) => y.position - x.position);
    return rs.length ? rs.map(r => `${r.name} (#${r.position})`).join(', ') : 'no roles';
  };

  const bm = await get(`/guilds/${guildId}/members/${me.id}`);
  if (!add(bm.res.ok, 'Bot is a member there', bm.res.ok
    ? 'yes'
    : discordErrorText(bm.res.status, bm.body, 'read the bot in'))) return lines;
  const botMember = bm.body as { roles?: string[]; communication_disabled_until?: string | null };
  const botRoles = botMember.roles ?? [];

  // A timed-out member cannot moderate, and Discord reports it as the same
  // "Missing Permissions" as everything else.
  const until = botMember.communication_disabled_until ? Date.parse(botMember.communication_disabled_until) : NaN;
  const timedOut = Number.isFinite(until) && until > Date.now();
  add(!timedOut, 'Bot is not timed out', timedOut
    ? `the bot is timed out until ${new Date(until).toISOString()} — a timed-out member cannot ban anyone`
    : 'not timed out');

  let target: { id: string; roleIds: string[] | null } | null = null;
  const tid = targetId?.replace(/^dc_/, '').trim() || null;
  if (tid) {
    const tm = await get(`/guilds/${guildId}/members/${tid}`);
    if (tm.res.ok) target = { id: tid, roleIds: (tm.body as { roles: string[] }).roles ?? [] };
    else if (tm.res.status === 404) target = { id: tid, roleIds: null };
    else add(false, 'Player', discordErrorText(tm.res.status, tm.body, 'look up'));
  }

  const a = banAbility({ guildId: guildId!, ownerId: guild.owner_id, roles: guild.roles, bot: { id: me.id, roleIds: botRoles }, target });
  const granting = botRoles.map(id => roleById.get(id)).filter((r): r is DiscordRole => {
    if (!r) return false;
    const pm = BigInt(r.permissions);
    return (pm & ADMINISTRATOR) !== 0n || (pm & BAN_MEMBERS) !== 0n;
  }).map(r => r.name);
  add(a.hasBanMembers, 'Ban Members permission', a.hasBanMembers
    ? `yes, from ${granting.length ? granting.join(', ') : (BigInt(roleById.get(guildId!)?.permissions ?? '0') & (ADMINISTRATOR | BAN_MEMBERS)) ? '@everyone' : 'ownership'}`
    : `${me.username} holds ${listRoles(botRoles)} in "${guild.name}", and none of them grants Ban Members or Administrator. `
      + 'The role you gave Ban Members is not on THIS bot in THIS server.');
  add(guild.mfa_level !== 1, '2FA for moderation', guild.mfa_level === 1
    ? 'this server requires it — the Discord account that OWNS the bot application must have 2FA on, '
      + 'or every ban is refused with error 60003'
    : 'not required');
  if (tid && target) {
    const theirs = target.roleIds === null ? 'not in the server' : listRoles(target.roleIds);
    const both = `Bot ${me.username}: ${listRoles(botRoles)}. Player: ${theirs}.`;
    if (target.roleIds === null) {
      add(a.canBanTarget !== false, 'Can ban this player', a.canBanTarget
        ? `yes — they are not in "${guild.name}", so a ban by id works and stops them joining`
        : `${a.reason ?? ''} ${both}`);
    } else {
      add(a.canBanTarget === true, 'Can ban this player', a.canBanTarget
        ? `yes — ${both}`
        : `${a.reason ?? ''}. ${both}`);
    }
  }
  return lines;
}

// Why a ban Discord just refused was refused, in one line, by asking.
//
// Discord answers every one of these refusals with the same "Missing
// Permissions", so the ban's own error cannot say which it was. The check can:
// it signs in with the same token, looks at the same server and the same
// player, and reports the first thing that is not true. Run automatically when
// a ban comes back 403, so the operator is told the cause instead of a list of
// candidates.
export async function explainBanRefusal(targetId: string): Promise<string | null> {
  try {
    const lines = await checkBanSetup(targetId);
    const bad = lines.find(l => !l.ok);
    if (bad) return `${bad.label} — ${bad.detail}`;
    const who = lines.find(l => l.label === 'Bot this site uses')?.detail.split(' — ')[0] ?? 'the bot';
    const where = lines.find(l => l.label === 'Server the ban goes to')?.detail.split(' — ')[0] ?? 'the server';
    return `every check passes for ${who} in ${where}, yet Discord refused. Try the ban once more; if it `
      + 'fails again, remove and re-add the bot\'s role — Discord has been known to hold stale permissions.';
  } catch {
    return null;
  }
}

// ---- the verify channel ----
//
// "Missing Access" (50001) when posting the verify panel means the bot cannot
// see the channel, and Discord does not say why. Usually it is one of two
// things that look fine from everywhere an operator would check: the token
// belongs to a different bot than the one set up, or the channel (or the
// category it sits in) has a permission setting hiding it from the bot's
// role. This works out which, naming the bot, the channel and the setting.

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const ALL_PERMS = (1n << 64n) - 1n;

export interface Overwrite { id: string; type: 0 | 1; allow: string; deny: string }

// What one member may do in one channel, by Discord's own rules: the
// @everyone role and the member's roles give the base; then the channel's
// @everyone setting, then its role settings (all denies, then all allows),
// then a setting for that member alone. For each permission still missing,
// also say which setting took it away, so the answer is "the 'Members' role
// is denied View Channel here", not just "no".
export function channelAccess(p: {
  guildId: string; ownerId: string; roles: DiscordRole[];
  member: { id: string; roleIds: string[] };
  overwrites: Overwrite[];
}): { view: boolean; send: boolean; embed: boolean; blocker: { view: string | null; send: string | null; embed: string | null } } {
  const roleById = new Map(p.roles.map(r => [r.id, r]));
  const name = (id: string) => (id === p.guildId ? '@everyone' : roleById.get(id)?.name ?? `role ${id}`);
  let perms = BigInt(roleById.get(p.guildId)?.permissions ?? '0');
  for (const id of p.member.roleIds) perms |= BigInt(roleById.get(id)?.permissions ?? '0');
  const owner = p.member.id === p.ownerId;
  const admin = owner || (perms & ADMINISTRATOR) !== 0n;
  if (admin) {
    return { view: true, send: true, embed: true, blocker: { view: null, send: null, embed: null } };
  }
  const base = perms;
  const evOw = p.overwrites.find(o => o.type === 0 && o.id === p.guildId);
  if (evOw) { perms &= ~BigInt(evOw.deny); perms |= BigInt(evOw.allow); }
  const roleOws = p.overwrites.filter(o => o.type === 0 && o.id !== p.guildId && p.member.roleIds.includes(o.id));
  let rAllow = 0n; let rDeny = 0n;
  for (const o of roleOws) { rAllow |= BigInt(o.allow); rDeny |= BigInt(o.deny); }
  perms &= ~rDeny; perms |= rAllow;
  const memOw = p.overwrites.find(o => o.type === 1 && o.id === p.member.id);
  if (memOw) { perms &= ~BigInt(memOw.deny); perms |= BigInt(memOw.allow); }

  const why = (bit: bigint, label: string): string | null => {
    if ((perms & bit) !== 0n) return null;
    if (memOw && (BigInt(memOw.deny) & bit)) return `the channel has a setting for the bot itself that denies ${label}`;
    const denyingRoles = roleOws.filter(o => BigInt(o.deny) & bit).map(o => `"${name(o.id)}"`);
    if (denyingRoles.length) return `the channel denies ${label} to ${denyingRoles.join(', ')}, which the bot has`;
    if (evOw && (BigInt(evOw.deny) & bit)) {
      return `the channel denies ${label} to @everyone and allows it to none of the bot's roles — `
        + 'add the bot (or its role) to the channel\'s permissions and allow it';
    }
    if ((base & bit) === 0n) return `none of the bot's roles grants ${label}, and the channel does not allow it either`;
    return `${label} is not granted here`;
  };
  return {
    view: (perms & VIEW_CHANNEL) !== 0n,
    send: (perms & SEND_MESSAGES) !== 0n,
    embed: (perms & EMBED_LINKS) !== 0n,
    blocker: { view: why(VIEW_CHANNEL, 'View Channel'), send: why(SEND_MESSAGES, 'Send Messages'), embed: why(EMBED_LINKS, 'Embed Links') },
  };
}

export async function checkVerifyChannel(channelId: string | null): Promise<BanCheckLine[]> {
  const lines: BanCheckLine[] = [];
  const add = (ok: boolean, label: string, detail: string) => { lines.push({ ok, label, detail }); return ok; };
  if (!channelId) { add(false, 'Verify channel', 'DISCORD_VERIFY_CHANNEL_ID is not set'); return lines; }
  if (!botEnabled()) { add(false, 'Verify channel', 'DISCORD_BOT_TOKEN is not set'); return lines; }
  const guildId = defaultGuildId();
  const get = async (path: string) => {
    const res = await fetch(`${API}${path}`, { headers: botAuth(), signal: AbortSignal.timeout(10_000) });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { res, body };
  };
  try {
    const meR = await get('/users/@me');
    if (!add(meR.res.ok, 'Bot this site uses', meR.res.ok
      ? `${(meR.body as { username: string }).username} (id ${(meR.body as { id: string }).id})`
      : discordErrorText(meR.res.status, meR.body, 'sign in as'))) return lines;
    const me = meR.body as { id: string; username: string };

    // The channel list of the configured server says whether the channel is
    // even in it, and carries its permission settings — readable here even
    // when the channel itself is hidden from the bot.
    if (!guildId) { add(false, 'Verify channel', 'DISCORD_GUILD_ID is not set'); return lines; }
    const [gR, chR, bmR] = await Promise.all([
      get(`/guilds/${guildId}`), get(`/guilds/${guildId}/channels`), get(`/guilds/${guildId}/members/${me.id}`),
    ]);
    if (!add(gR.res.ok, 'Server', gR.res.ok ? `"${(gR.body as { name: string }).name}"` : discordErrorText(gR.res.status, gR.body, 'read the server for'))) return lines;
    if (!add(chR.res.ok && bmR.res.ok, 'Channel list', chR.res.ok && bmR.res.ok ? 'readable'
      : discordErrorText((chR.res.ok ? bmR : chR).res.status, (chR.res.ok ? bmR : chR).body, 'read the channels for'))) return lines;
    const guild = gR.body as { name: string; owner_id: string; roles: DiscordRole[] };
    const chans = chR.body as { id: string; name: string; type: number; parent_id?: string | null; permission_overwrites?: Overwrite[] }[];
    const ch = chans.find(c => c.id === channelId);
    if (!add(!!ch, 'Verify channel', ch
      ? `#${ch.name}`
      : `channel ${channelId} is not in "${guild.name}" — DISCORD_VERIFY_CHANNEL_ID is a channel in another server, or it was deleted and recreated with a new id`)) return lines;
    const botRoles = (bmR.body as { roles?: string[] }).roles ?? [];
    const access = channelAccess({
      guildId, ownerId: guild.owner_id, roles: guild.roles,
      member: { id: me.id, roleIds: botRoles }, overwrites: ch!.permission_overwrites ?? [],
    });
    const cat = ch!.parent_id ? chans.find(c => c.id === ch!.parent_id) : null;
    const where = `#${ch!.name}${cat ? ` (in the "${cat.name}" category, whose settings it may be copying)` : ''}`;
    add(access.view, `${me.username} can see ${where}`, access.view ? 'yes' : access.blocker.view!);
    if (access.view) {
      add(access.send, `${me.username} can post there`, access.send ? 'yes' : access.blocker.send!);
      add(access.embed, `${me.username} can post the panel (Embed Links)`, access.embed ? 'yes' : access.blocker.embed!);
    }
  } catch (e) {
    add(false, 'Verify channel', `could not reach Discord: ${e instanceof Error ? e.message : 'network error'}`);
  }
  return lines;
}

// ---- where Discord sends the Verify button ----
//
// "Chekr Poker didn't respond in time" on the Verify button means Discord
// sent the click somewhere and got no answer within 3 seconds. The click goes
// to the Interactions Endpoint URL of the application that OWNS THE BOT that
// posted the panel — which need not be the application this site signs people
// in with, or the one an operator last looked at in the Developer Portal. If
// that URL is empty, Discord delivers clicks over a gateway connection this
// site never opens, and every click times out. The bot token can read its own
// application's settings, so this says where clicks actually go.

export function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try { return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.toLowerCase(); } catch { return null; }
}

export async function checkInteractions(thisSiteHosts: string[], instanceId?: string): Promise<BanCheckLine[]> {
  const lines: BanCheckLine[] = [];
  const add = (ok: boolean, label: string, detail: string) => { lines.push({ ok, label, detail }); return ok; };
  if (!botEnabled()) return lines;
  const hosts = [...new Set(thisSiteHosts.map(h => h.toLowerCase()).filter(Boolean))];
  const suggest = `https://${hosts.find(h => h.endsWith('.up.railway.app')) ?? hosts[0] ?? 'this-site'}/api/discord/interactions`;
  try {
    const res = await fetch(`${API}/applications/@me`, { headers: botAuth(), signal: AbortSignal.timeout(10_000) });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty */ }
    if (!add(res.ok, 'Bot\'s application', res.ok
      ? `"${(body as { name: string }).name}" (id ${(body as { id: string }).id})`
      : discordErrorText(res.status, body, 'read the application for'))) return lines;
    const app = body as { name: string; id: string; verify_key?: string; interactions_endpoint_url?: string | null };
    const url = app.interactions_endpoint_url?.trim() || null;
    const urlHost = hostOf(url);
    if (!url) {
      add(false, 'Verify button goes to', `nowhere — "${app.name}" has no Interactions Endpoint URL, so Discord has no `
        + 'address to send the click to and it times out ("didn\'t respond in time"). Developer Portal → '
        + `${app.name} → General Information → Interactions Endpoint URL = ${suggest} — then save.`);
    } else {
      // Ask the address itself. Discord gives up after 3 seconds, so a reply
      // slower than that is as good as none.
      let reachesUs = false; let ms = 0; let probeErr: string | null = null;
      if (instanceId) {
        const t0 = Date.now();
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(6_000) });
          ms = Date.now() - t0;
          const j = await r.json().catch(() => null) as { instance?: string } | null;
          reachesUs = j?.instance === instanceId;
        } catch (e) {
          ms = Date.now() - t0;
          probeErr = e instanceof Error ? e.message : 'unreachable';
        }
      }
      const looksLikeUs = !!urlHost && hosts.includes(urlHost) && /\/api\/discord\/interactions\/?$/.test(new URL(url).pathname);
      if (reachesUs || (!instanceId && looksLikeUs)) {
        add(ms < 2500, 'Verify button goes to', ms < 2500
          ? `${url} — this site (answered in ${ms}ms)`
          : `${url} — this site, but it took ${ms}ms to answer and Discord gives up at 3000ms`);
      } else if (probeErr) {
        add(false, 'Verify button goes to', `${url} — which did not answer (${probeErr}), so every click times out. `
          + `Set "${app.name}"'s Interactions Endpoint URL to ${suggest}.`);
      } else {
        add(false, 'Verify button goes to', `${url} — not this site, so this site never sees the click. `
          + `If "${app.name}" should verify players here, set its Interactions Endpoint URL to ${suggest}. `
          + 'If another site uses this same bot, only one of them can receive its button clicks.');
      }
    }
    const keys = discordPublicKeys();
    if (app.verify_key) {
      const has = keys.includes(app.verify_key.toLowerCase());
      add(has, 'Public key', keys.length === 0
        ? `DISCORD_PUBLIC_KEY is not set — set it to ${app.verify_key}`
        : has
          ? `"${app.name}"'s key is accepted${keys.length > 1 ? ` (plus ${keys.length - 1} other application${keys.length > 2 ? 's' : ''})` : ''}`
          : `"${app.name}"'s key is not among DISCORD_PUBLIC_KEY, so every click is rejected as forged. `
            + `Add it: ${app.verify_key}`);
    }
    // Forwarding means a SECOND application's interactions arrive here too —
    // the main site's — signed with that application's key. If only one key
    // is held, one of the two applications is being turned away.
    if (process.env.DISCORD_FORWARD_INTERACTIONS_URL?.trim()) {
      add(keys.length >= 2, 'Main site\'s interactions', keys.length >= 2
        ? `${keys.length} keys accepted, so the main site's application can still reach ${process.env.DISCORD_FORWARD_INTERACTIONS_URL.trim()} through here`
        : 'forwarding is on, so the main site\'s application sends its casino, giveaway and slash-command '
          + 'interactions here — but only one public key is set, so if that application is not '
          + `"${app.name}", every one of them is rejected. Add its Public Key to DISCORD_PUBLIC_KEY, comma separated.`);
    }
  } catch (e) {
    add(false, 'Bot\'s application', `could not reach Discord: ${e instanceof Error ? e.message : 'network error'}`);
  }
  return lines;
}
