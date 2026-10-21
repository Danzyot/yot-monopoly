// The card game as a pure state machine, built like the Monopoly engine
// (server/src/engine/game.ts): no timers, no sockets, no Math.random. The
// shuffle and the clock are injected so tests can replay any game exactly;
// rooms own pacing (they arm one timer at clockDeadline() and call
// clockTimeout()), this file owns the rules.
//
// Official rules by default, house rules from CardsRules, and the Chog Chaos
// mode's deck and cards (Purge, Blitz, Gas Spike, Rug Pull, Chog Roulette)
// with the Mercy rule. Every public entry point validates first and only then
// changes state, so a refused action (CardsError) leaves the game exactly as
// it was.

import { CARDS_HAND_SIZE, CARDS_MAX_PLAYERS, CARDS_MERCY_LIMIT, CARDS_MIN_PLAYERS, LAST_CARD_CALL } from '../../../shared/cards/meta.ts';
import {
  CARD_COLORS, COLOR_LABEL, DRAW_VALUE, bestColor, buildDeck, cardName, deckSize, handPoints, isCardColor, isDrawCard, isWild,
  matches, oneAway, sameFace, type Card, type CardColor, type CardKind, type DrawKind,
} from '../../../shared/cards/deck.ts';
import { DEFAULT_CARDS_RULES, normalizeCardsRules, type CardsRules } from '../../../shared/cards/rules.ts';
import type {
  CardsAction, CardsBotLevel, CardsDirection, CardsDrawReason, CardsLogEntry, CardsPhase, CardsPlay,
  CardsRoundResult, CardsStep, CardsView, CardsYouView,
} from '../../../shared/cards/types.ts';

export class CardsError extends Error {}

/** Integer in [0, n). */
export type Rng = (n: number) => number;

/** Consecutive turn timeouts before a player is marked away (autopilot takes over). */
export const AFK_AFTER = 2;
/** A pause ends by itself after this long, so no host can freeze a table for good. */
export const PAUSE_MAX_MS = 5 * 60_000;
/** The break between a round's end and the next deal. */
export const ROUND_BREAK_MS = 8_000;
/** After going down to one card, a player has this long to call before a catch counts. */
export const LAST_CARD_GRACE_MS = 1_000;
/** Phases that belong to the current player (the turn timer runs in these). */
const STEP_PHASES: CardsPhase[] = ['play', 'drawn', 'color', 'swap'];
/** Cards a round may start on; anything else turned up goes back and the pile is reshuffled. */
const START_KINDS = new Set<CardKind>(['number', 'skip', 'reverse', 'draw2', 'wild']);
const MAX_LOG = 250;
const VIEW_LOG = 80;
const MAX_ID_LEN = 64;

export interface CardsNewPlayer {
  id: string;
  name: string;
  isBot: boolean;
  /** Bot skill (bots only); normal when absent. */
  level?: CardsBotLevel;
}

export interface CardsPlayerState extends CardsNewPlayer {
  hand: Card[];
  /** Match points so far. */
  score: number;
  afk?: boolean;
  left?: boolean;
  /** Knocked out of this round by the Mercy rule; `outPoints` is what their hand was worth. */
  out?: boolean;
  outPoints?: number;
}

export interface CardsInit {
  players: CardsNewPlayer[];
  /** Missing fields take the official defaults; bad values are normalised. */
  rules?: Partial<CardsRules>;
  rng?: Rng;
  now?: () => number;
  /** Mirror of every log line, for the durable room log. */
  onLog?: (text: string) => void;
}

/** A Draw penalty waiting on the current player. */
interface PendingDraw {
  amount: number;
  kind: DrawKind;
  from: string;
  /** Draw cards stacked so far (missing in snapshots from before stacks were counted: 1). */
  chain?: number;
  /** A lone Wild Draw Four that may be challenged: was it legal, and what colour it was judged on. Secret. */
  check: { legal: boolean; prevColor: CardColor } | null;
}

/** A player on one card after their own play: their call, and the catch window. */
interface OneCardState {
  since: number;
  calledAt: number | null;
  /** The next player acted (or someone jumped in) before a catch: safe from now on. */
  closedAt: number | null;
}

/** Everything needed to rebuild a game after a restart (see CardsGame.restore). */
export interface CardsSnapshot {
  rules: CardsRules;
  players: CardsPlayerState[];
  pile: Card[];
  discard: Card[];
  color: CardColor | null;
  direction: CardsDirection;
  currentIdx: number;
  dealerIdx: number;
  phase: CardsPhase;
  pending: PendingDraw | null;
  colorFor: ColorFor | null;
  drawnCard: number | null;
  oneCard: Record<string, OneCardState>;
  preCall: string[];
  round: number;
  turn: number;
  stall: number;
  history: CardsRoundResult[];
  winner: string | null;
  lastPlay: CardsPlay | null;
  playSeq: number;
  seq: number;
  log: CardsLogEntry[];
  turnEndsAt: number | null;
  turnKey: string;
  timeoutStreak: Record<string, number>;
  nextRoundAt: number | null;
  paused: { by: string; at: number } | null;
  startedAt: number;
  endedAt: number | null;
  /** Game clock when taken, to carry running deadlines across a restart. */
  savedAt: number;
  /** A Wild Draw Four's legality while its colour is being picked. */
  wild4Check?: PendingDraw['check'];
  /** Knocked out this round by the Mercy rule, in order. */
  knocked?: string[];
}

/** What a colour is being named for (phase 'color'): the start card, or the Wild just played. */
type ColorFor = 'start' | 'wild' | 'wild4' | 'wild6' | 'wild10' | 'roulette';

function fail(msg: string): never {
  throw new CardsError(msg);
}

/** A player id from a client. */
function idArg(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > MAX_ID_LEN) fail('Unknown player');
  return v;
}

export class CardsGame {
  readonly rules: CardsRules;
  players: CardsPlayerState[];
  /** Face down; the top is the last element. */
  pile: Card[] = [];
  /** Face up; the top is the last element. */
  discard: Card[] = [];
  /** The colour in play (a Wild's named colour when one is on top). */
  color: CardColor | null = null;
  direction: CardsDirection = 1;
  currentIdx = 0;
  dealerIdx: number;
  phase: CardsPhase = 'play';
  pending: PendingDraw | null = null;
  /** Phase 'color': what the colour is for. */
  colorFor: ColorFor | null = null;
  /** Phase 'drawn': the id of the card just drawn. */
  drawnCard: number | null = null;
  oneCard: Record<string, OneCardState> = {};
  /** Players who called "Last card!" one play from one card (two cards, or a Purge that leaves one): it counts for that play. */
  preCall: string[] = [];
  /** Knocked out this round by the Mercy rule, in order. */
  knocked: string[] = [];
  round = 0;
  /** Bumps whenever the turn moves on (or a step restarts, like after a caught bluff). */
  turn = 0;
  /** Turns in a row that ended with nothing to play and nothing to draw. */
  private stall = 0;
  history: CardsRoundResult[] = [];
  winner: string | null = null;
  /** What the last action did, step by step (see CardsPlay): clients stage it, rooms time bots by it. */
  lastPlay: CardsPlay | null = null;
  private playSeq = 0;
  /** Steps recorded before the next settle() belong to lastPlay: one action is one play. */
  private playOpen = false;
  /** Bumps on every settled change. */
  seq = 0;
  log: CardsLogEntry[] = [];
  /** Turn timer: deadline for the current player's step, and the step it belongs to. */
  turnEndsAt: number | null = null;
  private turnKey = '';
  private timeoutStreak: Record<string, number> = {};
  nextRoundAt: number | null = null;
  paused: { by: string; at: number } | null = null;
  startedAt: number;
  endedAt: number | null = null;
  private rng: Rng;
  private now: () => number;
  private onLog?: (text: string) => void;

