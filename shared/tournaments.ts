// Tournaments for Monopoly and Cards: what the server sends and what a host
// may ask for. One format for both games: everyone registers, rounds of
// parallel tables are seated at random, the top players of each table go
// through, and the last table standing is the final. The engine is
// server/src/tournament/; the pages are client/src/tournaments/.

export type TournamentGame = 'monopoly' | 'cards';
export type TournamentStatus = 'registering' | 'running' | 'finished' | 'cancelled';
/** What happens to a player who has not opened their table when the seating clock runs out. */
export type NoShowPolicy = 'drop' | 'autoplay';

export const TOURNEY_GAMES: TournamentGame[] = ['monopoly', 'cards'];

/** Fewest and most players at one table, per game. */
export const TOURNEY_TABLE_RANGE: Record<TournamentGame, [number, number]> = { monopoly: [3, 6], cards: [3, 8] };
export const TOURNEY_DEFAULT_TABLE: Record<TournamentGame, number> = { monopoly: 4, cards: 6 };
/** Round time limits on offer (minutes). Monopoly ends on net worth, Cards on points. */
export const TOURNEY_ROUND_MINUTES: Record<TournamentGame, number[]> = { monopoly: [20, 30, 45, 60, 90], cards: [10, 15, 20, 30] };
export const TOURNEY_DEFAULT_ROUND_MINUTES: Record<TournamentGame, number> = { monopoly: 30, cards: 15 };
/** How long a seated player has to open their table. */
export const TOURNEY_NO_SHOW_MINUTES = [2, 3, 5, 10];
export const TOURNEY_DEFAULT_NO_SHOW_MINUTES = 3;
/** Cards: points to win a table's match ("single" plays one round). */
export const TOURNEY_CARDS_TARGETS = [100, 200, 300, 500];
/** A tournament needs at least this many entrants to start. */
export const TOURNEY_MIN_PLAYERS = 3;
/** The pause between one round's last table and the next round's seating. */
export const TOURNEY_BREAK_MS = 30_000;
/** A paused tournament carries on by itself after this long, so no event is frozen for good. */
export const TOURNEY_PAUSE_MAX_MS = 30 * 60_000;
export const TOURNEY_NAME_MAX = 48;
export const TOURNEY_PRIZE_MAX = 140;

/**
 * What a host may set up. Operators (admins) get the big numbers; Chog
 * holders and approved hosts the small ones, and one event at a time.
 */
export interface TournamentLimits {
  maxPlayers: Record<TournamentGame, number>;
  /** Live or upcoming events one host may have at once. */
  live: number;
  /** How far ahead a start may be scheduled. */
  aheadDays: number;
  roundMinutesMax: Record<TournamentGame, number>;
}

export const TOURNEY_LIMITS: { host: TournamentLimits; admin: TournamentLimits } = {
  host: { maxPlayers: { monopoly: 24, cards: 32 }, live: 1, aheadDays: 7, roundMinutesMax: { monopoly: 60, cards: 30 } },
  admin: { maxPlayers: { monopoly: 128, cards: 128 }, live: 20, aheadDays: 30, roundMinutesMax: { monopoly: 90, cards: 30 } },
};

export const PRIZE_DISCLAIMER = 'Prizes are the host’s promise, not Chog Games’: the host alone is responsible for handing them out.';

export interface TournamentSettings {
  maxPlayers: number;
  /** Entrants needed to start (a scheduled start with fewer is called off). */
  minPlayers: number;
  /** Most players at one table; a round with no more entrants than this is the final. */
  tableSize: number;
  /** Players going through from each table (1 or 2; a table always knocks someone out). */
  advance: 1 | 2;
  roundMinutes: number;
  noShowMinutes: number;
  noShow: NoShowPolicy;
  /** Empty seats are filled with bots. Bots never go through and never take a place. */
  botsFill: boolean;
  /** Scheduled start (registration closes then); null = when the host starts it. */
  startAt: number | null;
  /** Monopoly: the board. */
  mapId: string;
  /** Cards: one round, or first to `cardsTarget` points. */
  cardsMatch: 'single' | 'points';
  cardsTarget: number;
}

/** What tourney:create takes. Anything missing gets the defaults; everything is checked on the server. */
export interface TournamentCreate {
  game: TournamentGame;
  name: string;
  prize?: string;
  settings?: Partial<TournamentSettings>;
}

export function defaultTournamentSettings(game: TournamentGame): TournamentSettings {
  return {
    maxPlayers: game === 'monopoly' ? 16 : 24,
    minPlayers: TOURNEY_MIN_PLAYERS,
    tableSize: TOURNEY_DEFAULT_TABLE[game],
    advance: 2,
    roundMinutes: TOURNEY_DEFAULT_ROUND_MINUTES[game],
    noShowMinutes: TOURNEY_DEFAULT_NO_SHOW_MINUTES,
    noShow: 'drop',
    botsFill: false,
    startAt: null,
    mapId: 'classic',
    cardsMatch: 'single',
    cardsTarget: 200,
  };
}

