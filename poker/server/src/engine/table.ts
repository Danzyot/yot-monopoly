import { randomUUID } from 'node:crypto';
import type {
  TableReaction, TableTheme, TableTourneyInfo,
  ActionType, CardT, ChatMsg, HandHistoryEntry, HandResultEntry, LegalActions,
  PotView, SeatView, TableLogEntry, TableOverview, TableOverviewSeat, TableView,
} from '../../../shared/types.ts';
import { HoldemHand, type HandResult } from './hand.ts';
import { bestFiveOf, describeCards } from './evaluator.ts';
import { isOnline } from '../presence.ts';
import { withChog } from '../chogs.ts';
import { CHAT_COOLDOWN_MS, isBlocked, MAX_MENTIONS, resolveMentions, resolveReply } from '../chatrules.ts';

export interface TableSeatState {
  player: { id: string; name: string; avatar: string };
  stack: number;
  sittingOut: boolean;
  timebankMs: number;
  missedTurns: number;
  // Consecutive hands finished while offline with only auto-actions —
  // the tournament eliminates a player once this reaches its limit, so an
  // abandoned seat can't blind down forever while everyone waits.
  ghostHands: number;
}

export interface TableCallbacks {
  broadcast: (table: Table) => void; // push fresh views to subscribers
  chat: (table: Table, msg: ChatMsg) => void;
  event: (table: Table, text: string) => void;
  // Operator audit trail (actions taken, chips won/lost per hand).
  audit?: (table: Table, entry: AuditEntry) => void;
  // Emoji reactions float over the felt for everyone watching.
  reaction?: (table: Table, r: TableReaction) => void;
  // Tournament hook: called after each hand with seats that busted (stack 0).
  onHandEnd?: (table: Table, busted: { id: string; name: string; startStack: number }[]) => void;
}

export type AuditEntry =
  | { kind: 'action'; playerId: string; playerName: string; action: string; amount: number; pot: number; handNumber: number }
  | {
    kind: 'handEnd';
    contenders: {
      id: string; name: string; net: number;
      // Everything the collusion review needs to judge the QUALITY of a
      // decision, not just the direction chips moved.
      cards: CardT[]; committed: number; startStack: number; allIn: boolean;
      wentToShowdown: boolean;
    }[];
    board: CardT[];
    pot: number;
    tableId: string;
    tableName: string;
    handNumber: number;
  };

// One reversible turn. The hand is plain data all the way down, so a
// structured clone captures it exactly — including the deck order, which has
// to survive or the next card dealt after an undo would differ.
interface TurnSnapshot {
  handNumber: number;
  hand: {
    seats: HoldemHand['seats'];
    board: CardT[];
    deck: CardT[];
    street: HoldemHand['street'];
    currentBet: number;
    lastFullRaiseIncrement: number;
    actionIdx: number | null;
    finished: boolean;
    runoutPending: boolean;
  };
  // Per-seat bookkeeping the action also moved.
  seatMeta: { idx: number; missedTurns: number; ghostHands: number; sittingOut: boolean; timebankMs: number }[];
  autoActed: number[];
  // Where the session log had got to, so the reversed action's line goes with it.
  logLength: number;
  lastLoggedBoardLen: number;
  // What the felt said it was: name of the player whose turn it was.
  actorName: string;
}

export interface TableOpts {
  id?: string;
  name: string;
  tournamentId?: string;
  maxSeats?: number;
  sb: number;
  bb: number;
  ante?: number;
  actionTimeMs?: number;
  timebankMs?: number;
  interHandDelayMs?: number;
  displayMode?: 'chips' | 'bb';
  rabbitHunting?: boolean;
  theme?: TableTheme | null;
}

const DEFAULT_ACTION_MS = 22_000;
// Extra time granted once per decision, on top of the action clock. Default 0:
// the limit the host configures is exactly the limit players get.
const DEFAULT_TIMEBANK_MS = 0;

const RANK_CH: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_CH = ['♠', '♥', '♦', '♣'];

function cardLabel(c: CardT): string {
  return `${RANK_CH[c.r]}${SUIT_CH[c.s]}`;
}

// Internal hand record: full hole cards + per-card reveal flags; redacted per
// viewer when served through historyView().
interface StoredHand extends Omit<HandHistoryEntry, 'holeCards'> {
  holeCardsFull: { seat: number; cards: CardT[] }[];
  reveal: Record<number, [boolean, boolean]>;
}

// Same reasoning as the tournament log: keep enough that a restart restores
// the conversation instead of a stub of it.
const CHAT_KEEP = 250;

export class Table {
  id: string;
  name: string;
  tournamentId: string | null;
  maxSeats: number;
  seats: (TableSeatState | null)[];
  hand: HoldemHand | null = null;
  buttonSeat = 0;
  handNumber = 0;
  sb: number;
  bb: number;
  ante: number;
  paused = false;
  closed = false;
  lastResults: HandResultEntry[] | null = null;
  chatLog: ChatMsg[] = [];
  spectators = new Set<string>();
  cb: TableCallbacks;

  actionTimeMs: number;
  timebankMs: number;
  interHandDelayMs: number;
  displayMode: 'chips' | 'bb' = 'chips';
  // Pause between board cards when everyone is all-in (drama, not mechanics).
  runoutStepMs = 1_100;
  private actionTimer: NodeJS.Timeout | null = null;
  private pacingTimer: NodeJS.Timeout | null = null;
  actionDeadline: number | null = null;
  actionStarted: number | null = null;
  private usingTimebankFor: number | null = null;
  // What was left on the acting player's clock when the table was paused, so
  // resuming gives them exactly that back rather than a fresh full clock.
  private pausedClockMs: number | null = null;
  // Enough of the table to put a reversed turn back exactly as it was. Only
  // ever holds states from the hand in progress: once a hand ends the pot is
  // paid and the deck is gone, so there is nothing honest to go back to.
  private undoStack: TurnSnapshot[] = [];

