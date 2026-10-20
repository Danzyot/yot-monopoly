// Every tournament on the server: creating them (operators only, Cards only),
// driving their tables through the game's adapter (adapters.ts) once a
// second, and keeping them on the data volume so a restart picks up where it
// left off. The rules of one event are in engine.ts.

import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanName, stripInvisible } from '../auth.ts';
import { readJson, writeJson } from '../jsonstore.ts';
import { DATA_DIR } from '../paths.ts';
import { GAMES } from '../../../shared/brand.ts';
import {
  TOURNEY_AHEAD_DAYS, TOURNEY_CARDS_TARGETS, TOURNEY_GAMES, TOURNEY_MIN_PLAYERS, TOURNEY_NAME_MAX, TOURNEY_NO_SHOW_MINUTES,
  TOURNEY_PAUSE_MAX_MS, TOURNEY_PRIZE_MAX, TOURNEY_ROUND_MINUTES, TOURNEY_TABLE_RANGE, defaultTournamentSettings,
  type EntrantState, type TableLock, type TournamentGame, type TournamentMe, type TournamentResult,
  type TournamentSettings, type TournamentSummary, type TournamentView,
} from '../../../shared/tournaments.ts';
import { MAX_ENTRANTS, Tournament, TournamentError, type Member, type RoundData, type TableData, type TournamentData } from './engine.ts';

export { TournamentError };

/** What the engine needs from a game: open a locked table, watch it, read its result. */
export interface GameAdapter {
  /** After the round's time limit, how long the game's own limit gets before the table is ended outright. */
  readonly graceMs: number;
  /** Open a room in its lobby, seats locked to `lock.seats`, everyone seated but away. Returns the code. */
  open(lock: TableLock, players: Member[], t: TournamentData): string;
  /** Put the lock back on a room restored after a restart. False when the room is gone. */
  attach(code: string, lock: TableLock): boolean;
  /** Assigned players whose seat is connected right now; null when the room is gone. */
  present(code: string): string[] | null;
  /** Clear `drop`, add `bots`, deal. False when the room is gone or could not start. */
  begin(code: string, drop: string[], bots: number): boolean;
  /** The finishing order once the game is over (winner first); null while it runs; 'gone' when the room is. */
  result(code: string): { order: string[]; byTime: boolean } | null | 'gone';
  /** The round is out of time: end the game now on its own tiebreak (points). */
  timeUp(code: string): void;
  /** Pause or resume the game (best effort); null when nothing is running there. */
  isPaused(code: string): boolean | null;
  setPaused(code: string, paused: boolean, by: string): void;
  /** Take an operator-removed player out of a running game. */
  remove(code: string, playerId: string): void;
  /** The tournament no longer needs the room: end what is running, without a result. */
  close(code: string, reason: string): void;
}

export interface ManagerHooks {
  /** A tournament changed: broadcast it (and the list). */
  onChange(t: Tournament): void;
  /** These players were given a table. */
  onSeated?(t: Tournament, table: TableData, round: RoundData): void;
}

export interface ManagerOptions {
  now?: () => number;
  rng?: (n: number) => number;
  /** File on the data volume (tests use their own). */
  file?: string;
  /** Drive every tournament this often; 0 leaves it to tick() (tests). */
  tickMs?: number;
  dir?: string;
}

export interface Requester extends Member {
  isAdmin: boolean;
}

/** Live (upcoming or running) tournaments on the server at once. */
export const MAX_LIVE_TOURNAMENTS = 50;
/** Finished and cancelled events kept for their pages and players' profiles. */
const KEEP_FINISHED = 500;
const SAVE_EVERY_MS = 3_000;

