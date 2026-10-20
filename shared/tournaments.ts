// Tournaments for Cards: what the server sends and what an operator may ask
// for. Everyone registers, rounds of parallel tables are seated at random, the
// top players of each table go through, and the last table standing is the
// final. Only operators (admins) create them. The engine is
// server/src/tournament/; the pages are client/src/tournaments/.
//
// Every event keeps its `game`, so the engine stays game-agnostic, but Cards
// is the only game on offer: Monopoly games are too long for brackets.

import type { CardsGameMode } from './cards/rules.ts';

export type TournamentGame = 'cards';
export type TournamentStatus = 'registering' | 'running' | 'finished' | 'cancelled';
/** What happens to a player who has not opened their table when the seating clock runs out. */
export type NoShowPolicy = 'drop' | 'autoplay';

export const TOURNEY_GAMES: TournamentGame[] = ['cards'];

/** Fewest and most players at one table. */
export const TOURNEY_TABLE_RANGE: [number, number] = [3, 8];
export const TOURNEY_DEFAULT_TABLE = 6;
/** Round time limits on offer (minutes); then the round is scored and the most points win the table. */
export const TOURNEY_ROUND_MINUTES = [10, 15, 20, 30];
export const TOURNEY_DEFAULT_ROUND_MINUTES = 15;
/** How long a seated player has to open their table. */
export const TOURNEY_NO_SHOW_MINUTES = [2, 3, 5, 10];
export const TOURNEY_DEFAULT_NO_SHOW_MINUTES = 3;
/** Points to win a table's match ("single" plays one round). */
export const TOURNEY_CARDS_TARGETS = [100, 200, 300, 500];
/** A tournament needs at least this many entrants to start. */
export const TOURNEY_MIN_PLAYERS = 3;
/** How far ahead a start may be scheduled. */
export const TOURNEY_AHEAD_DAYS = 30;
/** The pause between one round's last table and the next round's seating. */
export const TOURNEY_BREAK_MS = 30_000;
/** A paused tournament carries on by itself after this long, so no event is frozen for good. */
export const TOURNEY_PAUSE_MAX_MS = 30 * 60_000;
export const TOURNEY_NAME_MAX = 48;
export const TOURNEY_PRIZE_MAX = 140;

export const PRIZE_NOTE = 'Prizes, when there are any, are handed out by the organisers after the final.';

export interface TournamentSettings {
  /** Most entrants, when the operator sets a cap; null (the default) takes everyone. */
  maxPlayers: number | null;
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
  /** One round, or first to `cardsTarget` points. */
  cardsMatch: 'single' | 'points';
  cardsTarget: number;
  /** Classic, or Chog Chaos with its own house rules (events saved before modes: Classic). */
  cardsMode: CardsGameMode;
}

/** What tourney:create takes. Anything missing gets the defaults; everything is checked on the server. */
export interface TournamentCreate {
  game: TournamentGame;
  name: string;
  prize?: string;
  settings?: Partial<TournamentSettings>;
}

export function defaultTournamentSettings(): TournamentSettings {
  return {
    maxPlayers: null,
    minPlayers: TOURNEY_MIN_PLAYERS,
    tableSize: TOURNEY_DEFAULT_TABLE,
    advance: 2,
    roundMinutes: TOURNEY_DEFAULT_ROUND_MINUTES,
    noShowMinutes: TOURNEY_DEFAULT_NO_SHOW_MINUTES,
    noShow: 'drop',
    botsFill: false,
    startAt: null,
    cardsMatch: 'single',
    cardsTarget: 200,
    cardsMode: 'classic',
  };
}

/** Sent with a tournament table's room state (CardsRoomView), for the "back to the tournament" bar. */
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

/** Set on a room that is a tournament table (server/src/cards/rooms.ts). */
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
  status: TournamentStatus;
  paused: { by: string; at: number } | null;
  settings: TournamentSettings;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  entrants: TournamentEntrantView[];
  rounds: TournamentRoundView[];
  /** Places 1..N once the event has finished; a cancelled event places nobody. */
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
  status: TournamentStatus;
  paused: boolean;
  entrants: number;
  /** null: no cap. */
  maxPlayers: number | null;
  startAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** The round being played (running only). */
  round: number | null;
  champion: { id: string; name: string } | null;
}

/** Who is asking, with the list (tourney:list): only operators create and run tournaments. */
export interface TournamentMe {
  isAdmin: boolean;
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
  /** Operators only. */
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

export const tableUrl = (code: string) => `/cards/r/${code}`;
export const tournamentUrl = (id: string) => `/tournaments/${id}`;
