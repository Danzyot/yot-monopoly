// Rooms: many independent games at once. Each room has a short join code, a
// lobby where the host picks the map, edition and house rules, and — once
// started — one Game. Rooms own everything time-based: auction deadlines, bot
// pacing, and autopilot for players who drop mid-game.

import { randomInt } from 'node:crypto';
import { EngineError, Game, type GameSnapshot } from './engine/game.ts';
import { botAction } from './engine/bot.ts';
import { isOn } from './features.ts';
import { DEFAULT_RULES, getTheme, resolveTheme, type RuleConfig } from '../../shared/themes.ts';
import { getMap } from '../../shared/maps.ts';
import { DEFAULT_TABLE_STYLE, sanitizeTableStyle, type TableStyle } from '../../shared/tableStyles.ts';
import { migrateCharacter } from '../../shared/characters.ts';
import { sanitizeRequirements } from './requirements.ts';
import {
  PLAYER_COLORS, CHARACTERS, type Action, type CharacterId, type JoinRequirements, type RoomSeat, type RoomSummary, type RoomView,
} from '../../shared/types.ts';

const BOT_DELAY_MS = 900;
/** Mini-game moves bring their own human-like delay (see the modules' bot()); this is just a nudge. */
const MINIGAME_BOT_DELAY_MS = 60;
/** How often to look in on bots waiting to make a mini-game move. */
const MINIGAME_POLL_MS = 150;
/** After a timer body throws, the room's timers are re-armed this much later (no tight error loops). */
const TIMER_RETRY_MS = 5_000;
/** A disconnected player's turn is auto-played after this long. */
export const AUTOPILOT_GRACE_MS = 45_000;
/** A host away this long hands the room to someone who is here. */
export const HOST_GRACE_MS = 2 * 60_000;
/**
 * Rooms with no connected humans are removed after this long; a running game
 * nobody is at (bots and autopilot only) is ended on net worth first.
 */
const IDLE_ROOM_MS = 30 * 60_000;
/** Finished rooms linger this long so people can read the result. */
const FINISHED_ROOM_MS = 10 * 60_000;
/** …or longer while someone is still at the table deciding on a rematch, up to this. */
const FINISHED_ROOM_MAX_MS = 3 * 60 * 60_000;
export const MAX_ROOMS = 500;
/** Each account may open this many rooms per CREATE_WINDOW_MS (operators exempt). */
export const CREATES_PER_WINDOW = 5;
const CREATE_WINDOW_MS = 10 * 60_000;
const BOT_NAMES = ['Rich Uncle', 'Tycoon', 'Landlord', 'Baron', 'Mogul', 'Magnate', 'Banker', 'Heiress'];

export interface Member {
  id: string;
  name: string;
  avatar: string;
}

interface Seat extends RoomSeat {
  disconnectedAt: number | null;
}

export interface RoomHooks {
  /** State changed outside a request (timers, bots): broadcast it. */
  onChange(room: Room): void;
  /** Something worth keeping in the durable room log. */
  onEvent(room: Room, text: string): void;
  /** The game just ended. */
  onFinished(room: Room): void;
  /** The last human left the lobby (bots don't count): the registry closes it. */
  onEmpty?(room: Room): void;
}

export class RoomError extends Error {}

function fail(msg: string): never {
  throw new RoomError(msg);
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  createdAt: number;
  startedAt: number | null;
  themeId: string;
  mapId: string;
  rules: RuleConfig;
  private: boolean;
  status: RoomView['status'];
  seats: Seat[];
  game: GameSnapshot | null;
  /** Absent in snapshots written before table styles existed. */
  style?: TableStyle;
  /** Absent in snapshots written before join requirements existed. */
  requirements?: JoinRequirements | null;
  /** Players who left the running game (never host again). Absent in older snapshots. */
  departed?: string[];
  /** Players the host removed: they may watch but not sit down again. Absent in older snapshots. */
  kicked?: string[];
}

