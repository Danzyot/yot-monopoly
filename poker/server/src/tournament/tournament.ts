import { randomUUID, randomInt } from 'node:crypto';
import type {
  BlindLevel, ChatMsg, PayoutEntry, SocialProgress, StandingEntry, TournamentConfig,
  TableReaction, TournamentState, TournamentTablesView, TournamentView,
} from '../../../shared/types.ts';
import { Table, type AuditEntry } from '../engine/table.ts';
import { buildCustomStructure, generateStructure, parseCustomLevels } from './blinds.ts';
import { computePayouts } from './payouts.ts';
import { CHAT_COOLDOWN_MS, isBlocked, MAX_MENTIONS, resolveMentions, resolveReply } from '../chatrules.ts';
import { logGameEvent } from '../eventlog.ts';
import { isOnline } from '../presence.ts';

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));

// The late clock as the host sent it, or null for off. Anything that is not
// an object with a sensible player count and number of seconds is off, so an
// old client that never heard of it creates exactly what it used to.
export const LATE_CLOCK_DEFAULT = { players: 30, extraSeconds: 10 };
export function parseLateClock(v: unknown): { players: number; extraSeconds: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { players?: unknown; extraSeconds?: unknown };
  const players = Math.floor(Number(o.players ?? LATE_CLOCK_DEFAULT.players));
  const extra = Math.floor(Number(o.extraSeconds ?? LATE_CLOCK_DEFAULT.extraSeconds));
  if (!Number.isFinite(players) || !Number.isFinite(extra) || players < 2 || extra < 1) return null;
  return { players: clamp(players, 2, 1000), extraSeconds: clamp(extra, 1, 120) };
}

export interface TPlayer {
  id: string;
  name: string;
  avatar: string;
  registeredAt: number;
  tableId: string | null;
  seatIdx: number | null;
  busted: boolean;
  place: number | null;
  prize: number | null;
  discord: { id: string; username: string } | null;
  discordVerified: boolean;
  entries: number; // 1 + re-entries used
  approved: boolean; // host approval (auto when approveRegistrations is off)
  // What they were sitting behind when they went out. Kept so a player put
  // back by the director returns with what they actually had, rather than a
  // fresh stack that would reward being wrongly removed.
  lastStack?: number;
}

export interface TournamentCallbacks {
  broadcastTourney: (t: Tournament) => void;
  broadcastTable: (table: Table) => void;
  tableChat: (table: Table, msg: ChatMsg) => void;
  tableEvent: (table: Table, text: string) => void;
  tableReaction?: (table: Table, r: TableReaction) => void;
  tableAudit?: (table: Table, entry: AuditEntry) => void;
  tourneyChat: (t: Tournament, msg: ChatMsg) => void;
  assigned: (t: Tournament, playerId: string, tableId: string) => void;
  lobbyChanged: () => void;
  // Called once when the tournament completes, with final standings available.
  finished?: (t: Tournament) => void;
  // Called when a single player busts out, with their place and prize set —
  // drives the "you finished Nth" popup on that player's screen.
  eliminated?: (t: Tournament, player: TPlayer) => void;
}

// A player who is offline and has had this many consecutive hands played for
// them by the clock is removed from the tournament — an abandoned seat must
// not force everyone else to grind its blinds down for an hour.
export const GHOST_KICK_HANDS = 5;

// A player who is STILL CONNECTED but has not acted gets far longer. They may
// not have opened their table yet — registration seats you, clicking through
// to the felt is a separate step — and removing them for that told people who
// had never played a hand that they had already finished. A tab abandoned on
// a sleeping phone still clears eventually, just not in five hands.
export const IDLE_KICK_HANDS = 20;

// How long a registered player has to press Join table before the place they
// reserved is given up. Host-configurable per tournament; this is the default.
export const DEFAULT_JOIN_MINUTES = 15;

// Nobody is dealt in the instant the first two people arrive. Without this the
// first pair to press the button would play heads-up while three hundred
// others were still filing in, and the hand everyone waited for would be a
// two-handed one. Tables hold their first deal for this long after the start.
export const SEATING_GRACE_MS = 45_000;

// Opening bet cap: how long it runs by default when the host switches it on,
// and how much of the chips behind them a player may volunteer in one bet or
// raise while it does.
export const DEFAULT_BET_CAP_MINUTES = 15;
export const BET_CAP_FRACTION = 0.5;

// How much conversation an event holds. A long tournament generates a lot of
// it, and the panel is the only record players have.
const CHAT_KEEP = 400;

// A tournament's background clocks — the level timer, the break, the window
// for claiming a seat — are housekeeping. They must fire, but none of them is
// a reason for the process to stay alive on its own: the server's own listener
// is what holds the loop open, and without this a finished-with test or a
// short-lived script hangs for as long as the longest blind level.
function background(t: NodeJS.Timeout): NodeJS.Timeout {
  t.unref?.();
  return t;
}

export class Tournament {
  id: string;
  config: TournamentConfig;
  hostId: string;
  hostName: string;
  state: TournamentState = 'registering';
  createdAt = Date.now();
  startedAt: number | null = null;
  // When the last hand was played. Without it the elapsed clock kept counting
  // after the winner was announced — an event that ran 112 minutes was still
  // ticking upward days later, which made the number meaningless.
  endedAt: number | null = null;
  scheduledStart: number | null = null;
  players = new Map<string, TPlayer>();
  tables = new Map<string, Table>();
  structure: BlindLevel[];
  levelIdx = 0; // index into structure
  actionTimeMs = 20_000; // per-decision clock, editable by the host
  levelEndsAt: number | null = null;
  private levelTimer: NodeJS.Timeout | null = null;
  private breakTimer: NodeJS.Timeout | null = null;
  private pauseRemainingMs: number | null = null;
  private nextPlace = 0; // next finishing place to assign (counts down)
  finalPayouts: PayoutEntry[] | null = null;
  chatLog: ChatMsg[] = [];
  private tableCounter = 0;
  cb: TournamentCallbacks;
  // Winner announcements (server-side secret; never sent to clients).
  discordWebhookUrl: string | null = null;
  // Social requirement confirmations before/without registration.
  socialConfirmations = new Map<string, { x: boolean; ig: boolean; discordJoined: boolean; discordVerified: boolean; discordRoleOk: boolean }>();

  constructor(config: TournamentConfig, host: { id: string; name: string }, cb: TournamentCallbacks, scheduledStart?: number | null) {
    this.id = randomUUID().slice(0, 8);
    this.config = config;
    this.hostId = host.id;
    this.hostName = host.name;
    this.cb = cb;
    this.scheduledStart = scheduledStart ?? null;
    this.actionTimeMs = clamp(Math.floor(config.actionSeconds ?? 20), 5, 120) * 1000;
    this.structure = config.customLevels && config.customLevels.length > 0
      ? buildCustomStructure(config.customLevels)
      : generateStructure(config.structure);
    this.armScheduledStart();
  }

  private scheduleTimer: NodeJS.Timeout | null = null;

  // (Re)arm the auto-start. Held by handle so the host can move or clear the
  // start time after registration has opened — the original timer was
  // anonymous, which made the schedule write-once.
  private armScheduledStart(): void {
    if (this.scheduleTimer) { clearTimeout(this.scheduleTimer); this.scheduleTimer = null; }
    if (!this.scheduledStart || this.state !== 'registering') return;
    const delay = Math.max(0, this.scheduledStart - Date.now());
    this.scheduleTimer = background(setTimeout(() => {
      this.scheduleTimer = null;
      if (this.state !== 'registering') return;
      if (this.approvedPlayers().length >= this.config.minPlayers) this.start();
      else {
        this.scheduledStart = null;
        this.systemChat('Not enough players at scheduled start — host can start manually.');
        this.cb.broadcastTourney(this);
      }
    }, delay));
  }

