import type { ChogBadge, PlayerProfile } from '../../shared/types';

const TOKEN_KEY = 'chog.token';
const PROFILE_KEY = 'chog.profile';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getProfile(): PlayerProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) as PlayerProfile : null;
  } catch {
    return null;
  }
}

export function saveAuth(token: string, profile: PlayerProfile) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    // Belt and braces with the server's no-store: the header stops anything in
    // the middle keeping a copy, and this stops the browser reaching for one it
    // already has.
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  // A token the server refuses is a dead session, not a passing error: the
  // signing key was rotated, or the token predates a change to what a token
  // has to carry. The stored copy will never work again, so drop it and say
  // so. Without this the header keeps rendering the cached profile while
  // every panel behind it sits at "Loading…" for ever.
  // 403 is deliberately left alone — that is a live session being told no.
  if (res.status === 401 && token) {
    clearAuth();
    window.dispatchEvent(new Event('auth:expired'));
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface AppConfig {
  features?: import('./features').Features;
  chatEnabled?: boolean;
  discordEnabled: boolean;
  demoMode: boolean;
  codeVerify: boolean;
  codeVerifyChannel: string | null;
  codeVerifyButton: boolean;
  // The Chog Games hub this room belongs to; null on a standalone deployment.
  hubUrl?: string | null;
  discord: {
    botEnabled: boolean;
    guildId: string | null;
    inviteUrl: string | null;
    announceConfigured: boolean;
  };
}

// "Your Chog" picker (server/src/chogroutes.ts). `chogs` is what the hub says
// this player holds; `reachable` false means the hub could not be asked.
export interface MyChogs {
  enabled: boolean;
  artBase: string | null;
  pick: number | null;
  chogs: ChogBadge[];
  reachable: boolean;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  myChogs: (refresh = false) => request<MyChogs>(`/api/chogs${refresh ? '?refresh=1' : ''}`),
  pickChog: (chogToken: number | null) =>
    request<{ pick: number | null; chog: ChogBadge | null }>('/api/chogs/pick', {
      method: 'POST', body: JSON.stringify({ chogToken }),
    }),
  // The profile as the server sees it (operator flag included).
  me: () => request<{ profile: PlayerProfile }>('/api/auth/me'),
  // Whether this player may host (operator, Chog holder or approved host; the hub decides).
  hosting: () => request<{ canHost: boolean; reason: 'admin' | 'holder' | 'approved' | null; error?: string | null }>('/api/hosting/me'),
  discordRoles: (guildId?: string) =>
    request<{ roles: { id: string; name: string }[] }>(
      `/api/discord/roles${guildId ? `?guildId=${encodeURIComponent(guildId)}` : ''}`),
  demoLogin: (name: string) =>
    request<{ token: string; profile: PlayerProfile }>('/api/auth/demo', {
      method: 'POST', body: JSON.stringify({ name }),
    }),
  codeStart: () =>
    request<{ code: string; expiresAt: number }>('/api/auth/code/start', { method: 'POST', body: '{}' }),
  codeStatus: (code: string) =>
    request<{ pending: boolean; expired?: boolean; token?: string; profile?: PlayerProfile }>(
      `/api/auth/code/status?code=${encodeURIComponent(code)}`),
  createTable: (opts: {
    name: string; sb: number; bb: number; minBuy: number; maxBuy: number; maxSeats: number;
    ante?: number; actionSeconds?: number; timebankSeconds?: number; rabbitHunting?: boolean;
    displayMode?: 'chips' | 'bb';
    customLevels?: { sb: number; bb: number; ante?: number; minutes: number; isBreak?: boolean }[];
    theme?: import('../../shared/types').TableTheme;
  }) =>
    request<{ id: string }>('/api/tables', { method: 'POST', body: JSON.stringify(opts) }),
  audit: () => request<{
    counts: { players: number; actions: number; pairs: number; flagged: number };
    players: {
      id: string; name: string; avatar: string; discordTag: string | null;
      discordVerifiedId: string | null; firstSeen: number; lastSeen: number;
      ips: string[]; countries: (string | null)[]; handsPlayed: number; games: number;
      // What the VPN door makes of their most recent address, reported
      // whether or not the block is on.
      vpn: 'vpn' | 'datacenter' | null;
    }[];
    alts: {
      key: string;
      // Each address carries who is behind it, so a ban started from here can
      // offer to take the accounts with it and name them first.
      addresses: { ip: string; country: string | null; accounts: { id: string; name: string; avatar: string; discordTag: string | null; discordId: string | null }[] }[];
      // Reading order, not a probability of guilt — see altGroups() for how it
      // is arrived at and why a big group scores low rather than high.
      score: number; reasons: string[]; playedTogether: number;
      players: { id: string; name: string; discordTag: string | null; lastSeen: number }[];
    }[];
    // Accounts that have signed in from the same browser. 'device' is the
    // same stored browser id — a fact. 'print' is the same browser traits —
    // a hint, since identical phones collide.
    devices: {
      key: string; strength: 'device' | 'print';
      players: { id: string; name: string; discordTag: string | null; lastSeen: number }[];
      sharedIps: string[]; lastSeen: number;
    }[];
    pairs: {
      a: string; aName: string; b: string; bName: string;
      handsTogether: number; headsUpPots: number; netAtoB: number;
      sharedIps: string[]; sameIpOnly: boolean;
      dumpHands: number; dumpChips: number;
    }[];
    flagged: {
      ts: number; tableName: string; handNumber: number;
      playerId: string; playerName: string;
      toId: string | null; toName: string | null;
      chips: number; stackPct: number; reason: string;
      cards: { r: number; s: number }[];
    }[];
  }>('/api/admin/audit'),
  // Plain-text report for sharing (not JSON — it is meant to be pasted).
  auditReport: async (): Promise<string> => {
    const token = getToken();
    const res = await fetch('/api/admin/audit/report', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Report failed (${res.status})`);
    return res.text();
  },
  // One account, and everything the addresses tie it to. Takes a site id, a
  // bare Discord id, a Discord tag or a name.
  playerConnections: (q: string) => request<{
    subject: {
      id: string; name: string; avatar: string;
      discordTag: string | null; discordVerifiedId: string | null;
      firstSeen: number; lastSeen: number;
      ips: string[]; countries: (string | null)[];
      handsPlayed: number; games: number;
    };
    addresses: { ip: string; country: string | null; accounts: number }[];
    linked: {
      id: string; name: string; avatar: string;
      discordTag: string | null; discordVerifiedId: string | null;
      sharedIps: string[]; hops: number; via: string | null; crowd: number;
      playedTogether: number; handsPlayed: number;
      firstSeen: number; lastSeen: number;
    }[];
    verdict: string;
  }>(`/api/admin/audit/player/${encodeURIComponent(q)}`),
  // The same thing as text, for pasting somewhere.
  playerConnectionsText: async (q: string): Promise<string> => {
    const token = getToken();
    const res = await fetch(
      `/api/admin/audit/player/${encodeURIComponent(q)}?format=text`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) throw new Error(`No account matches that (${res.status})`);
    return res.text();
  },
  // Is address detection actually working? The raw proxy headers, what we
  // resolved from them, and whether the hop count still looks right.
  ipDebug: () => request<{
    you: {
      forwardedFor: string | null; realIp: string | null;
      envoyExternal: string | null; cfConnecting: string | null;
      expressIp: string | null; socketPeer: string | null;
    };
    trustedProxyHops: number;
    hopCount: { samples: number; disagreeing: number; healthy: boolean; hint: string };
    recent: {
      at: number; who: string | null;
      forwardedFor: string | null; realIp: string | null;
      envoyExternal: string | null; cfConnecting: string | null;
      peer: string | null; resolved: string | null;
    }[];
  }>('/api/admin/ipdebug'),
  // Which games left an event record, newest first.
  eventGames: () => request<{
    games: { gameId: string; gameName: string; events: number; from: number; to: number }[];
  }>('/api/admin/events'),
  // One game's events as plain text. Same shape as the audit report: it is
  // meant to be read and pasted, so it does not come back as JSON.
  eventLog: async (id: string): Promise<string> => {
    const token = getToken();
    const res = await fetch(`/api/admin/events/${encodeURIComponent(id)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Could not load that log (${res.status})`);
    return res.text();
  },
  auditActions: (playerId?: string) => request<{
    actions: {
      ts: number; tableId: string; tableName: string; handNumber: number;
      playerId: string; playerName: string; action: string; amount: number; pot: number;
    }[];
  }>(`/api/admin/actions${playerId ? `?playerId=${encodeURIComponent(playerId)}` : ''}`),
  auditForgetPlayer: (playerId: string) =>
    request<{ found: boolean; actions: number; pairs: number; flagged: number }>(
      `/api/admin/audit/player/${encodeURIComponent(playerId)}`, { method: 'DELETE' }),
  health: () =>
    request<{
      uptimeSec: number; rssMb: number; heapMb: number; sockets: number;
      loopLagMs: number; liveTournaments: number; liveTables: number;
      seatedPlayers: number; integrityIssues: number;
      snapshotAgeMs: number | null; persistentDisk: boolean;
    }>('/api/admin/health'),
  // Final results for a tournament whose live game is gone.
  tournamentResult: (id: string) =>
    request<{ record: import('../../shared/types').TournamentRecord }>(`/api/results/${id}`),
  createTournament: (opts: Record<string, unknown>) =>
    request<{ id: string }>('/api/tournaments', { method: 'POST', body: JSON.stringify(opts) }),
  postVerifyMessage: (channelId?: string) =>
    request<{ ok: true; channelId: string }>('/api/discord/verify-message', {
      method: 'POST', body: JSON.stringify({ channelId }),
    }),
  // Null when the operator has switched the advert off or left it empty.
  promo: () => request<{ promo: PromoConfig | null }>('/api/promo').then(r => r.promo),
  promoGet: () => request<{ promo: PromoConfig }>('/api/admin/promo').then(r => r.promo),
  promoSave: (promo: PromoConfig) =>
    request<{ promo: PromoConfig }>('/api/admin/promo', {
      method: 'PUT', body: JSON.stringify(promo),
    }).then(r => r.promo),
  // Discord DM to a player. The server resolves their Discord account from
  // our own player id — Discord ids never reach the browser.
  dm: (playerId: string, message: string) =>
    request<{ ok: true; name: string }>('/api/admin/dm', {
      method: 'POST', body: JSON.stringify({ playerId, message }),
    }),
  chatGet: () => request<{ enabled: boolean }>('/api/admin/chat'),
  chatSet: (enabled: boolean) =>
    request<{ enabled: boolean }>('/api/admin/chat', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  // The VPN door: its state, and what turning it on would cost.
  vpnGet: () => request<{
    enabled: boolean; stored: boolean; envForcedOff: boolean;
    bypassKeySet: boolean; allowList: string[];
    ranges: { vpn: number; datacenter: number }; apiKeySet: boolean;
    players: number;
    wouldBlock: { id: string; name: string; kind: 'vpn' | 'datacenter' }[];
  }>('/api/admin/vpn'),
  vpnSet: (enabled: boolean) =>
    request<{ enabled: boolean }>('/api/admin/vpn', {
      method: 'PUT', body: JSON.stringify({ enabled }),
    }),
  featuresGet: () =>
    request<{ features: import('./features').Features }>('/api/admin/features').then(r => r.features),
  featuresSave: (f: import('./features').Features) =>
    request<{ features: import('./features').Features }>('/api/admin/features', {
      method: 'PUT', body: JSON.stringify(f),
    }).then(r => r.features),
  // Operator-only: the ids behind the names in a tournament's standings, and
  // who shares an address with whom. Deliberately not part of the standings
  // broadcast — that goes to every player, and a player id is a Discord
  // snowflake with a prefix.
  standingIdentities: (tournamentId: string) =>
    request<{ identities: { id: string; discordId: string | null; sharesWith: string[]; sharesDeviceWith: string[] }[] }>(
      `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/identities`),
  bans: () => request<{ bans: BanRow[] }>('/api/admin/bans'),
  ban: (b: {
    kind: 'player' | 'ip'; value?: string; name?: string; reason?: string;
    scope?: 'game' | 'lifetime'; gameId?: string | null;
    // For an IP ban when you know the player but not the address.
    playerId?: string;
    // Also ban them from the Discord server. The site ban goes through either
    // way; a Discord failure comes back as discordNote rather than as an error.
    discordBan?: boolean;
    // For an IP ban: also suspend the accounts seen from that address, so the
    // same people cannot simply come back from a phone.
    banPlayers?: boolean;
    // Further accounts — the subject's suspected alts — banned in the same
    // action, with the same reach.
    alsoBan?: string[];
    // Ban ONLY the alts in alsoBan: the player named by value/playerId is
    // left alone — no account ban, no address ban, no Discord ban.
    skipPrimary?: boolean;
  }) =>
    request<{
      ban: BanRow; ejected: { tournaments: number; tables: number };
      discordNote?: string | null;
      alsoBanned?: string[];
    }>('/api/admin/bans', {
      method: 'POST', body: JSON.stringify(b),
    }),
  // Live check of everything a Discord ban depends on, optionally against one
  // player. Run by the server, which holds the bot token.
  // Who joined the Discord through whose invite, and the bot's live connection.
  discordInvites: () => request<DiscordInvitesReport>('/api/admin/discord/invites'),
  discordInvitesReconnect: () =>
    request<{ status: DiscordInvitesReport['status'] }>('/api/admin/discord/invites/reconnect', { method: 'POST', body: '{}' }),
  discordBanCheck: (target?: string) =>
    request<{ lines: { ok: boolean; label: string; detail: string }[]; target?: string | null }>(
      `/api/admin/discord/ban-check${target ? `?target=${encodeURIComponent(target)}` : ''}`),
  // Who else this account looks like: same browser, or a shared address that
  // is not a carrier's. For the ban screen.
  suspectedAlts: (playerId: string) =>
    request<{ self: { id: string; name: string; avatar: string; discordTag: string | null; discordId: string | null } | null; alts: {
      id: string; name: string; avatar: string; discordTag: string | null; discordId: string | null;
      reasons: string[]; strength: 'browser' | 'address'; lastSeen: number; alreadyBanned: boolean;
    }[] }>(`/api/admin/players/${encodeURIComponent(playerId)}/alts`),
  unban: (b: BanRow) => {
    const q = b.scope === 'game' ? `?scope=game&gameId=${encodeURIComponent(b.gameId ?? '')}` : '';
    return request<{ ok: true }>(
      `/api/admin/bans/${b.kind}/${encodeURIComponent(b.value)}${q}`, { method: 'DELETE' });
  },
  bannableGames: () =>
    request<{ games: { id: string; name: string; kind: 'tournament' | 'cash' }[] }>(
      '/api/admin/bannable-games'),
  liveGames: () => request<{
    tournaments: {
      id: string; name: string; state: string; players: number; alive: number;
      level: number; createdAt: number; startedAt: number | null;
      hostId: string; hostName: string; playerHosted: boolean;
    }[];
    cashTables: {
      id: string; name: string; sb: number; bb: number; players: number;
      maxSeats: number; hands: number; closed: boolean; createdAt: number;
      hostId: string | null; hostName: string; playerHosted: boolean;
    }[];
  }>('/api/admin/games'),
  stopGame: (kind: 'cash' | 'tournament', id: string) =>
    request<{ ok: true }>(`/api/admin/games/${kind}/${encodeURIComponent(id)}/stop`, {
      method: 'POST', body: '{}',
    }),
  deleteGame: (kind: 'cash' | 'tournament', id: string) =>
    request<{ ok: true }>(`/api/admin/games/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  archive: () => request<{
    tournaments: import('../../shared/types').TournamentRecord[];
    cash: import('../../shared/types').CashRecord[];
  }>('/api/admin/archive'),
  deleteArchived: (kind: 'cash' | 'tournament', id: string) =>
    request<{ ok: true }>(`/api/admin/archive/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  musicList: () => request<{ songs: SongRow[] }>('/api/admin/music'),
  playlists: () => request<{ playlists: { name: string; count: number }[] }>('/api/admin/playlists'),
  playlistRename: (from: string, to: string) =>
    request<{ moved: number; playlists: { name: string; count: number }[] }>('/api/admin/playlists', {
      method: 'PATCH', body: JSON.stringify({ from, to }),
    }),
  musicUpdate: (id: string, patch: { name?: string; vibe?: string }) =>
    request<{ song: SongRow }>(`/api/admin/music/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  musicDelete: (id: string) =>
    request<{ ok: true }>(`/api/admin/music/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  graphicsList: () => request<{ graphics: GraphicRow[] }>('/api/admin/graphics'),
  graphicDelete: (id: string) =>
    request<{ ok: true }>(`/api/admin/graphics/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  graphicUpload: async (file: File, name: string): Promise<GraphicRow> => {
    const token = getToken();
    let data: ArrayBuffer;
    try {
      data = await file.arrayBuffer();
    } catch {
      throw new Error(`Couldn't read "${file.name}" — if it's in cloud storage, download it locally first`);
    }
    const res = await fetch(`/api/admin/graphics?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
    return (body as { graphic: GraphicRow }).graphic;
  },
  // Raw-body upload — name/playlist ride the query. The file is read into
  // memory first: Safari's fetch is flaky streaming a File directly (bare
  // "Load failed"), and reading also surfaces not-actually-downloaded
  // iCloud files as a clear error instead of a mid-transfer death.
  musicImport: (from: string, rename?: Record<string, string>) =>
    request<{ added: number; skipped: number; failed: { name: string; why: string }[] }>(
      '/api/admin/music/import',
      { method: 'POST', body: JSON.stringify({ from, rename: rename ?? {} }) }),
  musicUpload: async (file: File, name: string, vibe: string): Promise<SongRow> => {
    const token = getToken();
    let data: ArrayBuffer;
    try {
      data = await file.arrayBuffer();
    } catch {
      throw new Error(
        `Couldn't read "${file.name}" from this device — if it's in iCloud or cloud storage, download it locally first`,
      );
    }
    if (data.byteLength === 0) {
      throw new Error(`"${file.name}" read as empty — make sure it's fully downloaded, then try again`);
    }
    const post = () => fetch(
      `/api/admin/music?name=${encodeURIComponent(name)}&vibe=${encodeURIComponent(vibe)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: data,
      },
    );
    let res: Response;
    try {
      res = await post();
    } catch {
      // A bare network failure (server mid-restart, connection blip) —
      // one retry after a beat before giving up with a real message.
      await new Promise(r => setTimeout(r, 1500));
      try {
        res = await post();
      } catch {
        throw new Error('Upload failed mid-transfer — check your connection (or a deploy just restarted the server) and try again');
      }
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Upload failed (${res.status})`);
    return (body as { song: SongRow }).song;
  },
};

export interface FirmConfig {
  id: string;
  name: string;
  offer: string;
  url: string;
  accent: 'purple' | 'green' | 'gold' | 'blue';
}

export interface BanRow {
  kind: 'player' | 'ip';
  scope: 'game' | 'lifetime';
  gameId: string | null;
  gameName: string;
  value: string;
  name: string;
  reason: string;
  at: number;
  by: string;
}

export interface PromoConfig {
  enabled: boolean;
  code: string;
  headline: string;
  blurb: string;
  url: string;
  ctaLabel: string;
  railEnabled: boolean;
  firms: FirmConfig[];
}

export interface SongRow {
  id: string;
  name: string;
  vibe: string;
  file: string;
  size: number;
  addedAt: number;
}

export interface GraphicRow {
  id: string;
  name: string;
  file: string;
  size: number;
  addedAt: number;
}

type SiteAccount = { id: string; name: string; avatar: string };
export interface DiscordInvitesReport {
  status: {
    state: 'off' | 'connecting' | 'ready' | 'failed'; detail: string; since: number;
    invitesReadable: boolean | null; invitesTracked: number; lastJoinAt: number | null;
  };
  wanted: boolean;
  total: number;
  joins: {
    memberId: string; memberName: string; memberAvatar: string | null;
    accountCreatedAt: number; joinedAt: number;
    how: 'invite' | 'vanity' | 'ambiguous' | 'unknown';
    code: string | null; inviterId: string | null; inviterName: string | null;
    candidates?: { code: string; inviterId: string | null; inviterName: string | null }[];
    ageDays: number; young: boolean;
    member: SiteAccount | null; inviter: SiteAccount | null;
    flags: string[];
  }[];
  inviters: {
    inviterId: string; inviterName: string; inviter: SiteAccount | null;
    invited: number; fresh: number; flagged: number; banned: boolean;
  }[];
}
