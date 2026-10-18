// The game as a pure state machine: no timers, no sockets, no Math.random.
// Randomness and the clock are injected so tests can replay any game exactly.
// Rooms own pacing (auction deadlines, bots); this file owns the rules.

import {
  groupIndices, isOwnable, mortgageValue, type SpaceDef,
} from '../../../shared/board.ts';
import type { CardEffect, DeckId } from '../../../shared/cards.ts';
import type { Outfit } from '../../../shared/outfits.ts';
import {
  buildProblem, liftCost, manageProblem, mortgageProblem, sellProblem, unmortgageProblem,
} from '../../../shared/holdings.ts';
import type { RuleConfig, Theme } from '../../../shared/themes.ts';
import {
  MINIGAME_INFO, MINIGAME_KINDS, type MinigameKind, type MinigameMove, type MinigamePayout,
  type MinigameResult, type MinigameView,
} from '../../../shared/minigames.ts';
import {
  SPEED_FACES,
  type Action, type Auction, type CardShown, type Debt, type GameView, type LogEntry, type MoveChoice,
  type OwnedSpace, type PauseState, type PlayerState, type PlayerStats, type CharacterId, type SpeedFace,
  type Trade, type TradeSide, type TurnPhase,
} from '../../../shared/types.ts';
import { MINIGAMES, MinigameError, hash } from './minigames/index.ts';
import type { Ctx as MinigameCtx, Names } from './minigames/types.ts';

export class EngineError extends Error {}

// The auction clock lives in shared/pacing.ts so the bidding panel explains it exactly.
export { AUCTION_MS, AUCTION_EXTEND_MS } from '../../../shared/pacing.ts';
import { AUCTION_MS, AUCTION_EXTEND_MS } from '../../../shared/pacing.ts';
/** A debtor gets this many turn-lengths to pay before the engine settles for them. */
export const DEBT_TURNS = 2;
/** Consecutive turn timeouts before a player is marked away (autopilot takes over). */
export const AFK_AFTER = 2;
/** Turn phases that belong to the current player (the turn timer runs in these). */
const STEP_PHASES: TurnPhase[] = ['roll', 'buy', 'done', 'choose'];
const MAX_LOG = 250;
const MAX_OPEN_TRADES = 5;
/** Longest player or offer id a client may name (ids are short; anything longer is junk). */
const MAX_ID_LEN = 64;
/** Debt/charge reasons that start with this are rent (for the summary stats). */
const RENT_REASON = 'rent on ';
const NO_STATS: PlayerStats = { rentCollected: 0, biggestRentPaid: 0, propertiesBought: 0, jailed: 0, minigamesWon: 0 };

export type Rng = (n: number) => number; // integer in [0, n)

export interface NewPlayer {
  id: string;
  name: string;
  character: CharacterId;
  color: string;
  outfit?: Outfit;
  isBot: boolean;
}

export interface GameInit {
  theme: Theme;
  rules: RuleConfig;
  players: NewPlayer[];
  rng?: Rng;
  now?: () => number;
  /** Mirror of every log line, for the durable room log. */
  onLog?: (text: string) => void;
  /** Site-wide mini-game switch, read live so flipping it affects running games. Default on. */
  minigamesEnabled?: () => boolean;
  /**
   * Every movement of money between a player and the bank (positive: the bank
   * pays out). Player-to-player payments and the Free Parking pot are not bank
   * money. Lets tests prove cash is never created or lost by accident.
   */
  onBank?: (amount: number, reason: string) => void;
}

/** A running arcade round. `data` belongs to the module named by `kind` (and may hold secrets). */
export interface MinigameState {
  seq: number;
  kind: MinigameKind;
  host: string;
  stage: 'play' | 'result';
  /** When the result screen closes (stage 'result' only). */
  resultEndsAt: number;
  result: MinigameResult | null;
  data: unknown;
}

/** Everything needed to rebuild a game after a restart (see Game.restore). */
export interface GameSnapshot {
  players: PlayerState[];
  owned: Record<number, OwnedSpace>;
  currentIdx: number;
  phase: TurnPhase;
  dice: [number, number] | null;
  rollSeq: number;
  /** Turn number of the last roll (absent in older snapshots). */
  rollTurn?: number;
  /** Who threw the last roll (absent in older snapshots). */
  rollBy?: string;
  doublesCount: number;
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
  decks: Record<DeckId, number[]>;
  cardSeq: number;
  tradeSeq: number;
  outOrder: string[];
  /** Optional: snapshots written before mini-games existed lack these. */
  minigame?: MinigameState | null;
  minigameSeq?: number;
  /** Game clock when the snapshot was taken, to carry a live round's timers across a restart. */
  savedAt?: number;
  /** Optional: snapshots written before timers, pause and the Speed Die lack these. */
  turnEndsAt?: number | null;
  turnKey?: string;
  debtEndsAt?: Record<string, number>;
  timeoutStreak?: Record<string, number>;
  paused?: PauseState | null;
  endsAt?: number | null;
  timeUp?: boolean;
  speed?: SpeedFace | null;
  choice?: MoveChoice | null;
  speedPending?: 'mr' | null;
  endAfter?: boolean;
  estateQueue?: number[];
  resumePhase?: TurnPhase | null;
  /** Optional: snapshots written before the end-of-game summary existed lack these. */
  stats?: Record<string, PlayerStats>;
  startedAt?: number;
  endedAt?: number | null;
}

interface LandingOpts {
  railroadMultiplier?: number;
  utilityTenX?: boolean;
}

function fail(msg: string): never {
  throw new EngineError(msg);
}

/** A player or offer id from a client. */
function idArg(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > MAX_ID_LEN) fail('Unknown player or offer');
  return v;
}

function speedName(f: SpeedFace): string {
  return f === 'mr' ? 'Mr. Monopoly' : f === 'bus' ? 'Bus' : String(f);
}

export class Game {
  readonly theme: Theme;
  readonly rules: RuleConfig;
  readonly spaces: SpaceDef[];
  /** Board length and jail position: every map is a square, sizes vary. */
  readonly size: number;
  readonly jailIndex: number;
  players: PlayerState[];
  owned: Record<number, OwnedSpace> = {};
  currentIdx = 0;
  phase: TurnPhase = 'roll';
  dice: [number, number] | null = null;
  rollSeq = 0;
  /** The turn the dice were last rolled in: they belong to that turn only. */
  rollTurn = 0;
  /** Who threw the last roll: the turn may already have passed on by the time it is shown. */
  rollBy = '';
  doublesCount = 0;
  extraRoll = false;
  /** The current player chose "End turn" on a buy: hand over as soon as the property is settled. */
  endAfter = false;
  debts: Debt[] = [];
  auction: Auction | null = null;
  trades: Trade[] = [];
  pot = 0;
  housesLeft = 32;
  hotelsLeft = 12;
  lastCard: CardShown | null = null;
  winner: string | null = null;
  log: LogEntry[] = [];
  turnNumber = 1;
  decks: Record<DeckId, number[]>;
  /** Bankrupt players, first out first — gives finishing places. */
  outOrder: string[] = [];
  minigame: MinigameState | null = null;
  /** Turn timer: deadline for the current player's step, and the step it belongs to. */
  turnEndsAt: number | null = null;
  private turnKey = '';
  /** Per debtor: when the engine settles the debt for them. */
  debtEndsAt: Record<string, number> = {};
  /** Consecutive turn timeouts per player (any own action resets it). */
  private timeoutStreak: Record<string, number> = {};
  paused: PauseState | null = null;
  /** Game-length limit (null = none) and whether it has run out. */
  endsAt: number | null = null;
  timeUp = false;
  /** Speed Die: last face, the pending choice, and a Mr. Monopoly move still to make. */
  speed: SpeedFace | null = null;
  choice: MoveChoice | null = null;
  private speedPending: 'mr' | null = null;
  /** A bankrupt player's estate waiting to be auctioned by the bank, and the phase to return to. */
  private estateQueue: number[] = [];
  private resumePhase: TurnPhase | null = null;
  /** Summary counters per player (see PlayerStats); created lazily by stat(). */
  stats: Record<string, PlayerStats> = {};
  startedAt: number;
  endedAt: number | null = null;
  private minigameSeq = 0;
  private minigamesEnabled: () => boolean;
  private cardSeq = 0;
  private tradeSeq = 0;
  private onLog?: (text: string) => void;
  private onBank?: (amount: number, reason: string) => void;
  private rng: Rng;
  private now: () => number;

  constructor(init: GameInit) {
    if (init.players.length < 2) fail('Need at least 2 players');
    this.theme = init.theme;
    this.rules = init.rules;
    this.spaces = init.theme.spaces;
    this.size = this.spaces.length;
    this.jailIndex = this.spaces.findIndex(s => s.kind === 'jail');
    if (this.jailIndex < 0) fail('Board has no jail');
    this.rng = init.rng ?? (n => Math.floor(Math.random() * n));
    this.now = init.now ?? Date.now;
    this.onLog = init.onLog;
    this.onBank = init.onBank;
    this.minigamesEnabled = init.minigamesEnabled ?? (() => true);
    this.startedAt = this.now();
    this.players = init.players.map(p => ({
      ...p, cash: init.rules.startingCash, position: 0, inJail: false, jailTurns: 0,
      jailCards: [], bankrupt: false,
    }));
    this.decks = {
      chance: this.shuffled(init.theme.chance.length),
      chest: this.shuffled(init.theme.chest.length),
    };
    this.say(`Game started — ${this.current.name} goes first.`);
    const limit = init.rules.timeLimitMin ?? 0;
    if (limit > 0) this.endsAt = this.now() + limit * 60_000;
    this.settle();
  }

  // ---- helpers --------------------------------------------------------------

  get current(): PlayerState {
    return this.players[this.currentIdx];
  }

  player(id: string): PlayerState {
    return this.players.find(p => p.id === id) ?? fail('Unknown player');
  }

  active(): PlayerState[] {
    return this.players.filter(p => !p.bankrupt);
  }

