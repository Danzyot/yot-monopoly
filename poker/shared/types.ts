// Shared protocol types between server and client.
import { BRAND } from './brand.ts';

// How long a player waits between messages. The server enforces it; the chat
// box counts it down so the wait is visible rather than discovered by being
// refused. Shared so the countdown on screen can never disagree with the rule
// actually being applied.
export const CHAT_COOLDOWN_MS = 5_000;

// Stock reasons for a ban. One list so the dropdown, the stored record and
// the line the player is shown can never drift apart. Free text is still
// allowed — these are a starting point, not a whitelist.
export const BAN_REASONS = [
  'Alt accounts',
  'Chip dumping',
  'Collusion',
  'Bot or assisted play',
  'Real-time assistance',
  'Ghosting',
  'Stalling / clock abuse',
  'Abusive chat',
  'Evading a previous ban',
] as const;

// The line a suspended player is shown. Lives here because both sides need
// it — the server sends it, the operator's dialog previews it — and two
// copies of the same sentence would eventually stop matching.
export function banMessageFor(scope: 'game' | 'lifetime', reason: string): string {
  const where = scope === 'lifetime'
    ? `You have been suspended from participating in ${BRAND.tournaments}.`
    : `You have been suspended from ${BRAND.room}.`;
  const why = (reason ?? '').trim();
  return why ? `${where} Reason: ${why}` : where;
}

export type Suit = 0 | 1 | 2 | 3; // ♠ ♥ ♦ ♣
export interface CardT {
  r: number; // 2..14 (14 = Ace)
  s: Suit;
}

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: string; // emoji avatar
  // 'demo' only exists while DEMO_MODE is on, and a demo token is refused
  // outright once it is off — so turning the flag off logs every demo visitor
  // out rather than leaving valid sessions behind.
  provider: 'discord' | 'demo';
  // Linked Discord identity (set after OAuth), used for verification.
  discord?: { id: string; username: string } | null;
  // Site operator: may create and manage tournaments/tables.
  isAdmin?: boolean;
}

// Social requirements a host can attach to a tournament. All optional.
export interface SocialRequirements {
  xUrl: string | null; // e.g. https://x.com/yourhandle — player must follow
  igUrl: string | null; // instagram profile to follow
  discordInviteUrl: string | null; // discord invite the player must join
  discordGuildId: string | null; // guild id for real membership verification
  discordRoleId: string | null; // role the member must hold (needs bot token)
  discordRoleName: string | null; // display label for the role requirement
  requireDiscord: boolean; // player must sign in with / link Discord
}

// Per-player progress against a tournament's requirements.
export interface SocialProgress {
  x: boolean;
  ig: boolean;
  discordJoined: boolean; // confirmed joining the server (honor) or verified member
  discordLinked: boolean; // OAuth-linked Discord account
  discordVerified: boolean; // membership verified via Discord API
  discordRoleOk: boolean; // holds the required role (bot-verified)
}

export interface SeatView {
  idx: number;
  player: { id: string; name: string; avatar: string } | null;
  stack: number;
  bet: number; // chips committed this street (in front of player)
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean; // away — auto-folds until they come back
  missedTurns: number; // consecutive turns auto-played (shown as "away (N)")
  offline: boolean; // no connected sockets for this player
  kickAt: number | null; // cash only: epoch ms when an offline player is auto-removed
  isDealer: boolean;
  isTurn: boolean;
  lastAction: string | null;
  // Hole cards: only present for self, or at showdown for revealed hands.
  cards: (CardT | null)[] | null;
  handName?: string; // at showdown
  won?: number; // chips won this hand (showdown display)
  wonSplit?: boolean; // pot was split between multiple players
}

export interface PotView {
  amount: number;
  label: string; // "Main pot", "Side pot 1"
}

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  toCall: number; // additional chips needed to call (capped by stack)
  canRaise: boolean;
  minRaiseTo: number; // total bet target
  maxRaiseTo: number; // total bet target (all-in, or the opening cap)
  // maxRaiseTo is the tournament's opening half-stack cap, not an all-in.
  capped: boolean;
  pot: number; // current total pot for sizing buttons
  myBet: number; // my chips already committed this street
}

