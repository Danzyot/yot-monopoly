// Public player profiles, built only from finished-game results (results.json).
// Deliberately nothing from the accounts audit (connections.ts): a profile is
// public, and IPs, linked accounts and Discord ids must never leak through it.
import { isRanked, placePoints, type GameRecord } from './stats.ts';
import type { ProfileGame, PublicProfile } from '../../shared/types.ts';

const RECENT_GAMES = 20;

/** Ids are `dc_<snowflake>`, `demo_…` and the like; anything else is not a player. */
export function validPlayerId(id: string): boolean {
  return /^[\w-]{1,64}$/.test(id);
}

/** The most-played value, ties going to whichever was played most recently. */
function favourite(counts: Map<string, { n: number; last: number }>): { id: string; games: number } | null {
  let best: [string, { n: number; last: number }] | null = null;
  for (const e of counts) {
    if (!best || e[1].n > best[1].n || (e[1].n === best[1].n && e[1].last > best[1].last)) best = e;
  }
  return best ? { id: best[0], games: best[1].n } : null;
}

/** Aggregate one human's results. Null when they have never finished a game. */
export function buildProfile(id: string, records: readonly GameRecord[]): PublicProfile | null {
  if (!validPlayerId(id)) return null;
  let name = '', avatar = '';
  let games = 0, wins = 0, points = 0, rankedGames = 0;
  const maps = new Map<string, { n: number; last: number }>();
  const characters = new Map<string, { n: number; last: number }>();
  const recent: ProfileGame[] = [];
  const bump = (m: Map<string, { n: number; last: number }>, key: string, i: number) => {
    const c = m.get(key) ?? { n: 0, last: 0 };
    c.n++;
    c.last = i;
    m.set(key, c);
  };

  records.forEach((r, i) => {
    const place = r.places.findIndex(p => p.id === id && !p.isBot);
    if (place < 0) return;
    const me = r.places[place];
    // Records are oldest first, so the latest name and avatar win.
    name = me.name;
    if (me.avatar) avatar = me.avatar;
    games++;
    if (place === 0) wins++;
    if (isRanked(r)) {
      rankedGames++;
      points += placePoints(r.places.length, place);
    }
    bump(maps, r.mapId, i);
    if (me.character) bump(characters, me.character, i);
    recent.push({
      code: r.code, endedAt: r.endedAt, mapId: r.mapId, themeId: r.themeId,
      place: place + 1, of: r.places.length, turns: r.turns, character: me.character ?? null,
      opponents: r.places.flatMap((p, j) => (j === place ? [] : [{ id: p.id, name: p.name, isBot: p.isBot, place: j + 1 }])),
    });
  });

  if (!games) return null;
  return {
    id, name, avatar: avatar || '🎩',
    games, wins, winRate: wins / games, points, rankedGames,
    favouriteMap: favourite(maps),
    favouriteCharacter: favourite(characters),
    recent: recent.slice(-RECENT_GAMES).reverse(),
  };
}
