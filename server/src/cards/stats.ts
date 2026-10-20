// Finished card matches and their own leaderboard, kept apart from Monopoly's
// results (../stats.ts) so neither game's rankings or profiles mix the other's
// games in.
// TODO: fold into the shared leaderboard (a game tab, `game: 'cards'` on each
// record) once the leaderboard and profile pages can tell games apart.
import { debouncedWriter, readJson } from '../jsonstore.ts';
import { CARDS_GAME_ID } from '../../../shared/cards/meta.ts';
import type { CardsGameMode, CardsMatchMode } from '../../../shared/cards/rules.ts';
import type { CardsGame } from './game.ts';
import type { CardsRoom } from './rooms.ts';

export interface CardsRecord {
  game: typeof CARDS_GAME_ID;
  code: string;
  startedAt: number;
  endedAt: number;
  rounds: number;
  match: CardsMatchMode;
  targetScore: number;
  /** Classic or Chog Chaos (records from before modes: Classic). */
  mode?: CardsGameMode;
  /** Winner first, then by match score, then by fewest points left in hand; players who left last. */
  places: { id: string; name: string; isBot: boolean; score: number; left?: boolean; character?: string; avatar?: string }[];
}

export interface CardsLeaderRow {
  id: string;
  name: string;
  games: number;
  wins: number;
  points: number;
  avatar?: string;
}

const FILE = 'cards-results.json';
let records: CardsRecord[] = [];
const save = debouncedWriter(FILE, () => records, 500);

export function loadCardsResults(): void {
  records = readJson<CardsRecord[]>(FILE, []);
  if (!Array.isArray(records)) records = [];
}

/** The final order of a finished match. */
export function cardsStandings(g: CardsGame): CardsGame['players'] {
  const last = g.history.at(-1);
  const left = (id: string) => last?.hands[id] ?? 0;
  return [...g.players].sort((a, b) =>
    Number(b.id === g.winner) - Number(a.id === g.winner)
    || Number(!!a.left) - Number(!!b.left)
    || b.score - a.score
    || left(a.id) - left(b.id));
}

export function recordCardsResult(room: CardsRoom): CardsRecord | null {
  const g = room.game;
  if (!g || g.phase !== 'over') return null;
  const r: CardsRecord = {
    game: CARDS_GAME_ID, code: room.code, startedAt: room.startedAt ?? g.startedAt, endedAt: g.endedAt ?? Date.now(),
    rounds: g.round, match: g.rules.match, targetScore: g.rules.targetScore, mode: g.rules.mode,
    places: cardsStandings(g).map(p => {
      const seat = room.seat(p.id);
      return {
        id: p.id, name: p.name, isBot: p.isBot, score: p.score, ...(p.left && { left: true }),
        ...(seat && { character: seat.character }), ...(seat && !seat.isBot && { avatar: seat.avatar }),
      };
    }),
  };
  records.push(r);
  if (records.length > 5_000) records.splice(0, records.length - 5_000);
  save();
  return r;
}

export function recentCardsResults(limit = 20): CardsRecord[] {
  return records.slice(-limit).reverse();
}

/** Like Monopoly's: games against bots only do not count; a point per opponent beaten. */
export function cardsLeaderboard(limit = 50): CardsLeaderRow[] {
  const by = new Map<string, CardsLeaderRow>();
  for (const r of records) {
    if (r.places.filter(p => !p.isBot).length < 2) continue;
    r.places.forEach((p, i) => {
      if (p.isBot) return;
      const row = by.get(p.id) ?? { id: p.id, name: p.name, games: 0, wins: 0, points: 0 };
      row.name = p.name;
      if (p.avatar) row.avatar = p.avatar;
      row.games++;
      if (i === 0) row.wins++;
      row.points += r.places.length - 1 - i;
      by.set(p.id, row);
    });
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, limit);
}
