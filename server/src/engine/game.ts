// The game as a pure state machine: no timers, no sockets, no Math.random.
// Randomness and the clock are injected so tests can replay any game exactly.
// Rooms own pacing (auction deadlines, bots); this file owns the rules.

import {
  groupIndices, isOwnable, mortgageValue, unmortgageCost, type SpaceDef,
} from '../../../shared/board.ts';
import type { CardEffect, DeckId } from '../../../shared/cards.ts';
import type { RuleConfig, Theme } from '../../../shared/themes.ts';
import {
  MINIGAME_INFO, MINIGAME_KINDS, type MinigameKind, type MinigameMove, type MinigamePayout,
  type MinigameResult, type MinigameView,
} from '../../../shared/minigames.ts';
import type {
  Action, Auction, CardShown, Debt, GameView, LogEntry, OwnedSpace, PlayerState, PlayerStats, CharacterId,
  Trade, TradeSide, TurnPhase,
} from '../../../shared/types.ts';
import { MINIGAMES, MinigameError, hash } from './minigames/index.ts';
import type { Ctx as MinigameCtx, Names } from './minigames/types.ts';

export class EngineError extends Error {}

export const AUCTION_MS = 12_000;
/** Each bid guarantees at least this long for someone to respond. */
export const AUCTION_EXTEND_MS = 6_000;
const MAX_LOG = 250;
const MAX_OPEN_TRADES = 5;
/** Debt/charge reasons that start with this are rent (for the summary stats). */
const RENT_REASON = 'rent on ';
const NO_STATS: PlayerStats = { rentCollected: 0, biggestRentPaid: 0, propertiesBought: 0, jailed: 0, minigamesWon: 0 };

export type Rng = (n: number) => number; // integer in [0, n)

export interface NewPlayer {
  id: string;
  name: string;
  character: CharacterId;
  color: string;
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
  doublesCount = 0;
  extraRoll = false;
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
  /** Summary counters per player (see PlayerStats); created lazily by stat(). */
  stats: Record<string, PlayerStats> = {};
  startedAt: number;
  endedAt: number | null = null;
  private minigameSeq = 0;
  private minigamesEnabled: () => boolean;
  private cardSeq = 0;
  private tradeSeq = 0;
  private onLog?: (text: string) => void;
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

