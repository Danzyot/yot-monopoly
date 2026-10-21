// One tournament as plain data, and the rules that move it on. No rooms, no
// sockets, no timers: the manager (manager.ts) opens the tables through each
// game's adapter, watches them and reports back here. Time and the shuffle
// are injected, so tests can replay any event exactly.
//
// The format: registration until the start (or until full, when capped);
// then rounds of parallel tables, seated at random and balanced; the top
// `advance` players of each table go through (byes when the numbers do not
// fit tables of three or more); a round small enough for one table is the
// final, and its winner is the champion. Everyone gets a place, 1..N, when it
// finishes; a cancelled event places nobody.

import {
  TOURNEY_BREAK_MS, TOURNEY_TABLE_RANGE,
  type TableStatus, type TournamentGame, type TournamentSettings, type TournamentStatus,
} from '../../../shared/tournaments.ts';

export class TournamentError extends Error {}

function fail(msg: string): never {
  throw new TournamentError(msg);
}

export interface Member {
  id: string;
  name: string;
  avatar: string;
  /**
   * The Chog Genesis token they asked to play as. Only a wish: the room seats
   * it through its own wallet check (holdsChog), as at any other table.
   */
  chogToken?: number;
}

export interface Entrant extends Member {
  /** When they registered. */
  at: number;
  /** Taken out by an operator: never goes through again. */
  removed?: boolean;
}

export interface TableData {
  /** "r2t3": round 2, table 3. */
  id: string;
  /** The game room's code once it is open. */
  code: string | null;
  status: TableStatus;
  /** Assigned players, in seating order. */
  players: string[];
  /** Have opened the table (seen connected). */
  arrived: string[];
  /** Had not arrived when the seating clock ran out. */
  noShows: string[];
  /** Finishing order of the assigned players (winner first, no-shows last). */
  order: string[] | null;
  openedAt: number | null;
  /** Waiting: when the game starts without whoever is missing. */
  startsBy: number | null;
  startedAt: number | null;
  /** When the round's time limit is up. */
  endsAt: number | null;
  byTime?: boolean;
  walkover?: boolean;
  /** Times the room was lost (a restart that could not bring it back) and opened again. */
  reopened?: number;
}

export interface RoundData {
  n: number;
  final: boolean;
  advance: number;
  tables: TableData[];
  byes: string[];
  startedAt: number;
  finishedAt: number | null;
}

export interface TournamentData {
  id: string;
  game: TournamentGame;
  name: string;
  prize: string;
  hostId: string;
  hostName: string;
  createdAt: number;
  status: TournamentStatus;
  paused: { by: string; at: number } | null;
  settings: TournamentSettings;
  entrants: Entrant[];
  rounds: RoundData[];
  /** Player ids, 1st place first (set when the event is over). */
  places: string[];
  startedAt: number | null;
  finishedAt: number | null;
  /** Between rounds: when the next one is seated. */
  nextRoundAt: number | null;
  cancelReason: string | null;
  /** Created by a recurring schedule: which one, the occurrence's start, and its number (schedules.ts). */
  schedule?: { id: string; slot: number; n: number };
}

/**
 * A tournament without a cap still stops taking entrants here: a safety bound
 * for the server, far beyond any real event, and never shown to players.
 */
export const MAX_ENTRANTS = 1000;

/** A room that could not be brought back is opened again this often before its seat order stands as the result. */
const MAX_REOPEN = 2;

/**
 * How a round of `n` players sits down: balanced tables of `min`..`tableSize`
 * (sizes differ by at most one), the fewest tables that hold everyone. When
 * that cannot be done without a table under `min`, the surplus get byes.
 * Up to `tableSize` players is one table: the final.
 */
export function planRound(n: number, tableSize: number, min = 3): { sizes: number[]; byes: number; final: boolean } {
  if (n <= tableSize) return { sizes: n > 0 ? [n] : [], byes: 0, final: true };
  let k = Math.ceil(n / tableSize);
  let byes = 0;
  if (Math.floor(n / k) < min) {
    k = Math.max(1, Math.floor(n / min));
    byes = Math.max(0, n - k * tableSize);
  }
  const seated = n - byes;
  const base = Math.floor(seated / k);
  const extra = seated % k;
  return { sizes: Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0)), byes, final: false };
}

