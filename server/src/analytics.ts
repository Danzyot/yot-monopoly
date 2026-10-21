// The dashboard's Analytics tab (shared/analytics.ts), worked out from the
// stores the server already keeps: finished games (Monopoly, Cards and the
// Cards Daily Challenge), tournaments, live rooms and sockets, accounts,
// wallet links, the event log, and the two aggregate counters
// (liveSamples.ts, visits.ts). Pure: everything comes in through
// AnalyticsSources, so tests feed it synthetic data (routes/analytics.ts
// wires the real stores).
import {
  ANALYTICS_GAMES, DAY_MS, dayKey, lastDays,
  type AnalyticsGame, type AnalyticsPeriod, type AnalyticsPlayer, type AnalyticsReport,
} from '../../shared/analytics.ts';
import type { TournamentSummary } from '../../shared/tournaments.ts';
import type { SampleDay } from './liveSamples.ts';
import type { VisitDay } from './visits.ts';

/** A finished game, as much of it as the charts read (Monopoly and Cards records both fit). */
export interface AnalyticsResult {
  code: string;
  startedAt: number;
  endedAt: number;
  /** Winner first. */
  places: readonly { id: string; name: string; isBot: boolean; avatar?: string }[];
  /** Monopoly's board. */
  mapId?: string;
  /** Cards: classic or chaos (absent: classic). */
  mode?: string;
}

/** An official Daily Challenge attempt (cards/daily.ts). */
export interface AnalyticsDailyAttempt {
  date: string;
  id: string;
  startedAt: number;
  endedAt: number | null;
  result?: { won: boolean };
}

export interface AnalyticsSources {
  monopolyResults(): readonly AnalyticsResult[];
  cardsResults(): readonly AnalyticsResult[];
  dailyAttempts(): readonly AnalyticsDailyAttempt[];
  tournaments(): readonly Pick<TournamentSummary, 'status' | 'finishedAt'>[];
  accounts(): Iterable<{ id: string; firstSeen: number }>;
  /** Every linked wallet; `holds`: last seen holding a Chog. */
  wallets(): readonly { owner: string; linkedAt: number; holds: boolean }[];
  live(): { sockets: number; players: number; tables: number; playing: number };
  samples(): readonly SampleDay[];
  visits(): readonly VisitDay[];
  /** The event log's recent lines (eventlog.ts). */
  events(): readonly { ts: number; gameId: string }[];
  mapName(id: string): string;
  now(): number;
}

export const TOP_PLAYERS = 10;
export const TOP_PAGES = 12;
/** Longer than this from deal to result is a table left open, not a game length. */
const MAX_GAME_MS = 12 * 3_600_000;