export interface ChatMsg {
  id: string;
  from: { id: string; name: string; avatar: string } | 'system';
  text: string;
  ts: number;
  // Player ids named with @mentions. The client highlights the message for
  // anyone listed here; the server caps how many a single message may carry.
  mentions?: string[];
  // The message this one answers. Resolved server-side from an id the sender
  // sends, so the quote shown to everyone is the real message rather than
  // whatever text the sender claims it said.
  replyTo?: { id: string; name: string; text: string };
}

export interface HandResultEntry {
  seatIdx: number;
  name: string;
  amount: number;
  handName: string | null;
  split: boolean; // won a pot shared with other players
  bestFive: CardT[] | null; // the five cards making the winning hand (showdown)
}

// A floating emoji reaction over the felt.
export interface TableReaction {
  id: string;
  seat: number | null; // null when a spectator reacts
  name: string;
  emoji: string;
  ts: number;
}

// Event context painted faintly in the middle of the felt, PokerNow style.
export interface LateClock { players: number; extraSeconds: number }

export interface TableTourneyInfo {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  levelEndsAt: number | null;
  nextSb: number | null;
  nextBb: number | null;
  startedAt: number | null;
  // Set once the winner is decided (or the event is cancelled), so the
  // elapsed clock can stop instead of counting forever.
  endedAt?: number | null;
  playersLeft: number;
  totalEntries: number;
  onBreak: boolean;
  // The opening bet cap while it is running: for one bet or raise a player
  // may volunteer at most `fraction` of the chips still behind them. Null
  // once the window has passed, or when the host never switched it on.
  //
  // It travels with the table's tournament context rather than being copied
  // onto each table, which is what makes moving a player between tables
  // harmless — there is one clock for the event, read live, not a per-table
  // counter that a seat change could reset or double-count.
  betCap?: { endsAt: number; fraction: number } | null;
  // Seconds being added to every decision right now by the late clock; 0 or
  // absent when it is off or the field has not got that small yet.
  lateClockSeconds?: number;
}

// Custom table look, PokerNow-style: a felt color preset plus optional
// operator-uploaded images (center logo replacing the watermark, and a
// full felt background). Chosen at creation, editable live.
export interface TableTheme {
  felt: string; // one of the client's felt presets ('chog', 'green', ...)
  logoUrl: string | null;
  backgroundUrl: string | null;
}

export interface TableView {
  id: string;
  name: string;
  mode: 'cash' | 'tournament';
  tournamentId: string | null;
  maxSeats: number;
  seats: SeatView[];
  community: CardT[];
  pots: PotView[];
  totalPot: number;
  street: Street;
  handNumber: number;
  blinds: { sb: number; bb: number; ante: number };
  // What the host chose stacks and bets to be shown as by default. A player
  // can still flip it for themselves, per table.
  displayMode: 'chips' | 'bb';
  // Set only when a cash table runs a rising schedule; null means the blinds
  // stay where the host put them.
  blindLevel?: {
    level: number; sb: number; bb: number; ante: number;
    endsAt: number | null;
    next: { sb: number; bb: number; ante: number } | null;
  } | null;
  actionOn: number | null; // seat idx
  actionDeadline: number | null; // epoch ms
  actionStarted: number | null; // epoch ms
  myLegal: LegalActions | null;
  mySeat: number | null;
  myHandName: string | null; // live strength of my hand ("Pair of Jacks", ...)
  myCanReveal: boolean; // may show hole cards during the post-hand pause
  // Host controls: whether the last turn at this table can still be put back.
  canReverseTurn: boolean;
  // Rabbit hunting: what the rest of the board would have been.
  rabbitAvailable: boolean; // hand ended early and the table allows it
  rabbit: CardT[] | null; // populated once someone asks
  lastResults: HandResultEntry[] | null;
  cashConfig: { minBuy: number; maxBuy: number } | null;
  paused: boolean;
  spectators: number;
  ledger: LedgerEntry[]; // cash games: buy-ins / cash-outs / net per player
  hostId: string | null; // cash tables: who created it (may edit settings)
  playerHosted: boolean; // cash tables opened by a player host, not an operator
  actionSeconds: number; // per-decision clock
  rabbitHuntingOn: boolean;
  timebankSeconds: number;
  // Tournament context for the felt overlay (null on cash tables).
  tourney: TableTourneyInfo | null;
  // The viewer's live rank in the field, 1 = chip leader.
  myRank: number | null;
  theme: TableTheme | null;
  // Seconds of extra time bank the viewer still holds (null when not seated).
  myTimebankSeconds: number | null;
  // Tournament tables: this table broke or the event ended — spectators
  // should hop to a table that is still alive.
  closed: boolean;
}

