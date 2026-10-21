// The operator dashboard's Analytics tab (GET /api/admin/analytics?days=30):
// how the site is doing, worked out on the server from the stores it already
// keeps (results, live rooms, accounts, wallets, tournaments, the logs) plus
// two small aggregate counters on the data volume (server/src/liveSamples.ts,
// server/src/visits.ts). Nothing here follows an individual visitor around.

export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];
export const DEFAULT_ANALYTICS_PERIOD: AnalyticsPeriod = 30;

/** The kinds of game the charts split by. "daily" is the Cards Daily Challenge (official and practice deals). */
export type AnalyticsGame = 'monopoly' | 'cards' | 'daily';
export const ANALYTICS_GAMES: readonly AnalyticsGame[] = ['monopoly', 'cards', 'daily'];

export function analyticsPeriod(raw: unknown): AnalyticsPeriod {
  const n = Number(raw);
  return (ANALYTICS_PERIODS as readonly number[]).includes(n) ? (n as AnalyticsPeriod) : DEFAULT_ANALYTICS_PERIOD;
}

export interface AnalyticsKpis {
  /** Distinct signed-in accounts with an open connection. */
  onlineNow: number;
  /** Every open connection (tabs), signed in or not. */
  socketsNow: number;
  /** Live Monopoly rooms and card tables, and how many of them are mid-game. */
  tablesNow: number;
  playingNow: number;
  gamesToday: number;
  gamesTodayBy: Record<AnalyticsGame, number>;
  gamesPeriod: number;
  /** Distinct humans who finished a game in the period. */
  activePlayers: number;
  newToday: number;
  /** The last seven days, today included. */
  newWeek: number;
  newPeriod: number;
  playersTotal: number;
  walletsLinked: number;
  /** Accounts with at least one linked wallet. */
  walletAccounts: number;
  /** Accounts whose linked wallets were last seen holding a Chog. */
  holders: number;
  walletsNewPeriod: number;
  /** Tournaments finished in the period, ever (as far as the store keeps), and running or open now. */
  tournamentsRun: number;
  tournamentsAllTime: number;
  tournamentsLive: number;
  /** Official Daily Challenge attempts. */
  dailyToday: number;
  dailyPeriod: number;
  dailyPlayers: number;
  /** Share of finished official attempts in the period that were won; null with none. */
  dailyWinRate: number | null;
  /** Page loads and visitors today (server/src/visits.ts). */
  viewsToday: number;
  visitorsToday: number;
}

export interface AnalyticsReport {
  days: AnalyticsPeriod;
  generatedAt: number;
  /** The period's UTC days, oldest first ("2026-10-21"); the last is today. */
  dates: string[];
  kpis: AnalyticsKpis;
  gamesPerDay: ({ date: string } & Record<AnalyticsGame, number>)[];
  newPlayersPerDay: { date: string; players: number }[];
  /** Highest sampled counts per day; null where nothing was sampled (the server was down). */
  peakPerDay: { date: string; sockets: number | null; players: number | null }[];
  boards: { id: string; name: string; games: number }[];
  cardsModes: { classic: number; chaos: number };
  /** Minutes from deal to result. */
  gameLength: { game: AnalyticsGame; games: number; avgMin: number | null; medianMin: number | null }[];
  /** Seats filled by people and by bots, per kind of game. */
  seats: { game: AnalyticsGame; humans: number; bots: number }[];
  topPlayers: AnalyticsPlayer[];
  /** 24 UTC hours each. sockets: the average of each day's peak in that hour (null: never sampled). */
  hours: { games: number[]; sockets: (number | null)[]; views: number[] };
  visits: { perDay: { date: string; views: number; visitors: number }[]; pages: { page: string; views: number }[] };
  logs: { clientErrors: number; adminActions: number; gameEvents: number };
}

export interface AnalyticsPlayer {
  id: string;
  name: string;
  avatar?: string;
  games: number;
  wins: number;
  monopoly: number;
  cards: number;
  daily: number;
}

export const DAY_MS = 86_400_000;

/** The UTC day of a timestamp, "2026-10-21". */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** The `n` UTC days ending with the one `now` falls in, oldest first. */
export function lastDays(now: number, n: number): string[] {
  const today = Math.floor(now / DAY_MS);
  return Array.from({ length: n }, (_, i) => dayKey((today - (n - 1 - i)) * DAY_MS));
}