/** Daily Challenge tables seat the day's bots under these ids (cards/rooms.ts setupDaily). */
export function isDailyRecord(r: AnalyticsResult): boolean {
  return r.places.some(p => p.isBot && p.id.startsWith('bot-daily-'));
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

export function buildAnalytics(src: AnalyticsSources, days: AnalyticsPeriod): AnalyticsReport {
  const now = src.now();
  const dates = lastDays(now, days);
  const today = dates[dates.length - 1];
  const inPeriod = new Set(dates);
  const from = Date.parse(`${dates[0]}T00:00:00Z`);
  const within = (ts: number | null | undefined) => typeof ts === 'number' && ts >= from && ts <= now + 60_000;
  const weekStart = Math.floor(now / DAY_MS) * DAY_MS - 6 * DAY_MS;

  // ---- finished games, split three ways ----
  const games: { game: AnalyticsGame; r: AnalyticsResult }[] = [];
  for (const r of src.monopolyResults()) games.push({ game: 'monopoly', r });
  for (const r of src.cardsResults()) games.push({ game: isDailyRecord(r) ? 'daily' : 'cards', r });
  const periodGames = games.filter(g => within(g.r.endedAt));

  const perDay = new Map(dates.map(d => [d, { date: d, monopoly: 0, cards: 0, daily: 0 }]));
  const gamesTodayBy: Record<AnalyticsGame, number> = { monopoly: 0, cards: 0, daily: 0 };
  const boards = new Map<string, number>();
  const modes = { classic: 0, chaos: 0 };
  const lengths: Record<AnalyticsGame, number[]> = { monopoly: [], cards: [], daily: [] };
  const seats: Record<AnalyticsGame, { humans: number; bots: number }> = {
    monopoly: { humans: 0, bots: 0 }, cards: { humans: 0, bots: 0 }, daily: { humans: 0, bots: 0 },
  };
  const hourGames = Array<number>(24).fill(0);
  const players = new Map<string, AnalyticsPlayer & { last: number }>();

  for (const { game, r } of periodGames) {
    const date = dayKey(r.endedAt);
    const row = perDay.get(date);
    if (row) row[game]++;
    if (date === today) gamesTodayBy[game]++;
    if (game === 'monopoly') boards.set(r.mapId ?? 'classic', (boards.get(r.mapId ?? 'classic') ?? 0) + 1);
    else if (game === 'cards') modes[r.mode === 'chaos' ? 'chaos' : 'classic']++;
    const ms = r.endedAt - r.startedAt;
    if (Number.isFinite(ms) && ms > 0 && ms <= MAX_GAME_MS) lengths[game].push(ms / 60_000);
    hourGames[new Date(Number.isFinite(r.startedAt) && r.startedAt > 0 ? r.startedAt : r.endedAt).getUTCHours()]++;
    r.places.forEach((p, i) => {
      if (p.isBot) { seats[game].bots++; return; }
      seats[game].humans++;
      const row = players.get(p.id) ?? { id: p.id, name: p.name, games: 0, wins: 0, monopoly: 0, cards: 0, daily: 0, last: 0 };
      // The latest name and avatar win.
      if (r.endedAt >= row.last) {
        row.name = p.name;
        if (p.avatar) row.avatar = p.avatar;
        row.last = r.endedAt;
      }
      row.games++;
      row[game]++;
      if (i === 0) row.wins++;
      players.set(p.id, row);
    });
  }

  // ---- accounts ----
  const newPerDay = new Map(dates.map(d => [d, 0]));
  let playersTotal = 0, newToday = 0, newWeek = 0, newPeriod = 0;
  for (const a of src.accounts()) {
    playersTotal++;
    if (!Number.isFinite(a.firstSeen)) continue;
    const d = dayKey(a.firstSeen);
    if (newPerDay.has(d)) { newPerDay.set(d, newPerDay.get(d)! + 1); newPeriod++; }
    if (d === today) newToday++;
    if (a.firstSeen >= weekStart && a.firstSeen <= now + 60_000) newWeek++;
  }

  // ---- wallets ----
  const wallets = src.wallets();
  const owners = new Set(wallets.map(w => w.owner));
  const holders = new Set(wallets.filter(w => w.holds).map(w => w.owner));

  // ---- tournaments ----
  const tourneys = src.tournaments();
  const finished = tourneys.filter(t => t.status === 'finished');

  // ---- the Daily Challenge (official attempts) ----
  const attempts = src.dailyAttempts().filter(a => inPeriod.has(a.date));
  const doneAttempts = attempts.filter(a => a.result);

  // ---- live samples ----
  const sampleBy = new Map(src.samples().map(s => [s.date, s]));
  const hourSockets = Array.from({ length: 24 }, (_, h) => {
    const xs = dates.flatMap(d => {
      const v = sampleBy.get(d)?.hours[h];
      return typeof v === 'number' ? [v] : [];
    });
    return xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  });

  // ---- visits ----
  const visitBy = new Map(src.visits().map(v => [v.date, v]));
  const pages = new Map<string, number>();
  const hourViews = Array<number>(24).fill(0);
  for (const d of dates) {
    const v = visitBy.get(d);
    if (!v) continue;
    for (const [page, c] of Object.entries(v.pages)) pages.set(page, (pages.get(page) ?? 0) + c);
    v.hours.forEach((c, h) => { hourViews[h] += c; });
  }

  // ---- logs ----
  let clientErrors = 0, adminActions = 0, gameEvents = 0;
  for (const e of src.events()) {
    if (!within(e.ts)) continue;
    if (e.gameId === 'client-errors') clientErrors++;
    else if (e.gameId === 'admin') adminActions++;
    else gameEvents++;
  }

  const live = src.live();
  return {
    days,
    generatedAt: now,
    dates,
    kpis: {
      onlineNow: live.players,
      socketsNow: live.sockets,
      tablesNow: live.tables,
      playingNow: live.playing,
      gamesToday: gamesTodayBy.monopoly + gamesTodayBy.cards + gamesTodayBy.daily,
      gamesTodayBy,
      gamesPeriod: periodGames.length,
      activePlayers: players.size,
      newToday, newWeek, newPeriod, playersTotal,
      walletsLinked: wallets.length,
      walletAccounts: owners.size,
      holders: holders.size,
      walletsNewPeriod: wallets.filter(w => within(w.linkedAt)).length,
      tournamentsRun: finished.filter(t => within(t.finishedAt)).length,
      tournamentsAllTime: finished.length,
      tournamentsLive: tourneys.filter(t => t.status === 'running' || t.status === 'registering').length,
      dailyToday: attempts.filter(a => a.date === today).length,
      dailyPeriod: attempts.length,
      dailyPlayers: new Set(attempts.map(a => a.id)).size,
      dailyWinRate: doneAttempts.length ? doneAttempts.filter(a => a.result!.won).length / doneAttempts.length : null,
      viewsToday: visitBy.get(today)?.views ?? 0,
      visitorsToday: visitBy.get(today)?.visitors ?? 0,
    },
    gamesPerDay: [...perDay.values()],
    newPlayersPerDay: dates.map(date => ({ date, players: newPerDay.get(date) ?? 0 })),
    peakPerDay: dates.map(date => {
      const s = sampleBy.get(date);
      return { date, sockets: s ? s.sockets : null, players: s ? s.players : null };
    }),
    boards: [...boards].map(([id, n]) => ({ id, name: src.mapName(id), games: n }))
      .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    cardsModes: modes,
    gameLength: ANALYTICS_GAMES.map(game => {
      const xs = lengths[game];
      return {
        game, games: xs.length,
        avgMin: round1(xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null),
        medianMin: round1(median(xs)),
      };
    }),
    seats: ANALYTICS_GAMES.map(game => ({ game, ...seats[game] })),
    topPlayers: [...players.values()]
      .sort((a, b) => b.games - a.games || b.wins - a.wins || b.last - a.last)
      .slice(0, TOP_PLAYERS)
      .map(({ last: _last, ...p }) => p),
    hours: { games: hourGames, sockets: hourSockets, views: hourViews },
    visits: {
      perDay: dates.map(date => ({ date, views: visitBy.get(date)?.views ?? 0, visitors: visitBy.get(date)?.visitors ?? 0 })),
      pages: [...pages].map(([page, views]) => ({ page, views })).sort((a, b) => b.views - a.views).slice(0, TOP_PAGES),
    },
    logs: { clientErrors, adminActions, gameEvents },
  };
}