export type TournamentState = 'registering' | 'running' | 'break' | 'paused' | 'finished' | 'cancelled';

export interface BlindLevel {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  isBreak?: boolean;
}

export interface StandingEntry {
  rank: number;
  id: string;
  name: string;
  avatar: string;
  stack: number; // 0 if busted
  tableId: string | null;
  busted: boolean;
  // False while a registered player is still waiting to take their seat.
  // Their stack reads as the starting stack rather than zero, because they
  // have not lost anything — they have not sat down.
  seated?: boolean;
  place: number | null; // final place once busted / winner
  prize: number | null;
  // What a busted player was sitting behind when they went out — offered as
  // the default if the director puts them back in.
  lastStack?: number;
  discordTag: string | null; // linked Discord username (identity verification)
  discordVerified: boolean; // guild membership verified via Discord API
}

export interface PayoutEntry {
  place: number;
  amount: number;
  pct: number;
}

export interface TournamentView {
  id: string;
  name: string;
  state: TournamentState;
  hostId: string;
  hostName: string;
  createdAt: number;
  startedAt: number | null;
  // Set once the winner is decided (or the event is cancelled), so the
  // elapsed clock can stop instead of counting forever.
  endedAt?: number | null;
  scheduledStart: number | null;
  config: TournamentConfig;
  playersRegistered: number;
  playersAlive: number;
  level: BlindLevel;
  nextLevel: BlindLevel | null;
  levelEndsAt: number | null; // epoch ms
  lateRegEndsAt: number | null;
  // When the seat a registered player is holding stops being held for them:
  // the end of late registration, or fifteen minutes from the start,
  // whichever is later.
  joinEndsAt?: number | null;
  // When the opening bet cap stops applying. Null when the rule is off or the
  // event has not started. The lobby counts down to it.
  betCapEndsAt?: number | null;
  lateRegOpen: boolean;
  // Host-only: registrations waiting for approval.
  pending: { id: string; name: string; avatar: string }[];
  prizePool: number;
  payouts: PayoutEntry[];
  standings: StandingEntry[];
  tables: { id: string; name: string; players: number }[];
  // 'seating' = in the field, holding a place, no chips in front of them yet.
  // They register, then press Join table; that is what actually seats them.
  myStatus: 'none' | 'pending' | 'registered' | 'seating' | 'playing' | 'busted' | 'winner';
  myTableId: string | null;
  avgStack: number;
  totalChips: number;
  social: SocialRequirements | null;
  mySocial: SocialProgress;
  hasWebhook: boolean; // winners will be announced to Discord
  totalEntries: number; // including re-entries
  myCanReenter: boolean;
  myEntries: number;
}

export interface CustomBlindLevel {
  sb: number;
  bb: number;
  ante: number;
  minutes: number; // 0 on the final row = plays forever
  isBreak?: boolean;
}

export interface TournamentConfig {
  name: string;
  startingStack: number;
  levelMinutes: number;
  structure: 'turbo' | 'regular' | 'deep';
  maxPlayers: number;
  minPlayers: number;
  lateRegMinutes: number; // 0 = no late registration
  // How long after the start a registered player has to press Join table and
  // claim the place they reserved. Registering never seats anyone.
  joinMinutes?: number;
  // Opening bet cap: for this many minutes after the start, a player may not
  // put more than half the chips behind them into any single bet or raise.
  // Null or absent switches the rule off entirely; it is off unless the host
  // asks for it. Calling is never restricted, and blinds and antes are forced
  // posts that never go through the bet path at all.
  betCapMinutes?: number | null;
  // Extra time near the end: once `players` or fewer are left in the event,
  // every decision gets `extraSeconds` on top of the normal clock, so the
  // hands that decide the prizes are not rushed. Null or absent is off.
  lateClock?: LateClock | null;
  // Host must approve each registration before the player is seated.
  approveRegistrations: boolean;
  buyIn: number; // legacy, always 0 — there is no in-site currency
  breakEveryLevels: number; // 0 = no breaks
  seatsPerTable: number;
  social: SocialRequirements | null;
  // Re-entries allowed per player while late registration is open (0 = freezeout).
  maxReentries: number;
  // Host-written prize description (e.g. "1st: prop firm evaluation account").
  prizeText: string | null;
  // Host-authored blind schedule. When set it replaces the generated
  // structure entirely: rows play in order, each for its own duration, and a
  // final row with minutes 0 runs forever. Break rows pause every table.
  customLevels?: CustomBlindLevel[] | null;
  // Show the board that would have come after a hand ends early.
  rabbitHunting: boolean;
  // Default way stacks and bets are shown; players can still switch locally.
  displayMode: 'chips' | 'bb';
  // Per-decision clock in seconds (time limit per turn).
  actionSeconds?: number;
  // Optional extra seconds granted once per decision. 0 = the clock above is
  // exactly what players get.
  timebankSeconds?: number;
  // Custom look for every table of this tournament.
  theme?: TableTheme | null;
  // Created by a player host (a Chog holder or approved player), not an
  // operator: clamped limits, no Discord gating or announcements, and the
  // prizes are the host's to hand out.
  playerHosted?: boolean;
}

