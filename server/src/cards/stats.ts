// Finished card matches, their own leaderboard and the Cards half of a
// player's profile, kept apart from Monopoly's results (../stats.ts) so neither
// game's rankings mix the other's games in; the profile page shows each game in
// its own section.
// TODO: fold into the shared leaderboard (a game tab, `game: 'cards'` on each
// record) once the leaderboard page can tell games apart.
import { debouncedWriter, readJson } from '../jsonstore.ts';
import { CARDS_GAME_ID } from '../../../shared/cards/meta.ts';
import type { CardsMatchMode } from '../../../shared/cards/rules.ts';
import type { CardsProfile, CardsProfileGame } from '../../../shared/types.ts';
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
  /** A private table's (tournament tables are private): kept off public feeds like the home ticker. */
  private?: true;
  /** Winner first, then by match score, then by fewest points left in hand; players who left last. */
  places: CardsPlace[];
}

export interface CardsPlace {
  id: string; name: string; isBot: boolean; score: number; left?: boolean; character?: string; avatar?: string;
  /** Humans only: the NFT Chog they played as (their own, checked against their wallet). Absent in older records. */
  chogToken?: number;
  /** Their best round won (achievements), absent when they won none and in older records: the most points it scored... */
  bestRound?: number;
  /** ...and the most cards left in the others' hands when they went out (absent before card counts were kept). */
  roundCards?: number;
}

/** A player's best round won, from the match's round history. */
export function bestRounds(history: CardsGame['history'], id: string): { bestRound?: number; roundCards?: number } {
  let bestRound = 0, roundCards = 0;
  for (const h of history) {
    if (h.winner !== id) continue;
    bestRound = Math.max(bestRound, h.points);
    if (h.cards) roundCards = Math.max(roundCards, Object.values(h.cards).reduce((a, b) => a + b, 0));
  }
  return { ...(bestRound && { bestRound }), ...(roundCards && { roundCards }) };
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
/** Matches listed on a profile. */
const RECENT_GAMES = 20;
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
    rounds: g.round, match: g.rules.match, targetScore: g.rules.targetScore, ...(room.private && { private: true as const }),
    places: cardsStandings(g).map(p => {
      const seat = room.seat(p.id);
      const human = !!seat && !seat.isBot;
      return {
        id: p.id, name: p.name, isBot: p.isBot, score: p.score, ...(p.left && { left: true }),
        ...(seat && { character: seat.character }), ...(human && { avatar: seat.avatar }),
        ...(human && seat.chogToken !== undefined && { chogToken: seat.chogToken }),
        ...(!p.isBot && bestRounds(g.history, p.id)),
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

/** Every stored match, oldest first. */
export function allCardsResults(): readonly CardsRecord[] {
  return records;
}

/** Matches against bots only do not count towards the leaderboard. */
const isRankedCards = (r: CardsRecord) => r.places.filter(p => !p.isBot).length >= 2;

/** Like Monopoly's: games against bots only do not count; a point per opponent beaten. */
export function cardsLeaderboard(limit = 50): CardsLeaderRow[] {
  const by = new Map<string, CardsLeaderRow>();
  for (const r of records) {
    if (!isRankedCards(r)) continue;
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

/**
 * One human's Cards record for their public profile: matches, wins, points
 * (the leaderboard's), match score and the latest results. Null when they
 * have never finished a match. Like the Monopoly profile (../profiles.ts),
 * nothing but results goes in.
 */
export function buildCardsProfile(id: string, from: readonly CardsRecord[] = records): CardsProfile | null {
  let name = '', avatar = '';
  let games = 0, wins = 0, points = 0, rankedGames = 0, score = 0, firstGameAt = 0, lastGameAt = 0;
  const recent: CardsProfileGame[] = [];
  for (const r of from) {
    const place = r.places.findIndex(p => p.id === id && !p.isBot);
    if (place < 0) continue;
    const me = r.places[place];
    // Records are oldest first, so the latest name and avatar win.
    name = me.name;
    if (me.avatar) avatar = me.avatar;
    if (!games) firstGameAt = r.endedAt;
    lastGameAt = r.endedAt;
    games++;
    if (place === 0) wins++;
    score += me.score;
    if (isRankedCards(r)) {
      rankedGames++;
      points += r.places.length - 1 - place;
    }
    recent.push({
      code: r.code, endedAt: r.endedAt, place: place + 1, of: r.places.length, rounds: r.rounds,
      match: r.match, targetScore: r.targetScore, score: me.score, ...(me.left && { left: true }),
      character: me.character ?? null,
      opponents: r.places.flatMap((p, j) => (j === place ? [] : [{ id: p.id, name: p.name, isBot: p.isBot, place: j + 1 }])),
    });
  }
  if (!games) return null;
  return {
    id, name, avatar: avatar || '🃏', games, wins, winRate: wins / games, points, rankedGames, score,
    firstGameAt, lastGameAt, recent: recent.slice(-RECENT_GAMES).reverse(),
  };
}
