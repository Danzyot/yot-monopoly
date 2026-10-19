// A live connection to Discord, used for one thing: hearing members join the
// server, so the bot can tell which invite they came through and who made it.
//
// Everything else the bot does is a one-off request. Joins are not something
// Discord can be asked about afterwards — they are only ever announced, on
// this connection, as they happen. So the bot holds it open, keeps a count of
// every invite's uses, and on each join compares the counts (see invitelog.ts
// for how a join is attributed).
//
// Two switches on Discord's side, both needed, both reported in the status
// rather than failing silently:
//   - "Server Members Intent" in the Developer Portal → Bot. Without it
//     Discord closes the connection with 4014 and announces no joins.
//   - "Manage Server" for the bot in the server. Without it the invite list,
//     and so who invited whom, cannot be read.
//
// Set DISCORD_INVITE_TRACKING=off to keep the connection closed altogether.
import { botEnabled, botGet, defaultGuildId, discordApiBase, postAuditEmbed } from './discord.ts';
import {
  accountAgeDays, accountCreatedAt, attributeJoin, isYoung, recordJoin,
  type InviteInfo, type InviteJoin,
} from './invitelog.ts';

// GUILDS, GUILD_MEMBERS (privileged), GUILD_INVITES.
const INTENTS = (1 << 0) | (1 << 1) | (1 << 6);

export type GatewayState = 'off' | 'connecting' | 'ready' | 'failed';
export interface GatewayStatus {
  state: GatewayState;
  detail: string;
  since: number;
  // Whether the invite list could be read. False means joins are still logged
  // but nobody can be named as the inviter.
  invitesReadable: boolean | null;
  invitesTracked: number;
  lastJoinAt: number | null;
}

let status: GatewayStatus = {
  state: 'off', detail: 'Not started', since: Date.now(),
  invitesReadable: null, invitesTracked: 0, lastJoinAt: null,
};
const setStatus = (state: GatewayState, detail: string) => {
  status = { ...status, state, detail, since: Date.now() };
};
export function gatewayStatus(): GatewayStatus {
  return { ...status, invitesTracked: invites.size };
}

// Close codes that will not get better by reconnecting, in words that say
// what to change.
const FATAL: Record<number, string> = {
  4004: 'Discord refused the bot token — check DISCORD_BOT_TOKEN.',
  4010: 'Discord refused the connection (invalid shard).',
  4011: 'Discord says the bot needs sharding — it is in too many servers for one connection.',
  4012: 'Discord refused the gateway version.',
  4013: 'Discord refused the intents requested.',
  4014: 'Discord will not send member joins: turn on "Server Members Intent" in the Developer '
    + 'Portal → your application → Bot → Privileged Gateway Intents, then press Reconnect.',
};

let ws: WebSocket | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let seq: number | null = null;
let sessionId: string | null = null;
let resumeUrl: string | null = null;
let acked = true;
let attempts = 0;
let stopped = true;

// The invite counts as of the last look, and invites Discord has deleted in
// the last few seconds (a one-use invite is deleted by the join that uses it).
let invites = new Map<string, InviteInfo>();
let vanityUses: number | null = null;
let recentlyDeleted: { info: InviteInfo; at: number }[] = [];

export function inviteTrackingWanted(): boolean {
  return botEnabled() && !!defaultGuildId()
    && !/^(off|0|false|no)$/i.test(process.env.DISCORD_INVITE_TRACKING?.trim() ?? '');
}

export function startGateway(): void {
  if (!inviteTrackingWanted()) {
    setStatus('off', !botEnabled() || !defaultGuildId()
      ? 'Needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID'
      : 'Switched off with DISCORD_INVITE_TRACKING');
    return;
  }
  stopped = false;
  attempts = 0;
  void connect(false);
}

export function stopGateway(): void {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopHeartbeat();
  const s = ws;
  ws = null;
  try { s?.close(1000); } catch { /* already closed */ }
  setStatus('off', 'Stopped');
}

// For the dashboard's Reconnect button, after the operator has fixed whatever
// the status said.
export function restartGateway(): void {
  stopGateway();
  sessionId = null; seq = null; resumeUrl = null;
  startGateway();
}

// Where to connect. Discord names the URL; a test's stand-in names its own,
// and only a stand-in on this machine may use plain ws://.
async function gatewayUrl(): Promise<string> {
  const res = await botGet('/gateway/bot');
  if (!res.ok) throw Object.assign(new Error(`Discord answered ${res.status} when asked where to connect`), { status: res.status });
  const body = await res.json() as { url?: string };
  const url = String(body.url ?? '');
  const local = /^http:\/\/(127\.0\.0\.1|localhost)/.test(discordApiBase());
  if (/^wss:\/\/[a-z0-9.-]+\.discord\.gg(\/|$)/i.test(url)) return url.replace(/\/$/, '');
  if (local && /^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url)) return url.replace(/\/$/, '');
  throw new Error(`Discord gave a gateway address this server will not use: ${url.slice(0, 80)}`);
}