  // Seats whose turns were taken by the clock this hand (auto check/fold) —
  // feeds the abandoned-player counter at hand end.
  private autoActedSeats = new Set<number>();
  // Voluntary card reveals during the post-hand pause.
  private lastHandCards = new Map<number, CardT[]>(); // seat -> hole cards
  private postReveals = new Map<number, [boolean, boolean]>();
  private lastRevealSeats = new Set<number>(); // already face-up at showdown
  private lastBoard: CardT[] = []; // board kept on screen during the pause
  // Rabbit hunting: the board that never came, held back until asked for.
  rabbitHunting: boolean;
  // Custom look (felt preset + operator images); null = the default table.
  theme: TableTheme | null = null;
  // Set by the Tournament that owns this table: shared event context for the
  // felt overlay, and the viewer's live rank in the field.
  tourneyInfo: (() => TableTourneyInfo | null) | null = null;
  // Extra milliseconds on every decision, read live when a clock starts. A
  // tournament sets it for its late clock; unset means none.
  extraActionMs: (() => number) | null = null;
  rankOf: ((playerId: string) => number | null) | null = null;
  private rabbitCards: CardT[] = [];
  private rabbitShown = false;
  // Session log (timestamped game events) + recorded hands for the replayer.
  eventLog: TableLogEntry[] = [];
  private handRecords: StoredHand[] = [];
  private currentRecord: StoredHand | null = null;

  constructor(opts: TableOpts, cb: TableCallbacks) {
    this.id = opts.id ?? randomUUID().slice(0, 8);
    this.name = opts.name;
    this.tournamentId = opts.tournamentId ?? null;
    this.maxSeats = opts.maxSeats ?? 9;
    this.seats = new Array(this.maxSeats).fill(null);
    this.sb = opts.sb;
    this.bb = opts.bb;
    this.ante = opts.ante ?? 0;
    this.cb = cb;
    this.actionTimeMs = opts.actionTimeMs ?? DEFAULT_ACTION_MS;
    this.timebankMs = Math.max(0, opts.timebankMs ?? DEFAULT_TIMEBANK_MS);
    this.interHandDelayMs = opts.interHandDelayMs ?? 2_800;
    this.displayMode = opts.displayMode ?? 'chips';
    this.rabbitHunting = opts.rabbitHunting ?? false;
    this.theme = opts.theme ?? null;
  }

