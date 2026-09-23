// The game as a pure state machine: no timers, no sockets, no Math.random.
// Randomness and the clock are injected so tests can replay any game exactly.
// Rooms own pacing (auction deadlines, bots); this file owns the rules.

import {
  BOARD_SIZE, JAIL_INDEX, groupIndices, isOwnable, mortgageValue,
  unmortgageCost, type SpaceDef,
} from '../../../shared/board.ts';
import type { CardEffect, DeckId } from '../../../shared/cards.ts';
import type { RuleConfig, Theme } from '../../../shared/themes.ts';
import type {
  Action, Auction, CardShown, Debt, GameView, LogEntry, OwnedSpace, PlayerState, TokenId,
  Trade, TradeSide, TurnPhase,
} from '../../../shared/types.ts';

export class EngineError extends Error {}

export const AUCTION_MS = 12_000;
/** Each bid guarantees at least this long for someone to respond. */
export const AUCTION_EXTEND_MS = 6_000;
const MAX_LOG = 250;
const MAX_OPEN_TRADES = 5;

export type Rng = (n: number) => number; // integer in [0, n)

export interface NewPlayer {
  id: string;
  name: string;
  token: TokenId;
  color: string;
  isBot: boolean;
}

export interface GameInit {
  theme: Theme;
  rules: RuleConfig;
  players: NewPlayer[];
  rng?: Rng;
  now?: () => number;
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
  private cardSeq = 0;
  private tradeSeq = 0;
  private rng: Rng;
  private now: () => number;

  constructor(init: GameInit) {
    if (init.players.length < 2) fail('Need at least 2 players');
    this.theme = init.theme;
    this.rules = init.rules;
    this.spaces = init.theme.spaces;
    this.rng = init.rng ?? (n => Math.floor(Math.random() * n));
    this.now = init.now ?? Date.now;
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
    if (target >= BOARD_SIZE) {
      const landedOnGo = target % BOARD_SIZE === 0;
      const pay = this.rules.goSalary * (landedOnGo && this.rules.doubleOnGo ? 2 : 1);
      p.cash += pay;
      this.say(`${p.name} ${landedOnGo ? 'landed on' : 'passed'} ${this.spaces[0].name} and collected ${this.money(pay)}.`, p.id);
    }
    p.position = target % BOARD_SIZE;
  }

  private advanceTo(p: PlayerState, to: number) {
    const steps = (to - p.position + BOARD_SIZE) % BOARD_SIZE;
    this.moveBy(p, steps === 0 ? BOARD_SIZE : steps);
  }

  private sendToJail(p: PlayerState) {
    p.position = JAIL_INDEX;
    p.inJail = true;
    p.jailTurns = 0;
    this.doublesCount = 0;
    if (p === this.current) this.extraRoll = false;
    this.say(`${p.name} was sent to ${this.spaces[JAIL_INDEX].name}!`, p.id);
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
      this.charge(p, this.player(o.owner), rent, `rent on ${s.name}`);
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
    const text = card.text.replaceAll('$', this.theme.currency);
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
        let i = p.position;
        do i = (i + 1) % BOARD_SIZE; while (this.spaces[i].kind !== e.kind);
        this.advanceTo(p, i);
        this.resolveLanding(p, e.kind === 'railroad' ? { railroadMultiplier: 2 } : { utilityTenX: true });
        break;
      }
      case 'back':
        p.position = (p.position - e.steps + BOARD_SIZE) % BOARD_SIZE;
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
      this.auction = null;
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
      case 'proposeTrade': return this.proposeTrade(p, a.to, a.give, a.get);
      case 'acceptTrade': return this.acceptTrade(p, a.id);
      case 'rejectTrade': return this.rejectTrade(p, a.id);
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

    if (this.checkWinner()) return;
    if (this.auction) {
      this.leaveAuction(p.id); // may finish the auction, which advances the turn if p was current
      return;
    }
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

  private proposeTrade(p: PlayerState, toId: string, give: TradeSide, get: TradeSide) {
    const to = this.player(toId);
    if (to === p) fail('You cannot trade with yourself');
    if (to.bankrupt) fail('That player is out');
    if (this.trades.filter(t => t.from === p.id).length >= MAX_OPEN_TRADES) fail('Too many open offers');
    const empty = (s: TradeSide) => !s.cash && !s.spaces.length && !s.jailCards;
    if (empty(give) && empty(get)) fail('Empty trade');
    this.validateSide(p, give);
    this.validateSide(to, get);
    const t: Trade = { id: `t${++this.tradeSeq}`, from: p.id, to: to.id, give, get };
    this.trades.push(t);
    this.say(`${p.name} offered ${to.name} a trade.`, p.id);
  }

  private acceptTrade(p: PlayerState, id: string) {
    const t = this.trades.find(x => x.id === id) ?? fail('That offer is gone');
    if (t.to !== p.id) fail('That offer is not for you');
    if (this.phase === 'auction') fail('Wait for the auction to finish');
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

  // ---- views ----------------------------------------------------------------

  view(): GameView {
    return structuredClone({
      themeId: this.theme.id,
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
    });
  }
}