  /**
   * What a player is worth if they sold up now: cash, plus each deed's
   * mortgage value (nothing for one already mortgaged), plus buildings at
   * the half price the bank pays back. Bankrupt players are worth nothing.
   */
  netWorth(id: string): number {
    const p = this.player(id);
    if (p.bankrupt) return 0;
    return p.cash + this.ownedBy(p.id).reduce((a, i) => {
      const s = this.spaces[i], o = this.owned[i];
      return a + (o.mortgaged ? 0 : mortgageValue(s)) + Math.floor((s.houseCost ?? 0) / 2) * o.houses;
    }, 0);
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

  /** Pay now if possible; otherwise record a debt the payer must settle. */
  private charge(from: PlayerState, to: PlayerState | null, amount: number, reason: string, toPot = false) {
    if (amount <= 0) return;
    if (from.cash >= amount) {
      from.cash -= amount;
      if (to) to.cash += amount;
      // Counted when the money moves (now, or later via payDebt with the same
      // reason), so rent that ended in bankruptcy is not credited.
      if (to && reason.startsWith(RENT_REASON)) {
        this.stat(to.id).rentCollected += amount;
        const payer = this.stat(from.id);
        payer.biggestRentPaid = Math.max(payer.biggestRentPaid, amount);
      }
      else if (toPot && this.rules.freeParkingPot) this.pot += amount;
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
      p.cash += pay;
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
        p.cash += e.amount;
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
      this.nextTurn();
      return;
    }
    this.phase = this.extraRoll && !this.current.inJail ? 'roll' : 'done';
  }

  private nextTurn() {
    if (this.checkWinner()) return;
    this.doublesCount = 0;
    this.extraRoll = false;
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

  apply(playerId: string, a: Action): void {
    if (this.phase === 'over') fail('The game is over');
    const p = this.player(playerId);
    if (p.bankrupt) fail('You are out of the game');
    switch (a.type) {
      case 'roll': return this.roll(p);
      case 'buy': return this.buy(p);
      case 'decline': return this.decline(p);
      case 'bid': return this.bid(p, a.amount);
      case 'pass': return this.pass(p);
      case 'endTurn': return this.endTurn(p);
      case 'payJail': return this.payJail(p);
      case 'useJailCard': return this.useJailCard(p);
      case 'build': return this.build(p, a.space);
      case 'sell': return this.sell(p, a.space);
      case 'mortgage': return this.mortgage(p, a.space);
      case 'unmortgage': return this.unmortgage(p, a.space);
      case 'payDebt': return this.payDebt(p);
      case 'bankrupt': return this.goBankrupt(p);
      case 'proposeTrade': return this.proposeTrade(p, a.to, a.give, a.get, a.counterOf);
      case 'acceptTrade': return this.acceptTrade(p, a.id);
      case 'rejectTrade': return this.rejectTrade(p, a.id);
      case 'minigame': return this.minigameMove(p, a.move);
      default: fail('Unknown action');
    }
  }

  private requireTurn(p: PlayerState, phase: TurnPhase) {
    if (p !== this.current) fail('Not your turn');
    if (this.phase !== phase) fail(`Can't do that now (${this.phase})`);
  }

  private roll(p: PlayerState) {
    this.requireTurn(p, 'roll');
    if (this.debtOf(p.id) > 0) fail('Settle your debts first');
    const d: [number, number] = [this.die(), this.die()];
    this.dice = d;
    this.rollSeq++;
    const total = d[0] + d[1];
    const doubles = d[0] === d[1];
    this.say(`${p.name} rolled ${d[0]} + ${d[1]}${doubles ? ' (doubles)' : ''}.`, p.id);
    this.extraRoll = false;

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
        this.charge(p, null, this.rules.jailFine, 'jail fine', true);
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
    this.moveBy(p, total);
    this.resolveLanding(p);
    if (this.phase === 'done') this.afterResolution();
  }

  private buy(p: PlayerState) {
    this.requireTurn(p, 'buy');
    const s = this.spaces[p.position];
    const price = s.price ?? 0;
    if (p.cash < price) fail('Not enough cash — auction it or raise funds');
    p.cash -= price;
    this.owned[p.position] = { owner: p.id, houses: 0, mortgaged: false };
    this.stat(p.id).propertiesBought++;
    this.say(`${p.name} bought ${s.name} for ${this.money(price)}.`, p.id);
    this.afterResolution();
  }

  private decline(p: PlayerState) {
    this.requireTurn(p, 'buy');
    const s = this.spaces[p.position];
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
    };
    this.phase = 'auction';
    this.say(`${s.name} is up for auction!`);
  }

  private bid(p: PlayerState, amount: number) {
    const a = this.auction;
    if (this.phase !== 'auction' || !a) fail('No auction running');
    if (!a.bidders.includes(p.id)) fail('You have left this auction');
    if (!Number.isInteger(amount) || amount <= a.highBid) fail(`Bid more than ${this.money(a.highBid)}`);
    if (amount > p.cash) fail('You cannot bid more than your cash');
    a.highBid = amount;
    a.highBidder = p.id;
    a.endsAt = Math.max(a.endsAt, this.now() + AUCTION_EXTEND_MS);
    this.say(`${p.name} bid ${this.money(amount)}.`, p.id);
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
      a.highBidder = null;
      a.highBid = 0;
    }
    if (a.bidders.length === 0 || (a.bidders.length === 1 && a.highBidder === a.bidders[0])) {
      this.finishAuction();
    }
  }

  /** Called by the room when the auction clock runs out. */
  auctionTimeout(): boolean {
    if (!this.auction || this.now() < this.auction.endsAt) return false;
    this.finishAuction();
    return true;
  }

  private finishAuction() {
    const a = this.auction!;
    const s = this.spaces[a.space];
    this.auction = null;
    if (a.highBidder) {
      const w = this.player(a.highBidder);
      w.cash -= a.highBid;
      this.owned[a.space] = { owner: w.id, houses: 0, mortgaged: false };
      this.stat(w.id).propertiesBought++;
      this.say(`${w.name} won ${s.name} for ${this.money(a.highBid)}.`, w.id);
    } else {
      this.say(`Nobody bid on ${s.name}.`);
    }
    this.afterResolution();
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
    if (p.cash < this.rules.jailFine) fail('Not enough cash');
    this.charge(p, null, this.rules.jailFine, 'jail fine', true);
    this.leaveJail(p);
  }

  private useJailCard(p: PlayerState) {
    this.requireTurn(p, 'roll');
    if (!p.inJail) fail('You are not in jail');
    const deck = p.jailCards.pop() ?? fail('You have no Get Out of Jail Free card');
    const cards = deck === 'chance' ? this.theme.chance : this.theme.chest;
    const idx = cards.findIndex(c => c.effect.type === 'jailFree');
    this.decks[deck].push(idx);
    this.leaveJail(p);
    this.say(`${p.name} used a Get Out of Jail Free card.`, p.id);
  }

  private requireOwn(p: PlayerState, space: number): { s: SpaceDef; o: OwnedSpace } {
    const o = this.owned[space];
    if (!o || o.owner !== p.id) fail('You do not own that');
    if (this.phase === 'auction') fail('Wait for the auction to finish');
    if (this.phase === 'minigame') fail('Wait for the mini-game to finish');
    return { s: this.spaces[space], o };
  }