async function connect(resume: boolean): Promise<void> {
  if (stopped) return;
  setStatus('connecting', resume ? 'Resuming the connection to Discord…' : 'Connecting to Discord…');
  let base: string;
  try {
    base = resume && resumeUrl ? resumeUrl : await gatewayUrl();
  } catch (e) {
    const st = (e as { status?: number }).status;
    if (st === 401) { setStatus('failed', FATAL[4004]); return; }
    scheduleReconnect(false, e instanceof Error ? e.message : 'Could not reach Discord');
    return;
  }
  if (stopped) return;
  const sock = new WebSocket(`${base}/?v=10&encoding=json`);
  ws = sock;
  acked = true;
  sock.onmessage = ev => {
    if (ws !== sock) return;
    let msg: { op: number; d: unknown; s: number | null; t: string | null };
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    handle(sock, msg, resume);
  };
  sock.onclose = ev => {
    if (ws !== sock) return;
    ws = null;
    stopHeartbeat();
    if (stopped) return;
    const fatal = FATAL[ev.code];
    if (fatal) { setStatus('failed', `${fatal} (Discord close ${ev.code})`); return; }
    // 4007 (bad sequence) and 4009 (session timed out) cannot be resumed.
    const canResume = !!sessionId && ev.code !== 4007 && ev.code !== 4009 && ev.code !== 1000;
    if (!canResume) { sessionId = null; seq = null; }
    scheduleReconnect(canResume, `Connection closed (${ev.code}${ev.reason ? ` ${ev.reason}` : ''}) — reconnecting`);
  };
  sock.onerror = () => { /* the close that follows says what happened */ };
}

function scheduleReconnect(resume: boolean, why: string) {
  if (stopped) return;
  attempts += 1;
  const wait = Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6));
  setStatus('connecting', `${why}; trying again in ${Math.round(wait / 1000)}s`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(resume); }, wait);
  reconnectTimer.unref?.();
}

function send(sock: WebSocket, payload: unknown) {
  try { sock.send(JSON.stringify(payload)); } catch { /* closing; onclose handles it */ }
}

function stopHeartbeat() {
  if (heartbeat) { clearInterval(heartbeat); clearTimeout(heartbeat); heartbeat = null; }
}

function startHeartbeat(sock: WebSocket, interval: number) {
  stopHeartbeat();
  const beat = () => {
    if (ws !== sock) return;
    // No answer to the last beat: the connection is dead without having said
    // so. Close it and resume rather than wait forever.
    if (!acked) { try { sock.close(4000, 'no heartbeat ack'); } catch { /* gone */ } return; }
    acked = false;
    send(sock, { op: 1, d: seq });
  };
  // Discord asks for the first beat at a random point in the first interval.
  heartbeat = setTimeout(() => {
    beat();
    heartbeat = setInterval(beat, interval);
    heartbeat.unref?.();
  }, Math.floor(interval * Math.random()));
  heartbeat.unref?.();
}

function handle(sock: WebSocket, msg: { op: number; d: unknown; s: number | null; t: string | null }, resuming: boolean) {
  if (typeof msg.s === 'number') seq = msg.s;
  switch (msg.op) {
    case 10: { // Hello
      const interval = Number((msg.d as { heartbeat_interval?: number })?.heartbeat_interval) || 41_250;
      startHeartbeat(sock, interval);
      const token = process.env.DISCORD_BOT_TOKEN!.trim();
      if (resuming && sessionId) {
        send(sock, { op: 6, d: { token, session_id: sessionId, seq } });
      } else {
        send(sock, {
          op: 2,
          d: {
            token, intents: INTENTS, large_threshold: 50,
            properties: { os: process.platform, browser: 'poker-site', device: 'poker-site' },
          },
        });
      }
      return;
    }
    case 11: acked = true; return;
    case 1: send(sock, { op: 1, d: seq }); return;
    case 7: try { sock.close(4000, 'reconnect requested'); } catch { /* gone */ } return;
    case 9: { // Invalid session
      const resumable = msg.d === true;
      if (!resumable) { sessionId = null; seq = null; }
      try { sock.close(4000, 'invalid session'); } catch { /* gone */ }
      return;
    }
    case 0: dispatch(msg.t ?? '', msg.d); return;
  }
}

function dispatch(t: string, d: unknown) {
  const guild = defaultGuildId();
  const g = (d as { guild_id?: string; id?: string } | null) ?? {};
  switch (t) {
    case 'READY': {
      const r = d as { session_id: string; resume_gateway_url?: string };
      sessionId = r.session_id;
      resumeUrl = r.resume_gateway_url?.replace(/\/$/, '') ?? null;
      attempts = 0;
      setStatus('ready', 'Connected — watching joins');
      void refreshInvites();
      return;
    }
    case 'RESUMED':
      attempts = 0;
      setStatus('ready', 'Connected — watching joins');
      void refreshInvites();
      return;
    case 'GUILD_CREATE':
      if (g.id === guild) void refreshInvites();
      return;
    case 'INVITE_CREATE': {
      if (g.guild_id !== guild) return;
      const i = d as { code: string; uses?: number; max_uses?: number; inviter?: { id: string; username?: string; global_name?: string | null } };
      invites.set(i.code, {
        code: i.code, uses: i.uses ?? 0, maxUses: i.max_uses ?? 0,
        inviterId: i.inviter?.id ?? null,
        inviterName: i.inviter ? (i.inviter.global_name || i.inviter.username || null) : null,
      });
      return;
    }
    case 'INVITE_DELETE': {
      if (g.guild_id !== guild) return;
      const code = (d as { code: string }).code;
      const info = invites.get(code);
      if (info) recentlyDeleted.push({ info, at: Date.now() });
      // The join that used it may arrive after this; leave it in the list
      // until that join has been looked at, and drop it then.
      return;
    }
    case 'GUILD_MEMBER_ADD':
      if (g.guild_id !== guild) return;
      queue = queue.then(() => onJoin(d as MemberAdd)).catch(e => console.error('Invite tracking:', e));
      return;
  }
}

