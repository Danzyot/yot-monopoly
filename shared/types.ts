// Protocol types shared by server and client.

import type { DeckId } from './cards.ts';
import type { MinigameMove, MinigameView } from './minigames.ts';
import type { RuleConfig } from './themes.ts';
import type { TableStyle } from './tableStyles.ts';
import type { CharacterId } from './characters.ts';
import type { Outfit } from './outfits.ts';

// The character catalogue lives in characters.ts; re-exported so protocol
// code can keep importing everything from here.
export { CHARACTERS, type CharacterId } from './characters.ts';
export const PLAYER_COLORS = ['#e6194b', '#3cb4ff', '#ffd23f', '#3ddc84', '#b15cff', '#ff8c1a', '#ff5fa2', '#00d6c2'];

export interface PlayerState {
  id: string;
  name: string;
  character: CharacterId;
  /** Tints the character's main material, so no two players look alike. */
  color: string;
  /** Items worn over the character (shared/outfits.ts); none when absent. */
  outfit?: Outfit;
  cash: number;
  position: number;
  inJail: boolean;
  /** Failed doubles attempts this jail stay. */
  jailTurns: number;
  /** Held Get Out of Jail Free cards, by the deck they must return to. */
  jailCards: DeckId[];
  bankrupt: boolean;
  isBot: boolean;
  /** Timed out twice in a row: autopilot plays for them until they act again. */
  afk?: boolean;
  /** Has passed GO at least once (the Speed Die joins in from then on). */
  passedGo?: boolean;
}

export interface OwnedSpace {
  owner: string;
  /** 0–4 houses, 5 = hotel. */
  houses: number;
  mortgaged: boolean;
  /**
   * Received mortgaged this turn and the 10% interest is already paid: lifting
   * the mortgage before the turn ends costs only the principal. Absent: no.
   */
  interestPaid?: boolean;
}

export type TurnPhase =
  | 'roll'      // current player may roll (or pay/use card when jailed)
  | 'buy'       // landed on an unowned space: buy or auction
  | 'auction'
  | 'minigame'  // an arcade round is running; turn actions wait for it
  | 'done'      // rolled; may manage properties and end the turn
  | 'choose'    // Speed Die: pick the Bus move or the triples destination
  | 'over';

/** Speed Die faces: numbers add to the move; 'mr' = Mr. Monopoly; 'bus' = pick a die. */
export type SpeedFace = 1 | 2 | 3 | 'mr' | 'bus';
export const SPEED_FACES: SpeedFace[] = [1, 2, 3, 'mr', 'mr', 'bus'];

/** A move the current player must pick (phase 'choose'). */
export type MoveChoice =
  | { kind: 'bus'; options: number[] }
  | { kind: 'triples' };

export interface PauseState {
  /** Name of whoever paused (host or operator). */
  by: string;
  /** Server clock when the pause began; frozen countdowns read from here. */
  at: number;
}

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
  /** Selling a bankrupt player's estate for the bank (not the current player's landing). */
  bank?: boolean;
  /** Each bidder's best bid so far, so a resigning high bidder hands the lead back. Absent in older snapshots. */
  bids?: { id: string; amount: number }[];
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
  /**
   * Turn number of the last roll. The dice belong to the current turn only
   * when this equals turnNumber (absent from servers that predate it).
   */
  rollTurn?: number;
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
  /** The arcade round in progress (phase 'minigame'), result screen included. */
  minigame: MinigameView | null;
  /** Deadline for the current player's turn step (turn timer rule), null = none. */
  turnEndsAt: number | null;
  /** Players who owe money, and when they must have paid. */
  debtEndsAt: Record<string, number>;
  /** Frozen by the host or an operator; every clock stands still. */
  paused: PauseState | null;
  /** When the game-length limit runs out (null = no limit). */
  endsAt: number | null;
  /** The limit ran out: the game ends when the current turn step finishes. */
  timeUp: boolean;
  /** The Speed Die from the last roll (null when it was not rolled). */
  speed: SpeedFace | null;
  /** Phase 'choose': what the current player is choosing. */
  choice: MoveChoice | null;
  /** Net worth per player as the official short-game rules count it (see Game.netWorth). */
  netWorth: Record<string, number>;
  /** Per-player counters kept during play, for the end-of-game summary. */
  stats: Record<string, PlayerStats>;
  /** Game clock when play began and (once over) ended, for the summary's duration. */
  startedAt: number;
  endedAt: number | null;
  /** Bankrupt players, first out first: gives finishing places. */
  outOrder: string[];
}

/** Fun numbers the engine tallies as the game goes. */
export interface PlayerStats {
  /** Total rent received from other players. */
  rentCollected: number;
  /** The largest single rent this player paid. */
  biggestRentPaid: number;
  /** Deeds bought outright or won at auction. */
  propertiesBought: number;
  /** Times sent to jail. */
  jailed: number;
  /** Mini-game rounds that paid this player out. */
  minigamesWon: number;
}

/** Everything a player can ask the engine to do. */
export type Action =
  | { type: 'roll' }
  | { type: 'buy' }
  /** `endTurn`: also end the turn once the property is settled (straight away, or after its auction). */
  | { type: 'decline'; endTurn?: boolean }
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
  /** `counterOf`: an offer made to us that this one replaces, in one step. */
  | { type: 'proposeTrade'; to: string; give: TradeSide; get: TradeSide; counterOf?: string }
  | { type: 'acceptTrade'; id: string }
  | { type: 'rejectTrade'; id: string }
  | { type: 'minigame'; move: MinigameMove }
  /** Phase 'choose': Bus = steps to move; triples = the space to jump to. */
  | { type: 'choose'; value: number };

