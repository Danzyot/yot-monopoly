// The card game's room protocol: what a table looks like before, during and
// after a match, as each viewer is sent it (`cards:state`). The game itself
// is a CardsView built for that one viewer (no other hand is ever in it).

import type { CharacterId } from '../characters.ts';
import type { Outfit } from '../outfits.ts';
import { modeLabel, type CardsRules } from './rules.ts';
import type { CardsAction, CardsBotLevel, CardsView } from './types.ts';
import type { TournamentTableInfo } from '../tournaments.ts';
import type { CardsDailyTableInfo } from './daily.ts';

export type CardsRoomStatus = 'lobby' | 'playing' | 'finished';

/** Seat colours, one per seat at a full table of ten. */
export const CARDS_SEAT_COLORS = [
  '#ff5a5f', '#3cb4ff', '#ffd23f', '#3ddc84', '#b15cff',
  '#ff8c1a', '#ff5fa2', '#00d6c2', '#c9e265', '#9aa7ff',
];

export const CARDS_DEFAULT_MAX_PLAYERS = 6;
export const CARDS_BOT_LEVELS: { id: CardsBotLevel; label: string; help: string }[] = [
  { id: 'easy', label: 'Easy', help: 'Forgets to call now and then, and is slow to catch you.' },
  { id: 'normal', label: 'Normal', help: 'Plays a sound game and calls on time.' },
  { id: 'hard', label: 'Hard', help: 'Quick to catch, quick to jump in, and bluffs when it matters.' },
];
/** Turn timer choices for the lobby (seconds; 0 = off). */
export const CARDS_TURN_CHOICES = [0, 15, 20, 30, 45, 60, 90];
/** "First to N" choices (any value the rules allow is accepted). */
export const CARDS_TARGET_CHOICES = [100, 200, 300, 500, 1000];

export interface CardsSeatView {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  /** Bots only. */
  level?: CardsBotLevel;
  connected: boolean;
  character: CharacterId;
  /** A verified holder playing as their own Chog Genesis token (character 'chog' only; shared/chogs/traits.ts). */
  chogToken?: number;
  color: string;
  /** What the seat wears over its character (shared/outfits.ts), as in Monopoly. A token Chog wears its own traits instead. */
  outfit: Outfit;
  /** The host handed this seat to auto-play. */
  autopilot?: boolean;
  /** Lost connection at this server time (auto-play takes over after the grace). */
  awayAt?: number;
}

/** A dropped player's seat is played for them after this long (the server's CARDS_AUTOPILOT_GRACE_MS). */
export const CARDS_AUTOPLAY_GRACE_MS = 45_000;

export interface CardsRoomView {
  kind: 'cards';
  code: string;
  hostId: string;
  private: boolean;
  spectators: number;
  maxPlayers: number;
  rules: CardsRules;
  status: CardsRoomStatus;
  seats: CardsSeatView[];
  /** This viewer's view of the match (their own hand only). */
  game: CardsView | null;
  /** Server clock, for turn timers (clients keep the skew). */
  now: number;
  startedAt: number | null;
  /** Set on a tournament table: which event and round it belongs to (shared/tournaments.ts). */
  tournament?: TournamentTableInfo;
  /** Set on a Daily Challenge table (shared/cards/daily.ts): the day, official or practice, and the result once it is in. */
  daily?: CardsDailyTableInfo;
}

export interface CardsRoomSummary {
  code: string;
  status: CardsRoomStatus;
  players: number;
  maxPlayers: number;
  hostName: string;
  /** "Single round" or "First to 500" (with the mode in front when it is not Classic: "Chog Chaos · Single round"). */
  match: string;
}

export interface CardsChatMsg {
  t: number;
  id: string;
  name: string;
  color: string;
  text: string;
  spectator?: boolean;
  admin?: boolean;
}

/** Lobby settings a host may send (cards:configure). */
export interface CardsConfigure {
  rules?: Partial<CardsRules>;
  maxPlayers?: number;
  private?: boolean;
}

/** Socket events, client → server. Every one answers with an ack: { ok: true, ... } or { ok: false, error }. */
export interface CardsClientEvents {
  'cards:list': { subscribe?: boolean };
  /** `chogToken` (create and join): sit down as this Chog Genesis token, if the server finds it in a wallet linked to the account. */
  'cards:create': { chogToken?: number };
  /** Today's Daily Challenge: the official attempt (or back to it while it runs), a practice deal after. Answers { code, practice }. */
  'cards:daily': { chogToken?: number };
  'cards:join': { code: string; watch?: boolean; chogToken?: number };
  'cards:leave': Record<string, never>;
  'cards:away': { code: string };
  'cards:configure': CardsConfigure;
  'cards:seat': { character?: CharacterId; chogToken?: number; color?: string; outfit?: Outfit };
  'cards:addBot': { level?: CardsBotLevel };
  'cards:botLevel': { id: string; level: CardsBotLevel };
  'cards:kick': { id: string };
  'cards:host': { id: string };
  'cards:start': Record<string, never>;
  'cards:act': CardsAction;
  'cards:back': Record<string, never>;
  'cards:pause': { paused: boolean };
  'cards:rematch': Record<string, never>;
  'cards:chat': { text: string };
}

export function matchLabel(r: Pick<CardsRules, 'match' | 'targetScore'>): string {
  return r.match === 'single' ? 'Single round' : `First to ${r.targetScore}`;
}

/** The match, with the mode in front unless it is Classic: "Chog Chaos · First to 500". */
export function tableLabel(r: Pick<CardsRules, 'mode' | 'match' | 'targetScore'>): string {
  return r.mode === 'classic' ? matchLabel(r) : `${modeLabel(r.mode)} · ${matchLabel(r)}`;
}