interface MemberAdd {
  guild_id: string;
  joined_at?: string;
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null; bot?: boolean };
}

// Joins are looked at one at a time. Two at once would each see both counts
// go up and neither could be told apart.
let queue: Promise<void> = Promise.resolve();

async function readInvites(): Promise<Map<string, InviteInfo> | null> {
  const guild = defaultGuildId();
  if (!guild) return null;
  try {
    const res = await botGet(`/guilds/${guild}/invites`);
    if (!res.ok) {
      status = { ...status, invitesReadable: false };
      if (res.status === 403) {
        status.detail = 'Connected, but the bot cannot read the invite list — give it "Manage Server" '
          + 'in the Discord server, or joins are logged without who invited them.';
      }
      return null;
    }
    const list = await res.json() as {
      code: string; uses?: number; max_uses?: number;
      inviter?: { id: string; username?: string; global_name?: string | null };
    }[];
    status = { ...status, invitesReadable: true };
    if (status.state === 'ready') status.detail = 'Connected — watching joins';
    const m = new Map<string, InviteInfo>();
    for (const i of list) {
      m.set(i.code, {
        code: i.code, uses: i.uses ?? 0, maxUses: i.max_uses ?? 0,
        inviterId: i.inviter?.id ?? null,
        inviterName: i.inviter ? (i.inviter.global_name || i.inviter.username || null) : null,
      });
    }
    return m;
  } catch {
    return null;
  }
}

async function readVanityUses(): Promise<number | null> {
  const guild = defaultGuildId();
  if (!guild) return null;
  try {
    const res = await botGet(`/guilds/${guild}/vanity-url`);
    if (!res.ok) return null;
    const v = await res.json() as { code?: string | null; uses?: number };
    return v.code ? (v.uses ?? 0) : null;
  } catch {
    return null;
  }
}

async function refreshInvites(): Promise<void> {
  const m = await readInvites();
  if (m) invites = m;
  vanityUses = await readVanityUses();
}

async function onJoin(d: MemberAdd): Promise<void> {
  if (d.user.bot) return;
  const before = invites;
  const beforeVanity = vanityUses;
  const after = await readInvites();
  const afterVanity = await readVanityUses();
  const cutoff = Date.now() - 15_000;
  recentlyDeleted = recentlyDeleted.filter(x => x.at >= cutoff);
  const who = after
    ? attributeJoin(before, after, recentlyDeleted.map(x => x.info), { before: beforeVanity, after: afterVanity })
    : { how: 'unknown' as const, code: null, inviterId: null, inviterName: null };
  if (after) {
    invites = after;
    // Whatever was deleted has now been accounted for by this join or not at all.
    recentlyDeleted = recentlyDeleted.filter(x => after.has(x.info.code));
  }
  vanityUses = afterVanity;

  const joinedAt = d.joined_at ? Date.parse(d.joined_at) || Date.now() : Date.now();
  const join: InviteJoin = {
    memberId: d.user.id,
    memberName: d.user.global_name || d.user.username,
    memberAvatar: d.user.avatar
      ? `https://cdn.discordapp.com/avatars/${d.user.id}/${d.user.avatar}.png?size=64`
      : null,
    accountCreatedAt: accountCreatedAt(d.user.id),
    joinedAt,
    ...who,
  };
  recordJoin(join);
  status = { ...status, lastJoinAt: joinedAt };

  // A fresh account arriving through a member's invite is worth a look now,
  // not whenever someone next opens the audit.
  if (join.inviterId && isYoung(join) && accountAgeDays(join) < 7) {
    void postAuditEmbed({
      title: '🔗 Fresh account joined through a member\'s invite',
      description: `**${join.memberName}** (<@${join.memberId}>) joined through `
        + `**${join.inviterName ?? join.inviterId}**'s invite (<@${join.inviterId}>, code \`${join.code}\`).\n`
        + `Their Discord account is ${accountAgeDays(join) === 0 ? 'less than a day' : `${accountAgeDays(join)} day${accountAgeDays(join) === 1 ? '' : 's'}`} old.`,
      color: 0xe8b64c,
      footer: { text: 'Advisory only — Dashboard → Audit → Discord invites shows everyone they invited.' },
    });
  }
}