const clean = (raw: unknown, max: number) =>
  Array.from(stripInvisible(String(raw ?? '').normalize('NFKC')).replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();

export class TournamentManager {
  tournaments = new Map<string, Tournament>();
  private locks = new Map<string, TableLock>();
  private dirty = false;
  private writing = false;
  readonly now: () => number;
  private readonly rng: (n: number) => number;
  private readonly file: string;
  private readonly dir: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(private adapters: Record<TournamentGame, GameAdapter>, private hooks: ManagerHooks, opts: ManagerOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? (n => randomInt(n));
    this.file = opts.file ?? 'tournaments.json';
    this.dir = opts.dir ?? DATA_DIR;
    if (opts.tickMs) {
      this.timer = setInterval(() => this.tick(), opts.tickMs);
      this.timer.unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(id: string): Tournament | undefined {
    return this.tournaments.get(String(id));
  }

  require(id: unknown): Tournament {
    return this.get(String(id ?? '')) ?? (() => { throw new TournamentError('No tournament with that id'); })();
  }

  private changed(t: Tournament) {
    this.dirty = true;
    this.hooks.onChange(t);
  }

  // ---- who may create ------------------------------------------------------------

  /** What a viewer may do with the list: only operators create (and run) tournaments. */
  me(p: { id: string; isAdmin?: boolean } | null): TournamentMe {
    return { isAdmin: !!p?.isAdmin };
  }

  /** Checked in this order: operators only, the server's limit, the game, then every setting. */
  create(by: Requester, input: unknown): Tournament {
    const fail = (msg: string): never => { throw new TournamentError(msg); };
    if (!by.isAdmin) fail('Only operators can create tournaments');
    if ([...this.tournaments.values()].filter(t => t.live).length >= MAX_LIVE_TOURNAMENTS) fail('The server is at its tournament limit — try again later');
    const now = this.now();

    const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const game = raw.game as TournamentGame;
    if (!TOURNEY_GAMES.includes(game)) fail(`Tournaments are for ${GAMES.cards.name} only`);
    const name = cleanName(raw.name, TOURNEY_NAME_MAX) || fail('Give the tournament a name (2 characters or more)');
    const prize = clean(raw.prize, TOURNEY_PRIZE_MAX);
    const settings = this.settings(raw.settings);

    const d: TournamentData = {
      id: randomUUID().replace(/-/g, '').slice(0, 10), game, name, prize, hostId: by.id, hostName: by.name,
      createdAt: now, status: 'registering', paused: null, settings, entrants: [], rounds: [], places: [],
      startedAt: null, finishedAt: null, nextRoundAt: null, cancelReason: null,
    };
    const t = new Tournament(d, this.now, this.rng);
    this.tournaments.set(d.id, t);
    this.changed(t);
    return t;
  }

  /** The operator's settings: defaults for anything missing, refused when out of range. */
  private settings(raw: unknown): TournamentSettings {
    const fail = (msg: string): never => { throw new TournamentError(msg); };
    const s = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<Record<keyof TournamentSettings, unknown>>;
    const d = defaultTournamentSettings();
    const int = (v: unknown, dflt: number) => (v === undefined ? dflt : Number.isFinite(Number(v)) ? Math.round(Number(v)) : fail('Bad number'));
    const out: TournamentSettings = { ...d };

    // No cap unless the operator sets one (empty takes everyone).
    if (s.maxPlayers !== undefined && s.maxPlayers !== null && s.maxPlayers !== '') {
      out.maxPlayers = int(s.maxPlayers, 0);
      if (out.maxPlayers < TOURNEY_MIN_PLAYERS) fail(`A tournament needs room for at least ${TOURNEY_MIN_PLAYERS} players`);
      if (out.maxPlayers > MAX_ENTRANTS) fail(`A cap can be at most ${MAX_ENTRANTS} players — or leave it empty for no cap`);
    }
    out.minPlayers = int(s.minPlayers, d.minPlayers);
    if (out.minPlayers < TOURNEY_MIN_PLAYERS || out.minPlayers > (out.maxPlayers ?? MAX_ENTRANTS)) {
      fail(`The minimum must be at least ${TOURNEY_MIN_PLAYERS}${out.maxPlayers ? ' and no more than the cap' : ''}`);
    }

    const [lo, hi] = TOURNEY_TABLE_RANGE;
    out.tableSize = int(s.tableSize, d.tableSize);
    if (out.tableSize < lo || out.tableSize > hi) fail(`Tables seat ${lo} to ${hi} players`);
    out.advance = int(s.advance, d.advance) as 1 | 2;
    if (out.advance !== 1 && out.advance !== 2) fail('One or two players go through from each table');

    out.roundMinutes = int(s.roundMinutes, d.roundMinutes);
    if (!TOURNEY_ROUND_MINUTES.includes(out.roundMinutes)) fail('Pick a round length from the list');
    out.noShowMinutes = int(s.noShowMinutes, d.noShowMinutes);
    if (!TOURNEY_NO_SHOW_MINUTES.includes(out.noShowMinutes)) fail('Pick a seating time from the list');
    if (s.noShow !== undefined) {
      if (s.noShow !== 'drop' && s.noShow !== 'autoplay') fail('Unknown no-show rule');
      out.noShow = s.noShow as TournamentSettings['noShow'];
    }
    if (s.botsFill !== undefined) out.botsFill = s.botsFill === true;

    if (s.startAt !== undefined && s.startAt !== null) {
      const at = int(s.startAt, 0);
      const now = this.now();
      if (at < now + 60_000) fail('Schedule the start at least a minute from now');
      if (at > now + TOURNEY_AHEAD_DAYS * 86_400_000) fail(`Starts can be scheduled up to ${TOURNEY_AHEAD_DAYS} days ahead`);
      out.startAt = at;
    }
    if (s.cardsMatch !== undefined) {
      if (s.cardsMatch !== 'single' && s.cardsMatch !== 'points') fail('Unknown match format');
      out.cardsMatch = s.cardsMatch as TournamentSettings['cardsMatch'];
    }
    out.cardsTarget = int(s.cardsTarget, d.cardsTarget);
    if (!TOURNEY_CARDS_TARGETS.includes(out.cardsTarget)) fail('Pick a points target from the list');
    if (s.cardsMode !== undefined) {
      if (s.cardsMode !== 'classic' && s.cardsMode !== 'chaos') fail('Unknown mode');
      out.cardsMode = s.cardsMode;
    }
    return out;
  }

  // ---- player and host actions ----------------------------------------------------

  register(id: unknown, m: Member) {
    const t = this.require(id);
    t.register(m);
    this.changed(t);
  }

  unregister(id: unknown, playerId: string) {
    const t = this.require(id);
    t.unregister(playerId);
    this.changed(t);
  }

  start(id: unknown, by: Requester) {
    const t = this.require(id);
    t.start(by.id, by.isAdmin);
    this.changed(t);
    this.drive(t);
  }

  pause(id: unknown, by: Requester) {
    const t = this.require(id);
    t.pause(by.id, by.name, by.isAdmin);
    this.pauseTables(t, true, by.name);
    this.changed(t);
  }

  resume(id: unknown, by: Requester) {
    const t = this.require(id);
    t.resume(by.id, by.isAdmin);
    this.pauseTables(t, false, by.name);
    this.changed(t);
    this.drive(t);
  }

  cancel(id: unknown, by: Requester, reason?: unknown) {
    const t = this.require(id);
    const why = clean(reason, 140) || `Cancelled by ${t.d.hostId === by.id ? 'the host' : 'an operator'}`;
    const open = t.cancel(by.id, by.isAdmin, why);
    for (const table of open) this.closeTable(t, table, 'the tournament was cancelled');
    this.changed(t);
  }

  setPrize(id: unknown, by: Requester, prize: unknown) {
    const t = this.require(id);
    t.setPrize(by.id, by.isAdmin, clean(prize, TOURNEY_PRIZE_MAX));
    this.changed(t);
  }

  remove(id: unknown, by: Requester, playerId: unknown) {
    const t = this.require(id);
    const table = t.remove(String(playerId ?? ''), by.isAdmin);
    if (table?.code && table.status === 'playing') this.guard(t, () => this.adapters[t.d.game].remove(table.code!, String(playerId)));
    this.changed(t);
  }

  private pauseTables(t: Tournament, paused: boolean, by: string) {
    const ad = this.adapters[t.d.game];
    for (const table of t.currentRound()?.tables ?? []) {
      if (table.status !== 'playing' || !table.code) continue;
      this.guard(t, () => { if (ad.isPaused(table.code!) === !paused) ad.setPaused(table.code!, paused, by); });
    }
  }

  private closeTable(t: Tournament, table: TableData, reason: string) {
    if (!table.code) return;
    this.guard(t, () => this.adapters[t.d.game].close(table.code!, reason));
    this.locks.delete(table.code);
  }

  /** A bug in one game's adapter must not stop every other tournament. */
  private guard(t: Tournament, fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (e) {
      console.error(`[tournament ${t.id}] table step failed:`, e);
      return false;
    }
  }

  // ---- the clock -------------------------------------------------------------------

  /** Move every live tournament on: scheduled starts, seating, no-shows, time limits, results, next rounds. */
  tick() {
    for (const t of this.tournaments.values()) {
      if (!t.live) continue;
      try {
        this.drive(t);
      } catch (e) {
        console.error(`[tournament ${t.id}] tick failed:`, e);
      }
    }
  }

  private drive(t: Tournament) {
    const now = this.now();
    if (t.d.status === 'registering') {
      if (t.d.settings.startAt !== null && now >= t.d.settings.startAt) {
        t.scheduledStart();
        this.changed(t);
      } else return;
    }
    if (t.d.status !== 'running') return;
    if (t.d.paused) {
      if (now - t.d.paused.at < TOURNEY_PAUSE_MAX_MS) {
        // A table's own pause ends by itself after a few minutes: hold it for as long as the tournament's lasts.
        this.pauseTables(t, true, t.d.paused.by);
        return;
      }
      t.resume(null, true);
      this.pauseTables(t, false, 'the tournament');
      this.changed(t);
    }
    if (t.d.nextRoundAt !== null) {
      if (now < t.d.nextRoundAt) return;
      t.seatRound();
      this.changed(t);
    }
    const round = t.currentRound();
    if (!round) return;
    for (const table of round.tables) this.driveTable(t, round, table);
    if (round.tables.every(x => x.status === 'done') && round.finishedAt === null) {
      for (const table of round.tables) if (table.code) this.locks.delete(table.code);
      t.completeRound();
      this.changed(t);
    }
  }

  private lockFor(t: Tournament, round: RoundData, table: TableData): TableLock {
    return {
      hostId: `tourney-${t.id}`,
      seats: [...table.players],
      info: { id: t.id, name: t.d.name, round: round.n, final: round.final, endsAt: table.endsAt, startsBy: table.startsBy },
    };
  }

  private syncLock(table: TableData) {
    const lock = table.code ? this.locks.get(table.code) : undefined;
    if (!lock) return;
    lock.info.endsAt = table.endsAt;
    lock.info.startsBy = table.status === 'waiting' ? table.startsBy : null;
  }

  private driveTable(t: Tournament, round: RoundData, table: TableData) {
    const ad = this.adapters[t.d.game];
    const now = this.now();
    if (table.status === 'pending') {
      const lock = this.lockFor(t, round, table);
      const members = table.players.map(id => t.entrant(id)!)
        .map(e => ({ id: e.id, name: e.name, avatar: e.avatar, ...(e.chogToken !== undefined ? { chogToken: e.chogToken } : {}) }));
      let code: string;
      try {
        code = ad.open(lock, members, t.d);
      } catch (e) {
        console.error(`[tournament ${t.id}] could not open table ${table.id}:`, e);
        return;
      }
      t.tableOpened(table, code);
      this.locks.set(code, lock);
      this.syncLock(table);
      this.changed(t);
      this.hooks.onSeated?.(t, table, round);
      return;
    }
    const code = table.code;
    if (!code) return;
    if (table.status === 'waiting') {
      const here = ad.present(code);
      if (here === null) {
        t.tableLost(table);
        this.changed(t);
        return;
      }
      if (t.arrive(table, here)) this.changed(t);
      if (!t.readyToBegin(table)) return;
      const plan = t.beginTable(table);
      this.syncLock(table);
      if (!plan) {
        this.closeTable(t, table, 'decided without a game');
      } else if (!ad.begin(code, plan.drop, plan.bots)) {
        t.tableLost(table);
      }
      this.changed(t);
      return;
    }
    if (table.status === 'playing') {
      let r = ad.result(code);
      if (r === null && table.endsAt !== null && now >= table.endsAt + ad.graceMs) {
        this.guard(t, () => ad.timeUp(code));
        r = ad.result(code);
        if (r && r !== 'gone') r = { ...r, byTime: true };
      }
      if (r === 'gone') {
        t.tableLost(table);
        this.changed(t);
      } else if (r) {
        t.tableDone(table, r.order, r.byTime);
        this.locks.delete(code);
        this.changed(t);
      }
    }
  }

  // ---- what clients see -------------------------------------------------------------

  summary(t: Tournament): TournamentSummary {
    const d = t.d;
    const champ = t.champion();
    return {
      id: d.id, game: d.game, name: d.name, prize: d.prize, hostName: d.hostName,
      status: d.status, paused: !!d.paused, entrants: d.entrants.length, maxPlayers: d.settings.maxPlayers,
      startAt: d.settings.startAt, startedAt: d.startedAt, finishedAt: d.finishedAt,
      round: d.status === 'running' ? d.rounds.length || null : null,
      champion: champ ? { id: champ, name: t.entrant(champ)?.name ?? '?' } : null,
    };
  }

  /** Upcoming and live events, then the latest finished ones. */
  list(finished = 30): TournamentSummary[] {
    const all = [...this.tournaments.values()];
    const live = all.filter(t => t.live).sort((a, b) =>
      Number(a.d.status !== 'running') - Number(b.d.status !== 'running')
      || (a.d.settings.startAt ?? a.d.createdAt) - (b.d.settings.startAt ?? b.d.createdAt));
    const done = all.filter(t => !t.live).sort((a, b) => (b.d.finishedAt ?? 0) - (a.d.finishedAt ?? 0)).slice(0, finished);
    return [...live, ...done].map(t => this.summary(t));
  }

  view(t: Tournament): TournamentView {
    const d = t.d;
    const person = (id: string) => {
      const e = t.entrant(id);
      return { id, name: e?.name ?? '?', avatar: e?.avatar ?? '🎩' };
    };
    const place = new Map(d.places.map((id, i) => [id, i + 1]));
    const last = t.currentRound();
    const stateOf = (id: string): EntrantState => {
      if (d.status === 'registering' || (d.status === 'cancelled' && !last)) return 'registered';
      if (d.status === 'finished') return place.get(id) === 1 ? 'champion' : 'out';
      if (!last || d.status === 'cancelled') return 'out';
      if (last.byes.includes(id)) return 'through';
      const table = last.tables.find(x => x.players.includes(id));
      if (!table) return 'out';
      if (table.status !== 'done') return 'playing';
      return t.goingThrough(last, table).includes(id) ? 'through' : 'out';
    };
    return {
      id: d.id, game: d.game, name: d.name, prize: d.prize, hostId: d.hostId, hostName: d.hostName,
      status: d.status, paused: d.paused ? { ...d.paused } : null, settings: { ...d.settings },
      createdAt: d.createdAt, startedAt: d.startedAt, finishedAt: d.finishedAt,
      entrants: d.entrants.map(e => ({
        id: e.id, name: e.name, avatar: e.avatar, state: stateOf(e.id), ...(place.has(e.id) ? { place: place.get(e.id) } : {}),
      })),
      rounds: d.rounds.map(r => ({
        n: r.n, final: r.final, advance: r.advance, startedAt: r.startedAt, finishedAt: r.finishedAt,
        byes: r.byes.map(id => ({ id, name: person(id).name })),
        tables: r.tables.map(x => {
          const goes = new Set(t.goingThrough(r, x));
          return {
            id: x.id, code: x.code, status: x.status, startsBy: x.status === 'waiting' ? x.startsBy : null,
            startedAt: x.startedAt, endsAt: x.endsAt,
            ...(x.byTime ? { byTime: true } : {}), ...(x.walkover ? { walkover: true } : {}),
            players: x.players.map(id => {
              const finish = x.order ? x.order.indexOf(id) + 1 : 0;
              return {
                ...person(id), arrived: x.arrived.includes(id),
                ...(x.noShows.includes(id) ? { noShow: true } : {}),
                ...(finish > 0 ? { finish } : {}),
                ...(goes.has(id) ? { through: true } : {}),
              };
            }),
          };
        }),
      })),
      places: d.places.map((id, i) => ({ place: i + 1, ...person(id) })),
      nextRoundAt: d.nextRoundAt, cancelReason: d.cancelReason, now: this.now(),
    };
  }

  /** Finished tournaments a player took part in, latest first (their profile). */
  resultsOf(playerId: string, limit = 20): TournamentResult[] {
    return [...this.tournaments.values()]
      .filter(t => t.d.status === 'finished' && t.d.places.includes(playerId))
      .sort((a, b) => (b.d.finishedAt ?? 0) - (a.d.finishedAt ?? 0))
      .slice(0, limit)
      .map(t => ({
        id: t.id, game: t.d.game, name: t.d.name, place: t.d.places.indexOf(playerId) + 1,
        of: t.d.places.length, endedAt: t.d.finishedAt ?? 0,
      }));
  }

  // ---- persistence ---------------------------------------------------------------------

  private snapshot(): { savedAt: number; tournaments: TournamentData[] } {
    const all = [...this.tournaments.values()];
    const done = all.filter(t => !t.live).sort((a, b) => (b.d.finishedAt ?? 0) - (a.d.finishedAt ?? 0));
    // Old finished events beyond the keep limit are forgotten here and on disk.
    for (const t of done.slice(KEEP_FINISHED)) this.tournaments.delete(t.id);
    return { savedAt: this.now(), tournaments: [...this.tournaments.values()].map(t => t.d) };
  }

  /** Synchronous and unconditional (the way out; tests). */
  saveNow() {
    try {
      writeJson(this.file, this.snapshot());
      this.dirty = false;
    } catch (e) {
      console.error('Could not save tournaments:', e);
    }
  }

  /** The periodic save: only when something changed, off the event loop. */
  async saveIfDirty(): Promise<boolean> {
    if (this.writing || !this.dirty) return false;
    this.dirty = false;
    this.writing = true;
    try {
      const data = JSON.stringify(this.snapshot());
      await mkdir(this.dir, { recursive: true });
      const file = join(this.dir, this.file);
      await writeFile(`${file}.async.tmp`, data);
      await rename(`${file}.async.tmp`, file);
      return true;
    } catch (e) {
      this.dirty = true;
      console.error('Could not save tournaments:', e);
      return false;
    } finally {
      this.writing = false;
    }
  }

  armPersistence() {
    setInterval(() => { void this.saveIfDirty(); }, SAVE_EVERY_MS).unref();
    // After the rooms' own save on SIGTERM/SIGINT (persist.ts exits; 'exit' runs then).
    process.once('exit', () => {
      // A table that finished in the last second is read before it is saved.
      try { this.tick(); } catch { /* saving matters more */ }
      this.saveNow();
    });
  }

  /**
   * Load the saved events and put every open table's lock back on its room
   * (restored by the game's own snapshot). Deadlines move on by the time the
   * server was down, as the games' own clocks do. Returns how many are live.
   */
  restore(): number {
    const saved = readJson<{ savedAt?: number; tournaments?: TournamentData[] }>(this.file, {});
    const list = Array.isArray(saved.tournaments) ? saved.tournaments : [];
    const down = Math.max(0, this.now() - (Number(saved.savedAt) || this.now()));
    let live = 0;
    for (const d of list) {
      try {
        if (!d || typeof d.id !== 'string') continue;
        // Monopoly tournaments were retired: an old one is left out (its tables are ordinary rooms the idle sweep clears).
        if (!TOURNEY_GAMES.includes(d.game)) {
          console.warn(`Skipping tournament ${d.id}: ${String(d.game)} tournaments are no longer run`);
          continue;
        }
        const t = new Tournament(d, this.now, this.rng);
        this.tournaments.set(d.id, t);
        if (!t.live) continue;
        live++;
        if (d.paused) d.paused.at += down;
        else t.shiftClocks(down);
        const round = t.currentRound();
        if (d.status !== 'running' || !round) continue;
        for (const table of round.tables) {
          if (!table.code || table.status === 'done') continue;
          const lock = this.lockFor(t, round, table);
          if (this.adapters[d.game].attach(table.code, lock)) {
            this.locks.set(table.code, lock);
            this.syncLock(table);
          } else if (table.status === 'waiting') {
            t.tableLost(table);
          }
          // A playing table whose room is gone is noticed (and reopened) by the next tick.
        }
      } catch (e) {
        console.error(`Could not restore tournament ${d?.id}:`, e);
      }
    }
    this.dirty = true;
    return live;
  }
}