/** Sent with a tournament table's room state (RoomView / CardsRoomView), for the "back to the tournament" bar. */
export interface TournamentTableInfo {
  id: string;
  name: string;
  round: number;
  final: boolean;
  /** When the round's time limit ends the game (null until it starts). */
  endsAt: number | null;
  /** Lobby: when absent players are dropped and the game starts anyway. */
  startsBy: number | null;
}

/** Set on a room that is a tournament table (server rooms.ts, cards/rooms.ts). */
export interface TableLock {
  /** The tournament's own host id: no player has it, so only operators pass a room's host checks. */
  hostId: string;
  /** The players assigned to this table: nobody else may sit down. */
  seats: string[];
  info: TournamentTableInfo;
}

export interface TournamentPlace {
  place: number;
  id: string;
  name: string;
  avatar: string;
}

export type EntrantState = 'registered' | 'playing' | 'through' | 'out' | 'champion';

export interface TournamentEntrantView {
  id: string;
  name: string;
  avatar: string;
  state: EntrantState;
  /** Final place once they are out (or the event is over). */
  place?: number;
}

export interface TournamentSeatView {
  id: string;
  name: string;
  avatar: string;
  /** Opened their table. */
  arrived: boolean;
  /** Never showed up: dropped (or auto-played, as the host chose). */
  noShow?: boolean;
  /** Where they finished at this table (humans only, 1 = won it). */
  finish?: number;
  /** Going through to the next round. */
  through?: boolean;
}

export type TableStatus = 'pending' | 'waiting' | 'playing' | 'done';

export interface TournamentTableView {
  id: string;
  /** Room code (null until the room is open). */
  code: string | null;
  status: TableStatus;
  players: TournamentSeatView[];
  /** Waiting: when no-shows are dropped. */
  startsBy: number | null;
  startedAt: number | null;
  endsAt: number | null;
  /** Ended by the round's time limit. */
  byTime?: boolean;
  /** Decided without a game (everyone else failed to show). */
  walkover?: boolean;
}

export interface TournamentRoundView {
  n: number;
  final: boolean;
  /** Players going through from each table. */
  advance: number;
  tables: TournamentTableView[];
  /** Straight through to the next round without playing. */
  byes: { id: string; name: string }[];
  startedAt: number;
  finishedAt: number | null;
}

export interface TournamentView {
  id: string;
  game: TournamentGame;
  name: string;
  prize: string;
  hostId: string;
  hostName: string;
  /** Run by an operator (else a player host, whose prizes are theirs to give). */
  official: boolean;
  status: TournamentStatus;
  paused: { by: string; at: number } | null;
  settings: TournamentSettings;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  entrants: TournamentEntrantView[];
  rounds: TournamentRoundView[];
  places: TournamentPlace[];
  /** Between rounds: when the next one is seated. */
  nextRoundAt: number | null;
  cancelReason: string | null;
  /** Server clock, for countdowns. */
  now: number;
}

export interface TournamentSummary {
  id: string;
  game: TournamentGame;
  name: string;
  prize: string;
  hostName: string;
  official: boolean;
  status: TournamentStatus;
  paused: boolean;
  entrants: number;
  maxPlayers: number;
  startAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** The round being played (running only). */
  round: number | null;
  champion: { id: string; name: string } | null;
}

/** Who is asking, with the list (tourney:list): may they host, and under which limits. */
export interface TournamentMe {
  canHost: boolean;
  isAdmin: boolean;
  /** Their live or upcoming events. */
  hosting: string[];
  limits: TournamentLimits;
}

/** A finished tournament on a player's profile. */
export interface TournamentResult {
  id: string;
  game: TournamentGame;
  name: string;
  place: number;
  of: number;
  endedAt: number;
}

/** Socket events, client to server. Every one answers with an ack: { ok: true, ... } or { ok: false, error }. */
export interface TournamentClientEvents {
  'tourney:list': { subscribe?: boolean };
  'tourney:sub': { id: string };
  'tourney:unsub': { id: string };
  'tourney:create': TournamentCreate;
  'tourney:register': { id: string; chogToken?: number };
  'tourney:unregister': { id: string };
  'tourney:start': { id: string };
  'tourney:pause': { id: string };
  'tourney:resume': { id: string };
  'tourney:cancel': { id: string; reason?: string };
  'tourney:prize': { id: string; prize: string };
  /** Operators only. */
  'tourney:remove': { id: string; playerId: string };
}

/** Sent to a player's sockets when they are given a table. */
export interface TournamentSeated {
  id: string;
  name: string;
  game: TournamentGame;
  code: string;
  round: number;
}

export const tableUrl = (game: TournamentGame, code: string) => (game === 'cards' ? `/cards/r/${code}` : `/r/${code}`);
export const tournamentUrl = (id: string) => `/tournaments/${id}`;