  get level(): BlindLevel { return this.structure[Math.min(this.levelIdx, this.structure.length - 1)]; }
  get nextLevel(): BlindLevel | null { return this.structure[this.levelIdx + 1] ?? null; }
  get totalEntries(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.approved) n += p.entries;
    return n;
  }
  get prizePool(): number { return this.totalEntries * this.config.buyIn; }
  get lateRegEndsAt(): number | null {
    if (this.startedAt === null || this.config.lateRegMinutes <= 0) return null;
    return this.startedAt + this.config.lateRegMinutes * 60_000;
  }
  // Registering holds your place; clicking Join table is what puts chips in
  // front of you. Players who registered and then were not at their screen
  // when the event started used to be seated anyway, blinded off, and removed
  // — then told they had "already finished" a tournament they never played a
  // hand of. So the seat waits for them.
  //
  // The window runs to the end of late registration, with a floor of fifteen
  // minutes: a short late-reg must not mean a player who is two minutes late
  // has already lost their entry.
  // Time the window spent frozen, given back so a pause never costs a player
  // the chance to claim their seat.
  private joinShiftMs = 0;
  private joinRemainingMs: number | null = null;

  get joinEndsAt(): number | null {
    // Explicitly null, not falsy: a start time of zero is a real instant, and
    // treating it as "never started" left the window unarmed.
    if (this.startedAt === null) return null;
    // While paused the deadline is held out in front of the current instant,
    // so the countdown a waiting player is watching sits still instead of
    // draining to zero and then jumping back up when play resumes.
    if (this.joinRemainingMs !== null) return Date.now() + this.joinRemainingMs;
    return this.startedAt + this.joinWindowMs + this.joinShiftMs;
  }

  get joinWindowMs(): number {
    const mins = this.config.joinMinutes ?? DEFAULT_JOIN_MINUTES;
    return clamp(Math.floor(mins), 1, 240) * 60_000;
  }

  // Time the bet cap spent frozen while the event was paused, handed back so
  // a director's twenty-minute pause does not silently spend the protection
  // the rule was switched on to provide.
  private capShiftMs = 0;
  private pausedAt: number | null = null;

  get betCapWindowMs(): number | null {
    const mins = this.config.betCapMinutes;
    if (mins === null || mins === undefined) return null;
    const n = Math.floor(mins);
    if (!Number.isFinite(n) || n <= 0) return null;
    return clamp(n, 1, 240) * 60_000;
  }

  get betCapEndsAt(): number | null {
    // null, not falsy: a start time of zero is a real instant.
    if (this.startedAt === null) return null;
    const win = this.betCapWindowMs;
    if (win === null) return null;
    // While paused the deadline is held out in front of now, so the countdown
    // players are watching sits still rather than draining through a freeze.
    if (this.pausedAt !== null) {
      return this.startedAt + win + this.capShiftMs + (Date.now() - this.pausedAt);
    }
    return this.startedAt + win + this.capShiftMs;
  }

  get betCapActive(): boolean {
    const ends = this.betCapEndsAt;
    return ends !== null && Date.now() < ends;
  }

  get lateRegOpen(): boolean {
    const ends = this.lateRegEndsAt;
    return this.state === 'running' && ends !== null && Date.now() < ends
      && this.players.size < this.config.maxPlayers;
  }

  alivePlayers(): TPlayer[] {
    return [...this.players.values()].filter(p => p.approved && !p.busted);
  }

  approvedPlayers(): TPlayer[] {
    return [...this.players.values()].filter(p => p.approved);
  }

  pendingPlayers(): TPlayer[] {
    return [...this.players.values()].filter(p => !p.approved);
  }

  // ---------- social requirements ----------
  confirmSocial(playerId: string, patch: { x?: boolean; ig?: boolean; discordJoined?: boolean; discordVerified?: boolean; discordRoleOk?: boolean }) {
    const cur = this.socialConfirmations.get(playerId)
      ?? { x: false, ig: false, discordJoined: false, discordVerified: false, discordRoleOk: false };
    this.socialConfirmations.set(playerId, { ...cur, ...patch });
  }

  socialProgress(playerId: string | null, discordLinked: boolean): SocialProgress {
    const c = playerId ? this.socialConfirmations.get(playerId) : undefined;
    return {
      x: c?.x ?? false,
      ig: c?.ig ?? false,
      discordJoined: (c?.discordJoined || c?.discordVerified) ?? false,
      discordLinked,
      discordVerified: c?.discordVerified ?? false,
      discordRoleOk: c?.discordRoleOk ?? false,
    };
  }

  // Throws with a user-facing message if requirements are not met.
  assertRequirementsMet(player: { id: string; discord?: { id: string; username: string } | null }, discordAuthAvailable: boolean) {
    const req = this.config.social;
    if (!req) return;
    const c = this.socialConfirmations.get(player.id);
    if (req.xUrl && !c?.x) throw new Error('Follow the host on X and tick the checklist first');
    if (req.igUrl && !c?.ig) throw new Error('Follow the host on Instagram and tick the checklist first');
    if (req.discordInviteUrl && !(c?.discordJoined || c?.discordVerified)) {
      throw new Error('Join the Discord server and tick the checklist first');
    }
    if (req.requireDiscord && discordAuthAvailable && !player.discord) {
      throw new Error('Connect your Discord account to register');
    }
    if (req.requireDiscord && req.discordGuildId && discordAuthAvailable && !c?.discordVerified) {
      throw new Error('Discord server membership could not be verified — join the server first');
    }
    if (req.discordRoleId && discordAuthAvailable && !c?.discordRoleOk) {
      throw new Error(`You need the ${req.discordRoleName ?? 'required'} role in the Discord server to register`);
    }
  }

  // ---------- registration ----------
  register(player: { id: string; name: string; avatar: string; discord?: { id: string; username: string } | null; discordVerified?: boolean }) {
    if (this.state === 'finished' || this.state === 'cancelled') throw new Error('tournament is over');
    if (this.players.has(player.id)) throw new Error('already registered');
    if (this.players.size >= this.config.maxPlayers) throw new Error('tournament is full');
    if (this.state !== 'registering' && !this.lateRegOpen) throw new Error('registration closed');

    const p: TPlayer = {
      id: player.id, name: player.name, avatar: player.avatar,
      registeredAt: Date.now(), tableId: null, seatIdx: null,
      busted: false, place: null, prize: null,
      discord: player.discord ?? null,
      discordVerified: player.discordVerified ?? false,
      entries: 1,
      approved: !this.config.approveRegistrations,
    };
    this.players.set(player.id, p);

    if (!p.approved) {
      this.systemChat(`${player.name} requested to join — waiting for host approval`);
    } else {
      if (this.state !== 'registering') {
        // Late reg: seat immediately at the smallest table — and grow the
        // finishing-place pool. The host-approval path has always done this;
        // this auto-approved path did not, so every late registrant burned one
        // place and the counter ran out while dozens still played: the first
        // live event announced "finished 1st" mid-game and counted on into
        // negative places from there.
        this.nextPlace += 1;
        this.seatLateReg(p);
      }
      this.systemChat(`${player.name} registered (${this.approvedPlayers().length} players)`);
    }
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  // Host approves a pending registration (seats them immediately if running).
  approve(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('player not found');
    if (p.approved) return;
    if (this.state !== 'registering' && !this.lateRegOpen) throw new Error('registration closed');
    p.approved = true;
    if (this.state === 'running' || this.state === 'break' || this.state === 'paused') {
      this.nextPlace += 1; // one more player in the field
      // Approval is the HOST's click, not the player's — the person being
      // approved may have registered an hour ago and wandered off. While the
      // join window is open they claim their seat like everyone else who
      // registered ahead of the start; only once it has closed are they
      // seated directly, the way a late registration is.
      const ends = this.joinEndsAt;
      if (ends === null || Date.now() >= ends) this.seatLateReg(p);
    }
    this.systemChat(`${p.name} was approved (${this.approvedPlayers().length} players)`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  approveAll() {
    for (const p of this.pendingPlayers()) this.approve(p.id);
  }

  // Host removes a player. Pending/registering: gone entirely. Running: they
  // are eliminated in their current position and their chips are removed.
  kick(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('player not found');
    if (!p.approved || this.state === 'registering') {
      this.players.delete(playerId);
      this.systemChat(`${p.name} was removed by the host`);
      this.cb.broadcastTourney(this);
      this.cb.lobbyChanged();
      return;
    }
    if (p.busted || this.state === 'finished' || this.state === 'cancelled') return;
    // Eliminate mid-tournament. The table is remembered here because the seat
    // and tableId are cleared below, and the balancer needs to know which
    // table just lost a player.
    let leftTable: Table | null = null;
    if (p.tableId) {
      const table = this.tables.get(p.tableId);
      if (table) {
        leftTable = table;
        const idx = table.playerSeat(playerId);
        if (idx !== null) {
          // What they were sitting behind, read before the seat is cleared —
          // a director putting them back is owed this number.
          p.lastStack = table.seats[idx]!.stack;
          // Fold them out of a live hand first (their committed chips stay in the pot).
          const hs = table.hand?.seats.find(s => s.seat === idx);
          if (hs && !hs.folded) { hs.folded = true; hs.lastAction = 'Fold'; }
          table.seats[idx] = null;
        }
        table.scheduleStart();
        this.cb.broadcastTable(table);
      }
    }
    // Same structural truth as eliminate(): with N alive, you finished Nth.
    const aliveNow = this.alivePlayers().length; // includes p — not busted yet
    p.busted = true;
    p.place = aliveNow;
    this.nextPlace = aliveNow - 1;
    p.tableId = null;
    p.seatIdx = null;
    this.systemChat(`${p.name} was removed by the host`);
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.finish(alive[0]);
      return;
    }
    // Removing players can leave the field lopsided; settle it now rather than
    // waiting for the next hand to end somewhere. Their table has to be read
    // before the seat is cleared above — this looked it up afterwards, when
    // tableId was already null, and always fell through to an arbitrary table.
    const anyTable = leftTable ?? [...this.tables.values()].find(x => !x.closed);
    if (anyTable) {
      this.rebalance(anyTable);
      this.maybeFinalRedraw();
    }
    this.cb.broadcastTourney(this);
  }

  private joinTimer: NodeJS.Timeout | null = null;

  private armJoinWindow(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    const ends = this.joinEndsAt;
    if (ends === null) return;
    this.joinTimer = background(setTimeout(() => {
      this.joinTimer = null;
      this.closeJoinWindow();
    }, Math.max(0, ends - Date.now())));
  }

  // Is this player still owed a seat they have not taken?
  canJoinTable(playerId: string): boolean {
    if (this.state !== 'running' && this.state !== 'break' && this.state !== 'paused') return false;
    const p = this.players.get(playerId);
    if (!p || !p.approved || p.busted) return false;
    if (this.isSeated(p)) return false;
    const ends = this.joinEndsAt;
    return ends !== null && Date.now() < ends;
  }

  // The player claims it. Same seating path as a late registration, because
  // that is what this is from the table's point of view: somebody arriving
  // into a field already in play.
  joinTable(playerId: string): string {
    if (!this.canJoinTable(playerId)) {
      const p = this.players.get(playerId);
      if (!p) throw new Error('You are not registered for this tournament');
      if (p.busted) throw new Error('You are out of this tournament');
      if (this.isSeated(p)) throw new Error('You already have a seat');
      throw new Error('The window to take your seat has closed');
    }
    const p = this.players.get(playerId)!;
    this.seatLateReg(p);
    // Once nobody is still expected, there is nothing left to hold the deal
    // for. A small game where everyone presses the button at once starts
    // immediately instead of staring at an empty felt for the full grace.
    if (this.alivePlayers().every(x => this.isSeated(x))) {
      for (const table of this.tables.values()) table.releaseDealHold();
    }
    this.systemChat(`${p.name} took their seat`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
    return p.tableId!;
  }

  // Everyone still holding a place they never claimed forfeits it. They are
  // ranked at the bottom, below every player who actually sat down, which is
  // both fair and what the place counter already assumes.
  private closeJoinWindow(): void {
    if (this.state !== 'running' && this.state !== 'break' && this.state !== 'paused') return;
    const alive = this.alivePlayers();
    const waiting = alive.filter(p => !this.isSeated(p));
    if (waiting.length === 0) return;
    const atTheFelt = alive.filter(p => this.isSeated(p));

    // The ordinary case: a field is playing, and the places nobody claimed
    // forfeit at the bottom, beneath everyone who actually sat down.
    if (atTheFelt.length >= 2) {
      for (const p of waiting) {
        if (this.alivePlayers().length <= 1) break;
        this.eliminate(p, null, true);
      }
      this.systemChat(
        `${waiting.length} player${waiting.length === 1 ? '' : 's'} never took a seat — `
        + 'the window to join has closed.');
      logGameEvent(this.id, this.config.name,
        `join window closed: ${waiting.length} unseated player(s) forfeited`);
      this.cb.broadcastTourney(this);
      this.cb.lobbyChanged();
      return;
    }

    // Fewer than two people ever sat down, so there is no tournament left to
    // carry on with. Left alone this state runs forever: a "running" event
    // with no tables, no hands, and no way to reach a winner.
    for (const p of waiting) {
      if (this.alivePlayers().length <= 1) break;
      this.eliminate(p, null, true);
    }
    if (atTheFelt.length === 1) {
      // One player turned up. They win it by walkover — which is a real
      // result, and better than an event that can never end.
      this.systemChat(
        `${atTheFelt[0].name} was the only player to take a seat — the tournament is theirs.`);
      logGameEvent(this.id, this.config.name,
        `join window closed with one player seated: walkover to ${atTheFelt[0].name}`);
      this.finish(atTheFelt[0]);
      return;
    }
    // Nobody sat down at all. Crowning someone who never played would be
    // worse than admitting the event did not happen.
    this.systemChat('Nobody took a seat before the window closed — the tournament is cancelled.');
    logGameEvent(this.id, this.config.name, 'join window closed with nobody seated: cancelled');
    this.cancel();
  }

  canReenter(playerId: string): boolean {
    const p = this.players.get(playerId);
    return !!p && p.busted && this.lateRegOpen
      && this.config.maxReentries > 0
      && p.entries <= this.config.maxReentries;
  }

  // Registered is not the same as sitting somewhere: a player between tables,
  // or one who never made it to a seat, holds a place in the field with no
  // chips in front of them.
  private isSeated(p: TPlayer): boolean {
    if (!p.tableId) return false;
    const table = this.tables.get(p.tableId);
    return !!table && !table.closed && table.playerSeat(p.id) !== null;
  }

  // Seat someone at the smallest table and give them exactly the stack the
  // director asked for. seatLateReg deals the configured starting stack, so
  // the correction happens immediately afterwards — between hands, where
  // writing a seat's stack disturbs nothing in play.
  private seatWithStack(p: TPlayer, stack: number): void {
    this.seatLateReg(p);
    const table = p.tableId ? this.tables.get(p.tableId) : null;
    if (table) {
      const idx = table.playerSeat(p.id);
      if (idx !== null) table.seats[idx]!.stack = stack;
    }
  }

  // The director's override: put anyone at a table, right now, with whatever
  // stack they say.
  //
  // Everything else that seats a player enforces a rule — late registration
  // has to be open, the field cannot be over the cap, a busted player has to
  // have re-entries left. Those rules are right for players and wrong for the
  // person running the event, who needs a way out when something has gone
  // wrong that no rule anticipated: a player dropped by a bad deploy, someone
  // whose registration never landed, a seat that has to be filled to keep a
  // table playable. So this checks none of them.
  //
  // What it does keep straight is the accounting, because that is what makes
  // the standings readable afterwards. A busted player coming back is a
  // correction: no new entry, the prize pool does not move. A player who is
  // already registered but has never been seated already owns their entry, so
  // that does not move either. Only a genuinely new name is a new entry, and
  // that one does grow the pool — the same as registering during late reg.
  directorSeat(
    who: { id: string; name: string; avatar: string },
    stack?: number,
  ): { name: string; stack: number; action: 'reinstated' | 'seated' | 'added' } {
    if (this.state !== 'running' && this.state !== 'break' && this.state !== 'paused') {
      throw new Error(
        this.state === 'registering'
          ? 'The tournament has not started — register them normally instead'
          : 'The tournament is over',
      );
    }
    const id = String(who.id || '').trim();
    if (!id) throw new Error('Pick a player');

    let p = this.players.get(id);
    if (p && this.isSeated(p)) {
      throw new Error(`${p.name} is already at a table — use the table's stack tool to adjust chips`);
    }

    let action: 'reinstated' | 'seated' | 'added';
    if (!p) {
      const name = String(who.name || '').trim().slice(0, 32);
      if (!name) throw new Error('That player needs a name');
      p = {
        id, name, avatar: who.avatar || '🙂',
        registeredAt: Date.now(), tableId: null, seatIdx: null,
        busted: false, place: null, prize: null,
        discord: null, discordVerified: false,
        entries: 1, approved: true,
      };
      this.players.set(id, p);
      this.nextPlace += 1; // one more player in the field
      action = 'added';
    } else if (p.busted) {
      p.busted = false;
      p.place = null;
      p.prize = null;
      p.approved = true;
      this.nextPlace += 1; // one fewer finished player
      action = 'reinstated';
    } else {
      // Registered, still alive, never made it to a seat.
      p.approved = true;
      action = 'seated';
    }

    const give = Math.max(1, Math.floor(stack ?? p.lastStack ?? this.config.startingStack));
    p.lastStack = undefined;
    this.seatWithStack(p, give);

    const verb = action === 'reinstated' ? 'was put back in by the director'
      : action === 'added' ? 'was added to the game by the director'
      : 'was seated by the director';
    this.systemChat(`${p.name} ${verb} with ${give}`);
    logGameEvent(this.id, this.config.name, `director seat: ${p.name} (${action}) with ${give} chips`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
    return { name: p.name, stack: give, action };
  }

  // Who the director can pick from: everyone already in this tournament who
  // is not currently at a table, then every other name the site has seen.
  // Sorted so the people most likely to be the answer are at the top.
  directorPeople(known: { id: string; name: string; avatar: string }[]): {
    id: string; name: string; avatar: string;
    status: 'busted' | 'unseated' | 'playing' | 'new';
    lastStack: number | null;
  }[] {
    const out: {
      id: string; name: string; avatar: string;
      status: 'busted' | 'unseated' | 'playing' | 'new'; lastStack: number | null;
    }[] = [];
    const seen = new Set<string>();
    for (const p of this.players.values()) {
      const seated = this.isSeated(p);
      seen.add(p.id);
      out.push({
        id: p.id, name: p.name, avatar: p.avatar,
        status: p.busted ? 'busted' : seated ? 'playing' : 'unseated',
        lastStack: p.lastStack ?? null,
      });
    }
    for (const k of known) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push({ id: k.id, name: k.name, avatar: k.avatar, status: 'new', lastStack: null });
    }
    const rank = { unseated: 0, busted: 1, new: 2, playing: 3 } as const;
    return out.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
  }

  // The director puts a specific player back in.
  //
  // Re-entry is a rule the whole field plays by: it needs late registration
  // open, it costs an entry, and it grows the prize pool. This is a different
  // thing — a correction. When somebody was removed for a reason that turned
  // out not to be their doing, the fix is to put that one player back exactly
  // as they were, without pretending they bought in again and without opening
  // the door for everyone else who busted fairly.
  //
  // So: no entry is added, the prize pool does not move, and they return with
  // the stack they had when they were removed unless the director says
  // otherwise. Their finishing place is cleared — they have not finished.
  reinstate(playerId: string, stack?: number): void {
    if (this.state !== 'running' && this.state !== 'break' && this.state !== 'paused') {
      throw new Error('The tournament is not running');
    }
    const p = this.players.get(playerId);
    if (!p) throw new Error('That player is not registered');
    if (!p.approved) throw new Error('That player never entered');
    if (!p.busted) throw new Error(`${p.name} is still in the tournament`);
    const give = Math.max(1, Math.floor(stack ?? p.lastStack ?? this.config.startingStack));

    p.busted = false;
    p.place = null;
    p.prize = null;
    p.lastStack = undefined;
    // One fewer finished player, so the drift check stays honest.
    this.nextPlace += 1;
    this.seatWithStack(p, give);
    this.systemChat(`${p.name} was put back in by the director with ${give}`);
    logGameEvent(this.id, this.config.name, `${p.name} reinstated by the director with ${give} chips`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  // Busted player buys back in during late registration.
  reenter(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('not registered');
    if (!p.busted) throw new Error('you are still in the tournament');
    if (!this.canReenter(playerId)) throw new Error('re-entry is closed');
    p.entries += 1;
    p.busted = false;
    p.place = null;
    p.prize = null;
    this.nextPlace += 1; // one fewer finished player
    this.seatLateReg(p);
    this.systemChat(`${p.name} re-entered (entry #${p.entries}) — prize pool is now ${this.prizePool}`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  unregister(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('not registered');
    // Pending players can withdraw at any time; approved only before start.
    if (p.approved && this.state !== 'registering') throw new Error('cannot unregister after start');
    this.players.delete(playerId);
    this.systemChat(`${p.name} unregistered`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  // ---------- lifecycle ----------
  start() {
    if (this.state !== 'registering') throw new Error('already started');
    if (this.approvedPlayers().length < this.config.minPlayers) throw new Error(`need at least ${this.config.minPlayers} players`);
    this.state = 'running';
    this.startedAt = Date.now();
    this.nextPlace = this.approvedPlayers().length;

    // Nobody is dealt in by registering. Registering reserves a place in the
    // field; pressing Join table is what puts chips in front of you.
    //
    // The old behaviour seated every registered player the moment the clock
    // struck, which meant anyone who wasn't at their screen was blinded off,
    // removed inside a few hands, and then told they had already finished a
    // tournament they never played a hand of. Holding the seat instead costs
    // nothing and fixes that outright.
    //
    // So no tables are created here. They come into existence as players
    // arrive, the same way a late registration has always been seated.
    this.startLevelClock();
    const n = this.approvedPlayers().length;
    this.systemChat(
      `Tournament started — ${n} player${n === 1 ? '' : 's'} registered. `
      + `Press Join table to take your seat. You have ${Math.round(this.joinWindowMs / 60_000)} `
      + 'minutes.');
    logGameEvent(this.id, this.config.name,
      `started with ${n} registered; join window ${Math.round(this.joinWindowMs / 60_000)}m`);
    this.armJoinWindow();
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  private createTable(fixed?: { id: string; name: string }): Table {
    if (!fixed) this.tableCounter += 1;
    const lvl = this.level;
    const table = new Table({
      id: fixed?.id,
      name: fixed?.name ?? `${this.config.name} — Table ${this.tableCounter}`,
      mode: 'tournament',
      tournamentId: this.id,
      maxSeats: this.config.seatsPerTable,
      sb: lvl.sb, bb: lvl.bb, ante: lvl.ante,
      actionTimeMs: this.actionTimeMs,
      timebankMs: Math.max(0, Math.floor(this.config.timebankSeconds ?? 0)) * 1000,
      rabbitHunting: this.config.rabbitHunting,
      displayMode: this.config.displayMode ?? 'chips',
      theme: this.config.theme ?? null,
    }, {
      broadcast: t => this.cb.broadcastTable(t),
      chat: (t, m) => this.cb.tableChat(t, m),
      event: (t, m) => this.cb.tableEvent(t, m),
      audit: (t, e) => this.cb.tableAudit?.(t, e),
      reaction: (t, r) => this.cb.tableReaction?.(t, r),
      onHandEnd: (t, busted) => this.onHandEnd(t, busted),
    });
    // Tables created while players are still claiming seats hold their first
    // deal until the rush is over. Created later — a rebalance, a late arrival
    // long after the start — the deadline is already past and this is a no-op.
    if (this.startedAt !== null) table.dealNotBefore = this.startedAt + SEATING_GRACE_MS;
    // Felt overlay context + live rank, read per broadcast.
    table.tourneyInfo = () => ({
      level: this.level.level,
      sb: this.level.sb,
      bb: this.level.bb,
      ante: this.level.ante,
      levelEndsAt: this.levelEndsAt,
      nextSb: this.nextLevel?.sb ?? null,
      nextBb: this.nextLevel?.bb ?? null,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      playersLeft: this.alivePlayers().length,
      totalEntries: this.totalEntries,
      onBreak: this.state === 'break',
      // Read live on every broadcast rather than copied onto the table, so
      // one clock governs the whole event. Moving a player between tables —
      // or breaking a table entirely — cannot reset, extend or double-count
      // it, because no table owns any part of it.
      betCap: this.betCapActive
        ? { endsAt: this.betCapEndsAt!, fraction: BET_CAP_FRACTION }
        : null,
      lateClockSeconds: this.lateClockMs() / 1000,
    });
    table.rankOf = (playerId: string) => this.rankOf(playerId);
    table.extraActionMs = () => this.lateClockMs();
    this.tables.set(table.id, table);
    return table;
  }

  // Live rank by stack among players still in the field (1 = chip leader).
  rankOf(playerId: string): number | null {
    const p = this.players.get(playerId);
    if (!p || p.busted || !p.approved) return null;
    const mine = this.stackOf(p);
    let ahead = 0;
    for (const other of this.players.values()) {
      if (other.busted || !other.approved || other.id === playerId) continue;
      if (this.stackOf(other) > mine) ahead += 1;
    }
    return ahead + 1;
  }

  private seatPlayerAt(table: Table, p: TPlayer) {
    // First empty seat.
    const idx = table.seats.findIndex(s => s === null);
    if (idx < 0) throw new Error('table full');
    table.sit(idx, { id: p.id, name: p.name, avatar: p.avatar }, this.config.startingStack);
    p.tableId = table.id;
    p.seatIdx = idx;
    this.cb.assigned(this, p.id, table.id);
  }

  private seatLateReg(p: TPlayer) {
    let smallest: Table | null = null;
    for (const t of this.tables.values()) {
      if (t.closed) continue;
      if (t.seatedCount() < t.maxSeats && (!smallest || t.seatedCount() < smallest.seatedCount())) smallest = t;
    }
    // Every table full means a new one, and a new one starts with this player
    // alone on it. Left there it plays one-handed against nine-handed tables
    // and pays a blind every hand, which is how a 349-player event ended up
    // with tables of 9 and a table of 1. Balancing seeds it from the fullest
    // tables instead, so a late arrival never creates a lopsided field.
    const opened = !smallest;
    if (!smallest) smallest = this.createTable();
    this.seatPlayerAt(smallest, p);
    smallest.scheduleStart();
    if (opened) this.rebalance(smallest);
  }

  // ---------- level clock ----------
  // Minutes for a given structure row. Custom schedules carry their own
  // duration per row; a final custom row with 0 minutes runs forever.
  private levelMinutesFor(idx: number): number | null {
    const cl = this.config.customLevels;
    if (cl && cl.length > 0) {
      const i = Math.min(idx, cl.length - 1);
      const mins = cl[i]?.minutes ?? 0;
      if (i >= cl.length - 1 && mins <= 0) return null;
      return Math.max(1, mins);
    }
    return this.config.levelMinutes;
  }

  private startLevelClock() {
    this.clearLevelTimer();
    const mins = this.levelMinutesFor(this.levelIdx);
    if (mins === null) { this.levelEndsAt = null; return; } // final level, no clock
    const ms = mins * 60_000;
    this.levelEndsAt = Date.now() + ms;
    this.levelTimer = background(setTimeout(() => this.advanceLevel(), ms));
  }

  // Host edits settings after creation. Everything here is safe mid-game:
  // blind changes take effect from the next hand, never inside a live one.
  updateSettings(p: {
    name?: string;
    levelMinutes?: number;
    lateRegMinutes?: number;
    joinMinutes?: number;
    scheduledStart?: number | null;
    approveRegistrations?: boolean;
    prizeText?: string | null;
    actionSeconds?: number;
    maxPlayers?: number;
    timebankSeconds?: number;
    maxReentries?: number;
    rabbitHunting?: boolean;
    displayMode?: 'chips' | 'bb';
    customLevels?: unknown;
    blinds?: { sb: number; bb: number; ante: number } | null;
    jumpLevel?: number;
    betCapMinutes?: number | null;
    lateClock?: unknown;
    theme?: import('../../../shared/types.ts').TableTheme | null;
  }) {
    if (this.state === 'finished' || this.state === 'cancelled') {
      throw new Error('This tournament is over');
    }
    const changes: string[] = [];

    if (p.name !== undefined) {
      const name = p.name.trim().slice(0, 48);
      if (name && name !== this.config.name) { this.config.name = name; changes.push(`renamed to "${name}"`); }
    }
    if (p.prizeText !== undefined) {
      const text = p.prizeText === null ? null : p.prizeText.trim().slice(0, 500) || null;
      if (text !== this.config.prizeText) { this.config.prizeText = text; changes.push('prizes updated'); }
    }
    if (p.approveRegistrations !== undefined && p.approveRegistrations !== this.config.approveRegistrations) {
      this.config.approveRegistrations = p.approveRegistrations;
      changes.push(p.approveRegistrations ? 'registrations now need approval' : 'registrations now auto-approved');
      // Turning approval off should not strand people already in the queue.
      if (!p.approveRegistrations) this.approveAll();
    }
    if (p.scheduledStart !== undefined) {
      if (this.state !== 'registering') throw new Error('The start time can only be changed before the start');
      if (p.scheduledStart === null) {
        if (this.scheduledStart !== null) {
          this.scheduledStart = null;
          this.armScheduledStart();
          changes.push('scheduled start removed — the host will start it manually');
        }
      } else {
        const ts = Math.floor(Number(p.scheduledStart));
        if (!Number.isFinite(ts)) throw new Error('That start time makes no sense');
        if (ts < Date.now() + 60_000) throw new Error('Pick a start time at least a minute away');
        if (ts > Date.now() + 30 * 24 * 3_600_000) throw new Error('Pick a start time within the next 30 days');
        if (ts !== this.scheduledStart) {
          this.scheduledStart = ts;
          this.armScheduledStart();
          changes.push(`start time set — starts in ${Math.round((ts - Date.now()) / 60_000)}m`);
        }
      }
    }
    if (p.joinMinutes !== undefined) {
      const mins = clamp(Math.floor(p.joinMinutes), 1, 240);
      if (mins !== (this.config.joinMinutes ?? DEFAULT_JOIN_MINUTES)) {
        this.config.joinMinutes = mins;
        changes.push(`join window ${mins}m`);
        // Editing it mid-event moves the deadline, so the timer has to follow.
        if (this.startedAt !== null) this.armJoinWindow();
      }
    }
    if (p.betCapMinutes !== undefined) {
      const before = this.config.betCapMinutes ?? null;
      const next = p.betCapMinutes === null ? null : clamp(Math.floor(p.betCapMinutes), 1, 240);
      if (next !== before) {
        this.config.betCapMinutes = next;
        // Nothing to re-arm: the cap has no timer, it is read from the clock
        // each time a hand is dealt. Hands already in the air keep the rule
        // they were dealt under.
        changes.push(next === null
          ? 'opening bet cap off'
          : `opening bet cap ${next}m (max ${Math.round(BET_CAP_FRACTION * 100)}% of stack per bet)`);
      }
    }
    if (p.lateClock !== undefined) {
      const before = this.config.lateClock ?? null;
      const next = parseLateClock(p.lateClock);
      if (JSON.stringify(next) !== JSON.stringify(before)) {
        this.config.lateClock = next;
        // Read live when each clock starts, so this applies from the next
        // decision; nobody's running clock jumps.
        changes.push(next === null
          ? 'extra time near the end off'
          : `+${next.extraSeconds}s per decision from ${next.players} players left`);
        this.lateClockAnnounced = this.lateClockMs() > 0;
      }
    }
    if (p.lateRegMinutes !== undefined) {
      const mins = clamp(Math.floor(p.lateRegMinutes), 0, 240);
      if (mins !== this.config.lateRegMinutes) {
        this.config.lateRegMinutes = mins;
        changes.push(mins === 0 ? 'late registration closed' : `late registration set to ${mins} min`);
      }
    }
    if (p.actionSeconds !== undefined) {
      const ms = clamp(Math.floor(p.actionSeconds), 5, 120) * 1000;
      if (ms !== this.actionTimeMs) {
        for (const t of this.tables.values()) t.actionTimeMs = ms;
        this.actionTimeMs = ms;
        this.config.actionSeconds = ms / 1000;
        changes.push(`action time ${ms / 1000}s`);
      }
    }
    if (p.timebankSeconds !== undefined) {
      const secs = clamp(Math.floor(p.timebankSeconds), 0, 120);
      if (secs !== (this.config.timebankSeconds ?? 0)) {
        this.config.timebankSeconds = secs;
        for (const t of this.tables.values()) t.timebankMs = secs * 1000;
        changes.push(secs === 0 ? 'time bank off' : `time bank ${secs}s`);
      }
    }
    if (p.maxPlayers !== undefined) {
      // Never shrink below the people already in.
      const floor = Math.max(2, this.approvedPlayers().length + this.pendingPlayers().length);
      const cap = clamp(Math.floor(p.maxPlayers), floor, 1000);
      if (cap !== this.config.maxPlayers) {
        this.config.maxPlayers = cap;
        changes.push(`max players ${cap}`);
      }
    }
    if (p.maxReentries !== undefined) {
      const n = clamp(Math.floor(p.maxReentries), 0, 10);
      if (n !== this.config.maxReentries) {
        this.config.maxReentries = n;
        changes.push(n === 0 ? 're-entries off' : `re-entries up to ${n}`);
      }
    }
    if (p.theme !== undefined) {
      this.config.theme = p.theme;
      for (const t of this.tables.values()) { t.theme = p.theme; this.cb.broadcastTable(t); }
      changes.push('table look updated');
    }
    if (p.rabbitHunting !== undefined && p.rabbitHunting !== this.config.rabbitHunting) {
      this.config.rabbitHunting = p.rabbitHunting;
      for (const t of this.tables.values()) t.rabbitHunting = p.rabbitHunting;
      changes.push(p.rabbitHunting ? 'rabbit hunting on' : 'rabbit hunting off');
    }
    if (p.displayMode !== undefined && p.displayMode !== this.config.displayMode) {
      this.config.displayMode = p.displayMode === 'bb' ? 'bb' : 'chips';
      changes.push(`stacks shown as ${this.config.displayMode === 'bb' ? 'big blinds' : 'chips'}`);
    }
    if (p.customLevels !== undefined) {
      // Rewrite the upcoming schedule mid-game. The current level's blinds
      // switch to the matching row from the next hand; the clock re-bases to
      // that row's duration.
      const rows = parseCustomLevels(p.customLevels);
      if (rows) {
        this.config.customLevels = rows;
        this.structure = buildCustomStructure(rows);
        this.levelIdx = clamp(this.levelIdx, 0, this.structure.length - 1);
        while (this.structure[this.levelIdx]?.isBreak && this.levelIdx < this.structure.length - 1) {
          this.levelIdx += 1;
        }
        const lvl = this.level;
        for (const t of this.tables.values()) { t.sb = lvl.sb; t.bb = lvl.bb; t.ante = lvl.ante; }
        if (this.state === 'running') this.startLevelClock();
        changes.push(`blind schedule rewritten (${rows.filter(r => !r.isBreak).length} levels)`);
      }
    }
    if (p.levelMinutes !== undefined) {
      const mins = clamp(Math.floor(p.levelMinutes), 1, 60);
      if (mins !== this.config.levelMinutes) {
        this.config.levelMinutes = mins;
        changes.push(`levels now ${mins} min`);
        // Re-base the running clock so the change is felt immediately.
        if (this.state === 'running') this.startLevelClock();
      }
    }
    if (p.jumpLevel !== undefined) {
      let idx = clamp(Math.floor(p.jumpLevel) - 1, 0, this.structure.length - 1);
      // Jumping lands on a playable level, never a break row.
      while (this.structure[idx]?.isBreak && idx < this.structure.length - 1) idx++;
      while (this.structure[idx]?.isBreak && idx > 0) idx--;
      if (idx !== this.levelIdx) {
        this.levelIdx = idx;
        this.applyLevelToTables();
        const lvl = this.level;
        changes.push(`jumped to level ${lvl.level} (${lvl.sb}/${lvl.bb})`);
        if (this.state === 'running') this.startLevelClock();
      }
    }
    if (p.blinds) {
      const bb = clamp(Math.floor(p.blinds.bb), 2, 100_000_000);
      const sb = clamp(Math.floor(p.blinds.sb), 1, bb);
      const ante = clamp(Math.floor(p.blinds.ante), 0, bb);
      // Overwrite the current level so the structure keeps climbing from here.
      const lvl = this.structure[Math.min(this.levelIdx, this.structure.length - 1)];
      lvl.sb = sb; lvl.bb = bb; lvl.ante = ante;
      this.applyLevelToTables();
      changes.push(`blinds set to ${sb}/${bb}${ante ? ` ante ${ante}` : ''}`);
    }

    if (changes.length === 0) return;
    this.systemChat(`Settings updated — ${changes.join(', ')}.`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  private advanceLevel() {
    if (this.state !== 'running') return;
    this.levelIdx += 1;
    const lvl = this.level;

    // Custom schedules place breaks explicitly as rows.
    if (this.config.customLevels?.length && lvl.isBreak) {
      this.state = 'break';
      const mins = this.levelMinutesFor(this.levelIdx) ?? 3;
      const breakMs = mins * 60_000;
      this.levelEndsAt = Date.now() + breakMs;
      for (const t of this.tables.values()) t.pause();
      this.systemChat(`Break time! Play resumes in ${mins} minute${mins === 1 ? '' : 's'}.`);
      this.cb.broadcastTourney(this);
      this.breakTimer = background(setTimeout(() => {
        this.state = 'running';
        this.levelIdx += 1; // move past the break row
        this.applyLevelToTables();
        for (const t of this.tables.values()) t.resume();
        this.startLevelClock();
        const nl = this.level;
        this.systemChat(`Play resumes — level ${nl.level}: ${nl.sb}/${nl.bb}${nl.ante ? ` ante ${nl.ante}` : ''}`);
        this.cb.broadcastTourney(this);
      }, breakMs));
      return;
    }

    // Generated structures take a standard break on a fixed cadence.
    if (!this.config.customLevels?.length
      && this.config.breakEveryLevels > 0 && (lvl.level - 1) % this.config.breakEveryLevels === 0 && lvl.level > 1) {
      this.state = 'break';
      const breakMs = 3 * 60_000;
      this.levelEndsAt = Date.now() + breakMs;
      for (const t of this.tables.values()) t.pause();
      this.systemChat(`Break time! Play resumes in 3 minutes. Next level: ${lvl.sb}/${lvl.bb}${lvl.ante ? ` ante ${lvl.ante}` : ''}`);
      this.cb.broadcastTourney(this);
      this.breakTimer = background(setTimeout(() => {
        this.state = 'running';
        this.applyLevelToTables();
        for (const t of this.tables.values()) t.resume();
        this.startLevelClock();
        this.systemChat(`Play resumes — level ${lvl.level}: ${lvl.sb}/${lvl.bb}${lvl.ante ? ` ante ${lvl.ante}` : ''}`);
        this.cb.broadcastTourney(this);
      }, breakMs));
      return;
    }

    this.applyLevelToTables();
    this.systemChat(`Level ${lvl.level}: blinds ${lvl.sb}/${lvl.bb}${lvl.ante ? ` ante ${lvl.ante}` : ''}`);
    this.startLevelClock();
    this.cb.broadcastTourney(this);
  }

  private applyLevelToTables() {
    const lvl = this.level;
    for (const t of this.tables.values()) {
      t.sb = lvl.sb;
      t.bb = lvl.bb;
      t.ante = lvl.ante;
    }
  }

  pause() {
    if (this.state !== 'running' && this.state !== 'break') throw new Error('not running');
    if (this.state === 'running' && this.levelEndsAt) {
      this.pauseRemainingMs = Math.max(0, this.levelEndsAt - Date.now());
      this.clearLevelTimer();
    }
    // The seat-claiming window is part of "everything", and it is the one
    // clock a paused player cannot do anything about. A director who pauses
    // for twenty minutes would otherwise come back to a field where everyone
    // who had not yet pressed Join table had forfeited during the freeze.
    if (this.joinTimer) {
      const ends = this.joinEndsAt;
      this.joinRemainingMs = ends === null ? null : Math.max(0, ends - Date.now());
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
    // The bet cap is a wall clock, so a pause has to stop it too — for the
    // same reason the join window does. Nothing needs to fire when it expires,
    // so recording when the freeze began is enough; resume gives the time back.
    this.pausedAt = Date.now();
    this.state = 'paused';
    for (const t of this.tables.values()) t.pause();
    this.systemChat('Tournament paused by the director.');
    this.cb.broadcastTourney(this);
  }

  resume() {
    if (this.state !== 'paused') throw new Error('not paused');
    this.state = 'running';
    const mins = this.levelMinutesFor(this.levelIdx);
    if (mins === null && this.pauseRemainingMs === null) {
      this.levelEndsAt = null; // final custom level — no clock to restart
    } else {
      const remaining = this.pauseRemainingMs ?? (mins ?? this.config.levelMinutes) * 60_000;
      this.levelEndsAt = Date.now() + remaining;
      this.levelTimer = background(setTimeout(() => this.advanceLevel(), remaining));
    }
    if (this.pausedAt !== null) {
      this.capShiftMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.pauseRemainingMs = null;
    // Hand back exactly what was left of the join window, by pushing the
    // deadline out by however long the freeze lasted.
    if (this.joinRemainingMs !== null && this.startedAt !== null) {
      const raw = this.startedAt + this.joinWindowMs + this.joinShiftMs;
      this.joinShiftMs += Date.now() + this.joinRemainingMs - raw;
      this.joinRemainingMs = null;
      this.armJoinWindow();
    }
    for (const t of this.tables.values()) t.resume();
    this.systemChat('Tournament resumed.');
    this.cb.broadcastTourney(this);
  }

  // Finish the tournament on the spot: any hand in progress is rolled back
  // with every chip refunded, then remaining players are ranked by current
  // stack (bigger stack = higher place; already-eliminated players keep
  // their real finishes) and the normal finish flow runs — podium, prizes,
  // results record, announcements.
  endNow() {
    if (this.state === 'finished' || this.state === 'cancelled') throw new Error('tournament is over');
    if (this.state === 'registering') throw new Error('not started yet — cancel it instead');
    this.clearLevelTimer();
    if (this.breakTimer) { clearTimeout(this.breakTimer); this.breakTimer = null; }
    this.systemChat('The director is ending the tournament now — final ranks by chip count.');
    for (const t of this.tables.values()) {
      if (!t.closed) t.abortHand();
    }
    const ranked = this.alivePlayers()
      .map(p => ({ p, stack: this.stackOf(p) }))
      .sort((a, b) => a.stack - b.stack); // shortest stack gets the worst place
    while (ranked.length > 1) {
      this.eliminate(ranked.shift()!.p, null, true);
    }
    if (ranked.length === 1) {
      this.finish(ranked[0].p);
    } else {
      // No one left alive (shouldn't happen for a started tournament).
      this.state = 'finished';
      this.cb.broadcastTourney(this);
      this.cb.lobbyChanged();
    }
  }

  // Let go of everything this tournament holds before it is dropped from the
  // registry: timers keep firing (and keep the process alive) otherwise.
  dispose() {
    this.clearLevelTimer();
    if (this.scheduleTimer) { clearTimeout(this.scheduleTimer); this.scheduleTimer = null; }
    if (this.joinTimer) { clearTimeout(this.joinTimer); this.joinTimer = null; }
    if (this.breakTimer) { clearTimeout(this.breakTimer); this.breakTimer = null; }
    for (const t of this.tables.values()) t.close();
  }

  cancel() {
    if (this.state === 'finished' || this.state === 'cancelled') return;
    this.state = 'cancelled';
    this.endedAt = Date.now();
    this.clearLevelTimer();
    if (this.joinTimer) { clearTimeout(this.joinTimer); this.joinTimer = null; }
    if (this.breakTimer) { clearTimeout(this.breakTimer); this.breakTimer = null; }
    for (const t of this.tables.values()) { t.close(); this.cb.broadcastTable(t); }
    this.systemChat('Tournament cancelled by the director.');
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
  }

  // Mark a player out, free their seat, and record their finishing place.
  // `quiet` skips the chat line and popup — used by endNow(), where the
  // whole field is ranked at once and the finish announcement covers it.
  private eliminate(p: TPlayer, table: Table | null, quiet = false) {
    // The truth about a finishing place is structural: if N players are alive
    // when you bust, you finished Nth. The counter exists for the snapshot,
    // but the place is derived from the field so no bookkeeping slip on any
    // registration path can ever hand out "1st" mid-tournament again. When
    // the two disagree, say so in the log — that is a bug being absorbed,
    // and the next one should be found, not silently survived.
    const alive = this.alivePlayers().length; // includes p — not busted yet
    if (this.nextPlace !== alive) {
      console.warn(
        `place counter drift in ${this.config.name}: counter=${this.nextPlace} alive=${alive} — using alive`);
    }
    p.busted = true;
    p.place = alive;
    this.nextPlace = alive - 1;
    const from = table ?? (p.tableId ? this.tables.get(p.tableId) ?? null : null);
    // Read the stack before the seat is cleared — this is the only moment it
    // still exists anywhere.
    if (from) {
      const idx = from.playerSeat(p.id);
      if (idx !== null) p.lastStack = from.seats[idx]!.stack;
    }
    p.tableId = null;
    p.seatIdx = null;
    if (from) {
      const idx = from.playerSeat(p.id);
      if (idx !== null) from.seats[idx] = null;
    }
    const pay = this.getPayouts().find(x => x.place === p.place);
    if (pay) p.prize = pay.amount;
    if (quiet) return;
    this.systemChat(pay
      ? `${p.name} finished ${ordinal(p.place!)} — wins ${pay.amount} 🏆`
      : `${p.name} eliminated in ${ordinal(p.place!)} place`);
    this.cb.eliminated?.(this, p);
  }

  // Remove players who have sat offline through too many straight hands —
  // without this, an abandoned endgame (one live player vs. ghosts) loops
  // forever with the ghosts auto-folding every hand.
  private kickAbandoned(table: Table) {
    const ghosts: { p: TPlayer; stack: number; hands: number }[] = [];
    for (const s of table.seats) {
      if (!s) continue;
      // Gone means gone: a dropped connection is removed after five silent
      // hands. Still connected buys a much longer rope, because not having
      // opened the table yet is not the same as having abandoned it.
      const limit = isOnline(s.player.id) ? IDLE_KICK_HANDS : GHOST_KICK_HANDS;
      if (s.ghostHands < limit) continue;
      const p = this.players.get(s.player.id);
      if (!p || p.busted) continue;
      ghosts.push({ p, stack: s.stack, hands: s.ghostHands });
    }
    // Shortest stack is eliminated first (= worst place), matching the
    // normal same-hand bust tie-break.
    ghosts.sort((a, b) => a.stack - b.stack);
    for (const g of ghosts) {
      this.systemChat(`${g.p.name} was removed — the clock took every turn for ${g.hands} hands in a row`);
      this.eliminate(g.p, table);
    }
  }

  // A table's post-hand callback can be dropped if the table is broken by
  // rebalancing before its timer fires — the players who busted on it would
  // then keep a seat with zero chips forever, and since chipless seats are
  // never dealt in, that table can never start another hand. Sweep up anyone
  // sitting broke outside a live hand so the field always drains.
  private sweepBusted() {
    for (const p of this.players.values()) {
      if (p.busted || !p.approved || !p.tableId) continue;
      const table = this.tables.get(p.tableId);
      if (!table || table.closed) continue;
      const idx = table.playerSeat(p.id);
      if (idx === null) continue;
      // Still contesting a hand (all-in players have a zero stack mid-hand).
      if (table.hand?.seats.some(s => s.seat === idx)) continue;
      if (table.seats[idx]!.stack > 0) continue;
      this.eliminate(p, table);
    }
  }

  // ---------- eliminations & balancing ----------
  private onHandEnd(table: Table, busted: { id: string; name: string; startStack: number }[]) {
    if (this.state === 'cancelled' || this.state === 'finished') return;

    if (busted.length > 0) {
      // Bigger start-of-hand stack finishes higher (standard tie-break).
      const ordered = [...busted].sort((a, b) => a.startStack - b.startStack);
      for (const b of ordered) {
        const p = this.players.get(b.id);
        if (!p || p.busted) continue;
        this.eliminate(p, table);
      }
    }
    // Catch anyone whose elimination was missed — see sweepBusted().
    this.sweepBusted();
    // And anyone who has ghosted through too many hands in a row.
    this.kickAbandoned(table);

    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.finish(alive[0]);
      return;
    }
    if (alive.length === 0) {
      // Extremely rare (simultaneous multi-table bust to zero alive) — highest place wins.
      this.state = 'finished';
      this.cb.broadcastTourney(this);
      return;
    }

    this.rebalance(table);
    this.maybeFinalRedraw();
    this.maybeAnnounceLateClock();
    this.cb.broadcastTourney(this);
  }

  // The late clock: once the field is down to the host's number, every
  // decision gets extra seconds. Nothing is copied onto the tables — each one
  // asks here whenever it starts a clock, so a table that breaks, a player
  // who is moved, or a restart can neither lose nor double it.
  lateClockMs(): number {
    const lc = this.config.lateClock;
    if (!lc || this.startedAt === null) return 0;
    if (this.state === 'finished' || this.state === 'cancelled') return 0;
    return this.alivePlayers().length <= lc.players ? lc.extraSeconds * 1000 : 0;
  }

  private lateClockAnnounced = false;
  private maybeAnnounceLateClock() {
    if (this.lateClockAnnounced || this.lateClockMs() === 0) return;
    this.lateClockAnnounced = true;
    const lc = this.config.lateClock!;
    const text = `Down to ${this.alivePlayers().length} players — everyone now gets +${lc.extraSeconds}s on every decision`;
    this.systemChat(text);
    for (const t of this.tables.values()) if (!t.closed) this.cb.tableEvent(t, text);
  }

  // When the field consolidates onto the final table, real tournaments redraw
  // seats at random rather than letting the accident of who sat where carry
  // over. Done once, between hands.
  private finalRedrawDone = false;

  private maybeFinalRedraw() {
    if (this.finalRedrawDone) return;
    // A tournament that never had a second table has nothing to redraw —
    // its starting table IS the final table (standard single-table rules).
    // No flag latch: late registration can still grow the field onto more
    // tables, and a real consolidation later deserves its redraw.
    if (this.tableCounter <= 1) return;
    const open = [...this.tables.values()].filter(t => !t.closed);
    if (open.length !== 1) return;
    const table = open[0];
    if (table.hand) return; // never mid-hand
    const alive = this.alivePlayers();
    if (alive.length < 3 || alive.length > this.config.seatsPerTable) return;

    const occupants = table.seats
      .map((s, i) => ({ s, i }))
      .filter(x => x.s !== null)
      .map(x => x.s!);
    if (occupants.length < 3) return;

    // Fisher-Yates over the seat indices we actually have.
    const order = occupants.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const seatIdxs = table.seats.map((s, i) => (s ? i : -1)).filter(i => i >= 0);
    table.seats = new Array(table.maxSeats).fill(null);
    order.forEach((occIdx, k) => {
      const seat = seatIdxs[k];
      table.seats[seat] = occupants[occIdx];
      const p = this.players.get(occupants[occIdx].player.id);
      if (p) { p.tableId = table.id; p.seatIdx = seat; }
    });

    this.finalRedrawDone = true;
    this.systemChat('🎲 Final table — seats have been redrawn at random. Good luck!');
    this.cb.broadcastTable(table);
  }

  private rebalance(justEnded: Table) {
    const open = [...this.tables.values()].filter(t => !t.closed);
    if (open.length <= 1) return;

    const counts = () => open.filter(t => !t.closed).map(t => ({ t, n: t.seatedCount() }));

    // 1) Break tables when the field fits into fewer tables.
    const totalPlayers = this.alivePlayers().length;
    const capacity = (n: number) => n * this.config.seatsPerTable;
    let openTables = open.filter(t => !t.closed);
    while (openTables.length > 1 && capacity(openTables.length - 1) >= totalPlayers) {
      // Break the table with fewest players — prefer the one whose hand just ended.
      const candidates = openTables.filter(t => !t.hand);
      if (candidates.length === 0) break;
      candidates.sort((a, b) => a.seatedCount() - b.seatedCount());
      const toBreak = candidates.includes(justEnded) && justEnded.seatedCount() <= candidates[0].seatedCount() + 1
        ? justEnded : candidates[0];
      const others = openTables.filter(t => t !== toBreak);
      const freeSeats = others.reduce((a, t) => a + (t.maxSeats - t.seatedCount()), 0);
      if (freeSeats < toBreak.seatedCount()) break;

      this.systemChat(`Breaking ${toBreak.name} — players moving to other tables.`);
      for (let i = 0; i < toBreak.seats.length; i++) {
        const seat = toBreak.seats[i];
        if (!seat) continue;
        const stack = seat.stack;
        toBreak.seats[i] = null;
        const dest = others
          .filter(t => t.seatedCount() < t.maxSeats)
          .sort((a, b) => a.seatedCount() - b.seatedCount())[0];
        this.movePlayerTo(dest, seat.player, stack);
      }
      toBreak.close();
      // One last broadcast so spectators watching this table learn it is done
      // and can hop to a live one.
      this.cb.broadcastTable(toBreak);
      this.tables.delete(toBreak.id);
      openTables = [...this.tables.values()].filter(t => !t.closed);
      for (const t of openTables) t.scheduleStart();
    }

    // 2)) Even out table sizes. Tables must end within one player of each
    //    other. Only a table between hands can give a player up, so with many
    //    tables running we take whichever donors are free right now and let
    //    the next hand ending settle whatever is left.
    let guard = 0;
    while (guard++ < 200) {
      const cs = counts().filter(c => !c.t.closed);
      if (cs.length <= 1) break;
      cs.sort((a, b) => b.n - a.n);
      const smallest = cs[cs.length - 1];
      if (cs[0].n - smallest.n < 2) break;
      // Largest table that is free to release someone into the smallest.
      const donor = cs.find(c => !c.t.hand && c.n > smallest.n + 1);
      if (!donor || donor.t === smallest.t) break;
      if (!this.moveOnePlayer(donor.t, smallest.t)) break;
    }
  }

  private moveOnePlayer(from: Table, to: Table): boolean {
    // The player due to be big blind next moves — standard tournament rule, so
    // nobody gains or skips a blind by being transferred.
    let pick: number | null = null;
    for (let k = 1; k <= from.maxSeats; k++) {
      const i = (from.buttonSeat + k) % from.maxSeats;
      if (from.seats[i]) { pick = i; break; }
    }
    if (pick === null) return false;
    // Claim the destination seat BEFORE vacating the source. Vacating first
    // and then failing to seat them would drop the player off every table
    // while still counting them alive — a seatless ghost that stalls the field.
    const destSeat = this.incomingSeat(to);
    if (destSeat < 0) return false;

    const seat = from.seats[pick]!;
    from.seats[pick] = null;
    from.systemMsg(`${seat.player.name} moved to balance tables`);
    // That line goes to the table's own chat, which nobody keeps. Balancing is
    // exactly what a post-mortem needs to check, so it is recorded for the
    // tournament as well, with both ends of the move and the resulting sizes.
    logGameEvent(this.id, this.config.name,
      `${seat.player.name} moved from ${from.name} (${from.seatedCount()} left) `
      + `to ${to.name} (${to.seatedCount()} now) to balance tables`);
    this.seatMovedPlayer(to, destSeat, seat.player, seat.stack);
    from.scheduleStart();
    this.cb.broadcastTable(from);
    return true;
  }

  private seatMovedPlayer(
    table: Table, seatIdx: number,
    player: { id: string; name: string; avatar: string }, stack: number,
  ) {
    table.sit(seatIdx, player, stack);
    const p = this.players.get(player.id);
    if (p) { p.tableId = table.id; p.seatIdx = seatIdx; }
    this.cb.assigned(this, player.id, table.id);
    table.scheduleStart();
  }

  // Standard tournament rule: a player moved between tables takes the worst
  // open seat — the one coming up to the blinds — so a transfer can never be
  // used to dodge a blind. Scanning forward from the button lands there.
  private incomingSeat(table: Table): number {
    for (let k = 1; k <= table.maxSeats; k++) {
      const i = (table.buttonSeat + k) % table.maxSeats;
      if (!table.seats[i]) return i;
    }
    return table.seats.findIndex(s => s === null);
  }

  private movePlayerTo(table: Table, player: { id: string; name: string; avatar: string }, stack: number) {
    const idx = this.incomingSeat(table);
    if (idx < 0) return; // shouldn't happen — capacity checked by callers
    table.sit(idx, player, stack);
    const p = this.players.get(player.id);
    if (p) { p.tableId = table.id; p.seatIdx = idx; }
    this.cb.assigned(this, player.id, table.id);
    table.scheduleStart();
  }

  private finish(winner: TPlayer) {
    winner.place = 1;
    this.state = 'finished';
    this.endedAt = Date.now();
    this.clearLevelTimer();
    if (this.joinTimer) { clearTimeout(this.joinTimer); this.joinTimer = null; }
    const payouts = this.getPayouts();
    this.finalPayouts = payouts;
    const first = payouts.find(p => p.place === 1);
    if (first) winner.prize = first.amount;
    for (const t of this.tables.values()) { t.close(); this.cb.broadcastTable(t); }
    this.systemChat(`🏆 ${winner.name} wins ${this.config.name}${first ? ` and ${first.amount} credits` : ''}! Congratulations!`);
    this.cb.broadcastTourney(this);
    this.cb.lobbyChanged();
    this.cb.finished?.(this);
  }

  private clearLevelTimer() {
    if (this.levelTimer) { clearTimeout(this.levelTimer); this.levelTimer = null; }
  }

  getPayouts(): PayoutEntry[] {
    return this.finalPayouts ?? computePayouts(this.players.size, this.prizePool);
  }

  // ---------- chat ----------
  systemChat(text: string) {
    const msg: ChatMsg = { id: randomUUID().slice(0, 10), from: 'system', text, ts: Date.now() };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.shift();
    // Also to disk: this buffer holds 200 lines, and a large event overwrites
    // its own beginning long before anyone can read it back.
    logGameEvent(this.id, this.config.name, text);
    this.cb.tourneyChat(this, msg);
  }

  private lastChatAt = new Map<string, number>();

  userChat(player: { id: string; name: string; avatar: string }, text: string, replyToId?: string) {
    const clean = text.slice(0, 300).trim();
    if (!clean) return;
    if (isBlocked(clean)) throw new Error('That message was blocked.');
    const now = Date.now();
    const waited = now - (this.lastChatAt.get(player.id) ?? 0);
    if (waited < CHAT_COOLDOWN_MS) {
      throw new Error(`Slow down — ${Math.ceil((CHAT_COOLDOWN_MS - waited) / 1000)}s before your next message`);
    }
    // Anyone registered can be tagged in the lobby, seated or not.
    const people = [...this.players.values()].map(p => ({ id: p.id, name: p.name }));
    const { ids, count } = resolveMentions(clean, people);
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
    this.cb.tourneyChat(this, msg);
  }

  // ---------- views ----------
  stackOf(p: TPlayer): number {
    if (p.busted || !p.tableId) return 0;
    const t = this.tables.get(p.tableId);
    if (!t) return 0;
    const idx = t.playerSeat(p.id);
    if (idx === null) return 0;
    const hs = t.hand?.seats.find(s => s.seat === idx);
    return hs ? hs.stack : t.seats[idx]!.stack;
  }

  standings(): StandingEntry[] {
    const alive = this.alivePlayers()
      // Before the start everyone shows the starting stack, not 0. Same for a
      // player still waiting to take their seat: they have no chips in front
      // of them yet, and showing a zero reads as having lost them all.
      .map(p => ({
        p,
        seated: this.state !== 'registering' && this.isSeated(p),
        stack: this.state === 'registering' || !this.isSeated(p)
          ? this.config.startingStack
          : this.stackOf(p),
      }))
      .sort((a, b) => b.stack - a.stack);
    const busted = [...this.players.values()]
      .filter(p => p.busted)
      .sort((a, b) => (a.place ?? 9999) - (b.place ?? 9999));

    const out: StandingEntry[] = [];
    alive.forEach((e, i) => out.push({
      rank: i + 1, id: e.p.id, name: e.p.name, avatar: e.p.avatar,
      stack: e.stack, seated: e.seated, tableId: e.p.tableId, busted: false,
      place: e.p.place, prize: e.p.prize,
      discordTag: e.p.discord?.username ?? null, discordVerified: e.p.discordVerified,
    }));
    busted.forEach(p => out.push({
      rank: p.place ?? out.length + 1, id: p.id, name: p.name, avatar: p.avatar,
      stack: 0, seated: false, tableId: null, busted: true, place: p.place, prize: p.prize,
      lastStack: p.lastStack,
      discordTag: p.discord?.username ?? null, discordVerified: p.discordVerified,
    }));
    return out;
  }

  // Authoritative self-check: everything that must be true of a running
  // tournament at every moment. Used by the operator integrity endpoint and
  // by load tests, so nothing is inferred from two throttled snapshots.
  integrity(): {
    ok: boolean; alive: number; tables: number; seated: number;
    seatless: string[]; duplicated: string[]; spread: number; overCapacity: string[];
  } {
    const open = [...this.tables.values()].filter(t => !t.closed);
    const seen = new Map<string, number>();
    for (const t of open) {
      for (const s of t.seats) {
        if (s) seen.set(s.player.id, (seen.get(s.player.id) ?? 0) + 1);
      }
    }
    const alive = this.alivePlayers();
    // A player who has not pressed Join table yet has no seat on purpose.
    // Counting them as seatless reported every healthy tournament as corrupt
    // for the whole length of the join window.
    const claiming = this.joinEndsAt !== null && Date.now() < this.joinEndsAt;
    const seatless = alive
      .filter(p => !seen.has(p.id) && !(claiming && p.tableId === null))
      .map(p => p.name);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1)
      .map(([id]) => this.players.get(id)?.name ?? id);
    const counts = open.map(t => t.seatedCount());
    const spread = counts.length > 1 ? Math.max(...counts) - Math.min(...counts) : 0;
    const overCapacity = open.filter(t => t.seatedCount() > t.maxSeats).map(t => t.name);
    // A spread of 2 while a hand is running is normal play, not corruption:
    // the donor table cannot release a player mid-hand (TDA), so the balance
    // settles at the next hand end. Only a spread that persists with every
    // table idle means the balancer actually failed.
    const midHand = open.some(t => !!t.hand);
    const balanced = spread <= 1 || (spread === 2 && midHand);
    return {
      ok: seatless.length === 0 && duplicated.length === 0 && overCapacity.length === 0 && balanced,
      alive: alive.length, tables: open.length, seated: seen.size,
      seatless, duplicated, spread, overCapacity,
    };
  }

  // Snapshot of every live table for the spectate overview.
  tablesView(): TournamentTablesView {
    const alive = this.alivePlayers();
    const totalChips = alive.reduce((a, p) => a + this.stackOf(p), 0);
    return {
      tournamentId: this.id,
      level: this.level,
      playersAlive: alive.length,
      avgStack: alive.length ? Math.round(totalChips / alive.length) : 0,
      tables: [...this.tables.values()]
        .filter(t => !t.closed)
        .map(t => t.overview())
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    };
  }

  view(viewerId: string | null, viewerDiscordLinked = false, sharedStandings?: StandingEntry[]): TournamentView {
    const me = viewerId ? this.players.get(viewerId) : undefined;
    const alive = this.alivePlayers();
    const standings = sharedStandings ?? this.standings();
    const totalChips = this.state === 'registering'
      ? alive.length * this.config.startingStack
      : alive.reduce((a, p) => a + this.stackOf(p), 0);
    let myStatus: TournamentView['myStatus'] = 'none';
    if (me) {
      if (!me.approved) myStatus = 'pending';
      else if (this.state === 'registering') myStatus = 'registered';
      else if (me.place === 1) myStatus = 'winner';
      else if (me.busted) myStatus = 'busted';
      else if (!this.isSeated(me)) myStatus = 'seating';
      else myStatus = 'playing';
    }
    const isHost = viewerId === this.hostId;
    return {
      id: this.id,
      name: this.config.name,
      state: this.state,
      hostId: this.hostId,
      hostName: this.hostName,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      joinEndsAt: this.joinEndsAt,
      betCapEndsAt: this.betCapEndsAt,
      scheduledStart: this.scheduledStart,
      config: this.config,
      playersRegistered: this.approvedPlayers().length,
      playersAlive: this.state === 'registering' ? this.approvedPlayers().length : alive.length,
      level: this.level,
      nextLevel: this.nextLevel,
      levelEndsAt: this.levelEndsAt,
      lateRegEndsAt: this.lateRegEndsAt,
      lateRegOpen: this.lateRegOpen || this.state === 'registering',
      pending: isHost ? this.pendingPlayers().map(p => ({ id: p.id, name: p.name, avatar: p.avatar })) : [],
      prizePool: this.prizePool,
      payouts: this.getPayouts(),
      standings,
      tables: [...this.tables.values()].filter(t => !t.closed)
        .map(t => ({ id: t.id, name: t.name, players: t.seatedCount() })),
      myStatus,
      myTableId: me?.tableId ?? null,
      avgStack: alive.length ? Math.round(totalChips / alive.length) : 0,
      totalChips,
      social: this.config.social,
      mySocial: this.socialProgress(viewerId, viewerDiscordLinked || !!me?.discord),
      hasWebhook: !!this.discordWebhookUrl,
      totalEntries: this.totalEntries,
      myCanReenter: viewerId ? this.canReenter(viewerId) : false,
      myEntries: me?.entries ?? 0,
    };
  }

  // ---------- crash-safe persistence ----------
  // Everything needed to bring the tournament back after a restart or deploy.
  // Hands in progress are rolled back (committed chips refunded) — a crashed
  // hand is treated as never dealt, which is standard TDA practice.
  snapshot(): TournamentSnap {
    return {
      v: 1,
      id: this.id,
      config: this.config,
      hostId: this.hostId,
      hostName: this.hostName,
      state: this.state,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      scheduledStart: this.scheduledStart,
      levelIdx: this.levelIdx,
      levelRemainingMs: this.state === 'paused'
        ? this.pauseRemainingMs
        : this.levelEndsAt !== null ? Math.max(0, this.levelEndsAt - Date.now()) : null,
      actionTimeMs: this.actionTimeMs,
      nextPlace: this.nextPlace,
      tableCounter: this.tableCounter,
      discordWebhookUrl: this.discordWebhookUrl,
      finalPayouts: this.finalPayouts,
      finalRedrawDone: this.finalRedrawDone,
      lateClockAnnounced: this.lateClockAnnounced,
      players: [...this.players.values()].map(p => ({ ...p })),
      tables: [...this.tables.values()].filter(t => !t.closed).map(t => ({
        id: t.id,
        name: t.name,
        buttonSeat: t.buttonSeat,
        handNumber: t.handNumber,
        seats: t.snapshotSeats(),
        history: t.snapshotHistory(),
      })),
      // The whole log, not a tail of it. Trimming here was the other half of
      // "the chat reloads fresh": a deploy restored sixty messages of an
      // event that had hundreds, and the rest was simply gone.
      chatLog: this.chatLog.slice(-CHAT_KEEP),
    };
  }

  static restore(snap: TournamentSnap, cb: TournamentCallbacks): Tournament {
    const t = new Tournament(snap.config, { id: snap.hostId, name: snap.hostName }, cb, null);
    t.id = snap.id;
    t.createdAt = snap.createdAt;
    t.startedAt = snap.startedAt;
    t.endedAt = snap.endedAt ?? null;
    // A deploy must not silently extend or drop the window.
    if (t.state === 'running' || t.state === 'break' || t.state === 'paused') t.armJoinWindow();
    t.actionTimeMs = snap.actionTimeMs;
    t.nextPlace = snap.nextPlace;
    t.tableCounter = snap.tableCounter;
    t.discordWebhookUrl = snap.discordWebhookUrl;
    t.finalPayouts = snap.finalPayouts;
    t.chatLog = snap.chatLog ?? [];
    for (const p of snap.players) t.players.set(p.id, { ...p });

    if (snap.state === 'registering') {
      // Re-arm the scheduled auto-start if it is still in the future.
      if (snap.scheduledStart && snap.scheduledStart > Date.now()) {
        t.scheduledStart = snap.scheduledStart;
        t.armScheduledStart();
      }
      return t;
    }

    // The final-table redraw happens exactly once per tournament. Restoring
    // at the final table must not roll the seats a second time — trust the
    // stored flag; for snapshots that predate the field, infer it only for
    // fields that actually consolidated (a lone starting table never redraws).
    t.finalRedrawDone = snap.finalRedrawDone
      ?? (snap.tableCounter > 1 && snap.tables.length === 1);
    // Snapshots from before the late clock existed: if it is already on,
    // the field passed the mark before the restart — do not announce it twice.
    t.lateClockAnnounced = snap.lateClockAnnounced ?? t.lateClockMs() > 0;

    // A break interrupted by the restart just ends: land on the next
    // playable level and give it a fresh clock.
    t.levelIdx = clamp(snap.levelIdx, 0, t.structure.length - 1);
    while (t.structure[t.levelIdx]?.isBreak && t.levelIdx < t.structure.length - 1) t.levelIdx += 1;

    for (const ts of snap.tables) {
      const table = t.createTable({ id: ts.id, name: ts.name });
      table.buttonSeat = ts.buttonSeat;
      table.handNumber = ts.handNumber;
      table.restoreHistory(ts.history);
      table.paused = true;
      for (const seat of ts.seats) {
        table.seats[seat.idx] = {
          player: { ...seat.player },
          stack: seat.stack,
          sittingOut: seat.sittingOut,
          buyInTotal: seat.buyInTotal,
          timebankMs: seat.timebankMs,
          missedTurns: 0,
          ghostHands: 0, // restart forgives — the counter starts over
        };
      }
    }

    // Come back paused so players have a moment to reconnect; the caller
    // auto-resumes shortly (unless the host had paused it themselves).
    t.state = 'paused';
    const mins = t.levelMinutesFor(t.levelIdx);
    t.pauseRemainingMs = snap.state === 'running' && snap.levelRemainingMs !== null
      ? Math.max(30_000, snap.levelRemainingMs)
      : mins === null ? null : mins * 60_000;
    t.systemChat('Server restarted — tournament restored. Any hand that was in '
      + 'progress was cancelled and those chips returned. Play resumes shortly.');
    return t;
  }
}

// Serialized live-tournament state written to disk between hands of play.
export interface TournamentSnap {
  v: 1;
  id: string;
  config: TournamentConfig;
  hostId: string;
  hostName: string;
  state: TournamentState;
  createdAt: number;
  startedAt: number | null;
  endedAt?: number | null;
  scheduledStart: number | null;
  levelIdx: number;
  levelRemainingMs: number | null;
  actionTimeMs: number;
  nextPlace: number;
  tableCounter: number;
  discordWebhookUrl: string | null;
  finalPayouts: PayoutEntry[] | null;
  finalRedrawDone?: boolean;
  lateClockAnnounced?: boolean;
  players: TPlayer[];
  tables: {
    id: string;
    name: string;
    buttonSeat: number;
    handNumber: number;
    seats: {
      idx: number; player: { id: string; name: string; avatar: string };
      stack: number; sittingOut: boolean; timebankMs: number; buyInTotal: number;
    }[];
    history?: ReturnType<Table['snapshotHistory']>;
  }[];
  chatLog: ChatMsg[];
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