  constructor(init: CardsInit) {
    const n = init.players.length;
    if (n < CARDS_MIN_PLAYERS) fail(`Need at least ${CARDS_MIN_PLAYERS} players`);
    if (n > CARDS_MAX_PLAYERS) fail(`At most ${CARDS_MAX_PLAYERS} players`);
    if (new Set(init.players.map(p => p.id)).size !== n) fail('Duplicate player');
    this.rules = normalizeCardsRules({ ...DEFAULT_CARDS_RULES, ...init.rules });
    this.rng = init.rng ?? (k => Math.floor(Math.random() * k));
    this.now = init.now ?? Date.now;
    this.onLog = init.onLog;
    this.startedAt = this.now();
    this.players = init.players.map(p => ({
      id: p.id, name: p.name, isBot: p.isBot, ...(p.level && { level: p.level }), hand: [], score: 0,
    }));
    // The first dealer sits last, so the first seat plays first.
    this.dealerIdx = n - 1;
    // startRound() gathers and shuffles every card, this first deal included.
    this.pile = buildDeck(this.rules.mode);
    this.startRound();
    this.settle();
  }

  // ---- helpers --------------------------------------------------------------

  get current(): CardsPlayerState {
    return this.players[this.currentIdx];
  }

  get top(): Card | null {
    return this.discard.at(-1) ?? null;
  }

  /** The engine's clock (for bots and rooms timing against it). */
  clock(): number {
    return this.now();
  }

  player(id: string): CardsPlayerState {
    return this.players.find(p => p.id === id) ?? fail('Unknown player');
  }

  /** Every card in this game (the mode's deck). */
  get deckSize(): number {
    return deckSize(this.rules.mode);
  }

  /** Players still at the table. */
  active(): CardsPlayerState[] {
    return this.players.filter(p => !p.left);
  }

  /** Players still in this round: at the table and not knocked out by the Mercy rule. */
  inRound(): CardsPlayerState[] {
    return this.players.filter(p => !p.left && !p.out);
  }

  private livePlayer(id: string): CardsPlayerState {
    const p = this.player(id);
    if (p.left) fail(`${p.name} has left the table`);
    return p;
  }

  /** A player still in the round (a swap partner, someone to catch). */
  private roundPlayer(id: string): CardsPlayerState {
    const p = this.livePlayer(id);
    if (p.out) fail(`${p.name} is out of this round`);
    return p;
  }

  private idx(p: CardsPlayerState): number {
    return this.players.indexOf(p);
  }

  /** The next seat still in the round, `dir` steps around. */
  private nextSeat(from: number, dir: CardsDirection): number {
    const n = this.players.length;
    let i = from;
    do i = (i + dir + n) % n;
    while ((this.players[i].left || this.players[i].out) && i !== from);
    return i;
  }

  /** The next player in the direction of play. */
  private nextIdx(from: number): number {
    return this.nextSeat(from, this.direction);
  }

  /** Who plays after `id` (in the current direction). */
  nextPlayer(id: string): CardsPlayerState {
    return this.players[this.nextIdx(this.idx(this.player(id)))];
  }