  canBuild(id: string, space: number): string | null {
    const s = this.spaces[space];
    const o = this.owned[space];
    if (!o || o.owner !== id) return 'You do not own that';
    if (s.kind !== 'property') return 'Only coloured properties take houses';
    if (!this.ownsGroup(id, s.group!)) return 'You need the whole colour group';
    const grp = groupIndices(this.spaces, s.group!);
    if (grp.some(i => this.owned[i].mortgaged)) return 'Lift the mortgages in this group first';
    if (o.houses >= 5) return 'Already has a hotel';
    if (this.rules.evenBuild && o.houses > Math.min(...grp.map(i => this.owned[i].houses))) return 'Build evenly across the group';
    if (this.player(id).cash < s.houseCost!) return 'Not enough cash';
    if (this.rules.limitedBuildings) {
      if (o.houses === 4 && this.hotelsLeft === 0) return 'The bank is out of hotels';
      if (o.houses < 4 && this.housesLeft === 0) return 'The bank is out of houses';
    }
    return null;
  }

  private build(p: PlayerState, space: number) {
    const { s, o } = this.requireOwn(p, space);
    const why = this.canBuild(p.id, space);
    if (why) fail(why);
    p.cash -= s.houseCost!;
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
    const { s, o } = this.requireOwn(p, space);
    if (o.houses === 0) fail('Nothing to sell');
    const grp = groupIndices(this.spaces, s.group!);
    if (this.rules.evenBuild && o.houses < Math.max(...grp.map(i => this.owned[i].houses))) fail('Sell evenly across the group');
    let newLevel = o.houses - 1;
    if (o.houses === 5) {
      this.hotelsLeft++;
      // Breaking a hotel needs four houses back from the bank; with fewer, the
      // property drops to whatever the bank can supply.
      const back = this.rules.limitedBuildings ? Math.min(4, this.housesLeft) : 4;
      newLevel = back;
      this.housesLeft -= back;
    } else {
      this.housesLeft++;
    }
    const refund = Math.floor(s.houseCost! / 2) * (o.houses - newLevel);
    o.houses = newLevel;
    p.cash += refund;
    this.say(`${p.name} sold a building on ${s.name} for ${this.money(refund)}.`, p.id);
  }

  private mortgage(p: PlayerState, space: number) {
    const { s, o } = this.requireOwn(p, space);
    if (o.mortgaged) fail('Already mortgaged');
    if (this.groupHasBuildings(s.group)) fail('Sell the buildings in this group first');
    o.mortgaged = true;
    p.cash += mortgageValue(s);
    this.say(`${p.name} mortgaged ${s.name} for ${this.money(mortgageValue(s))}.`, p.id);
  }

  private unmortgage(p: PlayerState, space: number) {
    const { s, o } = this.requireOwn(p, space);
    if (!o.mortgaged) fail('Not mortgaged');
    const cost = unmortgageCost(s);
    if (p.cash < cost) fail('Not enough cash');
    p.cash -= cost;
    o.mortgaged = false;
    this.say(`${p.name} lifted the mortgage on ${s.name} for ${this.money(cost)}.`, p.id);
  }

  private payDebt(p: PlayerState) {
    const mine = this.debts.filter(d => d.from === p.id);
    if (!mine.length) fail('You owe nothing');
    const total = mine.reduce((a, d) => a + d.amount, 0);
    if (p.cash < total) fail(`You need ${this.money(total - p.cash)} more`);
    this.debts = this.debts.filter(d => d.from !== p.id);
    for (const d of mine) this.charge(p, d.to ? this.player(d.to) : null, d.amount, d.reason, d.toPot);
  }

  /** Voluntary resignation or failure to pay. */
  private goBankrupt(p: PlayerState) {
    const mine = this.debts.filter(d => d.from === p.id);
    const creditors = new Set(mine.map(d => d.to));
    const creditorId = creditors.size === 1 ? [...creditors][0] : null;
    const creditor = creditorId ? this.player(creditorId) : null;
    this.debts = this.debts
      .filter(d => d.from !== p.id)
      .map(d => (d.to === p.id ? { ...d, to: null } : d));
    this.trades = this.trades.filter(t => t.from !== p.id && t.to !== p.id);

    // Buildings go back to the bank at half price either way.
    let buildingCash = 0;
    for (const i of this.ownedBy(p.id)) {
      const o = this.owned[i];
      if (o.houses > 0) {
        buildingCash += Math.floor(this.spaces[i].houseCost! / 2) * o.houses;
        if (o.houses === 5) this.hotelsLeft++;
        else this.housesLeft += o.houses;
        o.houses = 0;
      }
    }

    if (creditor) {
      creditor.cash += p.cash + buildingCash;
      for (const i of this.ownedBy(p.id)) this.owned[i].owner = creditor.id;
      creditor.jailCards.push(...p.jailCards);
      this.say(`${p.name} went bankrupt — everything goes to ${creditor.name}.`, p.id);
    } else {
      for (const i of this.ownedBy(p.id)) delete this.owned[i];
      for (const deck of p.jailCards) {
        const cards = deck === 'chance' ? this.theme.chance : this.theme.chest;
        this.decks[deck].push(cards.findIndex(c => c.effect.type === 'jailFree'));
      }
      this.say(`${p.name} went bankrupt — their property returns to the bank.`, p.id);
    }
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
    if (p === this.current) this.nextTurn();
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
    this.validateSide(p, give);
    this.validateSide(to, get);
    if (original) this.trades = this.trades.filter(t => t !== original);
    const t: Trade = { id: `t${++this.tradeSeq}`, from: p.id, to: to.id, give, get };
    this.trades.push(t);
    this.say(original ? `${p.name} countered ${to.name}'s offer.` : `${p.name} offered ${to.name} a trade.`, p.id);
  }

