import type { ActionType, CardT, Street } from '../../../shared/types.ts';
import { shuffledDeck } from './cards.ts';
import { evaluate7, handName } from './evaluator.ts';

export interface HandSeat {
  seat: number; // table seat index
  id: string;
  stack: number; // live stack during the hand
  cards: [CardT, CardT];
  committed: number; // chips in front this street (bet-matching)
  totalCommitted: number; // total chips put in this hand (incl. antes)
  folded: boolean;
  allIn: boolean;
  lastAction: string | null;
  hasActedThisRound: boolean;
}

export interface HandAward {
  seat: number;
  id: string;
  amount: number;
  score: number | null;
  handName: string | null;
  split: boolean; // this award came from a pot shared between multiple winners
}

export interface HandResult {
  awards: HandAward[];
  revealSeats: number[]; // seats whose cards should be shown
  wentToShowdown: boolean;
}

export interface HandOptions {
  players: { seat: number; id: string; stack: number }[]; // ordered by seat index, all with stack > 0
  buttonSeat: number; // must be one of players' seats
  sb: number;
  bb: number;
  ante: number;
  deck?: CardT[]; // injectable for tests
  // The most of their own remaining stack a player may put in with a single
  // voluntary bet or raise, as a fraction. 1 is normal No-Limit. A tournament
  // running the opening half-stack cap deals its hands with 0.5.
  //
  // Decided once, when the hand is dealt, rather than read per action: a hand
  // that begins under the cap plays out under the cap, so the rules cannot
  // change between the flop and the river of the same pot.
  maxBetFraction?: number;
}

export interface LegalActionInfo {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  toCall: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  // True when maxRaiseTo is the tournament's opening bet cap rather than this
  // player's all-in. The client needs to tell the two apart: a slider that
  // tops out short is a rule, not a bug, and the button there must not say
  // "All-in" when chips would remain behind.
  capped: boolean;
  pot: number;
  myBet: number; // chips the actor already has in this street
}

// A single No-Limit Hold'em hand. Pure state machine — no timers, no I/O.
export class HoldemHand {
  seats: HandSeat[] = []; // in seat order
  buttonSeat: number;
  sb: number;
  bb: number;
  ante: number;
  street: Street = 'preflop';
  board: CardT[] = [];
  deck: CardT[];

  currentBet = 0; // amount each active player must match this street
  lastFullRaiseIncrement = 0;
  actionIdx: number | null = null; // index into this.seats
  finished = false;
  result: HandResult | null = null;
  // Set when everyone remaining is all-in: table should pace out remaining streets.
  runoutPending = false;
  // See HandOptions.maxBetFraction. 1 means no cap and every path below
  // behaves exactly as it did before the cap existed.
  readonly maxBetFraction: number;

  constructor(opts: HandOptions) {
    if (opts.players.length < 2) throw new Error('need at least 2 players');
    this.buttonSeat = opts.buttonSeat;
    this.sb = opts.sb;
    this.bb = opts.bb;
    this.ante = opts.ante;
    // Clamped rather than trusted: a fraction outside (0, 1] would either
    // forbid every bet or hand out chips nobody has.
    this.maxBetFraction = Math.min(1, Math.max(0.01, opts.maxBetFraction ?? 1));
    this.deck = opts.deck ? [...opts.deck] : shuffledDeck();

    for (const p of opts.players) {
      const cards: [CardT, CardT] = [this.deck.pop()!, this.deck.pop()!];
      this.seats.push({
        seat: p.seat, id: p.id, stack: p.stack, cards,
        committed: 0, totalCommitted: 0, folded: false, allIn: false,
        lastAction: null, hasActedThisRound: false,
      });
    }
    this.postForcedBets();
  }

  // ---------- helpers ----------
  private idxOfSeat(seat: number): number {
    return this.seats.findIndex(s => s.seat === seat);
  }

