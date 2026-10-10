// Bans. Two kinds, because cheats come back two ways.
//
// A player ban is tied to the account (and to its verified Discord id, so a
// fresh guest account with the same Discord cannot walk back in). An IP ban
// covers the address, which is what stops a brand new account from the same
// machine.
//
// Enforcement is deliberately at the doors — connecting, registering,
// sitting down — rather than sprinkled through the game code, so there is no
// path that forgets to check.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { banMessageFor } from '../../shared/types.ts';
import { DATA_DIR } from './paths.ts';

const FILE = join(DATA_DIR, 'bans.json');

export type BanKind = 'player' | 'ip';

// How far a ban reaches. A cheat in one tournament is not always someone you
// want gone forever, and throwing every offence straight to a lifetime ban
// makes the lifetime list useless.
export type BanScope = 'game' | 'lifetime';

export interface Ban {
  kind: BanKind;
  scope: BanScope;
  // Which game a 'game' ban belongs to (tournament or cash table id), and
  // what it was called — null/'' for lifetime bans.
  gameId: string | null;
  gameName: string;
  // Player id, Discord id, or IP address — whatever this ban keys on.
  value: string;
  // Who it was, at the time, so a list of raw ids is still readable a month
  // later. Never used for matching.
  name: string;
  reason: string;
  at: number;
  by: string;
  // True only when THIS site issued a Discord server ban alongside it. Lifting
  // the site ban lifts that one too — and because the flag records what we
  // did rather than what Discord currently holds, an unban here can never
  // undo a ban a moderator made by hand for something unrelated.
  discordBanned?: boolean;
  // For an account ban: the Discord account linked to it when it was banned.
  // A guest who links Discord afterwards keeps a g_ id, so without this the
  // same person on the same Discord could make a fresh guest, link it, and be
  // let straight back in.
  discordId?: string;
}

// The Discord snowflake an account id or bare id stands for, if any.
function snowflakeOf(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.startsWith('dc_')) return v.slice(3);
  return /^\d{15,22}$/.test(v) ? v : null;
}

let bans: Ban[] = [];

export function loadBans(): void {
  try {
    if (!existsSync(FILE)) return;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    if (!Array.isArray(parsed)) return;
    // Bans written before scopes existed were site-wide, and matching is by
    // scope now — without this they would load and quietly never match again.
    bans = (parsed as Partial<Ban>[])
      .filter((b): b is Ban => typeof b?.value === 'string' && !!b.value)
      .map(b => ({
        ...b,
        scope: b.scope === 'game' ? 'game' : 'lifetime',
        gameId: b.scope === 'game' ? (b.gameId ?? null) : null,
        gameName: b.gameName ?? '',
      }));
  } catch (e) {
    console.error('Could not load bans:', e);
  }
}

function save(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(bans, null, 2));
    renameSync(tmp, FILE);
  } catch (e) {
    console.error('Could not save bans:', e);
  }
}

// Addresses arrive in a few shapes depending on the proxy in front; compare
// them in one.
// Addresses arrive in a few shapes depending on the proxy in front, and the
// same address can be written several ways. Ban matching compares these as
// strings, so anything that is not folded to one spelling here is a way back
// in: `010.0.0.1` and `10.0.0.1` are the same machine, and a ban on one has to
// be a ban on the other.
export function normaliseIp(ip: string | null | undefined): string {
  if (!ip) return '';
  const raw = ip.trim()
    .replace(/^\[|\]$/g, '')   // bracketed IPv6
    .split('%')[0]             // zone index
    .replace(/^::ffff:/i, ''); // IPv4 written as IPv6
  if (!raw) return '';

  // IPv4: four decimal octets, leading zeros folded away. Anything that is not
  // exactly four octets in range is left alone rather than guessed at — a
  // wrong guess is a wrong ban.
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (v4) {
    const parts = v4.slice(1).map(n => Number(n.replace(/^0+(?=\d)/, '')));
    if (parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) return parts.join('.');
    return raw.toLowerCase();
  }

  if (!raw.includes(':')) return raw.toLowerCase();
  return canonicalIpv6(raw.toLowerCase()) ?? raw.toLowerCase();
}

// Expand to eight groups, drop leading zeros, then re-compress the longest run
// of zero groups. Two spellings of one address land on the same string.
function canonicalIpv6(addr: string): string | null {
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

  // A trailing IPv4 form (::ffff:1.2.3.4 style) — keep it readable as IPv4.
  const last = tail.length ? tail[tail.length - 1] : head[head.length - 1];
  if (last && last.includes('.')) return null;

  const groups: string[] = halves.length === 2
    ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
    : head;
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;

  const clean = groups.map(g => g.replace(/^0+(?=.)/, ''));
  let bestAt = -1; let bestLen = 0; let at = -1; let len = 0;
  clean.forEach((g, i) => {
    if (g === '0') {
      if (at < 0) { at = i; len = 0; }
      len += 1;
      if (len > bestLen) { bestLen = len; bestAt = at; }
    } else { at = -1; len = 0; }
  });
  if (bestLen < 2) return clean.join(':');
  return `${clean.slice(0, bestAt).join(':')}::${clean.slice(bestAt + bestLen).join(':')}`;
}

// Identity of a ban. Scope and game are part of it, so the same person can
// be barred from one tournament without that clashing with a lifetime ban.
const key = (b: Pick<Ban, 'kind' | 'scope' | 'gameId' | 'value'>) =>
  `${b.scope}:${b.gameId ?? ''}:${b.kind}:${b.kind === 'ip' ? normaliseIp(b.value) : b.value.trim()}`;

