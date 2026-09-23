// Protocol types shared by server and client.

import type { DeckId } from './cards.ts';
import type { RuleConfig } from './themes.ts';

export type TokenId = 'car' | 'hat' | 'dog' | 'ship' | 'boot' | 'iron' | 'cat' | 'duck';
export const TOKENS: TokenId[] = ['car', 'hat', 'dog', 'ship', 'boot', 'iron', 'cat', 'duck'];
export const PLAYER_COLORS = ['#e6194b', '#3cb4ff', '#ffd23f', '#3ddc84', '#b15cff', '#ff8c1a', '#ff5fa2', '#00d6c2'];

export interface PlayerState {
  id: string;
  name: string;
  token: TokenId;
  color: string;
  cash: number;
  position: number;
  inJail: boolean;
  /** Failed doubles attempts this jail stay. */
  jailTurns: number;
  /** Held Get Out of Jail Free cards, by the deck they must return to. */
  jailCards: DeckId[];
  bankrupt: boolean;
  isBot: boolean;
}

export interface OwnedSpace {
  owner: string;
  /** 0–4 houses, 5 = hotel. */
  houses: number;
  mortgaged: boolean;
}

export type TurnPhase =
  | 'roll'      // current player may roll (or pay/use card when jailed)
  | 'buy'       // landed on an unowned space: buy or auction
  | 'auction'
  | 'done'      // rolled; may manage properties and end the turn
  | 'over';

export interface Debt {
  from: string;
  /** null = the bank (or free parking pot). */
  to: string | null;
  amount: number;
  reason: string;
  /** Bank payment that feeds the Free Parking pot (house rule). */
  toPot?: boolean;
}

export interface Auction {
  space: number;
  highBid: number;
  highBidder: string | null;
  /** Players still in the bidding. */
  bidders: string[];
  /** Server clock deadline; each bid extends it. */
  endsAt: number;
}

export interface TradeSide {
  cash: number;
  spaces: number[];
  jailCards: number;
}

export interface Trade {
  id: string;
  from: string;
  to: string;
  give: TradeSide;
  get: TradeSide;
}

export interface LogEntry {
  t: number;
  text: string;
  /** Optional player id the entry is about, for colouring. */
  who?: string;
}

export interface CardShown {
  deck: DeckId;
  text: string;
  player: string;
  seq: number;
}

export interface GameView {
  themeId: string;
  mapId: string;
  rules: RuleConfig;
  players: PlayerState[];
  owned: Record<number, OwnedSpace>;
  current: string;
  phase: TurnPhase;
  dice: [number, number] | null;
  /** Bumps on every roll so clients animate even when the value repeats. */
  rollSeq: number;
  doublesCount: number;
  /** Current player rolled doubles and gets another roll after this one resolves. */
  extraRoll: boolean;
  debts: Debt[];
  auction: Auction | null;
  trades: Trade[];
  pot: number;
  housesLeft: number;
  hotelsLeft: number;
  lastCard: CardShown | null;
  winner: string | null;
  log: LogEntry[];
  turnNumber: number;
}

/** Everything a player can ask the engine to do. */
export type Action =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'decline' }
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'endTurn' }
  | { type: 'payJail' }
  | { type: 'useJailCard' }
  | { type: 'build'; space: number }
  | { type: 'sell'; space: number }
  | { type: 'mortgage'; space: number }
  | { type: 'unmortgage'; space: number }
  | { type: 'payDebt' }
  | { type: 'bankrupt' }
  | { type: 'proposeTrade'; to: string; give: TradeSide; get: TradeSide }
  | { type: 'acceptTrade'; id: string }
  | { type: 'rejectTrade'; id: string };

// ---- rooms -----------------------------------------------------------------

export interface RoomSeat {
  id: string;
  name: string;
  /** Emoji or Discord avatar URL. */
  avatar: string;
  token: TokenId;
  color: string;
  isBot: boolean;
  connected: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  themeId: string;
  mapId: string;
  /** Room is hidden from the public list (join by link/code only). */
  private: boolean;
  spectators: number;
  rules: RuleConfig;
  status: 'lobby' | 'playing' | 'finished';
  seats: RoomSeat[];
  game: GameView | null;
  /** Server clock, so clients can render auction countdowns without drift. */
  now: number;
}

export interface RoomSummary {
  code: string;
  themeId: string;
  mapId: string;
  status: RoomView['status'];
  players: number;
  maxPlayers: number;
  hostName: string;
}

// ---- accounts ---------------------------------------------------------------

export interface PlayerProfile {
  id: string;
  name: string;
  /** Emoji or Discord CDN avatar URL. */
  avatar: string;
  /** 'demo' exists only while DEMO_MODE=1; demo tokens stop working when it is off. */
  provider: 'discord' | 'demo';
  discord?: { id: string; username: string } | null;
  /** Site operator (ADMIN_DISCORD_IDS). */
  isAdmin?: boolean;
}

/** One message per this long, per player. Shared so the UI countdown matches. */
export const CHAT_COOLDOWN_MS = 2_000;

export type BanKind = 'player' | 'ip';
export type BanScope = 'room' | 'lifetime';

export const BAN_REASONS = [
  'Alt accounts',
  'Colluding / feeding money',
  'Abusive chat',
  'Griefing / stalling',
  'Cheating or exploits',
  'Evading a previous ban',
] as const;

/** The line a banned player is shown. Shared so the admin preview matches. */
export function banMessageFor(scope: BanScope, reason: string, expiresAt: number | null): string {
  const where = scope === 'lifetime' ? 'You are banned from this site.' : 'You are banned from this room.';
  const until = expiresAt ? ` Until ${new Date(expiresAt).toUTCString()}.` : '';
  const why = (reason ?? '').trim();
  return `${where}${until}${why ? ` Reason: ${why}` : ''}`;
}

/** Site-wide switches an operator can flip in the dashboard. */
export interface Features {
  /** Anyone signed in may create rooms (operators always can). */
  publicRooms: boolean;
  chat: boolean;
  music: boolean;
  minigames: boolean;
  bots: boolean;
  leaderboard: boolean;
  /** Announce finished games to DISCORD_ANNOUNCE_CHANNEL_ID. */
  announceResults: boolean;
}

export const DEFAULT_FEATURES: Features = {
  publicRooms: true,
  chat: true,
  music: true,
  minigames: true,
  bots: true,
  leaderboard: true,
  announceResults: false,
};

/** Public config the client reads at boot. */
export interface SiteConfig {
  discordEnabled: boolean;
  demoMode: boolean;
  adminMode: boolean;
  codeVerify: boolean;
  codeVerifyChannel: string | null;
  codeVerifyButton: boolean;
  inviteUrl: string | null;
  features: Features;
}
