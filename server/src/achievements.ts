// Achievements, worked out from what the server already keeps: finished
// Monopoly games (stats.ts), finished Cards matches (cards/stats.ts), finished
// tournaments (tournament/manager.ts) and whether the account has a wallet
// linked (wallet/store.ts; only that one yes/no, never an address). Nothing is
// tracked for badges alone: the few facts a badge needs that a result did not
// hold before (whole colour sets, a player's own NFT Chog, the best round
// won) are recorded with each result now, so badges that use them count games
// from then on.
//
// Each badge's `earnedAt` is the end of the game (or tournament, or the
// wallet link) that earned it, which is what puts the newest at the top and
// lets the client toast the ones a game just earned.
import { ACH, ACHIEVEMENTS, sortAchievements, type Achievement } from '../../shared/achievements.ts';
import { MAPS } from '../../shared/maps.ts';
import type { TournamentResult } from '../../shared/tournaments.ts';
import type { CardsRecord } from './cards/stats.ts';
import type { GameRecord } from './stats.ts';

const DAY_MS = 86_400_000;

export interface AchievementInput {
  monopoly: readonly GameRecord[];
  cards: readonly CardsRecord[];
  tournaments: readonly TournamentResult[];
  /** When the account first linked a wallet; null when it has none. */
  walletLinkedAt: number | null;
  /** The boards "win on every board" means; every board today by default. */
  boards?: readonly string[];
}

/** One game of either kind, as one player finished it. */
interface Played {
  game: 'monopoly' | 'cards';
  endedAt: number;
  won: boolean;
  /** Everyone else at the table, and how many of them were people. */
  opponents: number;
  humanOpponents: number;
  chogToken?: number;
  mapId?: string;
  sets?: number;
  match?: CardsRecord['match'];
  bestRound?: number;
  roundCards?: number;
}

/** A player's games, oldest first. */
export function gamesOf(id: string, monopoly: readonly GameRecord[], cards: readonly CardsRecord[]): Played[] {
  const out: Played[] = [];
  const common = (places: readonly { id: string; isBot: boolean }[], i: number) => ({
    won: i === 0,
    opponents: places.length - 1,
    humanOpponents: places.filter((p, j) => j !== i && !p.isBot).length,
  });
  for (const r of monopoly) {
    const i = r.places.findIndex(p => p.id === id && !p.isBot);
    if (i < 0) continue;
    const me = r.places[i];
    out.push({ game: 'monopoly', endedAt: r.endedAt, ...common(r.places, i), mapId: r.mapId, chogToken: me.chogToken, sets: me.sets });
  }
  for (const r of cards) {
    const i = r.places.findIndex(p => p.id === id && !p.isBot);
    if (i < 0) continue;
    const me = r.places[i];
    out.push({
      game: 'cards', endedAt: r.endedAt, ...common(r.places, i), chogToken: me.chogToken, match: r.match,
      bestRound: me.bestRound, roundCards: me.roundCards,
    });
  }
  // Stable, so games that ended in the same millisecond keep their store order.
  return out.sort((a, b) => a.endedAt - b.endedAt);
}

type Result = { earnedAt: number | null; progress?: { have: number; need: number } };

/** Counts `pred` matches oldest first: earned at the `need`th. */
function count<T extends { endedAt: number }>(list: readonly T[], pred: (x: T) => boolean, need: number): Result {
  let have = 0, at: number | null = null;
  for (const x of list) {
    if (!pred(x)) continue;
    have++;
    if (have === need) at = x.endedAt;
  }
  return { earnedAt: at, ...(need > 1 && { progress: { have: Math.min(have, need), need } }) };
}

/** The first match: a one-off badge. */
const first = <T extends { endedAt: number }>(list: readonly T[], pred: (x: T) => boolean): Result => count(list, pred, 1);

/** A run of `need` wins in a row (across both games); the progress is the best run so far. */
function streak(games: readonly Played[], need: number): Result {
  let run = 0, best = 0, at: number | null = null;
  for (const g of games) {
    run = g.won ? run + 1 : 0;
    best = Math.max(best, run);
    if (run === need && at === null) at = g.endedAt;
  }
  return { earnedAt: at, progress: { have: Math.min(best, need), need } };
}