  private nextIdxFrom(idx: number, pred: (s: HandSeat) => boolean): number | null {
    const n = this.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (idx + k) % n;
      if (pred(this.seats[i])) return i;
    }
    return null;
  }

  private live(s: HandSeat) { return !s.folded; }
  private canAct(s: HandSeat) { return !s.folded && !s.allIn; }

  get totalPot(): number {
    return this.seats.reduce((a, s) => a + s.totalCommitted, 0);
  }

  actionSeat(): number | null {
    return this.actionIdx === null ? null : this.seats[this.actionIdx].seat;
  }

  private commit(s: HandSeat, amount: number, isAnte = false) {
    const amt = Math.min(amount, s.stack);
    s.stack -= amt;
    if (!isAnte) s.committed += amt;
    s.totalCommitted += amt;
    if (s.stack === 0) s.allIn = true;
  }

  private postForcedBets() {
    const n = this.seats.length;
    const btnIdx = this.idxOfSeat(this.buttonSeat);
    // Antes first.
    if (this.ante > 0) for (const s of this.seats) this.commit(s, this.ante, true);

    let sbIdx: number, bbIdx: number, firstIdx: number;
    if (n === 2) {
      // Heads-up: button posts SB and acts first preflop.
      sbIdx = btnIdx;
      bbIdx = (btnIdx + 1) % n;
      firstIdx = sbIdx;
    } else {
      sbIdx = (btnIdx + 1) % n;
      bbIdx = (btnIdx + 2) % n;
      firstIdx = (bbIdx + 1) % n;
    }
    this.commit(this.seats[sbIdx], this.sb);
    this.seats[sbIdx].lastAction = 'SB';
    this.commit(this.seats[bbIdx], this.bb);
    this.seats[bbIdx].lastAction = 'BB';

    this.currentBet = this.bb;
    this.lastFullRaiseIncrement = this.bb;

    // First to act: next player who can act.
    const start = this.nextIdxFrom((firstIdx - 1 + n) % n, s => this.canAct(s));
    this.actionIdx = start;
    if (this.actionIdx === null) {
      // Everyone all-in from blinds/antes.
      this.checkRoundEnd(true);
    } else {
      // Edge: if no one can raise/call (all others all-in) betting may already be closed.
      this.maybeShortCircuit();
    }
  }

  // If fewer than 2 players can act and bets are settled, betting is over.
  private maybeShortCircuit() {
    const actors = this.seats.filter(s => this.canAct(s));
    const unsettled = actors.some(s => s.committed < this.currentBet);
    if (actors.length === 0 || (actors.length === 1 && !unsettled && this.streetHasNoPendingAction(actors[0]))) {
      this.closeStreet();
    }
  }

  private streetHasNoPendingAction(lone: HandSeat): boolean {
    // A lone actor still gets to act if there's an outstanding bet to respond to
    // or they haven't had a chance to act this street (e.g. BB option).
    if (lone.committed < this.currentBet) return false;
    if (!lone.hasActedThisRound && this.street === 'preflop' && this.currentBet === this.bb) {
      // BB option only matters if someone else is still in — vs all-in shorter stacks it's moot
      // when their all-in is below the BB. Give the option only if an opponent matched exactly.
      return !this.seats.some(s => s !== lone && !s.folded && s.committed === this.currentBet);
    }
    return lone.hasActedThisRound || this.currentBet === 0 ? true : lone.committed >= this.currentBet;
  }

  legalActions(): LegalActionInfo | null {
    if (this.finished || this.actionIdx === null) return null;
    const s = this.seats[this.actionIdx];
    const toCall = Math.min(this.currentBet - s.committed, s.stack);
    const canCheck = toCall === 0;
    // Min raise-to: currentBet + last full raise increment (or BB when no bet yet).
    const minTo = this.currentBet === 0
      ? Math.max(this.bb, 1)
      : this.currentBet + this.lastFullRaiseIncrement;
    const allInTo = s.committed + s.stack;
    // The cap limits the chips a player VOLUNTEERS, so it is a fraction of
    // what is still behind — not of the pot, and not of what they have
    // already been forced to put in as a blind or an ante this hand.
    const capTo = s.committed + Math.floor(s.stack * this.maxBetFraction);
    const maxTo = Math.min(allInTo, capTo);
    const capped = maxTo < allInTo;
    // Under the cap a raise must still reach the legal minimum. Without this
    // clause a capped player could make an underraise that No-Limit only
    // permits as an all-in — and theirs is not one, since chips remain behind.
    const canRaise = maxTo > this.currentBet
      && toCall < s.stack
      && (!capped || maxTo >= minTo);
    return {
      seat: s.seat,
      canFold: toCall > 0,
      canCheck,
      // Calling is never capped: the cap exists to stop players volunteering
      // their stack early, and forbidding a call would leave someone facing a
      // legal bet they are not allowed to answer.
      toCall,
      canRaise,
      minRaiseTo: Math.min(minTo, maxTo),
      maxRaiseTo: maxTo,
      capped,
      pot: this.totalPot,
      myBet: s.committed,
    };
  }

  // Apply an action for the seat currently on action. Throws on illegal input.
  act(seat: number, type: ActionType, amount?: number) {
    if (this.finished) throw new Error('hand finished');
    if (this.actionIdx === null) throw new Error('no action pending');
    const s = this.seats[this.actionIdx];
    if (s.seat !== seat) throw new Error('not your turn');
    const legal = this.legalActions()!;

    switch (type) {
      case 'fold': {
        s.folded = true;
        s.lastAction = 'Fold';
        break;
      }
      case 'check': {
        if (!legal.canCheck) throw new Error('cannot check');
        s.lastAction = 'Check';
        break;
      }
      case 'call': {
        if (legal.toCall <= 0) { s.lastAction = 'Check'; break; }
        this.commit(s, legal.toCall);
        s.lastAction = s.allIn ? 'All-in' : 'Call';
        break;
      }
      case 'allin': {
        amount = legal.maxRaiseTo;
        // fallthrough to raise/bet handling
      }
      // eslint-disable-next-line no-fallthrough
      case 'bet':
      case 'raise': {
        if (!legal.canRaise && (amount ?? 0) > this.currentBet) throw new Error('cannot raise');
        const target = Math.min(Math.max(amount ?? 0, 0), legal.maxRaiseTo);
        if (target <= this.currentBet) {
          // Treat as call (covers all-in below current bet).
          this.commit(s, legal.toCall);
          s.lastAction = s.allIn ? 'All-in' : 'Call';
          break;
        }
        // Against the real all-in figure, not legal.maxRaiseTo, which the cap
        // may have lowered. Getting this wrong would treat a capped half-stack
        // raise as an all-in and wave it past the minimum-raise check.
        const isAllIn = target === s.committed + s.stack;
        if (target < legal.minRaiseTo && !isAllIn) throw new Error('raise below minimum');
        const increment = target - this.currentBet;
        this.commit(s, target - s.committed);
        const fullRaise = increment >= this.lastFullRaiseIncrement;
        if (fullRaise) {
          this.lastFullRaiseIncrement = increment;
          // Full raise reopens action for everyone.
          for (const o of this.seats) if (o !== s) o.hasActedThisRound = false;
        }
        this.currentBet = target;
        s.lastAction = s.allIn ? 'All-in' : (this.street === 'preflop' || this.currentBet > 0 ? `Raise ${target}` : `Bet ${target}`);
        if (this.currentBet === target && this.street !== 'preflop' && increment === target) s.lastAction = s.allIn ? 'All-in' : `Bet ${target}`;
        break;
      }
      default:
        throw new Error(`unknown action ${type}`);
    }

    s.hasActedThisRound = true;
    this.advanceAction();
  }

  // Fold/check for a timed-out player.
  autoAct(seat: number) {
    const legal = this.legalActions();
    if (!legal || legal.seat !== seat) return;
    this.act(seat, legal.canCheck ? 'check' : 'fold');
  }

  private advanceAction() {
    // Hand over if one player left.
    const liveSeats = this.seats.filter(s => this.live(s));
    if (liveSeats.length === 1) {
      this.finishFold(liveSeats[0]);
      return;
    }
    this.checkRoundEnd(false);
  }

  private roundSettled(): boolean {
    const actors = this.seats.filter(s => this.canAct(s));
    if (actors.length === 0) return true;
    return actors.every(s => s.hasActedThisRound && s.committed === this.currentBet)
      || (actors.length === 1 && actors[0].committed >= this.currentBet && actors[0].hasActedThisRound);
  }

  private checkRoundEnd(fromForced: boolean) {
    if (this.roundSettled()) {
      this.closeStreet();
      return;
    }
    // Move action to next player who can act and either hasn't acted or hasn't matched.
    const cur = this.actionIdx ?? this.idxOfSeat(this.buttonSeat);
    const next = this.nextIdxFrom(cur, s =>
      this.canAct(s) && (!s.hasActedThisRound || s.committed < this.currentBet));
    if (next === null) {
      this.closeStreet();
    } else {
      this.actionIdx = next;
    }
    void fromForced;
  }

  private closeStreet() {
    // Collect street bets (they stay in totalCommitted); reset per-street state.
    for (const s of this.seats) {
      s.committed = 0;
      s.hasActedThisRound = false;
      if (!s.folded && !s.allIn) s.lastAction = null;
    }
    this.currentBet = 0;
    this.lastFullRaiseIncrement = this.bb;
    this.actionIdx = null;

    const actors = this.seats.filter(s => this.canAct(s));
    const live = this.seats.filter(s => this.live(s));

    if (live.length === 1) { this.finishFold(live[0]); return; }

    if (this.street === 'river') { this.finishShowdown(); return; }

    if (actors.length <= 1) {
      // All-in situation: table paces the runout by calling dealNextStreet repeatedly.
      this.runoutPending = true;
      return;
    }

    this.dealNextStreetInternal();
    // Post-flop action starts left of button.
    const btnIdx = this.idxOfSeat(this.buttonSeat);
    this.actionIdx = this.nextIdxFrom(btnIdx, s => this.canAct(s));
    if (this.actionIdx === null) this.closeStreet();
  }

  private dealNextStreetInternal() {
    if (this.street === 'preflop') {
      this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
      this.street = 'flop';
    } else if (this.street === 'flop') {
      this.board.push(this.deck.pop()!);
      this.street = 'turn';
    } else if (this.street === 'turn') {
      this.board.push(this.deck.pop()!);
      this.street = 'river';
    }
  }

  // For all-in runouts: deal one street. Returns false when showdown reached.
  // Rabbit hunting: the board cards that *would* have come had the hand run
  // to the river. Read-only peek — the deck is not consumed.
  peekRunout(): CardT[] {
    const need = 5 - this.board.length;
    if (need <= 0) return [];
    const out: CardT[] = [];
    for (let i = 0; i < need && i < this.deck.length; i++) {
      out.push(this.deck[this.deck.length - 1 - i]);
    }
    return out;
  }

  dealRunoutStep(): boolean {
    if (!this.runoutPending || this.finished) return false;
    if (this.street === 'river') {
      this.finishShowdown();
      return false;
    }
    this.dealNextStreetInternal();
    return true;
  }

  private finishFold(winner: HandSeat) {
    const pot = this.totalPot;
    winner.stack += pot;
    this.finished = true;
    this.actionIdx = null;
    this.result = {
      awards: [{ seat: winner.seat, id: winner.id, amount: pot, score: null, handName: null, split: false }],
      revealSeats: [],
      wentToShowdown: false,
    };
  }

  private finishShowdown() {
    this.street = 'showdown';
    this.finished = true;
    this.actionIdx = null;
    this.runoutPending = false;

    const live = this.seats.filter(s => this.live(s));
    const scores = new Map<number, number>();
    for (const s of live) scores.set(s.seat, evaluate7([...s.cards, ...this.board]));

    // Build side pots from total contributions.
    const contribs = this.seats.map(s => ({ s, amount: s.totalCommitted }));
    const levels = [...new Set(contribs.filter(c => c.amount > 0).map(c => c.amount))].sort((a, b) => a - b);

    const awards = new Map<number, HandAward>();
    const addAward = (seat: HandSeat, amt: number, split: boolean) => {
      const ex = awards.get(seat.seat);
      if (ex) {
        ex.amount += amt;
        ex.split = ex.split || split;
      } else {
        awards.set(seat.seat, {
          seat: seat.seat, id: seat.id, amount: amt,
          score: scores.get(seat.seat) ?? null,
          handName: scores.has(seat.seat) ? handName(scores.get(seat.seat)!) : null,
          split,
        });
      }
    };

    let prev = 0;
    for (const level of levels) {
      // Pot slice: everyone contributes min(total, level) - prev.
      let slice = 0;
      for (const c of contribs) slice += Math.max(0, Math.min(c.amount, level) - prev);
      prev = level;
      if (slice <= 0) continue;

      const eligible = live.filter(s => s.totalCommitted >= level);
      if (eligible.length === 0) continue; // shouldn't happen: live players always at max level
      const bestScore = Math.max(...eligible.map(s => scores.get(s.seat)!));
      const winners = eligible.filter(s => scores.get(s.seat)! === bestScore);
      const base = Math.floor(slice / winners.length);
      let remainder = slice - base * winners.length;

      // Odd chips to earliest winner left of button.
      const ordered = this.orderFromButton(winners);
      const isSplit = winners.length > 1;
      for (const w of ordered) {
        let amt = base;
        if (remainder > 0) { amt += 1; remainder -= 1; }
        if (amt > 0) { w.stack += amt; addAward(w, amt, isSplit); }
      }
    }

    this.result = {
      awards: [...awards.values()],
      revealSeats: live.map(s => s.seat),
      wentToShowdown: true,
    };
  }

  private orderFromButton(subset: HandSeat[]): HandSeat[] {
    const btnIdx = this.idxOfSeat(this.buttonSeat);
    const n = this.seats.length;
    const order: HandSeat[] = [];
    for (let k = 1; k <= n; k++) {
      const s = this.seats[(btnIdx + k) % n];
      if (subset.includes(s)) order.push(s);
    }
    return order;
  }
}