// ---- all-tables spectate overview ----
export interface TableOverviewSeat {
  idx: number;
  name: string;
  avatar: string;
  stack: number;
  folded: boolean;
  allIn: boolean;
  isTurn: boolean;
  isDealer: boolean;
}

export interface TableOverview {
  id: string;
  name: string;
  maxSeats: number;
  handNumber: number;
  street: Street;
  totalPot: number;
  community: CardT[];
  seats: TableOverviewSeat[];
  chipLeader: number; // biggest stack at the table
}

export interface TournamentTablesView {
  tournamentId: string;
  level: BlindLevel;
  playersAlive: number;
  avgStack: number;
  tables: TableOverview[];
}

// ---- hand history / replayer ----
export interface ReplaySeat {
  seat: number;
  stack: number;
  bet: number; // committed this street
  folded: boolean;
  allIn: boolean;
}

export interface ReplayStep {
  ts: number;
  text: string; // "Yot bets 50", "Flop: 5♣ Q♦ J♥", ...
  board: CardT[];
  pot: number;
  seats: ReplaySeat[];
}

export interface HandHistoryEntry {
  number: number;
  startedAt: number;
  endedAt: number | null;
  sb: number;
  bb: number;
  ante: number;
  buttonSeat: number;
  players: { seat: number; id: string; name: string; avatar: string; startStack: number }[];
  // Hole cards, redacted per viewer: own cards always; others only when shown.
  holeCards: { seat: number; cards: (CardT | null)[] }[];
  board: CardT[];
  steps: ReplayStep[];
  winners: { seat: number; amount: number; handName: string | null }[];
}

export interface TableLogEntry {
  text: string;
  ts: number;
}

// ---- persisted results & leaderboard ----
export interface TournamentResultRow {
  playerId: string;
  name: string;
  avatar: string;
  place: number;
  prize: number;
  entries: number;
  discordTag: string | null;
  discordVerified: boolean;
}

export interface TournamentRecord {
  id: string;
  name: string;
  finishedAt: number;
  entrants: number; // unique players
  totalEntries: number; // including re-entries
  buyIn: number;
  prizePool: number;
  structure: string;
  results: TournamentResultRow[]; // ordered by place
}

// A finished cash session, kept for the same reason tournaments are: once a
// table closes the live object is gone, and the operator still needs to see
// who played and how it ended.
export interface CashRecord {
  id: string;
  name: string;
  hostName: string;
  openedAt: number;
  closedAt: number;
  sb: number;
  bb: number;
  hands: number;
  ledger: LedgerEntry[];
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  avatar: string;
  discordTag: string | null;
  points: number;
  wins: number;
  cashes: number; // finishes in the money
  winnings: number;
  tournaments: number;
  bestFinish: number;
}

export interface LobbyTournament {
  id: string;
  name: string;
  state: TournamentState;
  players: number;
  maxPlayers: number;
  buyIn: number;
  prizePool: number;
  level: number;
  startingStack: number;
  structure: string;
  hostName: string;
  playerHosted: boolean;
  scheduledStart: number | null;
  createdAt: number;
  hasSocialReq: boolean;
  // Live chip leaders while running; final podium once finished.
  topPlayers: { name: string; avatar: string; stack: number; place: number | null; prize: number | null }[];
}

export interface LobbyCashTable {
  id: string;
  name: string;
  sb: number;
  bb: number;
  players: number;
  maxSeats: number;
  minBuy: number;
  maxBuy: number;
  createdAt: number;
  hostName: string;
  playerHosted: boolean;
}

export interface LobbyView {
  tournaments: LobbyTournament[];
  cashTables: LobbyCashTable[];
  online: number;
}

