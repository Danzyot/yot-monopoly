// The home page's live ticker (GET /api/activity, routes/activity.ts): the
// latest wins, tables starting, open lobbies, tournament champions and new
// sign-ups, built from the stores the server already keeps. Nothing new is
// recorded for it.
//
// Only what is public anyway goes out: display names (never ids beyond the
// public profile link the leaderboard already gives), no addresses, nothing
// from a private table (results remember whether their table was private), no
// tournament table (those are private), and nobody under a site ban. Winners'
// and champions' names ride on the leaderboard switch, like public profiles.
//
// The list is rebuilt at most every TTL_MS however many people poll it.
import type { ActivityGame, ActivityItem } from '../../shared/activity.ts';
import type { TournamentSummary } from '../../shared/tournaments.ts';
import { GAMES } from '../../shared/brand.ts';
import { isDeletedId } from './deleted.ts';

/** One live table, as much of it as the ticker reads (Monopoly rooms and card tables alike). */
export interface ActivityTable {
  code: string;
  private: boolean;
  status: 'lobby' | 'playing' | 'finished';
  players: number;
  maxPlayers: number;
  createdAt: number;
  startedAt: number | null;
  /** Someone is actually there (the public lists show only these). */
  occupied: boolean;
  /** Discord-gated or a tournament's: shown nowhere as open. */
  restricted: boolean;
}

/** A finished game, as much of it as the ticker reads. */
export interface ActivityResult {
  code: string;
  endedAt: number;
  private?: boolean;
  /** Winner first. */
  places: { id: string; name: string; isBot: boolean }[];
  /** Monopoly's map. */
  mapId?: string;
}

export interface ActivitySources {
  monopolyResults(): readonly ActivityResult[];
  cardsResults(): readonly ActivityResult[];
  monopolyTables(): Iterable<ActivityTable>;
  cardsTables(): Iterable<ActivityTable>;
  tournaments(): readonly TournamentSummary[];
  /** First-seen times of accounts created since `since`, with their ids (for the ban check only). */
  newAccounts(since: number): readonly { id: string; firstSeen: number }[];
  /** The leaderboard switch: winners' names are published only while it is on. */
  resultsPublic(): boolean;
  /** Under a live site-wide ban. */
  banned(playerId: string): boolean;
  mapName(mapId: string): string;
  now(): number;
}

export const TTL_MS = 10_000;
export const MAX_ITEMS = 50;
/** How far back wins and champions go. */
const RESULTS_WINDOW_MS = 3 * 24 * 3_600_000;
/** A table "just started" for this long. */
const STARTED_WINDOW_MS = 20 * 60_000;
/** Sign-ups counted in "new players joined". */
const JOINED_WINDOW_MS = 24 * 3_600_000;
/** Per kind of event, so one busy game cannot fill the strip on its own. */
const PER_SOURCE = 8;

const NAME_MAX = 24;
const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > NAME_MAX ? `${t.slice(0, NAME_MAX - 1)}…` : t;
};
const GAME_NAMES: Record<'monopoly' | 'cards', string> = { monopoly: GAMES.monopoly.name, cards: GAMES.cards.name };
const tableHref = (game: 'monopoly' | 'cards', code: string) => (game === 'cards' ? `/cards/r/${code}` : `/r/${code}`);