/** Every board in `boards` won at least once: earned when the last of them fell. */
function everyBoard(games: readonly Played[], boards: readonly string[]): Result {
  const won = new Set<string>();
  let at: number | null = null;
  for (const g of games) {
    if (g.game !== 'monopoly' || !g.won || !g.mapId || !boards.includes(g.mapId) || won.has(g.mapId)) continue;
    won.add(g.mapId);
    if (won.size === boards.length) at = g.endedAt;
  }
  return { earnedAt: at, progress: { have: won.size, need: boards.length } };
}

/** Both games played: earned with the first game of whichever came second. */
function bothGames(games: readonly Played[]): Result {
  const seen = new Set<string>();
  let at: number | null = null;
  for (const g of games) {
    seen.add(g.game);
    if (seen.size === 2) { at = g.endedAt; break; }
  }
  return { earnedAt: at, progress: { have: seen.size, need: 2 } };
}

/** Playing for `days`: the first game that came that long after the first. */
function oldGuard(games: readonly Played[], days: number): Result {
  if (!games.length) return { earnedAt: null, progress: { have: 0, need: days } };
  const start = games[0].endedAt;
  const hit = games.find(g => g.endedAt - start >= days * DAY_MS);
  const span = Math.floor((games.at(-1)!.endedAt - start) / DAY_MS);
  return { earnedAt: hit?.endedAt ?? null, progress: { have: Math.min(span, days), need: days } };
}

/** Every badge as this player stands with it, earned newest first, then the nearest to done. */
export function computeAchievements(id: string, input: AchievementInput): Achievement[] {
  const games = gamesOf(id, input.monopoly, input.cards);
  const mono = games.filter(g => g.game === 'monopoly');
  const cards = games.filter(g => g.game === 'cards');
  // Tournament results come latest first; oldest first here like the games.
  const tourneys = [...input.tournaments].sort((a, b) => a.endedAt - b.endedAt);
  const boards = input.boards ?? MAPS.map(m => m.id);
  const won = (g: Played) => g.won;
  const ownChog = (g: Played) => g.chogToken !== undefined;

  const rules: Record<string, () => Result> = {
    'first-game': () => first(games, () => true),
    'games-10': () => count(games, () => true, 10),
    'games-50': () => count(games, () => true, 50),
    'games-100': () => count(games, () => true, 100),
    'streak-3': () => streak(games, 3),
    'streak-5': () => streak(games, 5),
    'wins-25': () => count(games, won, 25),
    'both-games': () => bothGames(games),
    'beat-humans': () => first(games, g => g.won && g.humanOpponents >= 2),
    'old-guard': () => oldGuard(games, ACH.oldGuardDays),

    'mono-first-win': () => first(mono, won),
    'mono-every-board': () => everyBoard(mono, boards),
    'mono-landlord': () => first(mono, g => (g.sets ?? 0) >= 1),
    'mono-mogul': () => first(mono, g => (g.sets ?? 0) >= 3),
    'mono-crowd': () => first(mono, g => g.won && g.opponents >= ACH.crowdOpponents),
    'mono-wins-10': () => count(mono, won, 10),

    'cards-first-win': () => first(cards, won),
    'cards-hand-grenade': () => first(cards, g => (g.roundCards ?? 0) >= ACH.handGrenadeCards),
    'cards-big-haul': () => first(cards, g => (g.bestRound ?? 0) >= ACH.bigHaulPoints),
    'cards-long-game': () => first(cards, g => g.won && g.match === 'points'),
    'cards-crowd': () => first(cards, g => g.won && g.opponents >= ACH.crowdOpponents),
    'cards-wins-10': () => count(cards, won, 10),

    'tourney-played': () => first(tourneys, () => true),
    'tourney-final': () => first(tourneys, t => !!t.finalTable || t.place === 1),
    'tourney-podium': () => first(tourneys, t => t.place <= 3),
    'tourney-champ': () => first(tourneys, t => t.place === 1),

    'wallet': () => ({ earnedAt: input.walletLinkedAt }),
    'own-chog': () => first(games, ownChog),
    'own-chog-win': () => first(games, g => g.won && ownChog(g)),
  };

  return sortAchievements(ACHIEVEMENTS.map(def => {
    const r = rules[def.id]?.() ?? { earnedAt: null };
    const earned = r.earnedAt !== null;
    const progress = r.progress ? { have: earned ? r.progress.need : r.progress.have, need: r.progress.need } : null;
    return { ...def, earned, earnedAt: r.earnedAt, progress };
  }));
}
