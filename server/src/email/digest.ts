// The weekly digest's numbers: last week's finished public games (Monopoly and
// Cards), its top players by wins, and the tournaments of the week ahead.
// Bots, deleted players, banned players and private tables are left out, as on
// the leaderboard and the home ticker.
import { isDeletedId } from '../deleted.ts';
import type { DigestData } from './templates.ts';

const WEEK_MS = 7 * 86_400_000;

interface Finished {
  endedAt: number;
  private?: true;
  places: { id: string; name: string; isBot: boolean }[];
}

export interface DigestSources {
  monopoly: readonly Finished[];
  cards: readonly Finished[];
  banned(id: string): boolean;
  /** Tournaments starting in the week ahead (open ones and schedule occurrences). */
  tournaments(now: number): { name: string; start: number }[];
}

function lastWeek(src: DigestSources, now: number): Finished[] {
  const from = now - WEEK_MS;
  return [...src.monopoly, ...src.cards].filter(r => r.endedAt > from && r.endedAt <= now && !r.private);
}

export function buildDigest(src: DigestSources, now: number, top = 5): Omit<DigestData, 'you'> {
  const games = lastWeek(src, now);
  const by = new Map<string, { name: string; wins: number; games: number }>();
  for (const g of games) {
    g.places.forEach((p, i) => {
      if (p.isBot || isDeletedId(p.id)) return;
      const row = by.get(p.id) ?? { name: p.name, wins: 0, games: 0 };
      row.name = p.name;
      row.games++;
      if (i === 0) row.wins++;
      by.set(p.id, row);
    });
  }
  const leaders = [...by.entries()]
    .filter(([id, r]) => r.wins > 0 && !src.banned(id))
    .sort((a, b) => b[1].wins - a[1].wins || a[1].games - b[1].games || a[1].name.localeCompare(b[1].name))
    .slice(0, top)
    .map(([, r]) => r);
  const tournaments = src.tournaments(now).filter(t => t.start > now && t.start <= now + WEEK_MS).sort((a, b) => a.start - b.start).slice(0, 8);
  return { weekOf: new Date(now - WEEK_MS).toISOString().slice(0, 10), games: games.length, players: by.size, top: leaders, tournaments };
}

export function digestYou(src: DigestSources, id: string, now: number): DigestData['you'] {
  let games = 0;
  let wins = 0;
  for (const g of lastWeek(src, now)) {
    const i = g.places.findIndex(p => p.id === id);
    if (i < 0) continue;
    games++;
    if (i === 0) wins++;
  }
  return games ? { games, wins } : undefined;
}