  money(n: number): string {
    return `${this.theme.currency}${n}`;
  }

  private shuffled(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = this.rng(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private say(text: string, who?: string) {
    this.log.push({ t: this.now(), text, who });
    this.onLog?.(text);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private die(): number {
    return this.rng(6) + 1;
  }

  ownedBy(id: string): number[] {
    return Object.keys(this.owned).map(Number).filter(i => this.owned[i].owner === id);
  }

  ownsGroup(id: string, group: string): boolean {
    return groupIndices(this.spaces, group).every(i => this.owned[i]?.owner === id);
  }

  private groupHasBuildings(group: string | undefined): boolean {
    if (!group) return false;
    return groupIndices(this.spaces, group).some(i => (this.owned[i]?.houses ?? 0) > 0);
  }

  /** A player's summary counters, created on first use. */
  private stat(id: string): PlayerStats {
    return this.stats[id] ??= { ...NO_STATS };
  }

  debtOf(id: string): number {
    return this.debts.filter(d => d.from === id).reduce((a, d) => a + d.amount, 0);
  }

  rentFor(space: number, opts: LandingOpts = {}, diceTotal = 0): number {
    const s = this.spaces[space];
    const o = this.owned[space];
    if (!o || o.mortgaged) return 0;
    if (s.kind === 'property') {
      if (o.houses > 0) return s.rent![o.houses];
      return this.ownsGroup(o.owner, s.group!) ? s.rent![0] * 2 : s.rent![0];
    }
    if (s.kind === 'railroad') {
      const n = this.ownedBy(o.owner).filter(i => this.spaces[i].kind === 'railroad').length;
      return 25 * 2 ** (n - 1) * (opts.railroadMultiplier ?? 1);
    }
    if (s.kind === 'utility') {
      const n = this.ownedBy(o.owner).filter(i => this.spaces[i].kind === 'utility').length;
      const mult = opts.utilityTenX || n >= 2 ? 10 : 4;
      return mult * diceTotal;
    }
    return 0;
  }

  // ---- money ----------------------------------------------------------------

  /** The bank pays `p` (a negative amount: `p` pays the bank). All bank money goes through here. */
  private bankPays(p: PlayerState, amount: number, reason: string) {
    if (!amount) return;
    p.cash += amount;
    this.onBank?.(amount, reason);
  }

  /** Pay now if possible; otherwise record a debt the payer must settle. */
  private charge(from: PlayerState, to: PlayerState | null, amount: number, reason: string, toPot = false) {
    if (amount <= 0) return;
    if (from.cash >= amount) {
      if (to) {
        from.cash -= amount;
        to.cash += amount;
      } else if (toPot && this.rules.freeParkingPot) {
        from.cash -= amount;
        this.pot += amount;
      } else {
        this.bankPays(from, -amount, reason);
      }
      // Counted when the money moves (now, or later via payDebt with the same
      // reason), so rent that ended in bankruptcy is not credited.
      if (to && reason.startsWith(RENT_REASON)) {
        this.stat(to.id).rentCollected += amount;
        const payer = this.stat(from.id);
        payer.biggestRentPaid = Math.max(payer.biggestRentPaid, amount);
      }
      this.say(`${from.name} paid ${this.money(amount)}${to ? ` to ${to.name}` : ''} (${reason}).`, from.id);
    } else {
      this.debts.push({ from: from.id, to: to?.id ?? null, amount, reason, toPot });
      this.say(`${from.name} owes ${this.money(amount)}${to ? ` to ${to.name}` : ''} (${reason}) — must raise funds.`, from.id);
    }
  }

  // ---- movement & landing ---------------------------------------------------

  private moveBy(p: PlayerState, steps: number) {
    const target = p.position + steps;
    if (target >= this.size) {
      const landedOnGo = target % this.size === 0;
      const pay = this.rules.goSalary * (landedOnGo && this.rules.doubleOnGo ? 2 : 1);
      this.bankPays(p, pay, 'salary');
      p.passedGo = true;
      this.say(`${p.name} ${landedOnGo ? 'landed on' : 'passed'} ${this.spaces[0].name} and collected ${this.money(pay)}.`, p.id);
    }
    p.position = target % this.size;
  }

  private advanceTo(p: PlayerState, to: number) {
    const steps = (to - p.position + this.size) % this.size;
    this.moveBy(p, steps === 0 ? this.size : steps);
  }

  private sendToJail(p: PlayerState) {
    p.position = this.jailIndex;
    p.inJail = true;
    p.jailTurns = 0;
    this.doublesCount = 0;
    this.stat(p.id).jailed++;
    if (p === this.current) this.extraRoll = false;
    this.say(`${p.name} was sent to ${this.spaces[this.jailIndex].name}!`, p.id);
  }

  private resolveLanding(p: PlayerState, opts: LandingOpts = {}) {
    const i = p.position;
    const s = this.spaces[i];
    this.say(`${p.name} landed on ${s.name}.`, p.id);
    if (isOwnable(s)) {
      const o = this.owned[i];
      if (!o) {
        this.phase = 'buy';
        return;
      }
      if (o.owner === p.id) return;
      if (o.mortgaged) {
        this.say(`${s.name} is mortgaged — no rent.`);
        return;
      }
      const owner = this.player(o.owner);
      if (this.rules.noRentInJail && owner.inJail) {
        this.say(`${owner.name} is in jail — no rent on ${s.name}.`);
        return;
      }
      let diceTotal = this.dice ? this.dice[0] + this.dice[1] : 0;
      if (s.kind === 'utility' && opts.utilityTenX) {
        const a = this.die(), b = this.die();
        diceTotal = a + b;
        this.say(`${p.name} rolled ${a} + ${b} for the utility.`, p.id);
      }
      const rent = this.rentFor(i, opts, diceTotal);
      this.charge(p, this.player(o.owner), rent, `${RENT_REASON}${s.name}`);
      return;
    }
    switch (s.kind) {
      case 'tax':
        this.charge(p, null, s.tax ?? 0, s.name, true);
        break;
      case 'chance':
      case 'chest':
        this.drawCard(p, s.kind);
        break;
      case 'gotojail':
        this.sendToJail(p);
        break;
      case 'parking':
        if (this.rules.freeParkingPot && this.pot > 0) {
          this.say(`${p.name} scooped the ${s.name} pot of ${this.money(this.pot)}!`, p.id);
          p.cash += this.pot;
          this.pot = 0;
        }
        if (this.rules.arcadeParking && this.minigamesOn()) this.startMinigame(p);
        break;
      case 'arcade':
        if (this.minigamesOn()) this.startMinigame(p);
        else this.say('The arcade is closed today.');
        break;
      default:
        break;
    }
  }

  private drawCard(p: PlayerState, deck: DeckId) {
    const cards = deck === 'chance' ? this.theme.chance : this.theme.chest;
    const idx = this.decks[deck].shift();
    if (idx === undefined) return; // every card is held as a jail card — nothing to draw
    const card = cards[idx];
    const text = card.text; // placeholders already filled for this board
    if (card.effect.type === 'jailFree') p.jailCards.push(deck);
    else this.decks[deck].push(idx);
    this.lastCard = { deck, text, player: p.id, seq: ++this.cardSeq };
    this.say(`${p.name} drew ${this.theme.deckNames[deck]}: “${text}”`, p.id);
    this.applyCard(p, card.effect);
  }

  private applyCard(p: PlayerState, e: CardEffect) {
    const others = this.active().filter(o => o !== p);
    switch (e.type) {
      case 'advance':
        this.advanceTo(p, e.to);
        this.resolveLanding(p);
        break;
      case 'nearest': {
        if (!this.spaces.some(s => s.kind === e.kind)) break; // this map has none
        let i = p.position;
        do i = (i + 1) % this.size; while (this.spaces[i].kind !== e.kind);
        this.advanceTo(p, i);
        this.resolveLanding(p, e.kind === 'railroad' ? { railroadMultiplier: 2 } : { utilityTenX: true });
        break;
      }
      case 'back':
        p.position = (p.position - e.steps + this.size) % this.size;
        this.resolveLanding(p);
        break;
      case 'jail':
        this.sendToJail(p);
        break;
      case 'jailFree':
        break;
      case 'collect':
        this.bankPays(p, e.amount, 'card');
        break;
      case 'pay':
        this.charge(p, null, e.amount, 'card', true);
        break;
      case 'payEach':
        for (const o of others) this.charge(p, o, e.amount, 'card');
        break;
      case 'collectEach':
        for (const o of others) this.charge(o, p, e.amount, 'card');
        break;
      case 'repairs': {
        let total = 0;
        for (const i of this.ownedBy(p.id)) {
          const h = this.owned[i].houses;
          total += h === 5 ? e.perHotel : h * e.perHouse;
        }
        this.charge(p, null, total, 'repairs', true);
        break;
      }
    }
  }

  /** Called once whatever the roll triggered (buy, auction) is settled. */
  private afterResolution() {
    if (this.phase === 'over') return;
    if (this.current.bankrupt) {
      this.speedPending = null;
      this.nextTurn();
      return;
    }
    // Speed Die: Mr. Monopoly moves on once the first landing is fully dealt
    // with — rent included: while it is owed he waits (see resumeAfterDebt).
    if (this.speedPending === 'mr') {
      if (!this.current.inJail && this.debtOf(this.current.id) > 0) {
        this.phase = 'done';
        return;
      }
      this.speedPending = null;
      if (!this.current.inJail) {
        // Leave the phase that just ended (a mini-game or an auction) first:
        // when Mr. Monopoly has nowhere to go, nothing else would.
        this.phase = 'done';
        this.mrMonopoly(this.current);
        if (this.phase !== 'done') return; // buying, auctioning or playing: comes back here
      }
    }
    this.phase = this.extraRoll && !this.current.inJail ? 'roll' : 'done';
    if (this.endAfter) {
      this.endAfter = false;
      if (this.phase === 'done' && this.debtOf(this.current.id) === 0) this.nextTurn();
    }
  }

  private nextTurn() {
    if (this.checkWinner()) return;
    // "Lift the mortgage at once for the principal" lasts until the turn ends.
    for (const o of Object.values(this.owned)) delete o.interestPaid;
    this.doublesCount = 0;
    this.extraRoll = false;
    this.speedPending = null;
    this.endAfter = false;
    this.choice = null;
    do this.currentIdx = (this.currentIdx + 1) % this.players.length;
    while (this.current.bankrupt);
    this.phase = 'roll';
    this.turnNumber++;
  }

  private checkWinner(): boolean {
    const alive = this.active();
    if (alive.length === 1) {
      this.winner = alive[0].id;
      this.phase = 'over';
      this.endedAt = this.now();
      this.auction = null;
      this.minigame = null;
      this.say(`${alive[0].name} wins the game!`, alive[0].id);
      return true;
    }
    return false;
  }

  // ---- actions --------------------------------------------------------------

  /**
   * Run a player's action. `auto` marks moves the computer makes for a human
   * (autopilot): those must not count as the player being back.
   */
  apply(playerId: string, a: Action, opts: { auto?: boolean } = {}): void {
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') fail('Bad action');
    if (this.phase === 'over') fail('The game is over');
    const p = this.player(playerId);
    if (p.bankrupt) fail('You are out of the game');
    // Resigning stays possible so a player can still leave a paused table.
    if (this.paused && a.type !== 'bankrupt') fail(`The game is paused by ${this.paused.by}`);
    this.dispatch(p, a);
    if (!opts.auto) {
      this.timeoutStreak[p.id] = 0;
      if (p.afk) {
        p.afk = false;
        this.say(`${p.name} is back.`, p.id);
      }
    }
    this.settle();
  }

  /**
   * Actions come straight from clients: every field is checked here (or by the
   * handler) and only rebuilt, validated values reach the state.
   */
  private dispatch(p: PlayerState, a: Action): void {
    switch (a.type) {
      case 'roll': return this.roll(p);
      case 'buy': return this.buy(p);
      case 'decline': return this.decline(p, a.endTurn === true);
      case 'bid': return this.bid(p, a.amount);
      case 'pass': return this.pass(p);
      case 'endTurn': return this.endTurn(p);
      case 'payJail': return this.payJail(p);
      case 'useJailCard': return this.useJailCard(p);
      case 'build': return this.build(p, this.spaceArg(a.space));
      case 'sell': return this.sell(p, this.spaceArg(a.space));
      case 'mortgage': return this.mortgage(p, this.spaceArg(a.space));
      case 'unmortgage': return this.unmortgage(p, this.spaceArg(a.space));
      case 'payDebt': return this.payDebt(p);
      case 'bankrupt': return this.goBankrupt(p);
      case 'proposeTrade':
        return this.proposeTrade(p, idArg(a.to), this.readSide(a.give), this.readSide(a.get),
          a.counterOf === undefined ? undefined : idArg(a.counterOf));
      case 'acceptTrade': return this.acceptTrade(p, idArg(a.id));
      case 'rejectTrade': return this.rejectTrade(p, idArg(a.id));
      case 'minigame': return this.minigameMove(p, a.move);
      case 'choose': return this.choose(p, a.value);
      default: fail('Unknown action');
    }
  }

  /** A board index from a client: a whole number on this board. */
  private spaceArg(v: unknown): number {
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= this.size) fail('No such space');
    return v as number;
  }

  /**
   * Rebuild one side of an offer from its validated fields only, so nothing
   * else a client sent is ever stored. Ownership and cash are checked later
   * (validateSide), against the moment of proposing and again of accepting.
   */
  private readSide(raw: unknown): TradeSide {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Bad trade');
    const { cash = 0, spaces = [], jailCards = 0 } = raw as Record<string, unknown>;
    if (!Number.isInteger(cash) || (cash as number) < 0) fail('Bad cash amount');
    if (!Number.isInteger(jailCards) || (jailCards as number) < 0) fail('Bad jail card count');
    if (!Array.isArray(spaces) || spaces.length > this.size) fail('Bad property list');
    const list = spaces.map(i => this.spaceArg(i));
    if (new Set(list).size !== list.length) fail('Duplicate property');
    return { cash: cash as number, spaces: list, jailCards: jailCards as number };
  }

  private requireTurn(p: PlayerState, phase: TurnPhase) {
    if (p !== this.current) fail('Not your turn');
    if (this.phase !== phase) fail(`Can't do that now (${this.phase})`);
  }

  private roll(p: PlayerState) {
    this.requireTurn(p, 'roll');
    if (this.debtOf(p.id) > 0) fail('Settle your debts first');
    const d: [number, number] = [this.die(), this.die()];
    // The Speed Die joins once you have been round the board, never for a jail escape.
    const speed = this.rules.speedDie && p.passedGo && !p.inJail ? SPEED_FACES[this.rng(SPEED_FACES.length)] : null;
    this.dice = d;
    this.speed = speed;
    this.speedPending = null;
    this.rollSeq++;
    this.rollTurn = this.turnNumber;
    this.rollBy = this.current.id;
    const total = d[0] + d[1];
    const doubles = d[0] === d[1];
    const triples = doubles && speed === d[0];
    const face = speed === null ? '' : ` + ${speedName(speed)}`;
    this.say(`${p.name} rolled ${d[0]} + ${d[1]}${face}${triples ? ' (triples!)' : doubles ? ' (doubles)' : ''}.`, p.id);
    this.extraRoll = false;

    if (triples) {
      // Official Speed Die rule: triples go anywhere, and that ends the turn's rolling.
      this.doublesCount = 0;
      this.choice = { kind: 'triples' };
      this.phase = 'choose';
      return;
    }

    if (p.inJail) {
      if (doubles) {
        p.inJail = false;
        p.jailTurns = 0;
        this.say(`${p.name} rolled out of jail.`, p.id);
      } else {
        p.jailTurns++;
        if (p.jailTurns < 3) {
          this.phase = 'done';
          return;
        }
        this.say(`${p.name} must pay the ${this.money(this.rules.jailFine)} fine after three tries.`, p.id);
        this.charge(p, null, this.rules.jailFine, 'jail fine');
        p.inJail = false;
        p.jailTurns = 0;
      }
    } else if (doubles) {
      this.doublesCount++;
      if (this.doublesCount === 3) {
        this.say(`${p.name} rolled three doubles in a row.`, p.id);
        this.sendToJail(p);
        this.phase = 'done';
        return;
      }
      this.extraRoll = true;
    }

    this.phase = 'done';
    if (speed === 'bus') {
      // Bus: move by either white die or their sum — the player picks.
      this.choice = { kind: 'bus', options: [...new Set([d[0], d[1], total])].sort((a, b) => a - b) };
      this.phase = 'choose';
      return;
    }
    if (speed === 'mr') this.speedPending = 'mr';
    this.moveBy(p, total + (typeof speed === 'number' ? speed : 0));
    this.resolveLanding(p);
    if (this.phase === 'done') this.afterResolution();
  }

  /** Phase 'choose': the Bus move (steps) or the triples jump (a space). */
  private choose(p: PlayerState, value: number) {
    this.requireTurn(p, 'choose');
    const c = this.choice ?? fail('Nothing to choose');
    if (!Number.isInteger(value)) fail('Bad choice');
    if (c.kind === 'bus') {
      if (!c.options.includes(value)) fail('Pick one of the dice or their sum');
      this.choice = null;
      this.phase = 'done';
      this.say(`${p.name} took the bus ${value} space${value === 1 ? '' : 's'}.`, p.id);
      this.moveBy(p, value);
    } else {
      if (value < 0 || value >= this.size) fail('No such space');
      this.choice = null;
      this.phase = 'done';
      this.say(`${p.name} jumped to ${this.spaces[value].name}.`, p.id);
      // Moving forward: passing GO on the way still pays.
      if (value !== p.position) this.advanceTo(p, value);
    }
    this.resolveLanding(p);
    if (this.phase === 'done') this.afterResolution();
  }

  /** The default choice (timeouts, bots, autopilot): the dice sum, or the best free deed. */
  defaultChoice(id: string): number {
    const c = this.choice;
    if (c?.kind === 'bus') return Math.max(...c.options);
    return this.bestTriplesTarget(id);
  }

  /** Where a triples jump helps most: an unowned deed, preferring ones toward a set; else GO. */
  bestTriplesTarget(id: string): number {
    let best = 0;
    let bestScore = -1;
    this.spaces.forEach((s, i) => {
      if (!isOwnable(s) || this.owned[i]) return;
      const grp = s.group ? groupIndices(this.spaces, s.group) : [];
      const mine = grp.filter(j => this.owned[j]?.owner === id).length;
      const score = (s.price ?? 0) * (1 + mine);
      if (score > bestScore) { best = i; bestScore = score; }
    });
    return best;
  }

  /** Speed Die Mr. Monopoly: on to the next unowned deed, else the next one you owe rent on. */
  private mrMonopoly(p: PlayerState) {
    const ahead = Array.from({ length: this.size - 1 }, (_, k) => (p.position + k + 1) % this.size)
      .filter(i => isOwnable(this.spaces[i]));
    const target = ahead.find(i => !this.owned[i]) ?? ahead.find(i => this.rentDue(i, p));
    if (target === undefined) {
      this.say(`Mr. Monopoly has nowhere to send ${p.name}.`, p.id);
      return;
    }
    this.say(`🎩 Mr. Monopoly sends ${p.name} on to ${this.spaces[target].name}.`, p.id);
    this.phase = 'done';
    this.advanceTo(p, target);
    this.resolveLanding(p);
  }

  /** Would `p` owe rent landing on `i` right now? */
  private rentDue(i: number, p: PlayerState): boolean {
    const o = this.owned[i];
    if (!o || o.owner === p.id || o.mortgaged) return false;
    return !(this.rules.noRentInJail && this.player(o.owner).inJail);
  }

  private buy(p: PlayerState) {
    this.requireTurn(p, 'buy');
    const s = this.spaces[p.position];
    const price = s.price ?? 0;
    // Money already owed is not there to spend.
    const owe = this.debtOf(p.id);
    if (p.cash - owe < price) fail(owe ? 'Settle your debts first — or auction it' : 'Not enough cash — auction it or raise funds');
    this.bankPays(p, -price, 'purchase');
    this.owned[p.position] = { owner: p.id, houses: 0, mortgaged: false };
    this.stat(p.id).propertiesBought++;
    this.say(`${p.name} bought ${s.name} for ${this.money(price)}.`, p.id);
    this.afterResolution();
  }

  private decline(p: PlayerState, endTurn = false) {
    this.requireTurn(p, 'buy');
    const s = this.spaces[p.position];
    // "End turn" on an unbought property: pass on it and hand over once it is settled.
    this.endAfter = endTurn && !this.extraRoll;
    if (!this.rules.auctions) {
      this.say(`${p.name} passed on ${s.name}.`, p.id);
      this.afterResolution();
      return;
    }
    this.auction = {
      space: p.position,
      highBid: 0,
      highBidder: null,
      bidders: this.active().map(x => x.id),
      endsAt: this.now() + AUCTION_MS,
      bids: [],
    };
    this.phase = 'auction';
    this.say(`${s.name} is up for auction!`);
  }

  private bid(p: PlayerState, amount: number) {
    const a = this.auction;
    if (this.phase !== 'auction' || !a) fail('No auction running');
    if (!a.bidders.includes(p.id)) fail('You have left this auction');
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= a.highBid) fail(`Bid more than ${this.money(a.highBid)}`);
    // What they already owe is spoken for: the winner must be able to pay.
    const owe = this.debtOf(p.id);
    if (amount > p.cash - owe) fail(owe ? `You cannot bid more than your cash less the ${this.money(owe)} you owe` : 'You cannot bid more than your cash');
    a.highBid = amount;
    a.highBidder = p.id;
    a.bids = [...(a.bids ?? []).filter(b => b.id !== p.id), { id: p.id, amount }];
    a.endsAt = Math.max(a.endsAt, this.now() + AUCTION_EXTEND_MS);
    this.say(`${p.name} bid ${this.money(amount)}.`, p.id);
    // Deeds are locked and trades wait while an auction runs, so nobody's
    // spending money can grow: whoever can no longer top this bid is out,
    // rather than holding the clock open as a bidder in name only.
    const priced = a.bidders.filter(id => id !== p.id && this.player(id).cash - this.debtOf(id) <= amount);
    if (priced.length) {
      a.bidders = a.bidders.filter(id => !priced.includes(id));
      this.say(`${priced.map(id => this.player(id).name).join(' and ')} can't top ${this.money(amount)} and ${priced.length > 1 ? 'drop' : 'drops'} out.`);
    }
    if (a.bidders.length === 1) this.finishAuction();
  }

  private pass(p: PlayerState) {
    const a = this.auction;
    if (this.phase !== 'auction' || !a) fail('No auction running');
    if (!a.bidders.includes(p.id)) fail('Already out');
    if (a.highBidder === p.id) fail('You are the high bidder');
    this.leaveAuction(p.id);
  }

  private leaveAuction(id: string) {
    const a = this.auction;
    if (!a) return;
    a.bidders = a.bidders.filter(b => b !== id);
    if (a.highBidder === id) {
      // The lead goes back to the best bid from someone still in, not to nothing.
      const best = (a.bids ?? [])
        .filter(b => b.id !== id && a.bidders.includes(b.id))
        .sort((x, y) => y.amount - x.amount)[0];
      a.highBidder = best?.id ?? null;
      a.highBid = best?.amount ?? 0;
    }
    if (a.bidders.length === 0 || (a.bidders.length === 1 && a.highBidder === a.bidders[0])) {
      this.finishAuction();
    }
  }

  /** Called by the room when the auction clock runs out. */
  auctionTimeout(): boolean {
    if (this.paused || !this.auction || this.now() < this.auction.endsAt) return false;
    this.finishAuction();
    this.settle();
    return true;
  }

  private finishAuction() {
    const a = this.auction!;
    const s = this.spaces[a.space];
    this.auction = null;
    if (a.highBidder) {
      const w = this.player(a.highBidder);
      // Bids are capped at cash, but cash can move during the auction (a debt
      // paid, an operator fix): whatever is missing becomes an ordinary debt.
      const paid = Math.max(0, Math.min(a.highBid, w.cash));
      this.bankPays(w, -paid, 'auction');
      this.owned[a.space] = { owner: w.id, houses: 0, mortgaged: false };
      this.stat(w.id).propertiesBought++;
      this.say(`${w.name} won ${s.name} for ${this.money(a.highBid)}.`, w.id);
      if (paid < a.highBid) this.charge(w, null, a.highBid - paid, `the rest of the ${s.name} auction`);
    } else {
      this.say(`Nobody bid on ${s.name}${a.bank ? ' — it stays with the bank' : ''}.`);
    }
    if (!a.bank) {
      this.afterResolution();
      return;
    }
    // A bank sale interrupted someone's turn: put it back exactly where it was
    // (settle() starts the next lot, if any, straight after).
    this.phase = this.resumePhase ?? 'done';
    this.resumePhase = null;
    if (this.current.bankrupt) this.nextTurn();
  }

  /** Start the next bank sale of a bankrupt estate once the table is between steps. */
  private pumpEstate() {
    if (this.phase === 'over') {
      this.estateQueue = [];
      return;
    }
    if (this.paused || this.auction || this.minigame || !STEP_PHASES.includes(this.phase)) return;
    while (this.estateQueue.length) {
      const space = this.estateQueue.shift()!;
      if (this.owned[space]) continue; // someone got it meanwhile (operator fix)
      this.resumePhase = this.phase;
      this.auction = {
        space, highBid: 0, highBidder: null, bidders: this.active().map(x => x.id),
        endsAt: this.now() + AUCTION_MS, bank: true, bids: [],
      };
      this.phase = 'auction';
      this.say(`The bank is auctioning ${this.spaces[space].name}.`);
      return;
    }
  }

  private endTurn(p: PlayerState) {
    this.requireTurn(p, 'done');
    if (this.debtOf(p.id) > 0) fail('Settle your debts first');
    this.nextTurn();
  }

  private leaveJail(p: PlayerState) {
    p.inJail = false;
    p.jailTurns = 0;
  }

  private payJail(p: PlayerState) {
    this.requireTurn(p, 'roll');
    if (!p.inJail) fail('You are not in jail');
    if (this.debtOf(p.id) > 0) fail('Settle your debts first');
    if (p.cash < this.rules.jailFine) fail('Not enough cash');
    this.charge(p, null, this.rules.jailFine, 'jail fine');
    this.leaveJail(p);
  }

  private useJailCard(p: PlayerState) {
    this.requireTurn(p, 'roll');
    if (!p.inJail) fail('You are not in jail');
    const deck = p.jailCards.pop() ?? fail('You have no Get Out of Jail Free card');
    this.returnJailCard(deck);
    this.leaveJail(p);
    this.say(`${p.name} used a Get Out of Jail Free card.`, p.id);
  }

  // The property checks live in shared/holdings.ts, so the deed card's
  // buttons follow exactly the rules enforced here.
  private requireOwn(p: PlayerState, space: number): { s: SpaceDef; o: OwnedSpace } {
    const why = manageProblem(this, p.id, space);
    if (why) fail(why);
    return { s: this.spaces[space], o: this.owned[space] };
  }

  canBuild(id: string, space: number): string | null {
    return buildProblem(this, this.spaces, id, space, this.player(id).cash);
  }

  private build(p: PlayerState, space: number) {
    const { s, o } = this.requireOwn(p, space);
    const why = this.canBuild(p.id, space);
    if (why) fail(why);
    this.bankPays(p, -s.houseCost!, 'building');
    if (o.houses === 4) {
      this.hotelsLeft--;
      this.housesLeft += 4;
    } else {
      this.housesLeft--;
    }
    o.houses++;
    this.say(`${p.name} built ${o.houses === 5 ? 'a hotel' : 'a house'} on ${s.name}.`, p.id);
  }

  private sell(p: PlayerState, space: number) {
    this.requireOwn(p, space);
    const why = sellProblem(this, this.spaces, space);
    if (why) fail(why);
    this.sellOne(p, space);
  }

  /** Sell one building back to the bank (checks done by the caller). */
  private sellOne(p: PlayerState, space: number) {
    const s = this.spaces[space];
    const o = this.owned[space];
    if (o.houses < 5) {
      o.houses--;
      this.housesLeft++;
      const refund = Math.floor(s.houseCost! / 2);
      this.bankPays(p, refund, 'building sold');
      this.say(`${p.name} sold a house on ${s.name} for ${this.money(refund)}.`, p.id);
      return;
    }
    // A hotel is broken back into four houses, which come from the bank.
    let refund = 0;
    const changed: string[] = [];
    for (const [i, level] of this.hotelBreak(space)) {
      const lot = this.owned[i];
      if (level === lot.houses) continue;
      if (lot.houses === 5) this.hotelsLeft++;
      else this.housesLeft += lot.houses;
      this.housesLeft -= level; // never a hotel: lots only come down
      refund += Math.floor(this.spaces[i].houseCost! / 2) * (lot.houses - level);
      lot.houses = level;
      changed.push(`${this.spaces[i].name} → ${level === 0 ? 'no houses' : `${level} house${level === 1 ? '' : 's'}`}`);
    }
    this.bankPays(p, refund, 'building sold');
    if (changed.length === 1 && o.houses === 4) {
      this.say(`${p.name} sold the hotel on ${s.name} for ${this.money(refund)}.`, p.id);
    } else {
      this.say(`${p.name} sold the hotel on ${s.name}, but the bank was short of houses to replace it: ${changed.join(', ')} (${this.money(refund)}).`, p.id);
    }
  }

  /**
   * New house counts when the hotel on `space` is sold: four houses, if the
   * bank has them. In a housing shortage the lot can only drop to what the
   * bank can supply, and with even building on, the rest of the group must
   * come down with it (official rule: sell down further). Of every even
   * arrangement the bank can supply, the one that sells the least.
   */
  private hotelBreak(space: number): Map<number, number> {
    const bank = this.rules.limitedBuildings ? Math.max(0, this.housesLeft) : Infinity;
    if (bank >= 4) return new Map([[space, 4]]);
    if (!this.rules.evenBuild) return new Map([[space, bank]]);
    const grp = groupIndices(this.spaces, this.spaces[space].group!);
    const now = grp.map(i => this.owned[i].houses);
    const housesNow = now.reduce((a, h) => a + (h < 5 ? h : 0), 0);
    const pick = grp.map(() => 0);
    let best = pick.map(() => 0);
    let bestSum = -1;
    const visit = (k: number) => {
      if (k === grp.length) {
        if (Math.max(...pick) - Math.min(...pick) > 1) return;
        const need = pick.reduce((a, h) => a + (h < 5 ? h : 0), 0) - housesNow;
        const sum = pick.reduce((a, h) => a + h, 0);
        if (need <= bank && sum > bestSum) { best = [...pick]; bestSum = sum; }
        return;
      }
      for (let v = grp[k] === space ? Math.min(4, now[k]) : now[k]; v >= 0; v--) {
        pick[k] = v;
        visit(k + 1);
      }
    };
    visit(0);
    return new Map(grp.map((i, k) => [i, best[k]]));
  }

  private mortgage(p: PlayerState, space: number) {
    const { s, o } = this.requireOwn(p, space);
    const why = mortgageProblem(this, this.spaces, space);
    if (why) fail(why);
    this.mortgageOne(p, s, o);
  }

  private mortgageOne(p: PlayerState, s: SpaceDef, o: OwnedSpace) {
    o.mortgaged = true;
    this.bankPays(p, mortgageValue(s), 'mortgage');
    this.say(`${p.name} mortgaged ${s.name} for ${this.money(mortgageValue(s))}.`, p.id);
  }

  private unmortgage(p: PlayerState, space: number) {
    const { s, o } = this.requireOwn(p, space);
    const why = unmortgageProblem(this, this.spaces, space, p.cash);
    if (why) fail(why);
    const cost = liftCost(this.spaces, space, o);
    this.bankPays(p, -cost, 'mortgage lifted');
    o.mortgaged = false;
    delete o.interestPaid;
    this.say(`${p.name} lifted the mortgage on ${s.name} for ${this.money(cost)}.`, p.id);
  }

  private payDebt(p: PlayerState) {
    const mine = this.debts.filter(d => d.from === p.id);
    if (!mine.length) fail('You owe nothing');
    const total = mine.reduce((a, d) => a + d.amount, 0);
    if (p.cash < total) fail(`You need ${this.money(total - p.cash)} more`);
    this.debts = this.debts.filter(d => d.from !== p.id);
    for (const d of mine) this.charge(p, d.to ? this.player(d.to) : null, d.amount, d.reason, d.toPot);
    this.resumeAfterDebt(p);
  }

  /** The current player's debt is settled: a Mr. Monopoly move waiting on it goes ahead. */
  private resumeAfterDebt(p: PlayerState) {
    if (p === this.current && this.speedPending === 'mr' && this.phase === 'done' && this.debtOf(p.id) === 0) {
      this.afterResolution();
    }
  }

  /**
   * Voluntary resignation or failure to pay. Buildings go back to the bank at
   * half price first. Then debts are met in the order they arose, each in full
   * while the cash lasts, as they would be across the table; the first one that
   * cannot be met is who `p` goes bankrupt to. A player creditor takes
   * everything left (cash, deeds as they are, Get Out of Jail Free cards, and
   * what others owe `p`), paying the 10% on mortgaged deeds; the bank auctions
   * the deeds unmortgaged and puts the jail cards back under their decks.
   */
  private goBankrupt(p: PlayerState) {
    const mine = this.debts.filter(d => d.from === p.id);
    this.debts = this.debts.filter(d => d.from !== p.id);
    this.trades = this.trades.filter(t => t.from !== p.id && t.to !== p.id);

    for (const i of this.ownedBy(p.id)) if (this.owned[i].houses > 0) this.clearBuildings(i);

    let creditor: PlayerState | null = null;
    for (const d of mine) {
      const to = d.to ? this.player(d.to) : null;
      if (p.cash < d.amount) {
        creditor = to;
        break;
      }
      this.charge(p, to, d.amount, d.reason, d.toPot);
    }

    if (creditor) {
      const c = creditor;
      const deeds = this.ownedBy(p.id).sort((a, b) => a - b);
      if (p.cash) this.say(`${c.name} receives ${p.name}'s remaining ${this.money(p.cash)}.`, c.id);
      c.cash += p.cash;
      p.cash = 0;
      for (const i of deeds) this.owned[i].owner = c.id;
      c.jailCards.push(...p.jailCards);
      // Money others owed p is now owed to the creditor (and cancelled if it is their own).
      this.debts = this.debts
        .map(d => (d.to === p.id ? { ...d, to: c.id } : d))
        .filter(d => d.from !== d.to);
      this.say(`${p.name} went bankrupt — everything goes to ${c.name}.`, p.id);
      this.mortgageInterest(c, deeds);
    } else {
      const estate = this.ownedBy(p.id).sort((a, b) => a - b);
      // Official rule: the bank auctions the estate, each deed unmortgaged.
      for (const i of estate) delete this.owned[i];
      if (this.rules.auctions) this.estateQueue.push(...estate);
      this.bankPays(p, -p.cash, 'bankruptcy');
      for (const deck of p.jailCards) this.returnJailCard(deck);
      this.debts = this.debts.map(d => (d.to === p.id ? { ...d, to: null } : d));
      this.say(`${p.name} went bankrupt — their property returns to the bank${estate.length && this.rules.auctions ? ' to be auctioned' : ''}.`, p.id);
    }
    delete this.debtEndsAt[p.id];
    p.cash = 0;
    p.jailCards = [];
    p.bankrupt = true;
    this.outOrder.push(p.id);

    if (this.checkWinner()) return;
    if (this.auction) {
      this.leaveAuction(p.id); // may finish the auction, which advances the turn if p was current
      return;
    }
    if (this.minigame) this.dropFromMinigame(p);
    if (p === this.current) { this.nextTurn(); return; }
    // The creditor may be the current player, waiting on a debt that was just
    // cancelled (it was owed to the one who went bankrupt to them): a Mr.
    // Monopoly move held back by that debt goes ahead now.
    this.resumeAfterDebt(this.current);
  }

  // ---- trading --------------------------------------------------------------

  private validateSide(owner: PlayerState, side: TradeSide) {
    if (!Number.isInteger(side.cash) || side.cash < 0) fail('Bad cash amount');
    if (side.cash > owner.cash) fail(`${owner.name} does not have ${this.money(side.cash)}`);
    if (!Number.isInteger(side.jailCards) || side.jailCards < 0 || side.jailCards > owner.jailCards.length) {
      fail(`${owner.name} does not have that many jail cards`);
    }
    if (new Set(side.spaces).size !== side.spaces.length) fail('Duplicate property');
    for (const i of side.spaces) {
      const o = this.owned[i];
      if (!o || o.owner !== owner.id) fail(`${owner.name} does not own ${this.spaces[i]?.name ?? 'that'}`);
      if (this.groupHasBuildings(this.spaces[i].group)) fail(`Sell the buildings on ${this.spaces[i].name}'s group first`);
    }
  }

  /**
   * Both sides of an offer between `from` and `to`, as it stands right now.
   * Players may not lend or give each other money (official rule), so someone
   * who owes may not pay out, net, more than the cash they have over their debts.
   */
  private validateTrade(from: PlayerState, to: PlayerState, give: TradeSide, get: TradeSide) {
    this.validateSide(from, give);
    this.validateSide(to, get);
    for (const [who, out, back] of [[from, give.cash, get.cash], [to, get.cash, give.cash]] as const) {
      const owe = this.debtOf(who.id);
      if (owe > 0 && out - back > Math.max(0, who.cash - owe)) {
        fail(`${who.name} owes ${this.money(owe)} and cannot pay out cash before settling it`);
      }
    }
  }

  /**
   * `counterOf` names an offer made *to* p by `toId`; the new offer replaces
   * it in one step, so the original is never left dangling (or accepted)
   * while the counter is on its way. Everything is validated before either
   * changes.
   */
  private proposeTrade(p: PlayerState, toId: string, give: TradeSide, get: TradeSide, counterOf?: string) {
    const to = this.player(toId);
    if (to === p) fail('You cannot trade with yourself');
    if (to.bankrupt) fail('That player is out');
    let original: Trade | undefined;
    if (counterOf !== undefined) {
      original = this.trades.find(t => t.id === counterOf) ?? fail('That offer is gone');
      if (original.to !== p.id || original.from !== to.id) fail('You can only counter an offer made to you');
    }
    if (this.trades.filter(t => t.from === p.id).length >= MAX_OPEN_TRADES) fail('Too many open offers');
    const empty = (s: TradeSide) => !s.cash && !s.spaces.length && !s.jailCards;
    if (empty(give) && empty(get)) fail('Empty trade');
    this.validateTrade(p, to, give, get);
    if (original) this.trades = this.trades.filter(t => t !== original);
    const t: Trade = { id: `t${++this.tradeSeq}`, from: p.id, to: to.id, give, get };
    this.trades.push(t);
    this.say(original ? `${p.name} countered ${to.name}'s offer.` : `${p.name} offered ${to.name} a trade.`, p.id);
  }

  /** Why an open offer could not go through right now (null: it still could). */
  tradeProblem(t: Trade): string | null {
    try {
      this.validateTrade(this.player(t.from), this.player(t.to), t.give, t.get);
      return null;
    } catch (e) {
      if (e instanceof EngineError) return e.message;
      throw e;
    }
  }

  private acceptTrade(p: PlayerState, id: string) {
    const t = this.trades.find(x => x.id === id) ?? fail('That offer is gone');
    if (t.to !== p.id) fail('That offer is not for you');
    if (this.phase === 'auction') fail('Wait for the auction to finish');
    if (this.phase === 'minigame') fail('Wait for the mini-game to finish');
    const from = this.player(t.from);
    this.validateTrade(from, p, t.give, t.get);
    this.trades = this.trades.filter(x => x.id !== id);
    this.transfer(from, p, t.give);
    this.transfer(p, from, t.get);
    this.say(`${p.name} accepted ${from.name}'s trade.`, p.id);
    // Official rule: taking over a mortgaged deed costs 10% of its mortgage value at once.
    this.mortgageInterest(p, t.give.spaces);
    this.mortgageInterest(from, t.get.spaces);
    // Any other offer touching these properties may now be invalid; drop them.
    const moved = new Set([...t.give.spaces, ...t.get.spaces]);
    this.trades = this.trades.filter(x => ![...x.give.spaces, ...x.get.spaces].some(i => moved.has(i)));
  }

  private transfer(a: PlayerState, b: PlayerState, side: TradeSide) {
    a.cash -= side.cash;
    b.cash += side.cash;
    for (const i of side.spaces) this.owned[i].owner = b.id;
    for (let k = 0; k < side.jailCards; k++) b.jailCards.push(a.jailCards.pop()!);
  }

  /**
   * Official rule for a mortgaged deed changing hands (trade or bankruptcy):
   * the new owner pays the bank 10% interest at once, and may lift the
   * mortgage straight away for the principal alone (interestPaid, until the
   * turn ends); lifting it later costs principal plus 10% again.
   */
  private mortgageInterest(p: PlayerState, spaces: number[]) {
    for (const i of spaces) {
      const o = this.owned[i];
      if (!o?.mortgaged) continue;
      const fee = Math.ceil(mortgageValue(this.spaces[i]) / 10);
      this.charge(p, null, fee, `10% interest on mortgaged ${this.spaces[i].name}`);
      o.interestPaid = true;
    }
  }

  private rejectTrade(p: PlayerState, id: string) {
    const t = this.trades.find(x => x.id === id) ?? fail('That offer is gone');
    if (t.to !== p.id && t.from !== p.id) fail('Not your offer');
    this.trades = this.trades.filter(x => x.id !== id);
    this.say(t.from === p.id ? `${p.name} withdrew a trade offer.` : `${p.name} declined a trade.`, p.id);
  }

  // ---- mini-games -----------------------------------------------------------
  // An arcade landing pauses the turn in phase 'minigame'. The module decides
  // who won; the Game moves the money (bank payouts, `charge` for losses),
  // logs it, shows the result for a few seconds, then resumes the turn via
  // afterResolution() so doubles still earn their extra roll. Like auctions,
  // deadlines are stored here and the room calls minigameTimeout() on time.

  private minigamesOn(): boolean {
    return this.rules.minigames !== false && this.minigamesEnabled();
  }

  private minigameCtx(): MinigameCtx {
    return { now: this.now(), rng: this.rng };
  }

  private names(): Names {
    return { name: id => this.player(id).name, money: n => this.money(n) };
  }

  private startMinigame(p: PlayerState, kind?: MinigameKind) {
    const k = kind ?? MINIGAME_KINDS[this.rng(MINIGAME_KINDS.length)];
    const others = this.active().filter(o => o !== p).map(o => o.id);
    const data = MINIGAMES[k].start({ ...this.minigameCtx(), host: p.id, others });
    this.minigame = { seq: ++this.minigameSeq, kind: k, host: p.id, stage: 'play', resultEndsAt: 0, result: null, data };
    this.phase = 'minigame';
    const info = MINIGAME_INFO[k];
    const vs = k === 'diceDuel' ? ` — ${p.name} vs ${this.player((data as { opponent: string }).opponent).name}` : '';
    this.say(`${info.icon} Arcade: ${info.title}${vs}!`, p.id);
  }

  private minigameMove(p: PlayerState, move: MinigameMove) {
    const mg = this.minigame;
    if (this.phase !== 'minigame' || !mg) fail('No mini-game is running');
    if (!move || typeof move !== 'object' || typeof move.kind !== 'string') fail('Bad move');
    if (mg.stage === 'result') {
      if (move.kind !== 'continue') fail('This round is over');
      if (p.id !== mg.host) fail(`Waiting for ${this.player(mg.host).name}`);
      this.finishMinigame();
      return;
    }
    const def = MINIGAMES[mg.kind];
    if (!def.players(mg.data).includes(p.id)) fail('You are not playing this round');
    try {
      def.move(mg.data, p.id, move, this.minigameCtx());
    } catch (e) {
      if (e instanceof MinigameError) fail(e.message);
      throw e;
    }
    if (def.done(mg.data)) this.settleMinigame();
  }

  /** When the room must call minigameTimeout() next (internal: may be a secret GO time). */
  minigameDeadline(): number | null {
    const mg = this.minigame;
    if (!mg || this.phase !== 'minigame' || this.paused) return null;
    return mg.stage === 'result' ? mg.resultEndsAt : MINIGAMES[mg.kind].deadline(mg.data);
  }

  /** Called by the room when a mini-game deadline passes. True if anything changed. */
  minigameTimeout(): boolean {
    const mg = this.minigame;
    const due = this.minigameDeadline();
    if (!mg || due === null || this.now() < due) return false;
    if (mg.stage === 'result') {
      this.finishMinigame();
    } else {
      const def = MINIGAMES[mg.kind];
      def.tick(mg.data, this.minigameCtx());
      if (def.done(mg.data)) this.settleMinigame();
    }
    this.settle();
    return true;
  }

  /** The bot's next mini-game move (null = nothing to press yet). */
  minigameBotMove(id: string): MinigameMove | null {
    const mg = this.minigame;
    if (!mg || this.phase !== 'minigame' || mg.stage !== 'play') return null;
    const def = MINIGAMES[mg.kind];
    if (!def.players(mg.data).includes(id)) return null;
    return def.bot(mg.data, id, { now: this.now(), seed: hash(mg.seq, id) });
  }

  /** Pay out the round and switch to the result screen. */
  private settleMinigame() {
    const mg = this.minigame!;
    const def = MINIGAMES[mg.kind];
    const title = MINIGAME_INFO[mg.kind].title;
    const out = def.outcome(mg.data, this.names());
    this.say(`${title}: ${out.headline}`, mg.host);
    const paid: MinigamePayout[] = [];
    for (const po of out.payouts) {
      const p = this.player(po.player);
      if (p.bankrupt) continue;
      if (po.jailCard || po.amount > 0) this.stat(p.id).minigamesWon++;
      if (po.jailCard) {
        if (this.grantJailCard(p)) {
          this.say(`${p.name} got a Get Out of Jail Free card.`, p.id);
          paid.push(po);
          continue;
        }
        // Both cards are already in someone's hand: pay cash instead.
        po.amount = 50;
      }
      if (po.amount > 0) {
        this.bankPays(p, po.amount, title);
        this.say(`${p.name} won ${this.money(po.amount)} from the bank (${title}).`, p.id);
      } else if (po.amount < 0) {
        this.charge(p, null, -po.amount, title, true);
      }
      paid.push({ player: po.player, amount: po.amount });
    }
    mg.stage = 'result';
    mg.result = { headline: out.headline, payouts: paid };
    mg.resultEndsAt = this.now() + def.resultMs;
  }

  /** Take a Get Out of Jail Free card out of whichever deck still has one. */
  private grantJailCard(p: PlayerState): boolean {
    for (const deck of ['chance', 'chest'] as DeckId[]) {
      const cards = deck === 'chance' ? this.theme.chance : this.theme.chest;
      const idx = cards.findIndex(c => c.effect.type === 'jailFree');
      const at = idx < 0 ? -1 : this.decks[deck].indexOf(idx);
      if (at < 0) continue;
      this.decks[deck].splice(at, 1);
      p.jailCards.push(deck);
      return true;
    }
    return false;
  }

  private finishMinigame() {
    this.minigame = null;
    this.afterResolution();
  }

  /** A player went bankrupt mid-round (the caller then advances the turn if they were current). */
  private dropFromMinigame(p: PlayerState) {
    const mg = this.minigame!;
    if (mg.stage === 'result') {
      if (p.id === mg.host) this.minigame = null;
      return;
    }
    const def = MINIGAMES[mg.kind];
    if (p.id !== mg.host && !def.players(mg.data).includes(p.id)) return;
    if (p.id === mg.host || def.drop(mg.data, p.id)) {
      this.say(`The ${MINIGAME_INFO[mg.kind].title} was called off.`);
      this.minigame = null;
      if (p !== this.current) this.afterResolution();
      return;
    }
    if (def.done(mg.data)) this.settleMinigame();
  }

  private minigameView(): MinigameView | null {
    const mg = this.minigame;
    if (!mg) return null;
    const def = MINIGAMES[mg.kind];
    return {
      seq: mg.seq,
      host: mg.host,
      players: [...def.players(mg.data)],
      stage: mg.stage,
      endsAt: mg.stage === 'result' ? mg.resultEndsAt : def.publicEndsAt(mg.data),
      result: mg.result,
      ...def.body(mg.data),
    };
  }

  // ---- clocks: turn timer, debts, pause, game length -------------------------
  // Like auctions, the engine only stores deadlines: the room arms one timer at
  // clockDeadline() and calls clockTimeout(). Every public entry point ends in
  // settle(), which keeps the deadlines in step with whatever just happened.

  /** The clock deadlines are measured from: frozen while paused. */
  private clockNow(): number {
    return this.paused ? this.paused.at : this.now();
  }

  private turnMs(): number {
    return Math.max(0, this.rules.turnSeconds ?? 0) * 1000;
  }

  /** Waiting on a debt they cannot pay from cash? */
  private blockedByDebt(p: PlayerState): boolean {
    const owe = this.debtOf(p.id);
    return owe > 0 && p.cash < owe;
  }

  /** Bookkeeping after every change: the time-limit ending, estate sales, deadlines. */
  private settle() {
    // Out of time and between turn steps: that was the last one.
    if (this.timeUp && this.phase === 'roll' && !this.paused) this.finishByTime();
    this.pumpEstate();
    this.syncClocks();
  }

  private syncClocks() {
    const ms = this.turnMs();
    const base = this.clockNow();
    if (this.phase === 'over' || ms === 0) {
      this.turnEndsAt = null;
      this.turnKey = '';
      this.debtEndsAt = {};
      return;
    }
    const cur = this.current;
    if (!STEP_PHASES.includes(this.phase) || cur.isBot) {
      // Auctions and mini-games run their own clocks; bots never need one.
      this.turnEndsAt = null;
      this.turnKey = '';
    } else {
      // Each new step (new phase, new roll, new player) gets a full window.
      const key = `${this.turnNumber}|${this.currentIdx}|${this.phase}|${this.rollSeq}`;
      if (key !== this.turnKey) {
        this.turnKey = key;
        this.turnEndsAt = base + ms;
      } else if (this.turnEndsAt === null && !this.blockedByDebt(cur)) {
        // The step stalled on a debt (see turnTimeout); now it is sorted, time to finish.
        this.turnEndsAt = base + ms;
      }
    }
    for (const p of this.players) {
      if (p.isBot || p.bankrupt || this.debtOf(p.id) === 0) delete this.debtEndsAt[p.id];
      else this.debtEndsAt[p.id] ??= base + ms * DEBT_TURNS;
    }
  }

  /** When the room must call clockTimeout() next (turn step, a debt, or the game-length limit). */
  clockDeadline(): number | null {
    if (this.paused || this.phase === 'over') return null;
    const due = Object.values(this.debtEndsAt);
    if (this.turnEndsAt !== null) due.push(this.turnEndsAt);
    if (this.endsAt !== null && !this.timeUp) due.push(this.endsAt);
    return due.length ? Math.min(...due) : null;
  }

  /** Called by the room when clockDeadline() passes. True if anything changed. */
  clockTimeout(): boolean {
    const due = this.clockDeadline();
    const now = this.now();
    if (due === null || now < due) return false;
    if (this.endsAt !== null && !this.timeUp && now >= this.endsAt) {
      this.timeUp = true;
      this.say(this.phase === 'roll' ? '⏰ Time is up!' : `⏰ Time is up — the game ends when ${this.current.name}'s turn is over.`);
    }
    for (const [id, at] of Object.entries(this.debtEndsAt)) {
      if (this.phase === 'over') break;
      if (now >= at) this.debtTimeout(this.player(id));
    }
    if (this.phase !== 'over' && this.turnEndsAt !== null && now >= this.turnEndsAt) this.turnTimeout();
    this.settle();
    return true;
  }

  /** The current player let their step run out: take the safe default for them. */
  private turnTimeout() {
    const p = this.current;
    this.turnEndsAt = null;
    const owe = this.debtOf(p.id);
    if (owe > 0) {
      // Nothing can move until the debt is settled; its own clock decides that.
      if (p.cash < owe) return;
      const waiting = this.speedPending === 'mr';
      this.payDebt(p);
      // Mr. Monopoly just moved on: wherever he went gets its own full step.
      if (waiting) return;
    }
    this.say(`⏱ ${p.name} ran out of time.`, p.id);
    switch (this.phase) {
      case 'roll': this.roll(p); break; // in jail this is a roll for doubles
      case 'buy': this.decline(p); break; // never spends their money: it goes to auction
      case 'choose': this.choose(p, this.defaultChoice(p.id)); break;
      case 'done': this.endTurn(p); break;
    }
    const n = (this.timeoutStreak[p.id] ?? 0) + 1;
    this.timeoutStreak[p.id] = n;
    if (n >= AFK_AFTER && !p.afk && !p.bankrupt) {
      p.afk = true;
      this.say(`${p.name} seems to be away — autopilot plays for them until they are back.`, p.id);
    }
  }

  /** A debtor's time is up: raise the cash from their holdings if that covers it, else bankruptcy. */
  private debtTimeout(p: PlayerState) {
    delete this.debtEndsAt[p.id];
    const owe = this.debtOf(p.id);
    if (owe === 0 || p.bankrupt) return;
    this.say(`⏱ ${p.name} ran out of time to pay ${this.money(owe)}.`, p.id);
    if (this.raiseCash(p, owe)) this.payDebt(p);
    else this.goBankrupt(p);
  }

  /**
   * Mortgage bare deeds (cheapest first), then sell buildings, until `p` has
   * `need`. Touches nothing when even everything would not be enough.
   */
  private raiseCash(p: PlayerState, need: number): boolean {
    if (p.cash >= need) return true;
    const mine = this.ownedBy(p.id).sort((a, b) => (this.spaces[a].price ?? 0) - (this.spaces[b].price ?? 0));
    const potential = p.cash + mine.reduce((a, i) => {
      const s = this.spaces[i], o = this.owned[i];
      return a + (o.mortgaged ? 0 : mortgageValue(s)) + Math.floor((s.houseCost ?? 0) / 2) * o.houses;
    }, 0);
    if (potential < need) return false;
    while (p.cash < need) {
      const bare = mine.find(i => !this.owned[i].mortgaged && !this.groupHasBuildings(this.spaces[i].group));
      if (bare !== undefined) {
        this.mortgageOne(p, this.spaces[bare], this.owned[bare]);
        continue;
      }
      // Always the most built-up deed, which keeps the group even.
      const built = mine.filter(i => this.owned[i].houses > 0).sort((a, b) => this.owned[b].houses - this.owned[a].houses)[0];
      if (built === undefined) break;
      this.sellOne(p, built);
    }
    return p.cash >= need;
  }

  /** Host or operator freezes the table: every clock stops, only resigning still works. */
  pause(by: string) {
    if (this.phase === 'over') fail('The game is over');
    if (this.paused) fail(`Already paused by ${this.paused.by}`);
    this.paused = { by, at: this.now() };
    this.say(`⏸️ Game paused by ${by}.`);
  }

  resume(by: string) {
    const p = this.paused ?? fail('The game is not paused');
    this.paused = null;
    this.shiftClocks(this.now() - p.at);
    this.say(`▶️ Game resumed by ${by}.`);
    this.settle();
  }

  /** Move every running deadline on by `ms` (a pause, or a server restart). */
  private shiftClocks(ms: number) {
    if (ms <= 0) return;
    if (this.turnEndsAt !== null) this.turnEndsAt += ms;
    for (const id of Object.keys(this.debtEndsAt)) this.debtEndsAt[id] += ms;
    if (this.endsAt !== null && !this.timeUp) this.endsAt += ms;
    if (this.auction) this.auction.endsAt += ms;
    const mg = this.minigame;
    if (mg) {
      if (mg.stage === 'result') mg.resultEndsAt += ms;
      else MINIGAMES[mg.kind].shift(mg.data, ms);
    }
  }

  /** Game-length limit reached: richest player wins, everyone ranked by net worth. */
  private finishByTime() {
    const st = this.standings();
    this.winner = st[0].id;
    this.phase = 'over';
    this.endedAt = this.now();
    this.auction = null;
    this.minigame = null;
    this.choice = null;
    this.estateQueue = [];
    this.resumePhase = null;
    const w = this.player(this.winner);
    this.say(`🏁 ${w.name} wins with the highest net worth (${this.money(st[0].netWorth)})!`, w.id);
    this.say(`Final ranking: ${st.map((x, i) => `${i + 1}. ${this.player(x.id).name} ${this.money(x.netWorth)}`).join(' · ')}`);
  }

  /** The room gave up on the table (nobody has been at it for a long while): end it as the time limit would. */
  abandon() {
    if (this.phase === 'over') return;
    this.paused = null;
    this.say('🏁 Nobody has been at the table for a long while — the game ends here.');
    this.finishByTime();
    this.syncClocks();
  }

  // ---- operator fixes -------------------------------------------------------
  // Direct corrections for when something went wrong at a table. They bypass
  // turn order and work while paused (operators fix paused games), are written
  // to the game log for everyone to see, and keep money and buildings consistent.

  private livePlayer(id: string): PlayerState {
    if (this.phase === 'over') fail('The game is over');
    const p = this.player(id);
    if (p.bankrupt) fail(`${p.name} is out of the game`);
    return p;
  }

  adminSetCash(id: string, cash: number) {
    const p = this.livePlayer(id);
    if (!Number.isInteger(cash) || cash < 0 || cash > 1_000_000) fail('Cash must be a whole number from 0 to 1,000,000');
    const was = p.cash;
    this.bankPays(p, cash - was, 'operator');
    this.say(`🛠 An operator set ${p.name}'s cash to ${this.money(cash)} (was ${this.money(was)}).`, p.id);
    this.settle();
  }

  /** Give a deed to a player, or back to the bank (`to` null). */
  adminMoveProperty(space: number, to: string | null) {
    if (this.phase === 'over') fail('The game is over');
    const s = this.spaces[space];
    if (!s || !isOwnable(s)) fail('That space cannot be owned');
    if (this.auction?.space === space) fail('That deed is being auctioned');
    if (this.phase === 'buy' && this.current.position === space) fail(`${this.current.name} is deciding whether to buy it`);
    const target = to === null ? null : this.livePlayer(to);
    const o = this.owned[space];
    if (!o && !target) fail('The bank already has it');
    if (o && target && o.owner === target.id) fail(`${target.name} already owns it`);
    // The group stops being one owner's set: the bank buys its buildings back at half price.
    const group = s.group ? groupIndices(this.spaces, s.group) : [space];
    for (const i of group) if (this.owned[i]?.houses) this.clearBuildings(i);
    if (target) this.owned[space] = { owner: target.id, houses: 0, mortgaged: o?.mortgaged ?? false };
    else delete this.owned[space];
    this.estateQueue = this.estateQueue.filter(i => i !== space);
    this.trades = this.trades.filter(t => ![...t.give.spaces, ...t.get.spaces].includes(space));
    const from = o ? this.player(o.owner).name : 'the bank';
    this.say(`🛠 An operator moved ${s.name} from ${from} to ${target ? target.name : 'the bank'}.`, target?.id);
    this.settle();
  }

  /** Sell every building on a deed back to the bank at half price. */
  private clearBuildings(i: number) {
    const o = this.owned[i];
    const refund = Math.floor(this.spaces[i].houseCost! / 2) * o.houses;
    if (o.houses === 5) this.hotelsLeft++;
    else this.housesLeft += o.houses;
    o.houses = 0;
    this.bankPays(this.player(o.owner), refund, 'buildings sold');
  }

  adminJailCard(id: string, give: boolean) {
    const p = this.livePlayer(id);
    if (give) {
      if (!this.grantJailCard(p)) fail('Both Get Out of Jail Free cards are already held');
    } else {
      const deck = p.jailCards.pop() ?? fail(`${p.name} has no Get Out of Jail Free card`);
      this.returnJailCard(deck);
    }
    this.say(`🛠 An operator ${give ? 'gave' : 'took'} a Get Out of Jail Free card ${give ? 'to' : 'from'} ${p.name}.`, p.id);
    this.settle();
  }

  private returnJailCard(deck: DeckId) {
    const cards = deck === 'chance' ? this.theme.chance : this.theme.chest;
    this.decks[deck].push(cards.findIndex(c => c.effect.type === 'jailFree'));
  }

  adminClearDebt(id: string) {
    const p = this.livePlayer(id);
    const owe = this.debtOf(p.id);
    if (!owe) fail(`${p.name} owes nothing`);
    this.debts = this.debts.filter(d => d.from !== p.id);
    this.say(`🛠 An operator cleared ${p.name}'s debt of ${this.money(owe)}.`, p.id);
    this.resumeAfterDebt(p);
    this.settle();
  }

  adminJail(id: string, jail: boolean) {
    const p = this.livePlayer(id);
    if (p === this.current && (this.phase === 'buy' || this.phase === 'choose')) fail(`Wait until ${p.name}'s move is settled`);
    if (jail) {
      if (p.inJail) fail(`${p.name} is already in jail`);
      this.sendToJail(p);
      // Going to jail ends the turn's rolling, as it does in play.
      if (p === this.current && this.phase === 'roll') this.phase = 'done';
    } else {
      if (!p.inJail) fail(`${p.name} is not in jail`);
      this.leaveJail(p);
    }
    this.say(`🛠 An operator ${jail ? 'sent' : 'released'} ${p.name} ${jail ? 'to' : 'from'} jail.`, p.id);
    this.settle();
  }

  // ---- views ----------------------------------------------------------------

  snapshot(): GameSnapshot {
    return structuredClone({
      players: this.players, owned: this.owned, currentIdx: this.currentIdx, phase: this.phase,
      dice: this.dice, rollSeq: this.rollSeq, rollTurn: this.rollTurn, rollBy: this.rollBy, doublesCount: this.doublesCount, extraRoll: this.extraRoll,
      debts: this.debts, auction: this.auction, trades: this.trades, pot: this.pot,
      housesLeft: this.housesLeft, hotelsLeft: this.hotelsLeft, lastCard: this.lastCard,
      winner: this.winner, log: this.log, turnNumber: this.turnNumber, decks: this.decks,
      cardSeq: this.cardSeq, tradeSeq: this.tradeSeq, outOrder: this.outOrder,
      minigame: this.minigame, minigameSeq: this.minigameSeq, savedAt: this.now(),
      turnEndsAt: this.turnEndsAt, turnKey: this.turnKey, debtEndsAt: this.debtEndsAt,
      timeoutStreak: this.timeoutStreak, paused: this.paused, endsAt: this.endsAt, timeUp: this.timeUp,
      speed: this.speed, choice: this.choice, speedPending: this.speedPending, endAfter: this.endAfter,
      estateQueue: this.estateQueue, resumePhase: this.resumePhase,
      stats: this.stats, startedAt: this.startedAt, endedAt: this.endedAt,
    });
  }

  /** Rebuild a game from a snapshot taken by the same code on the same board. */
  static restore(init: Omit<GameInit, 'players'>, snap: GameSnapshot): Game {
    const g = new Game({ ...init, players: snap.players.map(p => ({ ...p })), onLog: undefined });
    const { savedAt, ...state } = structuredClone(snap);
    Object.assign(g, state);
    g.minigame ??= null;
    g.minigameSeq ??= 0;
    // Older snapshots: no timers, no pause, no Speed Die state. syncClocks()
    // below gives a running turn a fresh window if the rules ask for one.
    g.turnEndsAt = snap.turnEndsAt ?? null;
    g.turnKey = snap.turnKey ?? '';
    g.debtEndsAt = snap.debtEndsAt ?? {};
    g.timeoutStreak = snap.timeoutStreak ?? {};
    g.paused = snap.paused ?? null;
    g.endsAt = snap.endsAt ?? null;
    g.timeUp = snap.timeUp ?? false;
    g.speed = snap.speed ?? null;
    // Older snapshots: the dice on the table are this turn's unless a new turn is waiting to roll.
    g.rollTurn = snap.rollTurn ?? (g.dice && g.phase !== 'roll' ? g.turnNumber : 0);
    g.rollBy = snap.rollBy ?? '';
    g.choice = snap.choice ?? null;
    g.speedPending = snap.speedPending ?? null;
    g.endAfter = snap.endAfter ?? false;
    g.estateQueue = snap.estateQueue ?? [];
    g.resumePhase = snap.resumePhase ?? null;
    g.stats ??= {};
    // Offers saved before every field was validated may be malformed: rebuild
    // each one from checked fields, and drop any that cannot be.
    g.trades = (Array.isArray(g.trades) ? g.trades : []).flatMap(t => {
      try {
        return [{ id: idArg(t.id), from: idArg(t.from), to: idArg(t.to), give: g.readSide(t.give), get: g.readSide(t.get) }];
      } catch {
        return [];
      }
    });
    // Older snapshots: the game began at some unknown time; "now" is the honest floor.
    g.startedAt ??= g.now();
    g.endedAt ??= null;
    g.onLog = init.onLog;
    // Every clock resumes where it stood: deadlines move on by the downtime
    // (a pause stays a pause, its start moving with them).
    const down = savedAt === undefined ? 0 : g.now() - savedAt;
    if (down > 0) {
      g.shiftClocks(down);
      if (g.paused) g.paused.at += down;
    }
    // An auction's clock is wall time; give bidders a fresh window after a restart.
    if (g.auction) g.auction.endsAt = g.clockNow() + AUCTION_MS;
    g.syncClocks();
    return g;
  }

  /**
   * Net worth as the official short-game rules count it: cash, deeds at their
   * printed price (mortgaged ones at the mortgage value), buildings at cost,
   * less what the player owes and plus what is owed to them.
   */
  netWorth(id: string): number {
    const p = this.player(id);
    if (p.bankrupt) return 0;
    const deeds = this.ownedBy(id).reduce((a, i) => {
      const s = this.spaces[i], o = this.owned[i];
      return a + (o.mortgaged ? mortgageValue(s) : s.price ?? 0) + (s.houseCost ?? 0) * o.houses;
    }, 0);
    const owedToMe = this.debts.filter(d => d.to === id).reduce((a, d) => a + d.amount, 0);
    return p.cash + deeds - this.debtOf(id) + owedToMe;
  }

  /**
   * Final standings: winner, then the richest survivors, then last-out to
   * first-out. Equal net worth keeps seat order (the sort is stable: whoever
   * sat down first ranks higher), so a time-limit ending always has one winner.
   */
  standings(): { id: string; netWorth: number }[] {
    const worth = new Map(this.players.map(p => [p.id, this.netWorth(p.id)]));
    const alive = this.active().sort((a, b) =>
      Number(b.id === this.winner) - Number(a.id === this.winner) || worth.get(b.id)! - worth.get(a.id)!);
    const out = [...this.outOrder].reverse().map(id => this.player(id));
    return [...alive, ...out].map(p => ({ id: p.id, netWorth: worth.get(p.id)! }));
  }

  view(): GameView {
    return structuredClone({
      themeId: this.theme.id,
      mapId: this.theme.mapId,
      rules: this.rules,
      players: this.players,
      owned: this.owned,
      current: this.current.id,
      phase: this.phase,
      dice: this.dice,
      rollSeq: this.rollSeq,
      rollTurn: this.rollTurn,
      rollBy: this.rollBy || undefined,
      doublesCount: this.doublesCount,
      extraRoll: this.extraRoll,
      debts: this.debts,
      auction: this.auction,
      trades: this.trades,
      pot: this.pot,
      housesLeft: this.housesLeft,
      hotelsLeft: this.hotelsLeft,
      lastCard: this.lastCard,
      winner: this.winner,
      log: this.log.slice(-80),
      turnNumber: this.turnNumber,
      minigame: this.minigameView(),
      turnEndsAt: this.turnEndsAt,
      debtEndsAt: this.debtEndsAt,
      paused: this.paused,
      endsAt: this.endsAt,
      timeUp: this.timeUp,
      speed: this.speed,
      choice: this.choice,
      netWorth: Object.fromEntries(this.players.map(p => [p.id, this.netWorth(p.id)])),
      // Every player gets a row, even one nothing has happened to yet.
      stats: Object.fromEntries(this.players.map(p => [p.id, { ...NO_STATS, ...this.stats[p.id] }])),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      outOrder: this.outOrder,
    });
  }
}
