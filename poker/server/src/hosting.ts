// Player hosts. Operators (ADMIN_DISCORD_IDS) have always been able to open
// cash tables and tournaments here; Chog Games also lets Chog Genesis holders
// and players an operator approved host their own. Who qualifies is decided
// on the hub (server/src/hosting.ts there), so this room asks it — signed
// with the shared token secret — and keeps the answer for a minute.
//
// What a player host may do is deliberately narrow: start, pause, resume and
// cancel their own tournament, write its prize line, set its start time, and
// close their own cash table. Kicking, approving registrations, Discord role
// gating, results posted to Discord, rewriting a hand and everything else an
// operator does stays with operators.
import { PLAYER_HOST_LIMITS } from '../../shared/hosting.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { serviceMac } from './auth.ts';
import { hubUrl } from './hub.ts';

export type HostReason = 'admin' | 'holder' | 'approved';

export interface HostCheck {
  canHost: boolean;
  reason: HostReason | null;
  /** Set when the hub could not be asked; the answer is then "no" (fail closed). */
  error?: string;
}

export const HOST_CACHE_MS = 60_000;
const HUB_TIMEOUT_MS = 5_000;

export const HUB_UNREACHABLE = 'Could not check your hosting rights with Chog Games right now, so hosting is paused for you. Try again in a minute.';
export const NOT_A_HOST = 'Hosting is for Chog Genesis holders and players an operator has approved. Link the wallet that holds your Chog on Chog Games, then try again.';
export const NO_HUB = 'This poker room is not connected to Chog Games, so only operators can host here.';

let fetchImpl: typeof fetch = (...a) => fetch(...a);
let clock = () => Date.now();
const cache = new Map<string, { at: number; value: HostCheck }>();
const inflight = new Map<string, Promise<HostCheck>>();

/** Test hook: a fake hub and a fake clock. */
export function configureHosting(o: { fetch?: typeof fetch; now?: () => number }): void {
  if (o.fetch) fetchImpl = o.fetch;
  if (o.now) clock = o.now;
}

export function clearHostCache(): void {
  cache.clear();
}

/** What gets signed (the hub prefixes `svc:` the same way serviceMac does). */
export function canHostMessage(id: string, ts: number | string): string {
  return `hosting:can-host:${id}:${ts}`;
}

/**
 * Asks the hub whether this player may host. Answers are cached for a minute,
 * yes or no; a hub that cannot be reached (or refuses our signature) is a
 * "no" with an error, and is not cached, so the next try asks again.
 */