export interface LedgerEntry {
  playerId: string;
  name: string;
  avatar: string;
  buyIn: number;
  cashOut: number | null; // null while still seated (stack shown instead)
  stack: number | null; // current stack when still seated
  net: number;
}

// ---- socket events ----
export interface ServerToClientEvents {
  'lobby:state': (v: LobbyView) => void;
  'table:state': (v: TableView) => void;
  'table:reaction': (r: TableReaction) => void;
  'table:chat': (m: ChatMsg) => void;
  'table:event': (e: { kind: string; text: string; ts: number }) => void;
  'tourney:state': (v: TournamentView) => void;
  'tourney:chat': (m: ChatMsg) => void;
  'tourney:assigned': (info: { tableId: string }) => void;
  'tourney:tables': (v: TournamentTablesView) => void;
  'tourney:finished': (p: {
    tournamentId: string;
    name: string;
    entrants: number;
    prizeText: string | null;
    places: { playerId: string; place: number; name: string; avatar: string }[];
  }) => void;
  'toast': (t: { kind: 'info' | 'error' | 'success'; text: string }) => void;
}

export interface ClientToServerEvents {
  'lobby:sub': () => void;
  'lobby:unsub': () => void;
  'table:join': (tableId: string) => void;
  'table:leave': (tableId: string) => void;
  'table:sit': (p: { tableId: string; seat: number; buyIn?: number }) => void;
  'table:stand': (tableId: string) => void;
  'table:action': (p: { tableId: string; type: ActionType; amount?: number }) => void;
  'table:chatSend': (p: { tableId: string; text: string }) => void;
  'table:sitout': (p: { tableId: string; out: boolean }) => void;
  'table:topup': (p: { tableId: string; amount: number }) => void;
  // Ack-style fetch: server invokes the callback with this table's hand history.
  'table:history': (tableId: string, cb: (hands: HandHistoryEntry[]) => void) => void;
  // Round-trip probe: the server acks immediately. Used to measure real socket
  // latency under load without dragging any state into the measurement.
  'net:ping': (cb: (serverTime: number) => void) => void;
  'tourney:sub': (id: string) => void;
  'tourney:unsub': (id: string) => void;
  // All-tables spectate overview (separate room — it is heavier than the lobby).
  'tourney:tablesSub': (id: string) => void;
  'tourney:tablesUnsub': (id: string) => void;
  'tourney:register': (id: string) => void;
  'tourney:reenter': (id: string) => void;
  'tourney:approve': (p: { id: string; playerId: string }) => void;
  'tourney:approveAll': (id: string) => void;
  'tourney:kick': (p: { id: string; playerId: string }) => void;
  // Host edits settings after creation (any subset; blinds apply immediately).
  'tourney:settings': (p: {
    id: string;
    name?: string;
    levelMinutes?: number;
    lateRegMinutes?: number;
    approveRegistrations?: boolean;
    prizeText?: string | null;
    actionSeconds?: number;
    maxPlayers?: number;
    maxReentries?: number;
    rabbitHunting?: boolean;
    displayMode?: 'chips' | 'bb';
    timebankSeconds?: number;
    customLevels?: CustomBlindLevel[]; // rewrite the blind schedule mid-game
    blinds?: { sb: number; bb: number; ante: number } | null; // override current level
    jumpLevel?: number; // move to a level in the structure
  }) => void;
  // Host edits a cash table after creation (blind changes apply next hand).
  'table:settings': (p: {
    tableId: string;
    name?: string;
    sb?: number;
    bb?: number;
    ante?: number;
    actionSeconds?: number;
    timebankSeconds?: number;
    rabbitHunting?: boolean;
  }) => void;
  // Animated emoji reaction from a seated player or spectator.
  'table:react': (p: { tableId: string; emoji: string }) => void;
  'table:reveal': (p: { tableId: string; which: 'first' | 'second' | 'both' }) => void;
  'table:rabbit': (tableId: string) => void;
  'tourney:confirmSocial': (p: { id: string; x?: boolean; ig?: boolean; discordJoined?: boolean }) => void;
  'tourney:unregister': (id: string) => void;
  'tourney:start': (id: string) => void;
  'tourney:pause': (id: string) => void;
  'tourney:resume': (id: string) => void;
  'tourney:cancel': (id: string) => void;
  'tourney:chatSend': (p: { id: string; text: string }) => void;
}