// ---- rooms -----------------------------------------------------------------

export interface RoomSeat {
  id: string;
  name: string;
  /** Emoji or Discord avatar URL. */
  avatar: string;
  character: CharacterId;
  color: string;
  /** Items worn over the character (shared/outfits.ts). */
  outfit?: Outfit;
  isBot: boolean;
  connected: boolean;
  /** The host (or an operator) handed this player to autopilot. */
  autopilot?: boolean;
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
  /** Table finish, centre logo and backdrop the host picked (shared/tableStyles.ts). */
  style: TableStyle;
  /** Server clock, so clients can render auction countdowns without drift. */
  now: number;
  /** Discord gate for taking a seat (null = anyone signed in). */
  requirements: JoinRequirements | null;
  /** Poke bookkeeping for the current turn (added by the socket layer while a game runs). */
  poke?: PokeView | null;
}

export interface RoomSummary {
  code: string;
  themeId: string;
  mapId: string;
  status: RoomView['status'];
  players: number;
  maxPlayers: number;
  hostName: string;
  /** Present when the room is Discord-gated, for the badge on the room list. */
  requirements?: JoinRequirements | null;
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
  /** Emoji reactions and pokes at the table. */
  reactions: boolean;
}

export const DEFAULT_FEATURES: Features = {
  publicRooms: true,
  chat: true,
  music: true,
  minigames: true,
  bots: true,
  leaderboard: true,
  announceResults: false,
  reactions: true,
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

// ---- community: join requirements, profiles ---------------------------------

/**
 * Discord gate a host puts on taking a seat. Watching is never gated. The
 * guild is always the site's own (DISCORD_GUILD_ID), stored with the room so a
 * restored room keeps checking the server it was set up against.
 */
export interface JoinRequirements {
  guildId: string;
  /** Must be a member of the guild. Always true when a role is required. */
  member: boolean;
  roleId: string | null;
  /** Display label for the role, resolved server-side from Discord. */
  roleName: string | null;
}

/** Why a seat was refused, for the requirements modal. */
export interface RequirementFailure {
  /** What the player still lacks. */
  missing: 'discord' | 'member' | 'role' | 'unverifiable';
  /** Plain-English explanation, safe to show as-is. */
  message: string;
  requirements: JoinRequirements;
  inviteUrl: string | null;
}

/** What the lobby's requirement picker can offer (GET /api/community/discord). */
export interface DiscordGateInfo {
  /** The site has a Discord server configured, so membership can be required. */
  available: boolean;
  /** Roles of that server; null when there is no bot to list or check them. */
  roles: { id: string; name: string }[] | null;
  /** Why roles are unavailable, when they are. */
  rolesNote: string | null;
  inviteUrl: string | null;
}

export interface ProfileGame {
  code: string;
  endedAt: number;
  mapId: string;
  themeId: string;
  /** 1-based finishing place. */
  place: number;
  of: number;
  turns: number;
  character: string | null;
  opponents: { id: string; name: string; isBot: boolean; place: number }[];
}

/** Public profile (GET /api/players/:id). Built only from finished-game results. */
export interface PublicProfile {
  id: string;
  name: string;
  avatar: string;
  games: number;
  wins: number;
  /** 0..1 over all games. */
  winRate: number;
  /** Leaderboard points: games with 2+ people only, same formula. */
  points: number;
  rankedGames: number;
  /** When their first recorded game ended ("playing since"). */
  firstGameAt?: number;
  favouriteMap: { id: string; games: number } | null;
  favouriteCharacter: { id: string; games: number } | null;
  recent: ProfileGame[];
}
// ---- table social: reactions and pokes -------------------------------------

/** The reaction bar. The server only relays these, so a client cannot send arbitrary text. */
export const REACTION_EMOJI = ['👍', '😂', '😮', '😭', '😡', '🔥', '💸', '🎉', '🤝', '👀'] as const;
export type ReactionEmoji = typeof REACTION_EMOJI[number];
/**
 * Shown over a poked player's piece. Never sent over the wire as a reaction
 * (the server refuses it): the client raises it locally when a poke arrives.
 */
export const POKE_EMOJI = '👉' as const;

/**
 * Canned chat lines. Sent as ordinary chat messages (same filter and
 * cooldown); listed here so client and server agree on the exact text.
 */
export const QUICK_CHAT = ['Nice roll!', 'Trade?', 'Ouch 😬', 'Pay up 💸', 'GG', 'Hurry up ⏱', 'Lucky!', 'No deal'] as const;

/** One reaction, broadcast to the room as 'reaction'. */
export interface ReactionMsg {
  /** Unique per server, so repeated emoji from one player animate separately. */
  seq: number;
  id: string;
  name: string;
  /** A bar emoji from the server; POKE_EMOJI only on a client-side poke marker. */
  emoji: ReactionEmoji | typeof POKE_EMOJI;
  /** Not seated in this game: shown at the side rather than over a character. */
  spectator: boolean;
}

/** Someone nudged the current player, broadcast to the room as 'poke'. */
export interface PokeMsg {
  seq: number;
  from: string;
  fromName: string;
  to: string;
}

/** When the current turn began and who has poked in it: drives the poke button. */
export interface PokeView {
  /** Server clock when the current turn began (as far as the server saw). */
  since: number;
  pokedBy: string[];
}

/** A turn must run this long before anyone may poke the player. */
export const POKE_AFTER_MS = 15_000;