export function hubCanHost(playerId: string): Promise<HostCheck> {
  const hit = cache.get(playerId);
  if (hit && clock() - hit.at < HOST_CACHE_MS) return Promise.resolve(hit.value);
  const hub = hubUrl();
  if (!hub) return Promise.resolve({ canHost: false, reason: null, error: NO_HUB });
  let p = inflight.get(playerId);
  if (p) return p;
  p = (async (): Promise<HostCheck> => {
    try {
      const ts = clock();
      const res = await fetchImpl(`${hub}/api/hosting/can-host?id=${encodeURIComponent(playerId)}`, {
        headers: {
          'x-chog-timestamp': String(ts),
          'x-chog-signature': serviceMac(canHostMessage(playerId, ts)),
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
      });
      if (!res.ok) {
        // 401 here nearly always means CHOG_SECRET differs from the hub's APP_SECRET.
        console.error(`Hub hosting check failed (${res.status}) for ${playerId}`);
        return { canHost: false, reason: null, error: HUB_UNREACHABLE };
      }
      const body = await res.json() as { canHost?: unknown; reason?: unknown };
      const reason = body.reason === 'admin' || body.reason === 'holder' || body.reason === 'approved' ? body.reason : null;
      const value: HostCheck = { canHost: body.canHost === true && reason !== null, reason };
      if (cache.size > 5_000) cache.clear();
      cache.set(playerId, { at: clock(), value });
      return value;
    } catch (e) {
      console.error(`Hub hosting check failed for ${playerId}:`, e instanceof Error ? e.message : e);
      return { canHost: false, reason: null, error: HUB_UNREACHABLE };
    } finally {
      inflight.delete(playerId);
    }
  })();
  inflight.set(playerId, p);
  return p;
}

// ---------- limits for player hosts ----------

// The numbers live in shared/ so the create forms offer the same ones.
export { PLAYER_HOST_LIMITS };

/** Refuses with a message when a player host already runs as much as they may. */
export function assertUnderHostLimit(
  kind: 'tournament' | 'cash',
  hostId: string,
  live: {
    tournaments: { values(): Iterable<{ hostId: string; state: string }> };
    cashTables: { values(): Iterable<{ hostId: string | null; closed: boolean }> };
  },
): void {
  if (kind === 'tournament') {
    let n = 0;
    for (const t of live.tournaments.values()) {
      if (t.hostId === hostId && t.state !== 'finished' && t.state !== 'cancelled') n += 1;
    }
    if (n >= PLAYER_HOST_LIMITS.tournaments) {
      throw new Error(`You can host ${PLAYER_HOST_LIMITS.tournaments} tournament at a time — finish or cancel the one you have first.`);
    }
    return;
  }
  let n = 0;
  for (const t of live.cashTables.values()) if (t.hostId === hostId && !t.closed) n += 1;
  if (n >= PLAYER_HOST_LIMITS.cashTables) {
    throw new Error(`You can run ${PLAYER_HOST_LIMITS.cashTables} cash tables at a time — close one first.`);
  }
}

const cap = (v: number, max: number) => Math.min(v, max);

/**
 * A player host's tournament: the same form, clamped to a field and a length
 * a community night needs, with the operator-only parts taken out. Mutates
 * and returns the config.
 */
export function clampPlayerTournament(config: TournamentConfig): TournamentConfig {
  const L = PLAYER_HOST_LIMITS;
  config.playerHosted = true;
  config.maxPlayers = cap(config.maxPlayers, L.maxPlayers);
  config.minPlayers = cap(config.minPlayers, config.maxPlayers);
  config.startingStack = cap(config.startingStack, L.startingStack);
  config.levelMinutes = cap(config.levelMinutes, L.levelMinutes);
  config.lateRegMinutes = cap(config.lateRegMinutes, L.lateRegMinutes);
  config.joinMinutes = cap(config.joinMinutes ?? L.joinMinutes, L.joinMinutes);
  config.maxReentries = cap(config.maxReentries, L.maxReentries);
  if (config.betCapMinutes) config.betCapMinutes = cap(config.betCapMinutes, L.betCapMinutes);
  // A custom schedule can run a level for twelve hours or forever; player
  // events use the generated speeds, which keep climbing until someone wins.
  config.customLevels = null;
  // Gatekeeping who may enter (approval, Discord roles, follow requirements)
  // is an operator's job.
  config.approveRegistrations = false;
  config.social = null;
  return config;
}

/** A scheduled start a player host may set: in the future and within a week. */
export function playerScheduledStart(ts: number | null, now = Date.now()): number | null {
  if (ts === null) return null;
  if (ts > now + PLAYER_HOST_LIMITS.scheduleAheadMs) {
    throw new Error('Pick a start time within the next 7 days.');
  }
  return ts;
}

// ---------- who may do what to an event ----------

/** What a player host may do with their own tournament. */
export const PLAYER_HOST_ACTIONS = new Set(['start', 'pause', 'resume', 'cancel', 'prize', 'schedule'] as const);
export type DirectorAction =
  | 'start' | 'pause' | 'resume' | 'cancel' | 'prize' | 'schedule'
  | 'settings' | 'kick' | 'approve' | 'reinstate' | 'seat' | 'people' | 'endNow';

/**
 * May this viewer do this to that event? Operators may do anything anywhere.
 * The host of an event an operator created (it predates player hosting, or
 * the host has since left ADMIN_DISCORD_IDS) keeps the director's full kit,
 * as before. The host of a player-hosted event gets PLAYER_HOST_ACTIONS only.
 */
export function mayDirect(
  event: { hostId: string | null; playerHosted?: boolean },
  me: { id: string; isAdmin?: boolean },
  action: DirectorAction,
): boolean {
  if (me.isAdmin === true) return true;
  if (!event.hostId || event.hostId !== me.id) return false;
  if (!event.playerHosted) return true;
  return (PLAYER_HOST_ACTIONS as Set<string>).has(action);
}

/** Keys of tourney:settings a player host may send, and the action each one is. */
export const PLAYER_SETTINGS = new Map<string, DirectorAction>([['prizeText', 'prize'], ['scheduledStart', 'schedule']]);