export class Room {
  seats: Seat[] = [];
  status: RoomView['status'] = 'lobby';
  game: Game | null = null;
  themeId = 'classic';
  mapId = 'classic';
  rules: RuleConfig = { ...DEFAULT_RULES };
  private = false;
  /** Table look chosen by the host; purely cosmetic, so it never touches the game. */
  style: TableStyle = { ...DEFAULT_TABLE_STYLE };
  /** Discord gate on taking a seat; checked by the socket layer (requirements.ts). */
  requirements: JoinRequirements | null = null;
  readonly createdAt = Date.now();
  startedAt: number | null = null;
  finishedAt: number | null = null;
  /** Last human sign of life: a connection, a disconnection or their own move (never bots or autopilot). */
  lastActivity = Date.now();
  /** Sockets watching without a seat; maintained by the socket layer. */
  spectators = 0;
  /** Changed since the last live snapshot was written (persist.ts); every mutation sets it. */
  dirty = true;
  private botTimer: NodeJS.Timeout | null = null;
  private auctionTimer: NodeJS.Timeout | null = null;
  private minigameTimer: NodeJS.Timeout | null = null;
  private autopilotTimer: NodeJS.Timeout | null = null;
  /** Turn timer, debt deadlines and the game-length limit (Game.clockDeadline). */
  private clockTimer: NodeJS.Timeout | null = null;
  /** Separate from the game timers: host handover must not depend on schedule(). */
  private hostTimer: NodeJS.Timeout | null = null;
  /** Re-arms everything after a timer body threw (see guarded). */
  private retryTimer: NodeJS.Timeout | null = null;
  /**
   * Per seat, the automated move that just failed: not tried again until the
   * game changes, so a move the engine refuses cannot loop every BOT_DELAY_MS.
   */
  private failedMoves = new Map<string, string>();
  /** Players who left a running game for good; they keep their seat but can't host. */
  private departed = new Set<string>();
  /** Players removed by the host or an operator: never seated here again (watching is fine). */
  private kicked = new Set<string>();

  constructor(readonly code: string, public hostId: string, private hooks: RoomHooks) {}

  // ---- lobby ----------------------------------------------------------------

  seat(id: string): Seat | undefined {
    return this.seats.find(s => s.id === id);
  }

  hostName(): string {
    return this.seat(this.hostId)?.name ?? '—';
  }