  // ---------- seating ----------
  playerSeat(playerId: string): number | null {
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i]?.player.id === playerId) return i;
    }
    return null;
  }

  seatedCount(): number {
    return this.seats.filter(Boolean).length;
  }

  // Every seat with chips is dealt in. Away players still pay their blinds
  // and auto-fold quickly.
  activeSeatIdxs(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (!s || s.stack <= 0) continue;
      out.push(i);
    }
    return out;
  }

  sit(seatIdx: number, player: { id: string; name: string; avatar: string }, stack: number) {
    if (this.closed) throw new Error('table closed');
    if (seatIdx < 0 || seatIdx >= this.maxSeats) throw new Error('bad seat');
    if (this.seats[seatIdx]) throw new Error('seat taken');
    if (this.playerSeat(player.id) !== null) throw new Error('already seated');
    this.seats[seatIdx] = {
      player, stack, sittingOut: false,
      timebankMs: this.timebankMs, missedTurns: 0, ghostHands: 0,
    };
    this.logEvent(`${player.name} sat down at seat ${seatIdx + 1}`);
    this.scheduleStart();
    this.cb.broadcast(this);
  }

  setSitOut(playerId: string, out: boolean) {
    const idx = this.playerSeat(playerId);
    if (idx === null) return;
    this.seats[idx]!.sittingOut = out;
    if (!out) this.seats[idx]!.missedTurns = 0;
    this.scheduleStart();
    this.cb.broadcast(this);
  }

  private handSeatLive(seatIdx: number): boolean {
    if (!this.hand) return false;
    const hs = this.hand.seats.find(s => s.seat === seatIdx);
    return !!hs && !hs.folded;
  }

  // ---------- hand lifecycle ----------
  // No hand is dealt before this instant. A tournament sets it while players
  // are still arriving: with seats claimed one press at a time, the first two
  // people through the door would otherwise play the opening hand heads-up
  // while everyone else was still filing in.
  dealNotBefore = 0;

  // The wait is over: nobody else is expected. Any hold already armed has to
  // be torn down and re-armed, or the table sits out a delay that no longer
  // has a reason.
  releaseDealHold() {
    if (this.dealNotBefore === 0) return;
    this.dealNotBefore = 0;
    if (this.pacingTimer && !this.hand) {
      clearTimeout(this.pacingTimer);
      this.pacingTimer = null;
      this.scheduleStart();
    }
  }

  scheduleStart() {
    if (this.hand || this.paused || this.closed) return;
    if (this.activeSeatIdxs().length < 2) return;
    if (this.pacingTimer) return;
    const wait = Math.max(1_200, this.dealNotBefore - Date.now());
    this.setPacing(() => {
      this.pacingTimer = null;
      this.startHand();
    }, wait);
  }

  startHand() {
    if (this.hand || this.paused || this.closed) return;
    const active = this.activeSeatIdxs();
    if (active.length < 2) return;

    // Advance button to next active seat.
    this.buttonSeat = this.nextActiveSeat(this.buttonSeat, active);
    this.handNumber += 1;
    this.lastResults = null;

    const players = active.map(i => ({ seat: i, id: this.seats[i]!.player.id, stack: this.seats[i]!.stack }));
    this.lastLoggedBoardLen = 0;
    this.autoActedSeats.clear();
    // Reversal never reaches back past the hand in progress.
    this.undoStack.length = 0;
    this.lastHandCards.clear();
    this.postReveals.clear();
    this.lastRevealSeats.clear();
    this.lastBoard = [];
    this.rabbitCards = [];
    this.rabbitShown = false;
    // The opening bet cap is read once, here, from the tournament's own clock
    // — so a hand is dealt either under the rule or not, and cannot change
    // rules between its flop and its river. A table with no tournament
    // context is never capped.
    const cap = this.tourneyInfo?.()?.betCap ?? null;
    const maxBetFraction = cap && Date.now() < cap.endsAt ? cap.fraction : 1;
    this.hand = new HoldemHand({
      players, buttonSeat: this.buttonSeat, sb: this.sb, bb: this.bb, ante: this.ante,
      maxBetFraction,
    });
    // Start a replayer record for this hand.
    this.currentRecord = {
      number: this.handNumber,
      startedAt: Date.now(),
      endedAt: null,
      sb: this.sb, bb: this.bb, ante: this.ante,
      buttonSeat: this.buttonSeat,
      players: players.map(p => ({
        seat: p.seat, id: p.id,
        name: this.seats[p.seat]!.player.name,
        avatar: this.seats[p.seat]!.player.avatar,
        startStack: p.stack,
      })),
      board: [],
      steps: [],
      winners: [],
      holeCardsFull: [],
      reveal: {},
    };
    this.handRecords.push(this.currentRecord);
    if (this.handRecords.length > 60) this.handRecords.shift();
    // Deduct stacks: live stacks now tracked in hand; sync at end.
    this.logEvent(`Hand #${this.handNumber} — blinds ${this.sb}/${this.bb}${this.ante ? ` ante ${this.ante}` : ''}`);
    this.afterEngineStep();
  }

  private nextActiveSeat(from: number, active: number[]): number {
    for (let k = 1; k <= this.maxSeats; k++) {
      const i = (from + k) % this.maxSeats;
      if (active.includes(i)) return i;
    }
    return active[0];
  }

  applyAction(playerId: string, type: ActionType, amount?: number) {
    if (this.paused) throw new Error('The game is paused');
    if (!this.hand) throw new Error('no hand in progress');
    const seatIdx = this.playerSeat(playerId);
    if (seatIdx === null) throw new Error('not seated');
    this.captureTurn();
    this.hand.act(seatIdx, type, amount);
    const seat = this.seats[seatIdx];
    if (seat) {
      seat.missedTurns = 0;
      seat.ghostHands = 0; // a real decision — they're clearly here
      // ...so take them off the away clock too. In a tournament nobody chooses
      // to sit out — they are dealt in regardless — so the flag can only have
      // come from missing a turn, and acting is proof they are back.
      seat.sittingOut = false;
      this.autoActedSeats.delete(seatIdx);
      const hs = this.hand.seats.find(s => s.seat === seatIdx);
      if (hs?.lastAction) {
        this.logEvent(`${seat.player.name}: ${hs.lastAction}`);
        this.cb.audit?.(this, {
          kind: 'action',
          playerId: seat.player.id, playerName: seat.player.name,
          action: hs.lastAction, amount: hs.committed,
          pot: this.hand.totalPot, handNumber: this.handNumber,
        });
      }
    }
    this.afterEngineStep();
  }

  // Voluntarily show hole cards during the pause after a hand ends.
  applyReveal(playerId: string, which: 'first' | 'second' | 'both') {
    if (this.hand || !this.lastResults) throw new Error('nothing to reveal right now');
    const seat = this.playerSeat(playerId);
    if (seat === null) throw new Error('not seated');
    const cards = this.lastHandCards.get(seat);
    if (!cards) throw new Error('you were not in the last hand');
    if (this.lastRevealSeats.has(seat)) return; // already face-up at showdown
    const cur = this.postReveals.get(seat) ?? [false, false];
    const next: [boolean, boolean] = [
      cur[0] || which !== 'second',
      cur[1] || which !== 'first',
    ];
    if (next[0] === cur[0] && next[1] === cur[1]) return;
    this.postReveals.set(seat, next);
    // Mirror the reveal into the recorded hand so the replayer shows it too.
    if (this.currentRecord?.number === this.handNumber) {
      const rv = this.currentRecord.reveal[seat] ?? [false, false];
      this.currentRecord.reveal[seat] = [rv[0] || next[0], rv[1] || next[1]];
    }
    const name = this.seats[seat]?.player.name ?? 'Player';
    const shown = cards
      .filter((_, i) => next[i] && !cur[i])
      .map(c => cardLabel(c)).join(' ');
    this.logEvent(`${name} shows ${shown}`);
    this.cb.broadcast(this);
  }

  // Reveal the board that never came. Once shown, everyone at the table sees
  // it — rabbit hunting is public, not a private peek.
  showRabbit() {
    if (!this.rabbitHunting || this.hand || this.rabbitCards.length === 0 || this.rabbitShown) return;
    this.rabbitShown = true;
    this.logEvent(`🐇 Rabbit hunt: ${this.rabbitCards.map(c => cardLabel(c)).join(' ')}`);
    this.cb.broadcast(this);
  }

  private lastLoggedBoardLen = 0;

  // Reconcile engine state with table: timers, runouts, hand end.
  private afterEngineStep() {
    if (!this.hand) return;
    this.clearActionTimer();
    this.logStreetIfNew();

    if (this.hand.finished) {
      this.onHandFinished();
      return;
    }
    if (this.hand.runoutPending) {
      // Pace out remaining streets.
      this.cb.broadcast(this);
      this.setPacing(() => this.runoutStep(), this.runoutStepMs);
      return;
    }
    this.armActionTimer();
    this.cb.broadcast(this);
  }

  // Start the clock for whoever is to act. Split out of afterEngineStep so a
  // reversed turn can restart the clock without re-running the engine step,
  // which would re-log the street and could re-trigger a runout.
  private armActionTimer() {
    if (!this.hand) return;
    const seat = this.hand.actionSeat();
    if (seat === null) return;
    const st = this.seats[seat];
    // Away AND disconnected: resolve in a blink rather than burning the full
    // clock every hand. Away but still connected keeps the normal clock —
    // they may simply have missed one turn and still be sitting there.
    const wait = st?.sittingOut && !isOnline(st.player.id) ? 600 : this.clockMs();
    this.actionStarted = Date.now();
    this.actionDeadline = this.actionStarted + wait;
    this.usingTimebankFor = null;
    this.actionTimer = setTimeout(() => this.onActionTimeout(seat), wait);
  }

  // A full decision's worth of time: the table's clock plus whatever the
  // tournament is adding right now.
  private clockMs() {
    return this.actionTimeMs + Math.max(0, this.extraActionMs?.() ?? 0);
  }

  private runoutStep() {
    this.pacingTimer = null;
    if (!this.hand) return;
    const more = this.hand.dealRunoutStep();
    this.logStreetIfNew();
    if (this.hand.finished) {
      this.onHandFinished();
      return;
    }
    this.cb.broadcast(this);
    if (more) this.setPacing(() => this.runoutStep(), this.runoutStepMs);
  }

  private logStreetIfNew() {
    if (!this.hand) { this.lastLoggedBoardLen = 0; return; }
    const board = this.hand.board;
    if (board.length > this.lastLoggedBoardLen) {
      const names: Record<number, string> = { 3: 'Flop', 4: 'Turn', 5: 'River' };
      const label = names[board.length];
      if (label) {
        const cards = board.map(c => cardLabel(c)).join(' ');
        this.logEvent(`${label}: ${cards}`);
      }
      this.lastLoggedBoardLen = board.length;
    }
  }

  private onActionTimeout(seat: number) {
    this.actionTimer = null;
    if (this.paused) return;
    if (!this.hand || this.hand.actionSeat() !== seat) return;
    const st = this.seats[seat];
    this.autoActedSeats.add(seat);
    // The instant fold is for players who are GONE. Flagging someone away
    // after one missed turn and then giving them 600ms with no timebank meant
    // a single lag spike locked a present player into folding every hand —
    // they could not act fast enough to clear the flag that caused it. Anyone
    // whose connection is up keeps the full clock and their timebank; missed
    // turns still count toward removal, so real ghosts are unaffected.
    if (st?.sittingOut && !isOnline(st.player.id)) {
      this.captureTurn();
      this.hand.autoAct(seat);
      this.afterEngineStep();
      return;
    }
    // Give timebank once per decision.
    if (st && st.timebankMs > 0 && this.usingTimebankFor !== seat) {
      this.usingTimebankFor = seat;
      const grant = st.timebankMs;
      st.timebankMs = 0;
      this.actionDeadline = Date.now() + grant;
      this.actionTimer = setTimeout(() => this.onActionTimeout(seat), grant);
      this.logEvent(`${st.player.name} is using their time bank`);
      this.cb.broadcast(this);
      return;
    }
    // Auto check/fold.
    this.captureTurn();
    this.hand.autoAct(seat);
    if (st) {
      st.missedTurns += 1;
      // One missed turn is enough to stop holding the table up: from here the
      // clock resolves their turns in 600ms instead of the full timer. Acting
      // once puts them straight back on the normal clock.
      if (st.missedTurns >= 1 && !st.sittingOut) {
        st.sittingOut = true;
        this.logEvent(`${st.player.name} is away (missed a turn)`);
      }
    }
    this.afterEngineStep();
  }

  private onHandFinished() {
    const hand = this.hand!;
    const result: HandResult = hand.result!;

    // Sync stacks back to seats.
    for (const hs of hand.seats) {
      const seat = this.seats[hs.seat];
      if (seat) seat.stack = hs.stack;
      // Snapshot hole cards so players can voluntarily show them in the pause.
      this.lastHandCards.set(hs.seat, hs.cards);
    }
    this.lastRevealSeats = new Set(result.revealSeats);
    this.lastBoard = hand.board.slice();
    // Snapshot the board that never came, before the deck goes away.
    this.rabbitCards = this.rabbitHunting ? hand.peekRunout() : [];
    this.rabbitShown = false;

    this.lastResults = result.awards.map(a => {
      // The exact five cards forming the winning hand (for board highlighting).
      let bestFive: CardT[] | null = null;
      if (a.handName) {
        const hs = hand.seats.find(s => s.seat === a.seat);
        if (hs) bestFive = bestFiveOf([...hs.cards, ...hand.board]);
      }
      return {
        seatIdx: a.seat,
        name: this.seats[a.seat]?.player.name ?? 'Player',
        amount: a.amount,
        handName: a.handName,
        split: a.split,
        bestFive,
      };
    });

    // Finalize the replayer record before logging awards so the award steps
    // include the final board and reveal state.
    if (this.currentRecord) {
      const rec = this.currentRecord;
      rec.board = hand.board.slice();
      rec.holeCardsFull = hand.seats.map(s => ({ seat: s.seat, cards: s.cards.slice() }));
      for (const seat of result.revealSeats) rec.reveal[seat] = [true, true];
      rec.winners = result.awards.map(a => ({ seat: a.seat, amount: a.amount, handName: a.handName }));
      rec.endedAt = Date.now();
    }

    for (const seat of result.revealSeats) {
      const nm = this.seats[seat]?.player.name ?? 'Player';
      const hs = hand.seats.find(s => s.seat === seat);
      if (hs) this.logEvent(`${nm} shows ${hs.cards.map(c => cardLabel(c)).join(' ')}`);
    }

    for (const a of result.awards) {
      const nm = this.seats[a.seat]?.player.name ?? 'Player';
      const verb = a.split ? 'splits, takes' : 'wins';
      this.logEvent(a.handName
        ? `${nm} ${verb} ${a.amount} with ${a.handName}`
        : `${nm} ${verb} ${a.amount}`);
    }

    // Audit: net chips per player who was still in at the end, so the operator
    // can spot one-way flows between the same two accounts.
    {
      const won = new Map<number, number>();
      for (const a of result.awards) won.set(a.seat, (won.get(a.seat) ?? 0) + a.amount);
      const shown = new Set(result.revealSeats);
      // Everyone who put chips in — folders included. A player who dumps by
      // calling three streets and folding the river never reaches showdown,
      // so limiting this to contenders would miss half the ways to donate.
      const contenders = hand.seats
        .filter(hs => hs.totalCommitted > 0)
        .map(hs => ({
          id: this.seats[hs.seat]?.player.id ?? '',
          name: this.seats[hs.seat]?.player.name ?? 'Player',
          net: (won.get(hs.seat) ?? 0) - hs.totalCommitted,
          cards: hs.cards.slice(),
          committed: hs.totalCommitted,
          startStack: hs.stack + hs.totalCommitted,
          allIn: hs.stack === 0,
          wentToShowdown: !hs.folded && shown.has(hs.seat),
        }))
        .filter(c => c.id);
      if (contenders.length > 0) {
        this.cb.audit?.(this, {
          kind: 'handEnd', contenders,
          board: hand.board.slice(),
          pot: result.awards.reduce((a, x) => a + x.amount, 0),
          tableId: this.id, tableName: this.name, handNumber: this.handNumber,
        });
      }
    }

    // Abandoned-player accounting: a hand in which every one of a player's
    // turns was taken by the clock counts against them. Making a real decision
    // clears it (see applyAction) — that is the only proof somebody is there.
    //
    // The counter is kept for everyone, connected or not; WHAT IT COSTS is
    // decided where the removal happens, because the two cases are not the
    // same. Someone whose connection has dropped is gone. Someone still
    // connected may simply not have opened their table yet, and removing them
    // for that is how registered players who had not played a hand were told
    // they had already finished.
    for (const hs of hand.seats) {
      const seat = this.seats[hs.seat];
      if (!seat) continue;
      if (this.autoActedSeats.has(hs.seat)) seat.ghostHands += 1;
    }

    // Busted players: the tournament eliminates them (onHandEnd).
    const busted: { id: string; name: string; startStack: number }[] = [];
    for (const hs of hand.seats) {
      if (hs.stack === 0) {
        const seat = this.seats[hs.seat];
        if (seat) {
          busted.push({
            id: seat.player.id, name: seat.player.name,
            startStack: hand.seats.find(x => x.seat === hs.seat)!.totalCommitted,
          });
        }
      }
    }

    this.cb.broadcast(this); // showdown state with reveals

    const finishedHand = this.hand;
    this.hand = null;
    this.actionDeadline = null;
    this.actionStarted = null;
    // Second push for the pause window: showdown cards stay visible (via the
    // lastHandCards snapshot) and players get their "show cards" offer.
    this.cb.broadcast(this);

    this.setPacing(() => {
      this.pacingTimer = null;
      void finishedHand;
      this.cb.onHandEnd?.(this, busted);
      if (this.closed) return;
      this.lastResults = null;
      this.scheduleStart();
      this.cb.broadcast(this);
    }, this.interHandDelayMs);
  }

  // Tear down a hand in progress and hand every chip back — used when the
  // director ends a tournament immediately. Nobody wins or loses the hand.
  abortHand() {
    if (!this.hand) return;
    for (const hs of this.hand.seats) {
      const seat = this.seats[hs.seat];
      if (seat) seat.stack = hs.stack + hs.totalCommitted;
    }
    this.hand = null;
    this.clearActionTimer();
    if (this.pacingTimer) { clearTimeout(this.pacingTimer); this.pacingTimer = null; }
    this.actionDeadline = null;
    this.actionStarted = null;
    this.lastResults = null;
    if (this.currentRecord && this.currentRecord.endedAt === null) {
      this.currentRecord.endedAt = Date.now();
    }
    this.logEvent('Hand aborted — all bets returned');
    this.cb.broadcast(this);
  }

  // Session log, replayer hands and chat — carried through restarts so the
  // table's history doesn't vanish when a deploy lands mid-game.
  snapshotHistory() {
    return {
      eventLog: this.eventLog.slice(-150),
      handRecords: this.handRecords.slice(-10),
      chatLog: this.chatLog.slice(-CHAT_KEEP),
    };
  }

  restoreHistory(h: Partial<ReturnType<Table['snapshotHistory']>> | undefined) {
    if (!h) return;
    this.eventLog = h.eventLog ?? [];
    this.handRecords = h.handRecords ?? [];
    this.chatLog = h.chatLog ?? [];
  }

  // Durable snapshot of who sits here with how many chips. A hand in progress
  // is rolled back: everything a player committed to the pot comes back to
  // their stack, as if the hand was never dealt.
  snapshotSeats() {
    const out: {
      idx: number; player: { id: string; name: string; avatar: string };
      stack: number; sittingOut: boolean; timebankMs: number;
    }[] = [];
    for (let i = 0; i < this.seats.length; i++) {
      const s = this.seats[i];
      if (!s) continue;
      const hs = this.hand?.seats.find(x => x.seat === i);
      out.push({
        idx: i,
        player: { ...s.player },
        stack: hs ? hs.stack + hs.totalCommitted : s.stack,
        sittingOut: s.sittingOut,
        timebankMs: s.timebankMs,
      });
    }
    return out;
  }

  // Emoji reaction from a seated player or spectator. Rate limited per person
  // so nobody can spam the felt; the seat index lets the client float it in
  // the right place.
  private lastReactAt = new Map<string, number>();
  react(playerId: string, name: string, emoji: string) {
    const clean = [...emoji].slice(0, 2).join('');
    if (!clean.trim() || this.closed) return;
    const now = Date.now();
    if (now - (this.lastReactAt.get(playerId) ?? 0) < 1_200) return;
    this.lastReactAt.set(playerId, now);
    this.cb.reaction?.(this, {
      id: `${playerId}-${now}`,
      seat: this.playerSeat(playerId),
      name,
      emoji: clean,
      ts: now,
    });
  }

  // Pause means STOP: the hand in progress freezes where it stands. It used to
  // set a flag that only blocked the NEXT hand, so a director who paused
  // watched every table carry on playing — which is not what pausing is for.
  // The hand is not cancelled or rewound; the clock simply stops and nobody
  // may act until play resumes.
  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
      this.pausedClockMs = Math.max(0, (this.actionDeadline ?? Date.now()) - Date.now());
    }
    if (this.pacingTimer) { clearTimeout(this.pacingTimer); this.pacingTimer = null; }
    this.cb.broadcast(this);
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    const seat = this.hand?.actionSeat() ?? null;
    if (this.hand && seat !== null && seat >= 0) {
      // Hand it back with the time that was left on it.
      const left = this.pausedClockMs ?? this.clockMs();
      this.pausedClockMs = null;
      this.actionDeadline = Date.now() + left;
      this.actionStarted = Date.now();
      this.actionTimer = setTimeout(() => this.onActionTimeout(seat), left);
    } else {
      this.pausedClockMs = null;
      this.scheduleStart();
    }
    this.cb.broadcast(this);
  }

  // ---------- operator interventions ----------

  private captureTurn() {
    if (!this.hand) return;
    const h = this.hand;
    const actor = h.actionSeat();
    this.undoStack.push({
      handNumber: this.handNumber,
      hand: {
        seats: structuredClone(h.seats),
        board: structuredClone(h.board),
        deck: structuredClone(h.deck),
        street: h.street,
        currentBet: h.currentBet,
        lastFullRaiseIncrement: h.lastFullRaiseIncrement,
        actionIdx: h.actionIdx,
        finished: h.finished,
        runoutPending: h.runoutPending,
      },
      seatMeta: this.seats.flatMap((st, idx) => (st ? [{
        idx, missedTurns: st.missedTurns, ghostHands: st.ghostHands,
        sittingOut: st.sittingOut, timebankMs: st.timebankMs,
      }] : [])),
      autoActed: [...this.autoActedSeats],
      logLength: this.eventLog.length,
      lastLoggedBoardLen: this.lastLoggedBoardLen,
      actorName: (actor !== null && this.seats[actor]?.player.name) || 'the player',
    });
    // A hand cannot have more decisions than this; the cap stops a marathon
    // hand from holding every state it ever passed through.
    if (this.undoStack.length > 120) this.undoStack.shift();
  }

  canReverseTurn(): boolean {
    return !!this.hand && !this.hand.finished
      && this.undoStack.some(u => u.handNumber === this.handNumber);
  }

  // Put the last action back. Scoped to the hand in progress on purpose: once
  // a hand is paid out the pot is gone and "undo" would mean inventing chips.
  reverseTurn(): string {
    if (!this.hand) throw new Error('no hand in progress — nothing to reverse');
    if (this.hand.finished) throw new Error('this hand is already over — nothing to reverse');
    const snap = this.undoStack.pop();
    if (!snap || snap.handNumber !== this.handNumber) {
      if (snap) this.undoStack.push(snap); // not ours: leave it alone
      throw new Error('no action has been taken in this hand yet');
    }
    this.clearActionTimer();
    if (this.pacingTimer) { clearTimeout(this.pacingTimer); this.pacingTimer = null; }

    const h = this.hand;
    h.seats = structuredClone(snap.hand.seats);
    h.board = structuredClone(snap.hand.board);
    h.deck = structuredClone(snap.hand.deck);
    h.street = snap.hand.street;
    h.currentBet = snap.hand.currentBet;
    h.lastFullRaiseIncrement = snap.hand.lastFullRaiseIncrement;
    h.actionIdx = snap.hand.actionIdx;
    h.finished = snap.hand.finished;
    h.runoutPending = snap.hand.runoutPending;
    h.result = null;

    for (const m of snap.seatMeta) {
      const st = this.seats[m.idx];
      if (!st) continue;
      st.missedTurns = m.missedTurns;
      st.ghostHands = m.ghostHands;
      st.sittingOut = m.sittingOut;
      st.timebankMs = m.timebankMs;
    }
    this.autoActedSeats = new Set(snap.autoActed);
    this.eventLog.length = Math.min(this.eventLog.length, snap.logLength);
    this.lastLoggedBoardLen = snap.lastLoggedBoardLen;
    this.usingTimebankFor = null;

    const who = snap.actorName;
    this.logEvent(`The host reversed the last turn — back to ${who}`);
    this.systemMsg(`The host reversed the last turn. It is ${who}'s decision again.`);
    this.armActionTimer();
    this.cb.broadcast(this);
    return who;
  }

  // Set a seated player's stack outright. For putting chips back where they
  // belong after a cheat is dealt with; every use is written to the session
  // log, because silently moving chips is indistinguishable from cheating.
  setStack(playerId: string, newStack: number, by: string): { name: string; from: number; to: number } {
    const idx = this.playerSeat(playerId);
    if (idx === null) throw new Error('not seated at this table');
    const seat = this.seats[idx]!;
    if (this.hand && this.handSeatLive(idx)) {
      throw new Error('that player is in a live hand — reverse or finish it first');
    }
    const to = Math.max(0, Math.floor(newStack));
    if (!Number.isFinite(to)) throw new Error('bad amount');
    const from = seat.stack;
    if (to === from) return { name: seat.player.name, from, to };
    seat.stack = to;
    const delta = to - from;
    this.logEvent(
      `${by} adjusted ${seat.player.name}'s stack: ${from} → ${to} (${delta > 0 ? '+' : ''}${delta})`,
    );
    this.systemMsg(`${seat.player.name}'s stack was adjusted by the host (${delta > 0 ? '+' : ''}${delta}).`);
    this.scheduleStart();
    this.cb.broadcast(this);
    return { name: seat.player.name, from, to };
  }

  close() {
    this.closed = true;
    this.clearActionTimer();
    if (this.pacingTimer) { clearTimeout(this.pacingTimer); this.pacingTimer = null; }
  }

  private clearActionTimer() {
    if (this.actionTimer) { clearTimeout(this.actionTimer); this.actionTimer = null; }
  }

  // Only one pacing timer may ever be outstanding. Assigning over a live one
  // orphans it: it still fires later and can start a hand out of turn, and it
  // keeps the process alive. Always route through here.
  private setPacing(fn: () => void, ms: number) {
    if (this.pacingTimer) clearTimeout(this.pacingTimer);
    this.pacingTimer = setTimeout(fn, ms);
  }

  // ---------- session log & hand recording ----------
  // Every game event goes through here: session log + live feed + replayer step.
  private logEvent(text: string) {
    this.eventLog.push({ text, ts: Date.now() });
    if (this.eventLog.length > 800) this.eventLog.shift();
    if (this.hand && this.currentRecord) {
      this.currentRecord.steps.push({
        ts: Date.now(),
        text,
        board: this.hand.board.slice(),
        pot: this.hand.totalPot,
        seats: this.hand.seats.map(s => ({
          seat: s.seat, stack: s.stack, bet: s.committed, folded: s.folded, allIn: s.allIn,
        })),
      });
    }
    this.cb.event(this, text);
  }

  // Hand history with hole cards redacted for this viewer.
  historyView(viewerId: string | null): HandHistoryEntry[] {
    return this.handRecords.map(rec => {
      const { holeCardsFull, reveal, ...pub } = rec;
      return {
        ...pub,
        steps: rec.steps,
        holeCards: holeCardsFull.map(h => {
          const p = rec.players.find(pl => pl.seat === h.seat);
          const own = viewerId !== null && p?.id === viewerId;
          const rv = reveal[h.seat];
          if (own || (rv?.[0] && rv?.[1])) return { seat: h.seat, cards: h.cards.slice() };
          if (rv && (rv[0] || rv[1])) {
            return { seat: h.seat, cards: [rv[0] ? h.cards[0] : null, rv[1] ? h.cards[1] : null] };
          }
          return { seat: h.seat, cards: [null, null] };
        }),
      };
    });
  }

  // ---------- chat ----------
  systemMsg(text: string) {
    const msg: ChatMsg = { id: randomUUID().slice(0, 10), from: 'system', text, ts: Date.now() };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.shift();
    this.cb.chat(this, msg);
  }

  private lastChatAt = new Map<string, number>();

  // Everyone the viewer could reasonably tag at this table.
  // Everyone it makes sense to tag here: whoever is seated, plus anyone who
  // has spoken. Seats alone was wrong — a spectator, or a player who stood up
  // after posting, could be named in chat and read as tagging nobody.
  chatPeople(): { id: string; name: string }[] {
    const out = new Map<string, string>();
    for (const s of this.seats) if (s) out.set(s.player.id, s.player.name);
    for (const m of this.chatLog) {
      if (m.from === 'system') continue;
      out.set(m.from.id, m.from.name);
    }
    return [...out].map(([id, name]) => ({ id, name }));
  }

  userMsg(player: { id: string; name: string; avatar: string }, text: string, replyToId?: string) {
    const clean = text.slice(0, 300).trim();
    if (!clean) return;
    if (isBlocked(clean)) throw new Error('That message was blocked.');
    const now = Date.now();
    const waited = now - (this.lastChatAt.get(player.id) ?? 0);
    if (waited < CHAT_COOLDOWN_MS) {
      throw new Error(`Slow down — ${Math.ceil((CHAT_COOLDOWN_MS - waited) / 1000)}s before your next message`);
    }
    const { ids, count } = resolveMentions(clean, this.chatPeople());
    if (count > MAX_MENTIONS) {
      throw new Error(`At most ${MAX_MENTIONS} @mentions per message`);
    }
    this.lastChatAt.set(player.id, now);
    const replyTo = resolveReply(replyToId, this.chatLog);
    const msg: ChatMsg = {
      id: randomUUID().slice(0, 10), from: player, text: clean, ts: Date.now(),
      ...(ids.length ? { mentions: ids } : {}),
      ...(replyTo ? { replyTo } : {}),
    };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.shift();
    this.cb.chat(this, msg);
  }

  // Compact snapshot for the all-tables spectate screen — no hole cards, so
  // it is safe to broadcast to everyone and cheap at 50+ tables.
  overview(): TableOverview {
    const hand = this.hand;
    const seats: TableOverviewSeat[] = [];
    let chipLeader = 0;
    this.seats.forEach((s, i) => {
      if (!s) return;
      const hs = hand?.seats.find(x => x.seat === i) ?? null;
      const stack = hs ? hs.stack : s.stack;
      if (stack > chipLeader) chipLeader = stack;
      seats.push({
        idx: i,
        name: s.player.name,
        avatar: s.player.avatar,
        stack,
        folded: hs ? hs.folded : false,
        allIn: hs ? hs.allIn : false,
        isTurn: hand ? hand.actionSeat() === i : false,
        isDealer: i === this.buttonSeat && !!hand,
      });
    });
    return {
      id: this.id,
      name: this.name,
      maxSeats: this.maxSeats,
      handNumber: this.handNumber,
      street: hand ? hand.street : 'waiting',
      totalPot: hand ? hand.totalPot : 0,
      community: hand ? hand.board : this.lastBoard,
      seats,
      chipLeader,
    };
  }

  // ---------- views ----------
  view(viewerId: string | null): TableView {
    const hand = this.hand;
    const showdown = !!hand && hand.street === 'showdown';
    // Post-hand pause: no live hand but results still on screen.
    const pauseShow = !hand && !!this.lastResults;
    const reveal = new Set<number>(
      showdown && hand?.result ? hand.result.revealSeats
        : pauseShow ? this.lastRevealSeats : [],
    );
    const awardsBySeat = new Map<number, { amount: number; handName: string | null; split: boolean }>();
    if (this.lastResults) {
      for (const r of this.lastResults) {
        awardsBySeat.set(r.seatIdx, { amount: r.amount, handName: r.handName, split: r.split });
      }
    }

    const seats: SeatView[] = this.seats.map((s, i) => {
      if (!s) {
        return {
          idx: i, player: null, stack: 0, bet: 0, folded: false, allIn: false,
          sittingOut: false, missedTurns: 0, offline: false,
          isDealer: false, isTurn: false, lastAction: null, cards: null,
        };
      }
      const hs = hand?.seats.find(x => x.seat === i) ?? null;
      const isSelf = s.player.id === viewerId;
      let cards: (CardT | null)[] | null = null;
      if (hs) {
        if (isSelf || reveal.has(i)) cards = hs.cards;
        else if (!hs.folded) cards = [null, null]; // face-down backs
      } else if (pauseShow) {
        // Keep showdown reveals (and voluntary shows) visible during the pause.
        const held = this.lastHandCards.get(i);
        if (held) {
          if (isSelf || reveal.has(i)) cards = held;
          else {
            const pr = this.postReveals.get(i);
            if (pr && (pr[0] || pr[1])) cards = [pr[0] ? held[0] : null, pr[1] ? held[1] : null];
          }
        }
      }
      const award = awardsBySeat.get(i);
      const offline = !isOnline(s.player.id);
      return {
        idx: i,
        player: withChog({ id: s.player.id, name: s.player.name, avatar: s.player.avatar }),
        stack: hs ? hs.stack : s.stack,
        bet: hs ? hs.committed : 0,
        folded: hs ? hs.folded : false,
        allIn: hs ? hs.allIn : false,
        sittingOut: s.sittingOut,
        missedTurns: s.missedTurns,
        offline,
        isDealer: i === this.buttonSeat && !!hand,
        isTurn: hand ? hand.actionSeat() === i : false,
        lastAction: hs?.lastAction ?? null,
        cards,
        handName: reveal.has(i) && award?.handName ? award.handName : undefined,
        won: award?.amount,
        wonSplit: award?.split,
      };
    });

    // Live hand strength for the viewer.
    let myHandName: string | null = null;
    if (hand && viewerId) {
      const myIdx = this.playerSeat(viewerId);
      const hs = myIdx !== null ? hand.seats.find(x => x.seat === myIdx) : null;
      if (hs) myHandName = describeCards(hs.cards, hand.board);
    }

    // Pots view.
    const pots: PotView[] = [];
    if (hand) {
      const streetBets = hand.seats.reduce((a, s) => a + s.committed, 0);
      const collected = hand.totalPot - streetBets;
      if (collected > 0) pots.push({ amount: collected, label: 'Pot' });
    }

    const mySeat = viewerId ? this.playerSeat(viewerId) : null;
    let myLegal: LegalActions | null = null;
    if (hand && mySeat !== null && hand.actionSeat() === mySeat) {
      const l = hand.legalActions();
      if (l) myLegal = { ...l };
    }

    return {
      id: this.id,
      name: this.name,
      tournamentId: this.tournamentId,
      maxSeats: this.maxSeats,
      seats,
      // Keep the final board up through the post-hand pause so the winning
      // hand is still readable after the hand object is gone.
      community: hand ? hand.board : this.lastBoard,
      pots,
      totalPot: hand ? hand.totalPot : 0,
      street: hand ? hand.street : 'waiting',
      handNumber: this.handNumber,
      blinds: { sb: this.sb, bb: this.bb, ante: this.ante },
      displayMode: this.displayMode,
      actionOn: hand ? hand.actionSeat() : null,
      actionDeadline: this.actionDeadline,
      actionStarted: this.actionStarted,
      myLegal,
      mySeat,
      myHandName,
      canReverseTurn: this.canReverseTurn(),
      myCanReveal: pauseShow && mySeat !== null
        && this.lastHandCards.has(mySeat) && !reveal.has(mySeat),
      rabbitAvailable: pauseShow && this.rabbitCards.length > 0 && !this.rabbitShown,
      rabbit: this.rabbitShown ? this.rabbitCards : null,
      lastResults: this.lastResults,
      paused: this.paused,
      spectators: this.spectators.size,
      actionSeconds: Math.round(this.actionTimeMs / 1000),
      rabbitHuntingOn: this.rabbitHunting,
      timebankSeconds: Math.round(this.timebankMs / 1000),
      closed: this.closed,
      tourney: this.tourneyInfo?.() ?? null,
      myRank: viewerId ? this.rankOf?.(viewerId) ?? null : null,
      theme: this.theme,
      myTimebankSeconds: mySeat !== null
        ? Math.round((this.seats[mySeat]?.timebankMs ?? 0) / 1000)
        : null,
    };
  }

  // Broadcast fast path. Building view() per subscriber made each broadcast
  // O(viewers × full build); under 500 connections the per-tick bursts were
  // the dominant latency cost. The spectator view is built once, and each
  // seated viewer gets a shallow copy patched with only what is theirs:
  // their own hole cards and the my* fields. Nothing else differs by viewer.
  personalize(base: TableView, viewerId: string | null): TableView {
    if (!viewerId) return base;
    const mySeat = this.playerSeat(viewerId);
    if (mySeat === null) return base;

    const hand = this.hand;
    const pauseShow = !hand && !!this.lastResults;
    const hs = hand?.seats.find(x => x.seat === mySeat) ?? null;
    const myCards = hs ? hs.cards : pauseShow ? this.lastHandCards.get(mySeat) ?? null : null;

    let seats = base.seats;
    const baseSeat = base.seats[mySeat];
    // Only patch when the shared view doesn't already show these cards
    // face-up (showdown reveals are in the base for everyone).
    if (myCards && baseSeat && (!baseSeat.cards || baseSeat.cards.some(c => c === null))) {
      seats = base.seats.slice();
      seats[mySeat] = { ...baseSeat, cards: myCards };
    }

    let myHandName: string | null = null;
    // Shown even after folding: players want to see what they gave up.
    if (hand && hs) myHandName = describeCards(hs.cards, hand.board);

    let myLegal: LegalActions | null = null;
    if (hand && hand.actionSeat() === mySeat) {
      const l = hand.legalActions();
      if (l) myLegal = { ...l };
    }

    return {
      ...base,
      seats,
      mySeat,
      myHandName,
      myLegal,
      canReverseTurn: this.canReverseTurn(),
      myCanReveal: pauseShow && this.lastHandCards.has(mySeat)
        && !this.lastRevealSeats.has(mySeat),
      myRank: this.rankOf?.(viewerId) ?? null,
      myTimebankSeconds: Math.round((this.seats[mySeat]?.timebankMs ?? 0) / 1000),
    };
  }
}