  private acceptTrade(p: PlayerState, id: string) {
    const t = this.trades.find(x => x.id === id) ?? fail('That offer is gone');
    if (t.to !== p.id) fail('That offer is not for you');
    if (this.phase === 'auction') fail('Wait for the auction to finish');
    if (this.phase === 'minigame') fail('Wait for the mini-game to finish');
    const from = this.player(t.from);
    this.validateSide(from, t.give);
    this.validateSide(p, t.get);
    this.trades = this.trades.filter(x => x.id !== id);
    this.transfer(from, p, t.give);
    this.transfer(p, from, t.get);
    this.say(`${p.name} accepted ${from.name}'s trade.`, p.id);
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
    if (!mg || this.phase !== 'minigame') return null;
    return mg.stage === 'result' ? mg.resultEndsAt : MINIGAMES[mg.kind].deadline(mg.data);
  }

  /** Called by the room when a mini-game deadline passes. True if anything changed. */
  minigameTimeout(): boolean {
    const mg = this.minigame;
    const due = this.minigameDeadline();
    if (!mg || due === null || this.now() < due) return false;
    if (mg.stage === 'result') {
      this.finishMinigame();
      return true;
    }
    const def = MINIGAMES[mg.kind];
    def.tick(mg.data, this.minigameCtx());
    if (def.done(mg.data)) this.settleMinigame();
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
        p.cash += po.amount;
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

  // ---- views ----------------------------------------------------------------

  snapshot(): GameSnapshot {
    return structuredClone({
      players: this.players, owned: this.owned, currentIdx: this.currentIdx, phase: this.phase,
      dice: this.dice, rollSeq: this.rollSeq, doublesCount: this.doublesCount, extraRoll: this.extraRoll,
      debts: this.debts, auction: this.auction, trades: this.trades, pot: this.pot,
      housesLeft: this.housesLeft, hotelsLeft: this.hotelsLeft, lastCard: this.lastCard,
      winner: this.winner, log: this.log, turnNumber: this.turnNumber, decks: this.decks,
      cardSeq: this.cardSeq, tradeSeq: this.tradeSeq, outOrder: this.outOrder,
      minigame: this.minigame, minigameSeq: this.minigameSeq, savedAt: this.now(),
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
    g.stats ??= {};
    // Older snapshots: the game began at some unknown time; "now" is the honest floor.
    g.startedAt ??= g.now();
    g.endedAt ??= null;
    g.onLog = init.onLog;
    // An auction's clock is wall time; give bidders a fresh window after a restart.
    if (g.auction) g.auction.endsAt = g.now() + AUCTION_MS;
    // A mini-game resumes where it stood: every timer moves on by the downtime.
    const mg = g.minigame;
    const down = savedAt === undefined ? 0 : g.now() - savedAt;
    if (mg && down > 0) {
      if (mg.stage === 'result') mg.resultEndsAt += down;
      else MINIGAMES[mg.kind].shift(mg.data, down);
    }
    return g;
  }

  /** Final standings: winner (or richest survivors), then last-out to first-out. */
  standings(): { id: string; netWorth: number }[] {
    const alive = this.active().sort((a, b) => this.netWorth(b.id) - this.netWorth(a.id));
    const out = [...this.outOrder].reverse().map(id => this.player(id));
    return [...alive, ...out].map(p => ({ id: p.id, netWorth: this.netWorth(p.id) }));
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
      netWorth: Object.fromEntries(this.players.map(p => [p.id, this.netWorth(p.id)])),
      // Every player gets a row, even one nothing has happened to yet.
      stats: Object.fromEntries(this.players.map(p => [p.id, { ...NO_STATS, ...this.stats[p.id] }])),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      outOrder: this.outOrder,
    });
  }
}