export function listBans(): Ban[] {
  return [...bans].sort((a, b) => b.at - a.at);
}

export function addBan(b: Omit<Ban, 'at' | 'scope' | 'gameId' | 'gameName'> & {
  at?: number; scope?: BanScope; gameId?: string | null; gameName?: string;
}): Ban {
  const value = b.kind === 'ip' ? normaliseIp(b.value) : b.value.trim();
  if (!value) throw new Error('Nothing to ban');
  const scope: BanScope = b.scope === 'game' ? 'game' : 'lifetime';
  const gameId = scope === 'game' ? (b.gameId ?? '').trim() : null;
  if (scope === 'game' && !gameId) throw new Error('A game ban needs a game');
  const ban: Ban = {
    kind: b.kind,
    scope,
    gameId: gameId || null,
    gameName: (b.gameName ?? '').trim().slice(0, 60),
    value,
    name: (b.name ?? '').trim().slice(0, 60),
    reason: (b.reason ?? '').trim().slice(0, 200),
    at: b.at ?? Date.now(),
    by: (b.by ?? '').slice(0, 60),
    // Only stored when true. An absent flag and a false one mean the same
    // thing — this site issued no Discord ban — and leaving it out keeps
    // every row written before the feature existed honest by default.
    ...(b.discordBanned ? { discordBanned: true as const } : {}),
    ...(b.kind === 'player' && snowflakeOf(b.discordId ?? null) ? { discordId: snowflakeOf(b.discordId ?? null)! } : {}),
  };
  // Re-banning updates the note rather than stacking duplicates. A re-ban
  // that did NOT touch Discord must not erase the record of one that did:
  // the flag is what an unban later reads to decide whether to lift it.
  const i = bans.findIndex(x => key(x) === key(ban));
  if (i >= 0) {
    if (bans[i].discordBanned) ban.discordBanned = true;
    if (bans[i].discordId && !ban.discordId) ban.discordId = bans[i].discordId;
    bans[i] = ban;
  }
  else bans.push(ban);
  save();
  return ban;
}

// The exact stored ban a delete would remove. `findBan` above answers "is this
// person barred" from a person's identifiers; this answers "which row is this"
// from the row's own key, which is what the unban route holds. It is needed
// because removeBan reports only whether something was deleted — a contract
// the tests rely on — and lifting a Discord ban requires knowing whether this
// site ever issued one.
export function banAt(
  kind: BanKind, value: string,
  scope: BanScope = 'lifetime', gameId: string | null = null,
): Ban | null {
  const k = key({
    kind,
    value: kind === 'ip' ? normaliseIp(value) : value.trim(),
    scope,
    gameId: scope === 'game' ? gameId : null,
  });
  return bans.find(b => key(b) === k) ?? null;
}

export function removeBan(
  kind: BanKind, value: string,
  scope: BanScope = 'lifetime', gameId: string | null = null,
): boolean {
  const k = key({ kind, value, scope, gameId: scope === 'game' ? gameId : null });
  const before = bans.length;
  bans = bans.filter(b => key(b) !== k);
  if (bans.length === before) return false;
  save();
  return true;
}

// Is this player barred? Checked against the account id, the Discord id
// behind it, and the address they are coming from — any one is enough.
//
// `gameId` widens the question from "are they off the site" to "are they off
// the site OR out of this particular game". Called without one — at connect,
// and on every ordinary action — only lifetime bans can match, so a player
// barred from one tournament still has the rest of the site.
export function findBan(
  p: { id?: string | null; discordId?: string | null; ip?: string | null },
  gameId?: string | null,
): Ban | null {
  const ip = normaliseIp(p.ip);
  const matchesWho = (b: Ban) => {
    if (b.kind === 'ip') return !!ip && normaliseIp(b.value) === ip;
    // By account id, or by the Discord account behind it. A ban on dc_123 is
    // a ban on Discord 123 whatever account it next turns up on — including a
    // guest that linked it, whose id is g_… — and so is a ban recorded with
    // the Discord account the banned guest had linked.
    if (!!p.id && b.value === p.id) return true;
    const visitorDiscord = snowflakeOf(p.discordId ?? null) ?? snowflakeOf(p.id ?? null);
    if (!visitorDiscord) return false;
    return snowflakeOf(b.value) === visitorDiscord || b.discordId === visitorDiscord;
  };
  // Lifetime first: it is the more serious answer, and the one worth showing.
  for (const b of bans) {
    if (b.scope === 'lifetime' && matchesWho(b)) return b;
  }
  if (!gameId) return null;
  for (const b of bans) {
    if (b.scope === 'game' && b.gameId === gameId && matchesWho(b)) return b;
  }
  return null;
}

export function isBanned(p: Parameters<typeof findBan>[0], gameId?: string | null): boolean {
  return findBan(p, gameId) !== null;
}

// Every game ban attached to one game — used to clear them out when the game
// itself is deleted, so the list does not fill with bans for things that no
// longer exist.
export function removeGameBans(gameId: string): number {
  const before = bans.length;
  bans = bans.filter(b => !(b.scope === 'game' && b.gameId === gameId));
  const gone = before - bans.length;
  if (gone) save();
  return gone;
}

// The line a barred player is shown. The wording itself is shared with the
// client so the operator's preview and what the player reads cannot drift.
export function banMessage(b: Ban): string {
  return banMessageFor(b.scope, b.reason);
}