  private shuffled<T>(cards: T[]): T[] {
    const a = [...cards];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.rng(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private say(text: string, who?: string, extra: Pick<CardsLogEntry, 'amount' | 'reason'> = {}) {
    const e: CardsLogEntry = { t: this.now(), text, ...(who && { who }), ...extra };
    if (this.playOpen && this.lastPlay) e.play = this.lastPlay.seq;
    this.log.push(e);
    this.onLog?.(text);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  /**
   * Open the play an action records into (once per action). An action by
   * anyone but a one-card player closes that player's catch window: "before
   * the next player acts" means before anyone else does anything at the table.
   * Calls and catches are reactions, not turns, and leave the windows alone.
   */
  private begin(p: CardsPlayerState, closesWindows = true) {
    if (!this.playOpen || this.lastPlay?.player !== p.id) {
      this.lastPlay = { seq: ++this.playSeq, player: p.id, steps: [] };
      this.playOpen = true;
    }
    if (!closesWindows) return;
    const t = this.now();
    for (const [id, oc] of Object.entries(this.oneCard)) {
      if (id !== p.id && oc.calledAt === null && oc.closedAt === null) oc.closedAt = t;
    }
  }

  private step(s: CardsStep) {
    this.lastPlay?.steps.push(s);
  }

  private plural(n: number): string {
    return n === 1 ? 'a card' : `${n} cards`;
  }

  // ---- the piles ------------------------------------------------------------

  /** Draw pile empty: shuffle the discards back under, keeping the top card. False when there is nothing to shuffle. */
  private reshuffle(): boolean {
    if (this.discard.length <= 1) return false;
    const top = this.discard.pop()!;
    this.pile = this.shuffled(this.discard);
    this.discard = [top];
    this.step({ type: 'reshuffle', count: this.pile.length });
    this.say(`The draw pile ran out — ${this.pile.length} discards were shuffled into a new one.`);
    return true;
  }

  /**
   * Move up to `n` cards from the pile to `p`'s hand (reshuffling as needed),
   * stopping early after a card `stopAt` accepts. Records the draw steps
   * (split around any reshuffle, in order) but leaves the log line to the caller.
   */
  private drawCards(p: CardsPlayerState, n: number, reason: CardsDrawReason, stopAt?: (c: Card) => boolean): Card[] {
    const got: Card[] = [];
    let batch: Card[] = [];
    const flush = () => {
      if (batch.length) this.step({ type: 'draw', player: p.id, count: batch.length, reason, cards: batch });
      batch = [];
    };
    while (got.length < n) {
      if (!this.pile.length) {
        flush();
        if (!this.reshuffle()) break;
      }
      const c = this.pile.pop()!;
      p.hand.push(c);
      batch.push(c);
      got.push(c);
      if (stopAt?.(c)) break;
    }
    flush();
    if (got.length) this.stall = 0;
    return got;
  }

  // ---- rounds ---------------------------------------------------------------

  /** Gather every card, shuffle, deal 7 each from the dealer's left, and turn up the start card. */
  private startRound() {
    this.round++;
    if (this.round > 1) this.dealerIdx = this.nextSeat(this.dealerIdx, 1);
    if (this.players[this.dealerIdx].left) this.dealerIdx = this.nextSeat(this.dealerIdx, 1);
    const all = [...this.pile, ...this.discard, ...this.players.flatMap(p => p.hand)];
    for (const p of this.players) {
      p.hand = [];
      delete p.out;
      delete p.outPoints;
    }
    this.knocked = [];
    this.discard = [];
    this.pile = this.shuffled(all);
    this.direction = 1;
    this.pending = null;
    this.colorFor = null;
    this.drawnCard = null;
    this.oneCard = {};
    this.preCall = [];
    this.stall = 0;
    this.nextRoundAt = null;
    this.color = null;
    this.phase = 'play';
    this.turn++;

    const dealer = this.players[this.dealerIdx];
    this.begin(dealer, false);
    const order: CardsPlayerState[] = [];
    for (let i = this.nextSeat(this.dealerIdx, 1); order.length < this.active().length; i = this.nextSeat(i, 1)) {
      order.push(this.players[i]);
    }
    for (let k = 0; k < CARDS_HAND_SIZE; k++) for (const p of order) p.hand.push(this.pile.pop()!);
    this.step({ type: 'deal', round: this.round, dealer: dealer.id, order: order.map(p => p.id), count: CARDS_HAND_SIZE });

    // A Wild Draw Four (or a Chog Chaos card) may not start a round: back in, reshuffle, turn up another.
    let top = this.pile.pop()!;
    while (!START_KINDS.has(top.kind)) {
      this.step({ type: 'flip', card: top, back: true });
      this.say(`A ${cardName(top)} turned up — it goes back and the pile is reshuffled.`);
      this.pile.unshift(top);
      this.pile = this.shuffled(this.pile);
      top = this.pile.pop()!;
    }
    this.discard.push(top);
    this.step({ type: 'flip', card: top });
    this.say(`Round ${this.round} — ${dealer.name} deals ${CARDS_HAND_SIZE} cards each. First card: ${cardName(top)}.`, dealer.id);

    const firstIdx = this.nextSeat(this.dealerIdx, 1);
    const first = this.players[firstIdx];
    this.currentIdx = firstIdx;
    if (top.color) this.color = top.color;
    switch (top.kind) {
      case 'wild':
        this.phase = 'color';
        this.colorFor = 'start';
        this.say(`${first.name} picks the colour to start.`, first.id);
        break;
      case 'skip':
        this.step({ type: 'skip', player: first.id });
        this.say(`${first.name} is skipped.`, first.id);
        this.currentIdx = this.nextIdx(firstIdx);
        break;
      case 'reverse':
        this.direction = -1;
        this.step({ type: 'reverse', direction: -1 });
        this.currentIdx = this.dealerIdx;
        this.say(`Play starts the other way — ${dealer.name} goes first.`, dealer.id);
        break;
      case 'draw2': {
        const got = this.drawCards(first, 2, 'start');
        this.step({ type: 'skip', player: first.id });
        this.say(`${first.name} draws ${got.length} and misses a turn.`, first.id, { amount: got.length, reason: 'start' });
        this.currentIdx = this.nextIdx(firstIdx);
        break;
      }
    }
    this.say(`${this.current.name} ${this.phase === 'color' ? 'starts' : 'goes first'}.`, this.current.id);
  }

  /** A round's end: the winner scores everyone else's cards; the match may be over. */
  private endRound(w: CardsPlayerState, blocked: boolean | 'time' = false) {
    const hands: Record<string, number> = {};
    const cards: Record<string, number> = {};
    let points = 0;
    for (const q of this.active()) {
      if (q === w) continue;
      // A knocked-out hand went back under the pile: it still counts, as it was.
      hands[q.id] = q.out ? q.outPoints ?? 0 : handPoints(q.hand);
      // Cards still held (achievements); a knocked-out hand holds none.
      cards[q.id] = q.out ? 0 : q.hand.length;
      points += hands[q.id];
    }
    w.score += points;
    this.history.push({
      round: this.round, winner: w.id, points, ...(blocked && { blocked: true }), hands, cards,
      ...(this.knocked.length && { out: [...this.knocked] }),
    });
    const matchOver = this.rules.match === 'single' || w.score >= this.rules.targetScore;
    this.step({ type: 'roundEnd', winner: w.id, points, ...(blocked && { blocked: true }), matchOver });
    const total = this.rules.match === 'points' ? ` (${w.score} in all)` : '';
    const standing = !blocked && w.hand.length > 0;
    this.say(blocked === 'time'
      ? `⏰ Time is up in round ${this.round}. ${w.name} holds the fewest points and scores ${points}${total}.`
      : blocked
      ? `Nobody can play or draw — round ${this.round} is blocked. ${w.name} holds the fewest points and scores ${points}${total}.`
      : standing
        ? `${w.name} is the last one standing and wins round ${this.round}, scoring ${points} points${total}.`
        : `${w.name} is out of cards and wins round ${this.round}, scoring ${points} points${total}.`,
    w.id, { amount: points, reason: 'score' });
    this.oneCard = {};
    this.preCall = [];
    this.pending = null;
    this.drawnCard = null;
    this.colorFor = null;
    if (matchOver) {
      this.finish(w, this.rules.match === 'points' ? `🏆 ${w.name} wins the match with ${w.score} points!` : `🏆 ${w.name} wins!`);
    } else {
      this.phase = 'roundOver';
      this.nextRoundAt = this.clockNow() + ROUND_BREAK_MS;
    }
  }

  private finish(w: CardsPlayerState, text: string) {
    this.phase = 'over';
    this.winner = w.id;
    this.endedAt = this.now();
    this.nextRoundAt = null;
    this.turnEndsAt = null;
    this.say(text, w.id);
  }

  /**
   * Out of time (a tournament round's limit; ordinary tables never call it).
   * A round in play is scored as a blocked one is (the lowest hand takes it),
   * then the match ends with the highest score ahead, ties going to whoever
   * held fewer points in that last round.
   */
  endByTime() {
    if (this.phase === 'over') return;
    this.paused = null;
    this.playOpen = false;
    if (this.phase !== 'roundOver') {
      const alive = this.active();
      const w = alive.reduce((b, q) => (handPoints(q.hand) < handPoints(b.hand) ? q : b), alive[0]);
      this.endRound(w, 'time');
    }
    if ((this.phase as CardsPhase) !== 'over') {
      const hands = this.history.at(-1)?.hands ?? {};
      const best = [...this.active()].sort((a, b) => b.score - a.score || (hands[a.id] ?? 0) - (hands[b.id] ?? 0))[0];
      this.finish(best, `⏰ Time is up — ${best.name} wins the match with ${best.score} points!`);
    }
    this.settle();
  }

  /** Deal the next round now (rooms normally let clockTimeout() do it when nextRoundAt passes). */
  startNextRound() {
    if (this.phase !== 'roundOver') fail('The round is not over');
    if (this.paused) fail(`The game is paused by ${this.paused.by}`);
    this.playOpen = false;
    this.startRound();
    this.settle();
  }

  // ---- turn flow ------------------------------------------------------------

  /** Hand the turn on, skipping one player first if asked. */
  private advance(skipOne = false) {
    let i = this.nextIdx(this.currentIdx);
    if (skipOne) {
      const s = this.players[i];
      this.step({ type: 'skip', player: s.id });
      this.say(`${s.name} is skipped.`, s.id);
      i = this.nextIdx(i);
    }
    this.currentIdx = i;
    this.turn++;
    this.phase = 'play';
    this.drawnCard = null;
    this.colorFor = null;
  }

  /** The current player takes the pending Draw penalty and loses the turn. */
  private takePending(t: CardsPlayerState) {
    const amount = this.pending!.amount;
    this.pending = null;
    const got = this.drawCards(t, amount, 'penalty');
    this.step({ type: 'skip', player: t.id });
    this.say(`${t.name} draws ${got.length} and misses a turn.`, t.id, { amount: got.length, reason: 'penalty' });
    this.advance();
  }

  /** Can `c` go on the table right now, ignoring whose turn it is (used for what a draw turned up)? */
  private matchesNow(c: Card): boolean {
    const top = this.top;
    return !!top && matches(c, top, this.color);
  }

  /**
   * May `p` play `c` straight from a draw? A Wild Draw Four turned up by the draw is only
   * playable when the player holds none of the current colour (the official rule): otherwise
   * it stays in hand and the turn passes, rather than forcing a bluff that can be challenged.
   */
  private drawnPlayable(p: CardsPlayerState, c: Card): boolean {
    if (!this.matchesNow(c)) return false;
    if (c.kind === 'wild4' && !this.rules.noBluff && p.hand.some(x => x !== c && x.color === this.color)) return false;
    return true;
  }

  /**
   * May `c` answer the pending Draw? The same kind always (with stacking on).
   * Mixed stacking: in Classic a Wild Draw Four on a Draw Two, or a Draw Two in
   * the named colour on a Wild Draw Four; in Chog Chaos any Draw card worth at
   * least the one on top.
   */
  private stacksOn(c: Card): boolean {
    const pd = this.pending!;
    if (!isDrawCard(c)) return false;
    if (c.kind === pd.kind) return true;
    if (!this.rules.stackMixed) return false;
    if (this.rules.mode === 'chaos') return DRAW_VALUE[c.kind]! >= DRAW_VALUE[pd.kind]!;
    if (pd.kind === 'draw2') return c.kind === 'wild4';
    return c.kind === 'draw2' && c.color === this.color;
  }

  /** Why `p` may not play `c` now (null: they may). Covers jump-ins out of turn. */
  playProblem(p: CardsPlayerState, c: Card): string | null {
    if (p.left) return 'You have left the table';
    if (this.phase === 'over' || this.phase === 'roundOver') return 'The round is over';
    const top = this.top;
    if (!top) return 'Nothing on the table';
    if (p === this.current) {
      if (this.phase === 'color') return 'Pick a colour first';
      if (this.phase === 'swap') return 'Pick who to swap hands with first';
      if (this.phase === 'drawn' && c.id !== this.drawnCard) return 'You can only play the card you just drew';
      if (this.pending) {
        const take = `draw ${this.pending.amount}${this.pending.check ? ' or challenge' : ''}`;
        if (!this.rules.stacking) return `You must ${take}`;
        return this.stacksOn(c) ? null : `Stack a Draw card or ${take}`;
      }
      return matches(c, top, this.color) ? null : `${cardName(c)} does not match`;
    }
    if (!this.rules.jumpIn || this.phase !== 'play' || this.pending) return 'Not your turn';
    return sameFace(c, top) ? null : 'Not your turn — only an identical card can jump in';
  }

  private requireTurn(p: CardsPlayerState, phase: CardsPhase) {
    if (p !== this.current) fail('Not your turn');
    if (this.phase !== phase) fail(`Can't do that now (${this.phase})`);
  }

  /** The default 7-0 swap partner (timeouts, bots): the opponent with the fewest cards, nearest first. */
  defaultSwapTarget(id: string): string {
    const me = this.player(id);
    let best: CardsPlayerState | null = null;
    for (let i = this.nextIdx(this.idx(me)); this.players[i] !== me; i = this.nextIdx(i)) {
      const q = this.players[i];
      if (!best || q.hand.length < best.hand.length) best = q;
    }
    return (best ?? me).id;
  }

  // ---- actions --------------------------------------------------------------

  /**
   * Run a player's action. `auto` marks moves the computer makes for a human
   * (autopilot, timeouts): those must not count as the player being back.
   */
  apply(playerId: string, a: CardsAction, opts: { auto?: boolean } = {}): void {
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') fail('Bad action');
    if (this.phase === 'over') fail('The game is over');
    const p = this.player(idArg(playerId));
    if (p.left) fail('You have left the table');
    if (this.paused) fail(`The game is paused by ${this.paused.by}`);
    if (this.phase === 'roundOver') fail('The round is over — the next deal is coming');
    this.playOpen = false; // (an action that failed half way never reached settle())
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

  /** Same as apply(); the name the room glue may prefer. */
  act(playerId: string, a: CardsAction, opts: { auto?: boolean } = {}): void {
    this.apply(playerId, a, opts);
  }

  /** Actions come straight from clients: every field is checked before anything changes. */
  private dispatch(p: CardsPlayerState, a: CardsAction): void {
    switch (a.type) {
      case 'play': return this.play(p, a);
      case 'draw': return this.draw(p);
      case 'pass': return this.pass(p);
      case 'chooseColor': return this.chooseColor(p, a.color);
      case 'swap': return this.swapAction(p, a.target);
      case 'challenge': return this.challenge(p);
      case 'callLastCard': return this.callLastCard(p);
      case 'catch': return this.catchOut(p, a.target);
      default: fail('Unknown action');
    }
  }

  private play(p: CardsPlayerState, a: Extract<CardsAction, { type: 'play' }>) {
    if (!Number.isInteger(a.card)) fail('No such card');
    const at = p.hand.findIndex(c => c.id === a.card);
    if (at < 0) fail('You do not have that card');
    const card = p.hand[at];
    const why = this.playProblem(p, card);
    if (why) fail(why);
    if (a.color !== undefined && !isCardColor(a.color)) fail('No such colour');
    let target: CardsPlayerState | undefined;
    if (a.target !== undefined) {
      target = this.roundPlayer(idArg(a.target));
      if (target === p) fail("You can't swap hands with yourself");
    }

    const jumpIn = p !== this.current;
    const fromDrawn = this.phase === 'drawn';
    const prevColor = this.color!;
    this.begin(p);
    if (jumpIn) this.currentIdx = this.idx(p);
    p.hand.splice(at, 1);
    // A Purge clears its colour out of the hand first: those go down, then the Purge lands on them.
    const purged = card.kind === 'purge' ? p.hand.filter(c => c.color === card.color) : [];
    if (purged.length) {
      p.hand = p.hand.filter(c => !purged.includes(c));
      this.discard.push(...purged);
      this.step({ type: 'purge', player: p.id, cards: purged });
    }
    this.discard.push(card);
    this.drawnCard = null;
    this.phase = 'play';
    this.stall = 0;
    this.step({ type: 'play', player: p.id, card, from: fromDrawn ? 'drawn' : 'hand', ...(jumpIn && { jumpIn: true }) });
    this.say(jumpIn ? `${p.name} jumps in with ${cardName(card)}!` : `${p.name} plays ${cardName(card)}.`, p.id);
    if (card.kind === 'purge') {
      const n = purged.length;
      this.say(n
        ? `🌀 Purge! ${n} more ${COLOR_LABEL[card.color!]} card${n === 1 ? ' goes' : 's go'} with it.`
        : `🌀 Purge! ${p.name} had no other ${COLOR_LABEL[card.color!]} to clear.`, p.id);
    }
    if (!isWild(card)) this.color = card.color;

    if (p.hand.length === 1) {
      const called = a.callLastCard === true || this.preCall.includes(p.id);
      const t = this.now();
      this.oneCard[p.id] = { since: t, calledAt: called ? t : null, closedAt: null };
      if (called) this.announceCall(p);
    }
    this.preCall = this.preCall.filter(id => id !== p.id);

    if (p.hand.length === 0) return this.goOut(p, card);

    switch (card.kind) {
      case 'number':
        if (this.rules.sevenZero && card.value === 7) {
          const others = this.inRound().filter(q => q !== p);
          const to = target ?? (others.length === 1 ? others[0] : undefined);
          if (to) {
            this.swapHands(p, to);
            this.advance();
          } else {
            this.phase = 'swap';
          }
        } else if (this.rules.sevenZero && card.value === 0) {
          this.rotateHands();
          this.advance();
        } else {
          this.advance();
        }
        return;
      case 'skip':
        return this.advance(true);
      case 'reverse':
        this.direction = this.direction === 1 ? -1 : 1;
        this.step({ type: 'reverse', direction: this.direction });
        if (this.inRound().length === 2) {
          // Two players: a Reverse is a Skip, the same player goes again.
          this.say('Play reverses — with two players, that is a skip.');
          return this.advance(true);
        }
        this.say('Play reverses.');
        return this.advance();
      case 'draw2':
        return this.addPending(p, 'draw2', null);
      case 'purge':
        return this.advance();
      case 'blitz':
        // Everyone else is skipped: a fresh turn for the same player.
        this.step({ type: 'blitz', player: p.id });
        this.say(`⚡ Blitz! Everyone else is skipped — ${p.name} goes again.`, p.id);
        this.turn++;
        return;
      case 'wild':
      case 'wild4':
      case 'wild6':
      case 'wild10':
      case 'roulette': {
        const check = card.kind === 'wild4' && !this.pending && !this.rules.noBluff
          ? { legal: !p.hand.some(c => c.color === prevColor), prevColor }
          : null;
        if (a.color !== undefined) {
          this.setColor(p, a.color);
          return this.afterColor(p, card.kind, check);
        }
        this.phase = 'color';
        this.colorFor = card.kind;
        this.wild4Check = check;
        return;
      }
    }
  }

  /** A Wild Draw Four's legality, kept while its player picks the colour (phase 'color'). */
  private wild4Check: PendingDraw['check'] = null;

  private afterColor(p: CardsPlayerState, kind: ColorFor, check: PendingDraw['check']) {
    this.colorFor = null;
    this.wild4Check = null;
    if (kind === 'start') {
      // The first player named the colour; now they take their turn.
      this.phase = 'play';
      this.turn++;
      return;
    }
    if (kind === 'wild') return this.advance();
    if (kind === 'roulette') return this.roulette();
    this.addPending(p, kind, kind === 'wild4' ? check : null);
  }

  /** A Draw card was played: it lands on the next player, at once unless they have a choice to make. */
  private addPending(p: CardsPlayerState, kind: DrawKind, check: PendingDraw['check']) {
    const amount = (this.pending?.amount ?? 0) + DRAW_VALUE[kind]!;
    const chain = this.pending ? (this.pending.chain ?? 1) + 1 : 1;
    this.pending = { amount, kind, from: p.id, check, chain };
    if (chain > 1) {
      this.step({ type: 'stack', player: p.id, amount, chain });
      this.say(`🔥 Stacked! The penalty is up to ${amount}.`, p.id);
    }
    this.advance();
    // No stacking and nothing to challenge: nothing to decide, so it simply happens.
    if (!this.rules.stacking && !check) this.takePending(this.current);
  }

  /** Chog Roulette: the next player turns up cards until the named colour shows (Wilds don't count), keeps them all and misses their turn. */
  private roulette() {
    const t = this.players[this.nextIdx(this.currentIdx)];
    const color = this.color!;
    this.step({ type: 'roulette', player: t.id, color });
    const got = this.drawCards(t, Infinity, 'roulette', c => c.color === color);
    const hit = got.at(-1)?.color === color;
    this.say(hit
      ? `🎰 Chog Roulette! ${t.name} turns up ${this.plural(got.length)} before ${COLOR_LABEL[color]} shows, and keeps the lot.`
      : `🎰 Chog Roulette! ${t.name} turns up ${this.plural(got.length)} and no ${COLOR_LABEL[color]} ever shows.`,
    t.id, { amount: got.length, reason: 'roulette' });
    this.advance(true);
  }

  /** The player went out: the last card's Draw still lands, then the round is scored. */
  private goOut(p: CardsPlayerState, card: Card) {
    if (isDrawCard(card)) {
      const amount = (this.pending?.amount ?? 0) + DRAW_VALUE[card.kind]!;
      const t = this.players[this.nextIdx(this.idx(p))];
      const got = this.drawCards(t, amount, 'penalty');
      this.say(`${t.name} draws ${got.length}.`, t.id, { amount: got.length, reason: 'penalty' });
    }
    this.pending = null;
    this.endRound(p);
  }

  private setColor(p: CardsPlayerState, color: CardColor) {
    this.color = color;
    this.step({ type: 'color', player: p.id, color });
    this.say(`${p.name} picks ${COLOR_LABEL[color]}.`, p.id);
  }

  private draw(p: CardsPlayerState) {
    this.requireTurn(p, 'play');
    this.begin(p);
    if (this.pending) return this.takePending(p);
    const until = this.rules.drawUntilPlayable;
    const got = this.drawCards(p, until ? Infinity : 1, 'turn', until ? c => this.drawnPlayable(p, c) : undefined);
    if (!got.length) {
      // Nothing left anywhere to draw. If nobody can play either, the round is stuck.
      if (!p.hand.some(c => this.matchesNow(c))) this.stall++;
      this.step({ type: 'pass', player: p.id });
      this.say(`${p.name} has nothing to draw and passes.`, p.id);
      this.advance();
      if (this.stall >= this.inRound().length) this.blockRound();
      return;
    }
    this.say(`${p.name} draws ${this.plural(got.length)}.`, p.id, { amount: got.length, reason: 'turn' });
    const last = got.at(-1)!;
    if (this.drawnPlayable(p, last)) {
      this.phase = 'drawn';
      this.drawnCard = last.id;
    } else {
      this.advance();
    }
  }

  /** Nobody can play or draw: the lowest hand takes the round. */
  private blockRound() {
    const alive = this.inRound();
    const w = alive.reduce((b, q) => (handPoints(q.hand) < handPoints(b.hand) ? q : b), alive[0]);
    this.endRound(w, true);
  }

  private pass(p: CardsPlayerState) {
    this.requireTurn(p, 'drawn');
    if (this.rules.forcedPlay) fail('You must play the card you drew');
    this.begin(p);
    this.step({ type: 'pass', player: p.id });
    this.say(`${p.name} keeps the card and passes.`, p.id);
    this.advance();
  }

  private chooseColor(p: CardsPlayerState, color: unknown) {
    this.requireTurn(p, 'color');
    if (!isCardColor(color)) fail('No such colour');
    this.begin(p);
    this.setColor(p, color);
    this.afterColor(p, this.colorFor ?? 'wild', this.wild4Check);
  }

  private swapAction(p: CardsPlayerState, target: unknown) {
    this.requireTurn(p, 'swap');
    const t = this.roundPlayer(idArg(target));
    if (t === p) fail("You can't swap hands with yourself");
    this.begin(p);
    this.swapHands(p, t);
    this.advance();
  }

  private swapHands(p: CardsPlayerState, t: CardsPlayerState) {
    [p.hand, t.hand] = [t.hand, p.hand];
    this.step({ type: 'swap', player: p.id, target: t.id });
    this.say(`${p.name} swaps hands with ${t.name}.`, p.id);
  }

  /** 7-0: every hand moves one seat on in the direction of play. */
  private rotateHands() {
    const alive = this.inRound();
    const hands = new Map(alive.map(q => [q, q.hand]));
    for (const q of alive) this.players[this.nextIdx(this.idx(q))].hand = hands.get(q)!;
    this.step({ type: 'rotate', direction: this.direction });
    this.say('Everyone passes their hand along.');
  }

  private challenge(p: CardsPlayerState) {
    this.requireTurn(p, 'play');
    const pd = this.pending;
    if (!pd?.check) fail('There is nothing to challenge');
    const off = this.player(pd.from);
    const bluff = !pd.check.legal;
    this.begin(p);
    this.step({ type: 'challenge', player: p.id, target: off.id, bluff, hand: off.hand.map(c => ({ ...c })) });
    this.pending = null;
    if (bluff) {
      const got = this.drawCards(off, 4, 'bluff');
      this.say(`${p.name} challenges ${off.name}'s Wild Draw Four — it was a bluff (${off.name} held ${COLOR_LABEL[pd.check.prevColor]}). ${off.name} draws ${got.length}.`,
        off.id, { amount: got.length, reason: 'bluff' });
      // The challenger escapes the penalty and takes their turn as normal.
      this.turn++;
      return;
    }
    const got = this.drawCards(p, 6, 'challenge');
    this.step({ type: 'skip', player: p.id });
    this.say(`${p.name} challenges ${off.name}'s Wild Draw Four — it was legal. ${p.name} draws ${got.length} and misses a turn.`,
      p.id, { amount: got.length, reason: 'challenge' });
    this.advance();
  }

  private announceCall(p: CardsPlayerState) {
    this.step({ type: 'call', player: p.id });
    this.say(`${p.name}: "${LAST_CARD_CALL}"`, p.id);
  }

  private callLastCard(p: CardsPlayerState) {
    const n = p.hand.length;
    if (n === 1) {
      const oc = this.oneCard[p.id];
      if (oc?.calledAt != null) fail(`You already called "${LAST_CARD_CALL}"`);
      this.begin(p, false);
      const t = this.now();
      this.oneCard[p.id] = { since: oc?.since ?? t, calledAt: t, closedAt: oc?.closedAt ?? null };
    } else if (oneAway(p.hand)) {
      // Two cards, or a Purge that would leave one: the call counts for the play that does it.
      if (this.preCall.includes(p.id)) fail(`You already called "${LAST_CARD_CALL}"`);
      this.begin(p, false);
      this.preCall.push(p.id);
    } else {
      fail(`"${LAST_CARD_CALL}" is for when you are down to one card`);
    }
    this.announceCall(p);
  }

  private catchOut(p: CardsPlayerState, target: unknown) {
    const t = this.roundPlayer(idArg(target));
    if (t === p) fail("You can't catch yourself");
    const oc = this.oneCard[t.id];
    if (!oc || t.hand.length !== 1) fail(`${t.name} is not down to one card`);
    if (oc.calledAt !== null) fail(`${t.name} already called "${LAST_CARD_CALL}"`);
    if (oc.closedAt !== null) fail(`Too late — play has moved on`);
    if (this.now() < oc.since + LAST_CARD_GRACE_MS) fail('Too soon — give them a moment to call');
    this.begin(p, false);
    delete this.oneCard[t.id];
    this.step({ type: 'catch', player: p.id, target: t.id });
    const got = this.drawCards(t, 2, 'caught');
    this.say(`${p.name} caught ${t.name} without a "${LAST_CARD_CALL}" call — ${t.name} draws ${got.length}.`,
      t.id, { amount: got.length, reason: 'caught' });
  }

  /**
   * The Mercy rule, after every change: anyone holding CARDS_MERCY_LIMIT or
   * more is knocked out of the round. Their cards go under the draw pile (the
   * points they were worth still count for the round's winner); a turn they
   * owed moves on; the last one standing wins the round.
   */
  private mercySweep() {
    if (!this.rules.mercy) return;
    for (const p of this.inRound()) {
      if (this.phase === 'over' || this.phase === 'roundOver') return;
      if (p.hand.length < CARDS_MERCY_LIMIT) continue;
      const count = p.hand.length;
      const wasCurrent = p === this.current;
      p.out = true;
      p.outPoints = handPoints(p.hand);
      this.knocked.push(p.id);
      this.pile.unshift(...p.hand);
      p.hand = [];
      delete this.oneCard[p.id];
      this.step({ type: 'mercy', player: p.id, count });
      this.say(`💥 ${p.name} hits ${count} cards — no mercy! Out of round ${this.round}.`, p.id);
      if (this.pending?.from === p.id) this.pending.check = null;
      const still = this.inRound();
      if (still.length === 1) {
        this.pending = null;
        this.endRound(still[0]);
        return;
      }
      if (wasCurrent) {
        // Whatever they owed goes with them.
        if (this.color === null) this.color = CARD_COLORS[this.rng(CARD_COLORS.length)];
        this.pending = null;
        this.wild4Check = null;
        this.advance();
      }
    }
  }

  /** Bookkeeping after every change: the Mercy rule, one-card states, deadlines, the change counter. */
  private settle() {
    if (this.playOpen) this.mercySweep();
    this.playOpen = false;
    for (const id of Object.keys(this.oneCard)) {
      if (this.player(id).hand.length !== 1) delete this.oneCard[id];
    }
    this.preCall = this.preCall.filter(id => oneAway(this.player(id).hand));
    this.syncClocks();
    this.seq++;
  }

  // ---- clocks ---------------------------------------------------------------
  // The engine only stores deadlines: the room arms one timer at
  // clockDeadline() and calls clockTimeout().

  /** The clock deadlines are measured from: frozen while paused. */
  private clockNow(): number {
    return this.paused ? this.paused.at : this.now();
  }

  private turnMs(): number {
    return Math.max(0, this.rules.turnSeconds) * 1000;
  }

  private syncClocks() {
    const ms = this.turnMs();
    if (this.phase === 'over' || ms === 0 || !STEP_PHASES.includes(this.phase) || this.current.isBot) {
      // Bots never need a clock; the round break has its own (nextRoundAt).
      this.turnEndsAt = null;
      this.turnKey = '';
      return;
    }
    // Each new step (new turn, new phase) gets a full window.
    const key = `${this.round}|${this.turn}|${this.phase}|${this.currentIdx}`;
    if (key !== this.turnKey) {
      this.turnKey = key;
      this.turnEndsAt = this.clockNow() + ms;
    }
  }

  /**
   * The players are still watching the last play animate until `until`: a
   * turn step (or round break) whose clock started before then starts at
   * `until` instead, so nobody loses thinking time to the animation.
   */
  holdTurnClock(until: number) {
    if (this.paused) return;
    const ms = this.turnMs();
    if (this.turnEndsAt !== null && ms > 0 && this.turnEndsAt - ms < until) this.turnEndsAt = until + ms;
    if (this.nextRoundAt !== null && this.nextRoundAt - ROUND_BREAK_MS < until) this.nextRoundAt = until + ROUND_BREAK_MS;
  }

  /** When the room must call clockTimeout() next (turn step, round break, pause limit). */
  clockDeadline(): number | null {
    if (this.phase === 'over') return null;
    if (this.paused) return this.paused.at + PAUSE_MAX_MS;
    const due = [this.turnEndsAt, this.nextRoundAt].filter((t): t is number => t !== null);
    return due.length ? Math.min(...due) : null;
  }

  /** Called by the room when clockDeadline() passes. True if anything changed. */
  clockTimeout(): boolean {
    const due = this.clockDeadline();
    const now = this.now();
    if (due === null || now < due) return false;
    if (this.paused) {
      this.unpause('▶️ Game resumed (pause time limit).');
      return true;
    }
    this.playOpen = false;
    if (this.phase === 'roundOver' && this.nextRoundAt !== null && now >= this.nextRoundAt) this.startRound();
    else if (this.turnEndsAt !== null && now >= this.turnEndsAt) this.turnTimeout();
    this.settle();
    return true;
  }

  /** The current player let their step run out: draw, then pass (or the safe default for a choice). */
  private turnTimeout() {
    const p = this.current;
    this.turnEndsAt = null;
    this.begin(p);
    this.step({ type: 'timeout', player: p.id });
    this.say(`⏱ ${p.name} ran out of time.`, p.id);
    switch (this.phase) {
      case 'color':
        this.chooseColor(p, bestColor(p.hand));
        break;
      case 'swap':
        this.swapAction(p, this.defaultSwapTarget(p.id));
        break;
      case 'drawn':
        this.finishDrawn(p);
        break;
      case 'play':
        if (this.pending) {
          this.draw(p); // takes the penalty: never challenges for them
        } else {
          this.draw(p);
          // (draw() may have moved the phase on: TS narrowed it to 'play' above)
          if ((this.phase as CardsPhase) === 'drawn' && this.current === p) this.finishDrawn(p);
        }
        break;
    }
    const n = (this.timeoutStreak[p.id] ?? 0) + 1;
    this.timeoutStreak[p.id] = n;
    if (n >= AFK_AFTER && !p.afk && !p.left) {
      p.afk = true;
      this.say(`${p.name} seems to be away — auto-play is on for them until they are back.`, p.id);
    }
  }

  /** Timeout after a playable draw: pass, or (forced play) play it with sensible picks. */
  private finishDrawn(p: CardsPlayerState) {
    if (!this.rules.forcedPlay) return this.pass(p);
    const card = p.hand.find(c => c.id === this.drawnCard)!;
    const rest = p.hand.filter(c => c !== card);
    this.play(p, {
      type: 'play', card: card.id,
      ...(isWild(card) && { color: bestColor(rest) }),
      ...(this.rules.sevenZero && card.value === 7 && { target: this.defaultSwapTarget(p.id) }),
    });
  }

  // ---- pause, leaving -------------------------------------------------------

  /** Host or operator freezes the table: every clock stops, nobody can act. */
  pause(by: string) {
    if (this.phase === 'over') fail('The game is over');
    if (this.paused) fail(`Already paused by ${this.paused.by}`);
    this.paused = { by, at: this.now() };
    this.say(`⏸️ Game paused by ${by}.`);
    this.seq++;
  }

  resume(by: string) {
    if (!this.paused) fail('The game is not paused');
    this.unpause(`▶️ Game resumed by ${by}.`);
  }

  private unpause(text: string) {
    const p = this.paused!;
    this.paused = null;
    this.shiftClocks(this.now() - p.at);
    this.say(text);
    this.settle();
  }

  /** Move every running deadline on by `ms` (a pause, or a server restart). */
  private shiftClocks(ms: number) {
    if (ms <= 0) return;
    if (this.turnEndsAt !== null) this.turnEndsAt += ms;
    if (this.nextRoundAt !== null) this.nextRoundAt += ms;
    // The grace before a catch counts is thinking time too.
    for (const oc of Object.values(this.oneCard)) oc.since += ms;
  }

  /**
   * The room takes a player out (left, kicked). Their cards go to the bottom
   * of the draw pile; a step they owed is dropped and play moves on. The last
   * player at the table wins.
   */
  forfeit(playerId: string) {
    if (this.phase === 'over') fail('The game is over');
    const p = this.livePlayer(idArg(playerId));
    this.playOpen = false;
    this.begin(p, false);
    const wasCurrent = p === this.current;
    p.left = true;
    this.pile.unshift(...p.hand);
    p.hand = [];
    delete this.oneCard[p.id];
    this.step({ type: 'leave', player: p.id });
    this.say(`${p.name} left the table.`, p.id);
    const alive = this.active();
    if (alive.length === 1) {
      this.pending = null;
      this.finish(alive[0], `🏆 ${alive[0].name} wins — everyone else has left.`);
    } else if (this.phase !== 'roundOver' && this.inRound().length === 1) {
      // Everyone else in the round was knocked out: the last one standing takes it.
      this.pending = null;
      this.endRound(this.inRound()[0]);
    } else if (this.phase !== 'roundOver') {
      // A Draw Four from someone who has gone can no longer be challenged.
      if (this.pending?.from === p.id) this.pending.check = null;
      if (wasCurrent) {
        // Whatever they owed (a pick, a penalty, a choice) goes with them.
        if (this.color === null) this.color = CARD_COLORS[this.rng(CARD_COLORS.length)];
        this.pending = null;
        this.wild4Check = null;
        this.advance();
      }
    }
    this.settle();
  }

  // ---- snapshots ------------------------------------------------------------

  snapshot(): CardsSnapshot {
    return structuredClone({
      rules: this.rules, players: this.players, pile: this.pile, discard: this.discard, color: this.color,
      direction: this.direction, currentIdx: this.currentIdx, dealerIdx: this.dealerIdx, phase: this.phase,
      pending: this.pending, colorFor: this.colorFor, drawnCard: this.drawnCard, oneCard: this.oneCard,
      preCall: this.preCall, round: this.round, turn: this.turn, stall: this.stall, history: this.history,
      winner: this.winner, lastPlay: this.lastPlay, playSeq: this.playSeq, seq: this.seq, log: this.log,
      turnEndsAt: this.turnEndsAt, turnKey: this.turnKey, timeoutStreak: this.timeoutStreak,
      nextRoundAt: this.nextRoundAt, paused: this.paused, startedAt: this.startedAt, endedAt: this.endedAt,
      savedAt: this.now(), wild4Check: this.wild4Check, knocked: this.knocked,
    });
  }

  /** Rebuild a game from a snapshot. Running deadlines move on by the downtime. */
  static restore(init: Omit<CardsInit, 'players' | 'rules'>, snap: CardsSnapshot): CardsGame {
    const g = new CardsGame({ ...init, rules: snap.rules, players: snap.players, onLog: undefined });
    const { savedAt, rules: _rules, wild4Check, ...state } = structuredClone(snap);
    Object.assign(g, state);
    g.wild4Check = wild4Check ?? null;
    g.onLog = init.onLog;
    const down = g.now() - savedAt;
    if (down > 0) {
      g.shiftClocks(down);
      if (g.paused) g.paused.at += down;
    }
    return g;
  }

  // ---- views ----------------------------------------------------------------

  /**
   * What `forId` may see. Other hands are counts; the draw pile is a count;
   * drawn cards and a challenged hand appear only in their owner's (or the
   * challenger's) view; a Wild Draw Four's legality never appears until a
   * challenge shows it. Spectators (no or unknown id) see no hand at all.
   * `log: false` leaves the log out (bots decide many times a second).
   */
  view(forId?: string, opts: { log?: boolean } = {}): CardsView {
    const me = forId === undefined ? undefined : this.players.find(p => p.id === forId);
    const now = this.now();
    const live = this.phase !== 'over' && this.phase !== 'roundOver';
    const pd = this.pending;
    // Built from fresh copies throughout (cards are flat objects): nothing in
    // a view shares memory with the game, and it is cheap enough for bots.
    const copy = (c: Card): Card => ({ ...c });
    return {
      game: 'cards',
      rules: { ...this.rules },
      players: this.players.map((p, seat) => ({
        id: p.id, name: p.name, isBot: p.isBot, seat, cards: p.hand.length, score: p.score,
        ...(p.afk && { afk: true }), ...(p.left && { left: true }), ...(p.out && { out: true }),
      })),
      you: me ? this.youView(me, now) : null,
      phase: this.phase,
      current: this.current.id,
      dealer: this.players[this.dealerIdx].id,
      direction: this.direction,
      color: this.color,
      top: this.top && copy(this.top),
      discardCount: this.discard.length,
      drawCount: this.pile.length,
      pendingDraw: pd && live ? {
        amount: pd.amount, kind: pd.kind, from: pd.from, chain: pd.chain ?? 1, challengeable: !!pd.check,
        ...(pd.check && { prevColor: pd.check.prevColor }),
      } : null,
      oneCard: Object.entries(this.oneCard).map(([player, oc]) => ({
        player, since: oc.since, calledAt: oc.calledAt, closedAt: oc.closedAt,
        catchable: oc.calledAt === null && oc.closedAt === null,
        catchFrom: oc.since + LAST_CARD_GRACE_MS,
      })),
      round: this.round,
      turn: this.turn,
      history: this.history.map(h => ({ ...h, hands: { ...h.hands }, ...(h.cards && { cards: { ...h.cards } }) })),
      winner: this.winner,
      lastPlay: this.lastPlay && {
        seq: this.lastPlay.seq,
        player: this.lastPlay.player,
        steps: this.lastPlay.steps.map((s): CardsStep => {
          switch (s.type) {
            case 'draw': {
              // Only the drawer sees what they drew.
              const { cards, ...rest } = s;
              return s.player === forId && cards ? { ...rest, cards: cards.map(copy) } : rest;
            }
            case 'challenge': {
              // Only the challenger sees the hand that was shown.
              const { hand, ...rest } = s;
              return s.player === forId && hand ? { ...rest, hand: hand.map(copy) } : rest;
            }
            case 'deal': return { ...s, order: [...s.order] };
            case 'flip':
            case 'play': return { ...s, card: copy(s.card) };
            case 'purge': return { ...s, cards: s.cards.map(copy) };
            default: return { ...s };
          }
        }),
      },
      seq: this.seq,
      log: opts.log === false ? [] : this.log.slice(-VIEW_LOG).map(e => ({ ...e })),
      turnEndsAt: this.turnEndsAt,
      nextRoundAt: this.nextRoundAt,
      paused: this.paused && { ...this.paused },
      startedAt: this.startedAt,
      endedAt: this.endedAt,
    };
  }

  private youView(me: CardsPlayerState, now: number): CardsYouView {
    const mine = me === this.current;
    const acting = !this.paused && !me.left && this.phase !== 'over' && this.phase !== 'roundOver';
    const n = me.hand.length;
    const oc = this.oneCard[me.id];
    return {
      id: me.id,
      hand: me.hand.map(c => ({ ...c })),
      playable: acting ? me.hand.filter(c => !this.playProblem(me, c)).map(c => c.id) : [],
      drawn: mine && this.phase === 'drawn' ? this.drawnCard : null,
      canDraw: acting && mine && this.phase === 'play',
      canPass: acting && mine && this.phase === 'drawn' && !this.rules.forcedPlay,
      canChallenge: acting && mine && this.phase === 'play' && !!this.pending?.check,
      // (A single card handed over by a 7-0 swap carries no call duty: no window, so no prompt.)
      canCallLastCard: acting && ((n === 1 && !!oc && oc.calledAt == null) || (n >= 2 && oneAway(me.hand) && !this.preCall.includes(me.id))),
      canCatch: acting
        ? Object.entries(this.oneCard)
          .filter(([id, o]) => id !== me.id && o.calledAt === null && o.closedAt === null && now >= o.since + LAST_CARD_GRACE_MS)
          .map(([id]) => id)
        : [],
      preCalled: this.preCall.includes(me.id),
    };
  }
}