/** Everything worth a line right now, newest first. */
export function buildActivity(src: ActivitySources): ActivityItem[] {
  const now = src.now();
  const out: ActivityItem[] = [];
  const recent = <T>(xs: readonly T[], at: (x: T) => number) =>
    xs.filter(x => now - at(x) <= RESULTS_WINDOW_MS && at(x) <= now + 60_000)
      .sort((a, b) => at(b) - at(a));

  // ---- wins ----
  if (src.resultsPublic()) {
    const wins = (game: 'monopoly' | 'cards', records: readonly ActivityResult[]) => {
      let n = 0;
      for (const r of recent(records, x => x.endedAt)) {
        if (n >= PER_SOURCE) break;
        const w = r.places[0];
        if (r.private || !w || w.isBot || isDeletedId(w.id) || src.banned(w.id)) continue;
        const others = r.places.length - 1;
        const text = game === 'monopoly'
          ? `${clip(w.name)} won on ${src.mapName(r.mapId ?? 'classic')}`
          : `${clip(w.name)} won at ${GAME_NAMES.cards}${others > 0 ? ` (${r.places.length} players)` : ''}`;
        out.push({ id: `win:${game}:${r.code}:${r.endedAt}`, kind: 'win', game, text, at: r.endedAt, href: `/u/${encodeURIComponent(w.id)}` });
        n++;
      }
    };
    wins('monopoly', src.monopolyResults());
    wins('cards', src.cardsResults());
  }

  // ---- live tables: just started, and lobbies with seats free ----
  const tables = (game: 'monopoly' | 'cards', list: Iterable<ActivityTable>) => {
    let started = 0, open = 0;
    const all = [...list].filter(t => !t.private && t.occupied && !t.restricted);
    for (const t of all.filter(x => x.status === 'playing' && x.startedAt !== null && now - x.startedAt <= STARTED_WINDOW_MS)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))) {
      if (started++ >= PER_SOURCE) break;
      out.push({
        id: `started:${game}:${t.code}:${t.startedAt}`, kind: 'started', game, at: t.startedAt!, href: tableHref(game, t.code),
        text: `Table ${t.code} just started (${GAME_NAMES[game]}, ${t.players} players)`,
      });
    }
    for (const t of all.filter(x => x.status === 'lobby' && x.players < x.maxPlayers).sort((a, b) => b.createdAt - a.createdAt)) {
      if (open++ >= PER_SOURCE) break;
      const free = t.maxPlayers - t.players;
      out.push({
        id: `open:${game}:${t.code}`, kind: 'open', game, at: Math.min(t.createdAt, now), href: tableHref(game, t.code),
        text: `Table ${t.code} has ${free} seat${free === 1 ? '' : 's'} free (${GAME_NAMES[game]}, ${t.players}/${t.maxPlayers})`,
      });
    }
  };
  tables('monopoly', src.monopolyTables());
  tables('cards', src.cardsTables());

  // ---- tournaments ----
  let champs = 0, running = 0;
  for (const t of src.tournaments()) {
    const game: ActivityGame = 'tournament';
    const href = `/tournaments/${encodeURIComponent(t.id)}`;
    if (t.status === 'finished' && t.champion && t.finishedAt !== null && now - t.finishedAt <= RESULTS_WINDOW_MS) {
      // A champion is a winner's name: published only while results are.
      if (!src.resultsPublic() || champs >= PER_SOURCE || isDeletedId(t.champion.id) || src.banned(t.champion.id)) continue;
      champs++;
      out.push({ id: `champion:${t.id}`, kind: 'champion', game, at: t.finishedAt, href, text: `${clip(t.champion.name)} took 1st in ${clip(t.name)}` });
    } else if (t.status === 'running' && t.startedAt !== null && running < PER_SOURCE) {
      running++;
      out.push({
        id: `tournament:${t.id}:${t.round ?? 0}`, kind: 'tournament', game, at: t.startedAt, href,
        text: `${clip(t.name)} is under way${t.round ? ` (round ${t.round})` : ''}`,
      });
    }
  }

  // ---- sign-ups: counted, never named ----
  const joined = src.newAccounts(now - JOINED_WINDOW_MS).filter(a => !src.banned(a.id));
  if (joined.length) {
    const at = Math.max(...joined.map(a => a.firstSeen));
    out.push({
      id: `joined:${joined.length}:${at}`, kind: 'joined', game: 'site', at,
      text: joined.length === 1 ? 'A new player joined' : `${joined.length} new players joined today`,
    });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
}

/** buildActivity behind a short cache: everyone polling within TTL_MS gets the same list. */
export function createActivityFeed(src: ActivitySources, ttlMs = TTL_MS) {
  let cache: { at: number; items: ActivityItem[] } | null = null;
  return {
    get(limit = 20): { items: ActivityItem[]; now: number } {
      const now = src.now();
      if (!cache || now - cache.at >= ttlMs || now < cache.at) cache = { at: now, items: buildActivity(src) };
      const asked = Math.floor(Number(limit));
      const n = Number.isFinite(asked) ? Math.max(1, Math.min(MAX_ITEMS, asked)) : 20;
      return { items: cache.items.slice(0, n), now: cache.at };
    },
    /** Drop the cached list (tests). */
    clear() { cache = null; },
  };
}