  /** Take a seat (lobby) or reclaim one (any time). Throws when neither is possible. */
  join(m: Member): Seat {
    this.dirty = true;
    this.lastActivity = Date.now();
    const existing = this.seat(m.id);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      this.departed.delete(m.id);
      existing.avatar = m.avatar;
      if (this.status === 'lobby') existing.name = m.name;
      return existing;
    }
    if (this.status !== 'lobby') fail('This game has already started — you can watch');
    if (this.kicked.has(m.id)) fail('You were removed from this room — you can watch');
    if (this.seats.length >= this.rules.maxPlayers) fail('The room is full — you can watch');
    const s: Seat = {
      id: m.id, name: m.name, avatar: m.avatar, isBot: false, connected: true, disconnectedAt: null,
      character: this.freeCharacter(), color: this.freeColor(),
    };
    this.seats.push(s);
    if (!this.seat(this.hostId)) this.hostId = m.id;
    this.hooks.onEvent(this, `${m.name} joined`);
    return s;
  }

  private freeCharacter(): CharacterId {
    return CHARACTERS.find(c => !this.seats.some(s => s.character === c)) ?? CHARACTERS[0];
  }

  private freeColor(): string {
    return PLAYER_COLORS.find(c => !this.seats.some(s => s.color === c)) ?? '#ffffff';
  }

  /** Leave for good: lobby frees the seat; in a game it forfeits. */
  leave(id: string) {
    this.dirty = true;
    const s = this.seat(id);
    if (!s) return;
    if (this.status === 'lobby') {
      if (this.hostId === id) this.passHost(id, 'left');
      this.seats = this.seats.filter(x => x.id !== id);
      this.hooks.onEvent(this, `${s.name} left`);
      this.closeIfEmpty();
    } else {
      this.departed.add(id);
      // Hand over first: the forfeit below can end the game.
      if (this.hostId === id) this.passHost(id, 'left');
      if (this.game && !this.game.player(id).bankrupt && this.game.phase !== 'over') {
        this.hooks.onEvent(this, `${s.name} forfeited`);
        this.act(id, { type: 'bankrupt' });
      }
    }
    // Gone from the table for good: a finished room must not wait on them
    // (see the sweep), and a rematch will not keep their seat.
    if (this.status !== 'lobby') this.setConnected(id, false);
  }

  /** A lobby nobody human sits in is closed at once rather than lingering for the idle sweep. */
  private closeIfEmpty() {
    if (this.status === 'lobby' && !this.seats.some(s => !s.isBot)) this.hooks.onEmpty?.(this);
  }

  // ---- host -------------------------------------------------------------------

  /** The host (or an operator) makes another seated human the host — lobby or mid-game. */
  transferHost(byId: string, target: string, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(byId, isAdmin);
    const s = this.seat(target) ?? fail('Not in this room');
    if (s.isBot) fail('A bot cannot be the host');
    if (target === this.hostId) fail(`${s.name} is already the host`);
    if (!s.connected || this.departed.has(target)) fail(`${s.name} is not at the table right now`);
    const by = byId === this.hostId ? this.hostName() : 'an operator';
    this.hostId = target;
    this.hooks.onEvent(this, `${s.name} is now the host (handed over by ${by})`);
    this.watchHost();
  }

  /**
   * Who takes over when the host goes: the longest-seated connected human
   * (seats keep join order). Players still in the game come before bankrupt
   * ones, who are only watching.
   */
  private successor(except: string): Seat | undefined {
    const here = this.seats.filter(s => !s.isBot && s.connected && s.id !== except && !this.departed.has(s.id));
    const stillIn = (s: Seat) => !this.game || !this.game.player(s.id).bankrupt;
    return here.find(stillIn) ?? here[0];
  }

  /** Move the host away from `from`. Returns false (host unchanged) when nobody can take over. */
  private passHost(from: string, why: string): boolean {
    const next = this.successor(from);
    if (!next) {
      // Nobody connected. A lobby still needs a host, so it goes to whoever is
      // seated (watchHost moves it on if they stay away); with nobody seated
      // the next person to sit down gets it (see join()).
      if (this.status === 'lobby') this.hostId = this.seats.find(x => !x.isBot && x.id !== from)?.id ?? '';
      return false;
    }
    const was = this.seat(from)?.name;
    this.dirty = true;
    this.hostId = next.id;
    this.hooks.onEvent(this, `${next.name} is now the host (${was ?? 'the host'} ${why})`);
    return true;
  }

  /**
   * Hand the room on when its host is gone: left a running game, or away for
   * HOST_GRACE_MS. Called whenever someone connects or drops, so a room whose
   * host vanished while nobody else was around recovers the moment someone
   * returns. Finished rooms too: someone still at the table must be able to
   * start the rematch.
   */
  private watchHost() {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
    const h = this.seat(this.hostId);
    let gone = !h || this.departed.has(this.hostId);
    if (h && !gone && h.disconnectedAt !== null) {
      const due = h.disconnectedAt + HOST_GRACE_MS - Date.now();
      if (due > 0) {
        this.hostTimer = setTimeout(() => this.guarded('host', () => this.watchHost(), false), due + 50);
        this.hostTimer.unref?.();
        return;
      }
      gone = true;
    }
    if (!gone) return;
    const why = !h || this.departed.has(this.hostId) ? 'left' : 'was away for over 2 minutes';
    if (this.passHost(this.hostId, why)) this.hooks.onChange(this);
  }

  /** Host (or operator) sets who may take a seat. Validation happens in requirements.ts. */
  setRequirements(id: string, isAdmin: boolean, req: JoinRequirements | null) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    this.requirements = req;
    this.hooks.onEvent(this, req
      ? `Seats now need ${req.roleId ? `the ${req.roleName ?? 'required'} Discord role` : 'Discord server membership'}`
      : 'Discord requirements removed');
  }

  setConnected(id: string, connected: boolean) {
    this.dirty = true;
    const s = this.seat(id);
    if (!s || s.isBot) return;
    s.connected = connected;
    s.disconnectedAt = connected ? null : Date.now();
    this.lastActivity = Date.now();
    this.schedule();
    this.watchHost();
  }

  requireHost(id: string, isAdmin = false) {
    if (id !== this.hostId && !isAdmin) fail('Only the host can do that');
  }

  requireLobby() {
    if (this.status !== 'lobby') fail('The game has already started');
  }

  configure(id: string, isAdmin: boolean, p: { themeId?: string; mapId?: string; rules?: Partial<RuleConfig>; private?: boolean }) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    if (p.mapId) {
      this.mapId = getMap(p.mapId).id;
      const cash = getMap(this.mapId).startingCash;
      if (cash) this.rules = { ...this.rules, startingCash: cash };
    }
    if (p.themeId) {
      this.themeId = getTheme(p.themeId).id;
      // An edition brings its own default house rules.
      this.rules = sanitizeRules({ ...this.rules, ...getTheme(this.themeId).rules });
    }
    if (p.rules) this.rules = sanitizeRules({ ...this.rules, ...p.rules });
    if (typeof p.private === 'boolean') this.private = p.private;
    while (this.seats.length > this.rules.maxPlayers) {
      const bot = [...this.seats].reverse().find(s => s.isBot);
      if (!bot) break;
      this.seats = this.seats.filter(s => s !== bot);
    }
    if (this.seats.length > this.rules.maxPlayers) {
      this.rules = { ...this.rules, maxPlayers: this.seats.length };
    }
  }

  /** Host (or operator) picks the table look. Always sanitised: every viewer loads these URLs. */
  setStyle(id: string, isAdmin: boolean, raw: unknown) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    this.style = sanitizeTableStyle(raw);
  }

  pickCharacter(id: string, character: CharacterId) {
    this.dirty = true;
    this.requireLobby();
    if (!CHARACTERS.includes(character)) fail('Unknown character');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.character === character)) fail('That character is taken');
    s.character = character;
  }

  pickColor(id: string, color: string) {
    this.dirty = true;
    this.requireLobby();
    if (!PLAYER_COLORS.includes(color)) fail('Unknown colour');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.color === color)) fail('That colour is taken');
    s.color = color;
  }

  addBot(id: string, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    if (this.seats.length >= this.rules.maxPlayers) fail('The room is full');
    const used = new Set(this.seats.map(s => s.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot ${this.seats.length + 1}`;
    this.seats.push({
      id: `bot-${this.code}-${randomInt(1e9)}`, name, avatar: '🤖', isBot: true, connected: true, disconnectedAt: null,
      character: this.freeCharacter(), color: this.freeColor(),
    });
  }

  /** Host (or operator) removes someone: lobby seat freed, in-game forfeited. */
  kick(byId: string, target: string, isAdmin: boolean) {
    this.requireHost(byId, isAdmin);
    if (target === byId) fail('Use leave instead');
    const s = this.seat(target) ?? fail('Not in this room');
    this.hooks.onEvent(this, `${s.name} was removed by ${this.seat(byId)?.name ?? 'an operator'}`);
    // No reloading back into the seat (bots never come back anyway).
    if (!s.isBot) this.kicked.add(target);
    this.remove(target);
  }

  wasKicked(id: string): boolean {
    return this.kicked.has(id);
  }

  /** Remove a player regardless of who asks (bans, kicks). */
  remove(target: string) {
    this.dirty = true;
    if (this.status === 'lobby') {
      if (this.hostId === target) this.passHost(target, 'was removed');
      this.seats = this.seats.filter(s => s.id !== target);
      this.closeIfEmpty();
    } else {
      if (this.seat(target)) this.departed.add(target);
      if (this.hostId === target) this.passHost(target, 'was removed');
      if (this.game && this.game.phase !== 'over' && !this.game.player(target).bankrupt) {
        this.act(target, { type: 'bankrupt' }, true); // not the player acting
      }
    }
  }

  start(id: string, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    if (this.seats.length < 2) fail('Need at least 2 players (add a bot?)');
    const order = [...this.seats];
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.game = new Game({
      theme: resolveTheme(this.themeId, this.mapId),
      rules: this.rules,
      players: order.map(s => ({ id: s.id, name: s.name, character: s.character, color: s.color, isBot: s.isBot })),
      rng: n => randomInt(n),
      onLog: text => this.hooks.onEvent(this, text),
      // The operator's site-wide switch wins over the room's house rule, even mid-game.
      minigamesEnabled: () => isOn('minigames'),
    });
    this.status = 'playing';
    this.startedAt = Date.now();
    this.schedule();
  }

  /**
   * Host (or operator) sends a finished table back to the lobby for another
   * game: same map, edition, house rules, table style and seats. Bots keep
   * their seats; humans who are no longer at the table (`present` is false —
   * the socket layer knows who is) lose theirs. Everyone left keeps their
   * character and colour.
   */
  rematch(byId: string, isAdmin: boolean, present: (id: string) => boolean) {
    this.dirty = true;
    this.requireHost(byId, isAdmin);
    if (this.status !== 'finished') fail('The game is not over yet');
    this.clearTimers();
    const gone = this.seats.filter(s => !s.isBot && !present(s.id));
    this.seats = this.seats.filter(s => s.isBot || present(s.id));
    if (!this.seat(this.hostId)) this.hostId = this.seats.find(s => !s.isBot)?.id ?? byId;
    for (const s of this.seats) if (!s.isBot) { s.connected = true; s.disconnectedAt = null; }
    this.game = null;
    this.status = 'lobby';
    this.startedAt = null;
    this.finishedAt = null;
    this.lastActivity = Date.now();
    this.hooks.onEvent(this, `Rematch! Back to the lobby${gone.length ? ` (${gone.map(s => s.name).join(', ')} left)` : ''}`);
  }

  /** Operator stops a game outright. */
  end(reason: string) {
    this.dirty = true;
    this.clearTimers();
    this.hooks.onEvent(this, `Game ended by an operator: ${reason}`);
    this.status = 'finished';
    this.finishedAt = Date.now();
    if (this.game && this.game.endedAt === null) this.game.endedAt = this.finishedAt;
  }

  /**
   * Nobody has been at a running table for IDLE_ROOM_MS: end the game on net
   * worth, like the time limit (so results are recorded as usual), and let
   * the sweep clear the finished room.
   */
  abandon() {
    const g = this.runningGame();
    g.abandon();
    this.hooks.onEvent(this, 'Game ended: nobody has been at the table for 30 minutes');
    this.afterChange();
    this.hooks.onChange(this);
  }

  // ---- play -----------------------------------------------------------------

  /** `auto`: the computer is moving for this seat (bot or autopilot), not the player. */
  act(id: string, a: Action, auto = false) {
    if (!this.game) fail('The game has not started');
    if (this.status === 'finished') fail('The game is over');
    // Bots and autopilot moving is no sign anyone is still here (see the sweep).
    if (!auto) this.lastActivity = Date.now();
    this.game.apply(id, a, { auto });
    const s = this.seat(id);
    if (!auto && s?.autopilot) {
      // Acting yourself takes the seat back from autopilot.
      s.autopilot = false;
      this.hooks.onEvent(this, `${s.name} took back control from autopilot`);
    }
    this.afterChange();
  }

  /** Host or operator freezes every clock in the game (chat keeps working). */
  pause(id: string, isAdmin: boolean, byName: string) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    const g = this.runningGame();
    g.pause(byName);
    this.hooks.onEvent(this, `Game paused by ${byName}`);
    this.schedule();
  }

  resume(id: string, isAdmin: boolean, byName: string) {
    this.requireHost(id, isAdmin);
    const g = this.runningGame();
    g.resume(byName);
    this.hooks.onEvent(this, `Game resumed by ${byName}`);
    this.afterChange();
  }

  /** Host or operator hands a (connected but absent) player to autopilot, or takes them off it. */
  setAutopilot(byId: string, target: string, on: boolean, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(byId, isAdmin);
    const g = this.runningGame();
    const s = this.seat(target) ?? fail('Not in this room');
    if (s.isBot) fail('Bots already play themselves');
    if (g.player(target).bankrupt) fail(`${s.name} is out of the game`);
    s.autopilot = on;
    // Taking someone off autopilot also clears the away flag it may be covering for.
    if (!on) g.player(target).afk = false;
    this.hooks.onEvent(this, on
      ? `${s.name} was handed to autopilot by ${this.seat(byId)?.name ?? 'an operator'}`
      : `${s.name} was taken off autopilot by ${this.seat(byId)?.name ?? 'an operator'}`);
    this.schedule();
  }

  private runningGame(): Game {
    if (!this.game || this.status !== 'playing' || this.game.phase === 'over') fail('No game is running');
    return this.game;
  }

  /** Operator corrections (routes/adminGame.ts); each is logged by the engine and here. */
  adminFix(fix: (g: Game) => void, what: string, by: string) {
    const g = this.runningGame();
    fix(g);
    this.hooks.onEvent(this, `Operator ${by}: ${what}`);
    this.afterChange();
  }

  private afterChange() {
    this.dirty = true;
    this.failedMoves.clear();
    if (this.game?.phase === 'over' && this.status !== 'finished') {
      this.status = 'finished';
      this.finishedAt = Date.now();
      this.hooks.onFinished(this);
    }
    this.schedule();
  }

  /** Is this seat played by the computer right now? */
  private automated(s: Seat, now: number): 'bot' | 'autopilot' | null {
    if (s.isBot) return 'bot';
    if (s.disconnectedAt !== null && now - s.disconnectedAt >= AUTOPILOT_GRACE_MS) return 'autopilot';
    // Handed over by the host, or marked away after timing out: until they act again.
    if (s.autopilot || this.game?.players.find(p => p.id === s.id)?.afk) return 'autopilot';
    return null;
  }

  /** Re-arm timers after any change. */
  private schedule() {
    const g = this.game;
    this.clearTimers();
    if (!g || g.phase === 'over' || this.status === 'finished') return;
    // Paused: nothing moves, not even bots, until resume() re-arms everything.
    if (g.paused) return;

    const clockDue = g.clockDeadline();
    if (clockDue !== null) {
      this.clockTimer = setTimeout(() => this.guarded('clock', () => {
        if (this.game?.clockTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }), Math.max(0, clockDue - Date.now()) + 50);
    }

    if (g.auction) {
      const wait = Math.max(0, g.auction.endsAt - Date.now()) + 50;
      this.auctionTimer = setTimeout(() => this.guarded('auction', () => {
        if (this.game?.auctionTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }), wait);
    }

    const now = Date.now();
    const mgDue = g.minigameDeadline();
    if (mgDue !== null) {
      // Wake at the round's next deadline, or sooner while a computer player is
      // still to move — bots decide on their own delay, so they need polling.
      const botWaiting = g.minigame?.stage === 'play'
        && this.seats.some(s => this.automated(s, now) === 'bot' && !g.player(s.id).bankrupt);
      const wait = Math.max(0, mgDue - now) + 20;
      this.minigameTimer = setTimeout(() => this.guarded('mini-game', () => {
        if (this.game?.minigameTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }), botWaiting ? Math.min(wait, MINIGAME_POLL_MS) : wait);
    }

    const next = this.nextAutomatedAction(now);
    if (next) {
      this.botTimer = setTimeout(() => this.guarded('bot', () => {
        const next = this.nextAutomatedAction(Date.now());
        if (!next) {
          this.schedule();
          return;
        }
        try {
          this.act(next.id, next.action, true);
        } catch (e) {
          // A bot choosing an illegal move is a bug, or the move went stale (a
          // trade whose cash was spent meanwhile), but it must never wedge the
          // room: log it and fall back to something harmless.
          console.error(`[room ${this.code}] automated ${next.action.type} failed:`, (e as Error).message);
          // A mini-game move can go stale (the round moved on); that's never worth a fallback.
          if (next.action.type !== 'minigame') {
            this.failedMoves.set(next.id, JSON.stringify(next.action));
            this.fallback(next.id, next.action);
          } else {
            this.schedule();
          }
        }
        this.hooks.onChange(this);
      }), next.action.type === 'minigame' ? MINIGAME_BOT_DELAY_MS : BOT_DELAY_MS);
      return;
    }

    const pending = this.seats
      .filter(s => !s.isBot && s.disconnectedAt !== null && !g.player(s.id).bankrupt)
      .map(s => s.disconnectedAt! + AUTOPILOT_GRACE_MS - now)
      .filter(ms => ms > 0);
    if (pending.length) {
      this.autopilotTimer = setTimeout(() => this.guarded('autopilot', () => { this.schedule(); this.hooks.onChange(this); }), Math.min(...pending) + 50);
    }
  }

  private nextAutomatedAction(now: number): { id: string; action: Action } | null {
    const g = this.game;
    if (!g || g.phase === 'over') return null;
    const order = [g.current.id, ...g.players.map(p => p.id).filter(id => id !== g.current.id)];
    for (const id of order) {
      const s = this.seat(id);
      const mode = s ? this.automated(s, now) : null;
      if (!mode) continue;
      let action: Action | null;
      try {
        action = botAction(g, id);
      } catch (e) {
        // A bug in the bot for this seat must not stop everyone else's moves.
        console.error(`[room ${this.code}] bot for ${id} failed:`, e);
        continue;
      }
      if (!action) continue;
      // Autopilot keeps an absent player's game moving but never spends their
      // money on a whim or makes deals in their name.
      if (mode === 'autopilot') {
        // Absent players just let a mini-game's clock run out (it plays safe for them).
        if (action.type === 'minigame') continue;
        if (action.type === 'bid') action = { type: 'pass' };
        else if (action.type === 'acceptTrade') action = { type: 'rejectTrade', id: action.id };
        else if (action.type === 'proposeTrade' || action.type === 'build' || action.type === 'unmortgage'
          // Selling or mortgaging only to raise money owed; never to build or buy with.
          || ((action.type === 'sell' || action.type === 'mortgage') && g.debtOf(id) === 0)) {
          action = g.phase === 'done' ? { type: 'endTurn' } : g.phase === 'buy' ? { type: 'decline' } : { type: 'roll' };
        } else if (action.type === 'buy') action = { type: 'decline' };
      }
      if (this.failedMoves.get(id) === JSON.stringify(action)) continue;
      return { id, action };
    }
    return null;
  }

  /**
   * An automated move failed: try something harmless instead. Never
   * bankruptcy — a stale trade or a debt during an auction is no reason to
   * resign for anyone; the debt clock decides that. With nothing harmless to
   * do, the seat waits (its failed move is not retried until the game moves).
   */
  private fallback(id: string, failed: Action) {
    const tries: Action[] = [];
    if (failed.type === 'acceptTrade') tries.push({ type: 'rejectTrade', id: failed.id });
    tries.push({ type: 'pass' }, { type: 'endTurn' });
    for (const a of tries) {
      try { this.act(id, a, true); return; } catch (e) { if (!(e instanceof EngineError)) throw e; }
    }
    this.schedule();
  }

  /**
   * Every timer body runs through here: a bug in the engine, the bot or a hook
   * is logged with the room code and, unless `rearm` is false, the room's
   * timers are re-armed a little later. It must never take the server (and
   * every other table) down with it.
   */
  private guarded(what: string, fn: () => void, rearm = true) {
    try {
      fn();
    } catch (e) {
      console.error(`[room ${this.code}] ${what} timer failed:`, e);
      if (!rearm) return;
      this.clearTimers();
      this.retryTimer = setTimeout(() => this.guarded('retry', () => {
        this.schedule();
        this.hooks.onChange(this);
      }), TIMER_RETRY_MS);
    }
  }

  private clearTimers() {
    for (const t of [this.botTimer, this.auctionTimer, this.minigameTimer, this.autopilotTimer, this.clockTimer, this.retryTimer]) if (t) clearTimeout(t);
    this.botTimer = this.auctionTimer = this.minigameTimer = this.autopilotTimer = this.clockTimer = this.retryTimer = null;
  }

  dispose() {
    this.clearTimers();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
  }

  hasConnectedHumans(): boolean {
    return this.seats.some(s => !s.isBot && s.connected);
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      themeId: this.themeId,
      mapId: this.mapId,
      private: this.private,
      spectators: this.spectators,
      rules: this.rules,
      status: this.status,
      seats: this.seats.map(({ disconnectedAt: _d, ...s }) => s),
      game: this.game?.view() ?? null,
      style: this.style,
      now: Date.now(),
      requirements: this.requirements,
    };
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      themeId: this.themeId,
      mapId: this.mapId,
      status: this.status,
      players: this.seats.length,
      maxPlayers: this.rules.maxPlayers,
      hostName: this.hostName(),
      requirements: this.requirements,
    };
  }

  // ---- persistence ----------------------------------------------------------

  snapshot(): RoomSnapshot {
    return {
      code: this.code, hostId: this.hostId, createdAt: this.createdAt, startedAt: this.startedAt,
      themeId: this.themeId, mapId: this.mapId, rules: this.rules, private: this.private,
      status: this.status, seats: structuredClone(this.seats), game: this.game?.snapshot() ?? null,
      style: { ...this.style },
      requirements: this.requirements ? { ...this.requirements } : null,
      departed: [...this.departed],
      kicked: [...this.kicked],
    };
  }

  static restore(s: RoomSnapshot, hooks: RoomHooks): Room {
    const r = new Room(s.code, s.hostId, hooks);
    Object.assign(r, {
      createdAt: s.createdAt, startedAt: s.startedAt, themeId: s.themeId, mapId: s.mapId,
      // Rooms saved before the turn timer existed keep playing without one.
      rules: sanitizeRules({ ...s.rules, turnSeconds: (s.rules as Partial<RuleConfig>).turnSeconds ?? 0 }), private: !!s.private, status: s.status,
      style: sanitizeTableStyle(s.style),
      requirements: sanitizeRequirements(s.requirements),
    });
    if (Array.isArray(s.departed)) r.departed = new Set(s.departed.filter(x => typeof x === 'string'));
    if (Array.isArray(s.kicked)) r.kicked = new Set(s.kicked.filter(x => typeof x === 'string'));
    // Everyone starts disconnected: they reclaim their seats on reconnect, and
    // autopilot covers anyone who never comes back.
    const now = Date.now();
    // Snapshots from before characters existed carry `token`; migrateCharacter
    // maps those (and anything unknown) onto a character.
    const withCharacter = <T extends object>(x: T) => {
      const { token: _legacy, ...rest } = x as T & { token?: unknown };
      return { ...rest, character: migrateCharacter(x) };
    };
    r.seats = s.seats.map(x => ({ ...withCharacter(x), connected: x.isBot, disconnectedAt: x.isBot ? null : now }));
    if (s.game) {
      const game = { ...s.game, players: s.game.players.map(withCharacter) };
      r.game = Game.restore({
        theme: resolveTheme(r.themeId, r.mapId), rules: r.rules, rng: n => randomInt(n),
        onLog: text => hooks.onEvent(r, text), minigamesEnabled: () => isOn('minigames'),
      }, game);
    }
    if (r.status === 'finished') r.finishedAt = now;
    try {
      r.schedule();
      // The host is disconnected like everyone else: start their 2-minute clock.
      r.watchHost();
    } catch (e) {
      // Not restored after all: leave no timers running for a room nobody can reach.
      r.dispose();
      throw e;
    }
    return r;
  }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

export function sanitizeRules(r: Partial<RuleConfig>): RuleConfig {
  const d = DEFAULT_RULES;
  const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  return {
    startingCash: clampInt(r.startingCash, 100, 100_000, d.startingCash),
    goSalary: clampInt(r.goSalary, 0, 10_000, d.goSalary),
    doubleOnGo: bool(r.doubleOnGo, d.doubleOnGo),
    freeParkingPot: bool(r.freeParkingPot, d.freeParkingPot),
    auctions: bool(r.auctions, d.auctions),
    evenBuild: bool(r.evenBuild, d.evenBuild),
    limitedBuildings: bool(r.limitedBuildings, d.limitedBuildings),
    jailFine: clampInt(r.jailFine, 0, 10_000, d.jailFine),
    maxPlayers: clampInt(r.maxPlayers, 2, 8, d.maxPlayers),
    minigames: bool(r.minigames, d.minigames),
    arcadeParking: bool(r.arcadeParking, d.arcadeParking),
    // 0 = off; otherwise at least 15 s so nobody can set an unplayable clock.
    turnSeconds: offOrClamp(r.turnSeconds, 15, 600, d.turnSeconds),
    timeLimitMin: offOrClamp(r.timeLimitMin, 5, 600, d.timeLimitMin),
    noRentInJail: bool(r.noRentInJail, d.noRentInJail),
    speedDie: bool(r.speedDie, d.speedDie),
  };
}

function offOrClamp(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = clampInt(v, 0, hi, dflt);
  return n === 0 ? 0 : Math.max(lo, n);
}

// Unambiguous characters only — codes get read out loud and typed on phones.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Registry {
  rooms = new Map<string, Room>();
  private hooks: RoomHooks;
  /** When each account opened its recent rooms (see CREATES_PER_WINDOW). */
  private created = new Map<string, number[]>();
  /** Rooms added or removed since the last live snapshot (each room tracks its own changes). */
  private dirty = true;

  constructor(hooks: RoomHooks, sweepEveryMs = 60_000) {
    this.hooks = { ...hooks, onEmpty: r => { if (this.rooms.get(r.code) === r) this.delete(r.code); } };
    setInterval(() => this.sweep(), sweepEveryMs).unref();
  }

  /** `exempt`: operators open as many rooms as they like. */
  create(hostId: string, exempt = false): Room {
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('The server is at its room limit — try again later');
    if (!exempt) {
      const now = Date.now();
      const recent = (this.created.get(hostId) ?? []).filter(t => now - t < CREATE_WINDOW_MS);
      if (recent.length >= CREATES_PER_WINDOW) throw new RoomError('You have opened a lot of rooms — try again in a few minutes');
      recent.push(now);
      this.created.set(hostId, recent);
    }
    let code: string;
    do code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    while (this.rooms.has(code));
    const room = new Room(code, hostId, this.hooks);
    this.rooms.set(code, room);
    this.dirty = true;
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(String(code).toUpperCase());
  }

  /** Public list: open rooms with someone in them. */
  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(r => !r.private && r.hasConnectedHumans() && r.status !== 'finished')
      .map(r => r.summary())
      .sort((a, b) => Number(a.status !== 'lobby') - Number(b.status !== 'lobby'));
  }

  delete(code: string): boolean {
    const r = this.rooms.get(code);
    if (!r) return false;
    r.dispose();
    this.rooms.delete(code);
    this.dirty = true;
    return true;
  }

  /** Rooms a player currently sits in (for bans and admin lookups). */
  roomsOf(playerId: string): Room[] {
    return [...this.rooms.values()].filter(r => r.seat(playerId));
  }

  snapshot(): RoomSnapshot[] {
    return [...this.rooms.values()].filter(r => r.status !== 'finished').map(r => r.snapshot());
  }

  /** Has anything changed since the last call? Clears the flags: call it just before snapshot(). */
  takeDirty(): boolean {
    let dirty = this.dirty;
    this.dirty = false;
    for (const r of this.rooms.values()) {
      if (r.dirty) dirty = true;
      r.dirty = false;
    }
    return dirty;
  }

  /** A snapshot could not be written: try again next time. */
  markDirty() {
    this.dirty = true;
  }

  restore(snaps: RoomSnapshot[]): number {
    let n = 0;
    for (const s of snaps) {
      try {
        this.rooms.set(s.code, Room.restore(s, this.hooks));
        n++;
      } catch (e) {
        console.error(`Could not restore room ${s?.code}:`, e);
      }
    }
    return n;
  }

  private sweep() {
    const now = Date.now();
    for (const [id, times] of this.created) {
      if (times.every(t => now - t >= CREATE_WINDOW_MS)) this.created.delete(id);
    }
    for (const [code, r] of this.rooms) {
      try {
        this.sweepOne(code, r, now);
      } catch (e) {
        console.error(`[room ${code}] sweep failed:`, e);
      }
    }
  }

  private sweepOne(code: string, r: Room, now: number) {
    const away = !r.hasConnectedHumans() && now - r.lastActivity > IDLE_ROOM_MS;
    // Bots and autopilot would play an abandoned game forever: end it (it is
    // swept below once finished, like any other).
    if (away && r.status === 'playing' && r.game && r.game.phase !== 'over') r.abandon();
    const idle = away && r.spectators === 0;
    // A finished table stays while people are still at it (reading the
    // summary, waiting on the host's rematch), within a hard cap.
    const since = now - (r.finishedAt ?? now);
    const occupied = r.hasConnectedHumans() || r.spectators > 0;
    const done = r.status === 'finished' && since > FINISHED_ROOM_MS && (!occupied || since > FINISHED_ROOM_MAX_MS);
    if (idle || done) this.delete(code);
  }
}