/** Players going through from a table of `seats`: never all of them, so every table knocks someone out. */
export function effectiveAdvance(advance: number, seats: number): number {
  return Math.max(0, Math.min(advance, seats - 1));
}

export function shuffled<T>(items: readonly T[], rng: (n: number) => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** What the manager must do to start a table's game. */
export interface TableBegin {
  /** Seats to clear before the start (no-shows, when they are dropped). */
  drop: string[];
  /** Bots to add (the host allowed filling). */
  bots: number;
}

export class Tournament {
  constructor(public d: TournamentData, private now: () => number, private rng: (n: number) => number) {}

  get id(): string { return this.d.id; }
  get live(): boolean { return this.d.status === 'registering' || this.d.status === 'running'; }

  entrant(id: string): Entrant | undefined {
    return this.d.entrants.find(e => e.id === id);
  }

  requireHost(id: string, isAdmin: boolean) {
    if (!isAdmin && id !== this.d.hostId) fail('Only the host can do that');
  }

  currentRound(): RoundData | null {
    return this.d.rounds.at(-1) ?? null;
  }

  // ---- registration ----------------------------------------------------------

  register(m: Member) {
    if (this.d.status !== 'registering') fail('Registration is closed');
    if (this.entrant(m.id)) fail('You are already registered');
    if (this.d.entrants.length >= (this.d.settings.maxPlayers ?? MAX_ENTRANTS)) fail('The tournament is full');
    this.d.entrants.push({ id: m.id, name: m.name, avatar: m.avatar, at: this.now(), ...(m.chogToken !== undefined ? { chogToken: m.chogToken } : {}) });
  }

  unregister(id: string) {
    if (this.d.status !== 'registering') fail('The tournament has started — you can no longer withdraw');
    if (!this.entrant(id)) fail('You are not registered');
    this.d.entrants = this.d.entrants.filter(e => e.id !== id);
  }

  /** Operators only: off the list before the start; out (never through again) once running. Returns their live table, if any. */
  remove(playerId: string, isAdmin: boolean): TableData | null {
    if (!isAdmin) fail('Only operators can remove players');
    const e = this.entrant(playerId) ?? fail('Not in this tournament');
    if (this.d.status === 'registering') {
      this.d.entrants = this.d.entrants.filter(x => x !== e);
      return null;
    }
    if (this.d.status !== 'running') fail('The tournament is over');
    e.removed = true;
    const t = this.currentRound()?.tables.find(x => x.players.includes(playerId) && x.status !== 'done');
    return t ?? null;
  }

  setPrize(by: string, isAdmin: boolean, prize: string) {
    this.requireHost(by, isAdmin);
    if (!this.live) fail('The tournament is over');
    this.d.prize = prize;
  }

  // ---- host controls ---------------------------------------------------------

  start(by: string, isAdmin: boolean) {
    this.requireHost(by, isAdmin);
    this.begin();
  }

  /** The scheduled start: begin, or call it off when too few have registered. True when it began. */
  scheduledStart(): boolean {
    if (this.d.entrants.length < this.d.settings.minPlayers) {
      this.end('cancelled', `Not enough players registered (${this.d.entrants.length} of the ${this.d.settings.minPlayers} needed)`);
      return false;
    }
    this.begin();
    return true;
  }

  private begin() {
    if (this.d.status !== 'registering') fail('The tournament has already started');
    const n = this.d.entrants.length;
    if (n < this.d.settings.minPlayers) fail(`Need at least ${this.d.settings.minPlayers} players to start (${n} registered)`);
    this.d.status = 'running';
    this.d.startedAt = this.now();
    this.d.paused = null;
    this.seatRound();
  }

  pause(by: string, byName: string, isAdmin: boolean) {
    this.requireHost(by, isAdmin);
    if (this.d.status !== 'running') fail('Only a running tournament can be paused');
    if (this.d.paused) fail(`Already paused by ${this.d.paused.by}`);
    this.d.paused = { by: byName, at: this.now() };
  }

  /** Every clock the pause froze moves on by its length. `by` null: the pause ran out by itself. */
  resume(by: string | null, isAdmin: boolean) {
    if (by !== null) this.requireHost(by, isAdmin);
    const p = this.d.paused ?? fail('The tournament is not paused');
    this.shiftClocks(this.now() - p.at);
    this.d.paused = null;
  }

  /** Moves every running deadline on by `ms` (a pause, or the server being down). */
  shiftClocks(ms: number) {
    if (ms <= 0) return;
    if (this.d.nextRoundAt !== null) this.d.nextRoundAt += ms;
    for (const t of this.currentRound()?.tables ?? []) {
      if (t.status === 'waiting' && t.startsBy !== null) t.startsBy += ms;
      if (t.status === 'playing' && t.endsAt !== null) t.endsAt += ms;
    }
  }

  /** Host or operator calls it off. Returns the tables whose rooms should be closed. */
  cancel(by: string, isAdmin: boolean, reason: string): TableData[] {
    this.requireHost(by, isAdmin);
    if (!this.live) fail('The tournament is already over');
    const open = (this.currentRound()?.tables ?? []).filter(t => t.code && t.status !== 'done');
    this.end('cancelled', reason);
    return open;
  }

  private end(status: 'finished' | 'cancelled', reason: string | null) {
    this.d.status = status;
    // A cancelled event places nobody: no champion, nothing on anyone's profile.
    if (status === 'cancelled') this.d.places = [];
    this.d.finishedAt = this.now();
    this.d.paused = null;
    this.d.nextRoundAt = null;
    this.d.cancelReason = reason;
  }

  // ---- rounds ----------------------------------------------------------------

  /** Who is still in: the last round's byes and those going through, or every entrant before round one. */
  contenders(): string[] {
    const last = this.currentRound();
    if (!last) return this.d.entrants.filter(e => !e.removed).map(e => e.id);
    return this.advancers(last);
  }

  /** Seat the next round from whoever is still in. */
  seatRound() {
    const ids = this.contenders();
    const s = this.d.settings;
    const plan = planRound(ids.length, s.tableSize, TOURNEY_TABLE_RANGE[0]);
    const order = shuffled(ids, this.rng);
    // Byes go first to players who have not had one.
    const hadBye = new Set(this.d.rounds.flatMap(r => r.byes));
    const byes = [...order.filter(id => !hadBye.has(id)), ...order.filter(id => hadBye.has(id))].slice(0, plan.byes);
    const seated = order.filter(id => !byes.includes(id));
    const n = this.d.rounds.length + 1;
    let at = 0;
    const tables: TableData[] = plan.sizes.map((size, i) => {
      const players = seated.slice(at, at + size);
      at += size;
      return {
        id: `r${n}t${i + 1}`, code: null, status: 'pending', players, arrived: [], noShows: [], order: null,
        openedAt: null, startsBy: null, startedAt: null, endsAt: null,
      };
    });
    this.d.rounds.push({ n, final: plan.final, advance: s.advance, tables, byes, startedAt: this.now(), finishedAt: null });
    this.d.nextRoundAt = null;
  }

  /** Byes and the first `advance` of each finished table who showed up and are still allowed in. */
  advancers(r: RoundData): string[] {
    return [...r.byes.filter(id => !this.entrant(id)?.removed), ...r.tables.flatMap(t => this.goingThrough(r, t))];
  }

  /** Who goes through from one finished table (none while it plays, and none from a final). */
  goingThrough(r: RoundData, t: TableData): string[] {
    if (!t.order || r.final) return [];
    const k = effectiveAdvance(r.advance, t.players.length);
    return t.order.filter(id => !this.entrant(id)?.removed && !t.noShows.includes(id)).slice(0, k);
  }

  // ---- one table, as the manager reports it -----------------------------------

  table(id: string): TableData | undefined {
    return this.currentRound()?.tables.find(t => t.id === id);
  }

  tableOpened(t: TableData, code: string) {
    t.code = code;
    t.status = 'waiting';
    t.openedAt = this.now();
    t.startsBy = this.now() + this.d.settings.noShowMinutes * 60_000;
  }

  /** Players seen at the table. True when someone new arrived. */
  arrive(t: TableData, here: string[]): boolean {
    const fresh = here.filter(id => t.players.includes(id) && !t.arrived.includes(id));
    t.arrived.push(...fresh);
    return fresh.length > 0;
  }

  /** Everyone is here, or the seating clock ran out. */
  readyToBegin(t: TableData): boolean {
    return t.status === 'waiting' && (t.players.every(id => t.arrived.includes(id)) || this.now() >= (t.startsBy ?? 0));
  }

  /**
   * Decide how the table starts. With no more players present than go
   * through, there is nothing to play for: they go through on a walkover
   * (the table is done and null comes back). Otherwise the game starts with
   * the no-shows dropped (or auto-played, as the host chose).
   */
  beginTable(t: TableData): TableBegin | null {
    const r = this.currentRound()!;
    const present = t.players.filter(id => t.arrived.includes(id) && !this.entrant(id)?.removed);
    t.noShows = t.players.filter(id => !t.arrived.includes(id));
    const k = effectiveAdvance(r.advance, t.players.length);
    if (present.length <= k) {
      t.walkover = true;
      this.tableDone(t, present);
      return null;
    }
    const keep = this.d.settings.noShow === 'autoplay' ? t.players : present;
    const drop = t.players.filter(id => !keep.includes(id));
    const bots = this.d.settings.botsFill ? Math.max(0, this.d.settings.tableSize - keep.length) : 0;
    t.status = 'playing';
    t.startedAt = this.now();
    t.endsAt = this.now() + this.d.settings.roundMinutes * 60_000;
    t.startsBy = null;
    return { drop, bots };
  }

  /**
   * The table's game is over. `order` is the game's finishing order (bots and
   * all); only the assigned players count, those who played first, no-shows
   * after them, anyone the game never saw last.
   */
  tableDone(t: TableData, order: string[], byTime = false) {
    const mine = order.filter(id => t.players.includes(id));
    const played = mine.filter(id => !t.noShows.includes(id));
    const ghosts = mine.filter(id => t.noShows.includes(id));
    const rest = t.players.filter(id => !mine.includes(id));
    t.order = [...new Set([...played, ...ghosts, ...rest.filter(id => !t.noShows.includes(id)), ...rest])];
    t.status = 'done';
    t.startsBy = null;
    if (byTime) t.byTime = true;
  }

  /** The room vanished (a restart it did not survive): open it again, or, after a couple of tries, let the seat order stand. */
  tableLost(t: TableData) {
    t.reopened = (t.reopened ?? 0) + 1;
    if (t.reopened > MAX_REOPEN) {
      this.tableDone(t, t.players);
      return;
    }
    Object.assign(t, { code: null, status: 'pending', arrived: [], noShows: [], order: null, openedAt: null, startsBy: null, startedAt: null, endsAt: null });
    delete t.byTime;
    delete t.walkover;
  }

  /**
   * Every table of the round is done: the event is over after a final, or
   * with one player (or none) left; otherwise the next round is seated after
   * a short break. True when that finished the tournament.
   */
  completeRound(): boolean {
    const r = this.currentRound();
    if (!r || r.finishedAt !== null || r.tables.some(t => t.status !== 'done')) return false;
    r.finishedAt = this.now();
    if (r.final || this.advancers(r).length <= 1) {
      this.d.places = this.placings();
      this.end('finished', null);
      return true;
    }
    this.d.nextRoundAt = this.now() + TOURNEY_BREAK_MS;
    return false;
  }

  /**
   * Places 1..N: the final table's order (or whoever was left standing),
   * then each earlier round's knock-outs, later rounds first. Within a round
   * a table's 3rd beats every table's 4th; equal finishes go by table.
   */
  placings(): string[] {
    const out: string[] = [];
    const add = (id: string) => { if (!out.includes(id)) out.push(id); };
    const rounds = [...this.d.rounds].reverse();
    const last = rounds[0];
    if (last?.final) for (const t of last.tables) for (const id of t.order ?? t.players) add(id);
    else if (last) for (const id of this.advancers(last)) add(id);
    for (const r of rounds) {
      const through = new Set(this.advancers(r));
      const gone: { id: string; pos: number; table: number }[] = [];
      r.tables.forEach((t, ti) => (t.order ?? t.players).forEach((id, pos) => {
        if (!through.has(id)) gone.push({ id, pos, table: ti });
      }));
      gone.sort((a, b) => a.pos - b.pos || a.table - b.table);
      for (const g of gone) add(g.id);
    }
    for (const e of this.d.entrants) add(e.id);
    return out;
  }

  /** The champion, once there is one. */
  champion(): string | null {
    return this.d.status === 'finished' ? this.d.places[0] ?? null : null;
  }
}
