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
import {
  PLAYER_COLORS, CHARACTERS, type Action, type CharacterId, type RoomSeat, type RoomSummary, type RoomView,
} from '../../shared/types.ts';

const BOT_DELAY_MS = 900;
/** Mini-game moves bring their own human-like delay (see the modules' bot()); this is just a nudge. */
const MINIGAME_BOT_DELAY_MS = 60;
/** How often to look in on bots waiting to make a mini-game move. */
const MINIGAME_POLL_MS = 150;
/** A disconnected player's turn is auto-played after this long. */
export const AUTOPILOT_GRACE_MS = 45_000;
/** Rooms with no connected humans are removed after this long. */
const IDLE_ROOM_MS = 30 * 60_000;
/** Finished rooms linger this long so people can read the result. */
const FINISHED_ROOM_MS = 10 * 60_000;
export const MAX_ROOMS = 500;
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
  readonly createdAt = Date.now();
  startedAt: number | null = null;
  finishedAt: number | null = null;
  lastActivity = Date.now();
  /** Sockets watching without a seat; maintained by the socket layer. */
  spectators = 0;
  private botTimer: NodeJS.Timeout | null = null;
  private auctionTimer: NodeJS.Timeout | null = null;
  private minigameTimer: NodeJS.Timeout | null = null;
  private autopilotTimer: NodeJS.Timeout | null = null;
  /** Turn timer, debt deadlines and the game-length limit (Game.clockDeadline). */
  private clockTimer: NodeJS.Timeout | null = null;

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
    this.lastActivity = Date.now();
    const existing = this.seat(m.id);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.avatar = m.avatar;
      if (this.status === 'lobby') existing.name = m.name;
      return existing;
    }
    if (this.status !== 'lobby') fail('This game has already started — you can watch');
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
    const s = this.seat(id);
    if (!s) return;
    if (this.status === 'lobby') {
      this.seats = this.seats.filter(x => x.id !== id);
      if (this.hostId === id) this.hostId = this.seats.find(x => !x.isBot)?.id ?? '';
      this.hooks.onEvent(this, `${s.name} left`);
    } else if (this.game && !this.game.player(id).bankrupt && this.game.phase !== 'over') {
      this.hooks.onEvent(this, `${s.name} forfeited`);
      this.act(id, { type: 'bankrupt' });
    }
  }

  setConnected(id: string, connected: boolean) {
    const s = this.seat(id);
    if (!s || s.isBot) return;
    s.connected = connected;
    s.disconnectedAt = connected ? null : Date.now();
    this.schedule();
  }

  requireHost(id: string, isAdmin = false) {
    if (id !== this.hostId && !isAdmin) fail('Only the host can do that');
  }

  requireLobby() {
    if (this.status !== 'lobby') fail('The game has already started');
  }

  configure(id: string, isAdmin: boolean, p: { themeId?: string; mapId?: string; rules?: Partial<RuleConfig>; private?: boolean }) {
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
    this.requireHost(id, isAdmin);
    this.requireLobby();
    this.style = sanitizeTableStyle(raw);
  }

  pickCharacter(id: string, character: CharacterId) {
    this.requireLobby();
    if (!CHARACTERS.includes(character)) fail('Unknown character');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.character === character)) fail('That character is taken');
    s.character = character;
  }

  pickColor(id: string, color: string) {
    this.requireLobby();
    if (!PLAYER_COLORS.includes(color)) fail('Unknown colour');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.color === color)) fail('That colour is taken');
    s.color = color;
  }

  addBot(id: string, isAdmin: boolean) {
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
    this.remove(target);
  }

  /** Remove a player regardless of who asks (bans, kicks). */
  remove(target: string) {
    if (this.status === 'lobby') {
      this.seats = this.seats.filter(s => s.id !== target);
      if (this.hostId === target) this.hostId = this.seats.find(x => !x.isBot)?.id ?? '';
    } else if (this.game && this.game.phase !== 'over' && !this.game.player(target).bankrupt) {
      this.act(target, { type: 'bankrupt' }, true); // not the player acting
    }
  }

  start(id: string, isAdmin: boolean) {
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

  /** Operator stops a game outright. */
  end(reason: string) {
    this.clearTimers();
    this.hooks.onEvent(this, `Game ended by an operator: ${reason}`);
    this.status = 'finished';
    this.finishedAt = Date.now();
  }

  // ---- play -----------------------------------------------------------------

  /** `auto`: the computer is moving for this seat (bot or autopilot), not the player. */
  act(id: string, a: Action, auto = false) {
    if (!this.game) fail('The game has not started');
    if (this.status === 'finished') fail('The game is over');
    this.lastActivity = Date.now();
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
      this.clockTimer = setTimeout(() => {
        if (this.game?.clockTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }, Math.max(0, clockDue - Date.now()) + 50);
    }

    if (g.auction) {
      const wait = Math.max(0, g.auction.endsAt - Date.now()) + 50;
      this.auctionTimer = setTimeout(() => {
        if (this.game?.auctionTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }, wait);
    }

    const now = Date.now();
    const mgDue = g.minigameDeadline();
    if (mgDue !== null) {
      // Wake at the round's next deadline, or sooner while a computer player is
      // still to move — bots decide on their own delay, so they need polling.
      const botWaiting = g.minigame?.stage === 'play'
        && this.seats.some(s => this.automated(s, now) === 'bot' && !g.player(s.id).bankrupt);
      const wait = Math.max(0, mgDue - now) + 20;
      this.minigameTimer = setTimeout(() => {
        if (this.game?.minigameTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }, botWaiting ? Math.min(wait, MINIGAME_POLL_MS) : wait);
    }

    const next = this.nextAutomatedAction(now);
    if (next) {
      this.botTimer = setTimeout(() => {
        const next = this.nextAutomatedAction(Date.now());
        if (!next) return;
        try {
          this.act(next.id, next.action, true);
        } catch (e) {
          // A bot choosing an illegal move is a bug, but it must never wedge
          // the room: log it and fall back to something always legal.
          console.error(`[room ${this.code}] automated ${next.action.type} failed:`, (e as Error).message);
          // A mini-game move can go stale (the round moved on); that's never worth a fallback.
          if (next.action.type !== 'minigame') this.fallback(next.id);
          else this.schedule();
        }
        this.hooks.onChange(this);
      }, next.action.type === 'minigame' ? MINIGAME_BOT_DELAY_MS : BOT_DELAY_MS);
      return;
    }

    const pending = this.seats
      .filter(s => !s.isBot && s.disconnectedAt !== null && !g.player(s.id).bankrupt)
      .map(s => s.disconnectedAt! + AUTOPILOT_GRACE_MS - now)
      .filter(ms => ms > 0);
    if (pending.length) {
      this.autopilotTimer = setTimeout(() => { this.schedule(); this.hooks.onChange(this); }, Math.min(...pending) + 50);
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
      let action = botAction(g, id);
      if (!action) continue;
      // Autopilot keeps an absent player's game moving but never spends their
      // money on a whim or makes deals in their name.
      if (mode === 'autopilot') {
        // Absent players just let a mini-game's clock run out (it plays safe for them).
        if (action.type === 'minigame') continue;
        if (action.type === 'bid') action = { type: 'pass' };
        else if (action.type === 'acceptTrade') action = { type: 'rejectTrade', id: action.id };
        else if (action.type === 'proposeTrade' || action.type === 'build' || action.type === 'unmortgage') {
          action = g.phase === 'done' ? { type: 'endTurn' } : { type: 'roll' };
        } else if (action.type === 'buy') action = { type: 'decline' };
      }
      return { id, action };
    }
    return null;
  }

  private fallback(id: string) {
    for (const a of [{ type: 'pass' }, { type: 'endTurn' }, { type: 'bankrupt' }] as Action[]) {
      try { this.act(id, a, true); return; } catch (e) { if (!(e instanceof EngineError)) throw e; }
    }
  }

  private clearTimers() {
    for (const t of [this.botTimer, this.auctionTimer, this.minigameTimer, this.autopilotTimer, this.clockTimer]) if (t) clearTimeout(t);
    this.botTimer = this.auctionTimer = this.minigameTimer = this.autopilotTimer = this.clockTimer = null;
  }

  dispose() {
    this.clearTimers();
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
    };
  }

  // ---- persistence ----------------------------------------------------------

  snapshot(): RoomSnapshot {
    return {
      code: this.code, hostId: this.hostId, createdAt: this.createdAt, startedAt: this.startedAt,
      themeId: this.themeId, mapId: this.mapId, rules: this.rules, private: this.private,
      status: this.status, seats: structuredClone(this.seats), game: this.game?.snapshot() ?? null,
      style: { ...this.style },
    };
  }

  static restore(s: RoomSnapshot, hooks: RoomHooks): Room {
    const r = new Room(s.code, s.hostId, hooks);
    Object.assign(r, {
      createdAt: s.createdAt, startedAt: s.startedAt, themeId: s.themeId, mapId: s.mapId,
      // Rooms saved before the turn timer existed keep playing without one.
      rules: sanitizeRules({ ...s.rules, turnSeconds: (s.rules as Partial<RuleConfig>).turnSeconds ?? 0 }), private: !!s.private, status: s.status,
      style: sanitizeTableStyle(s.style),
    });
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
    r.schedule();
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

  constructor(private hooks: RoomHooks, sweepEveryMs = 60_000) {
    setInterval(() => this.sweep(), sweepEveryMs).unref();
  }

  create(hostId: string): Room {
    if (this.rooms.size >= MAX_ROOMS) throw new RoomError('The server is at its room limit — try again later');
    let code: string;
    do code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    while (this.rooms.has(code));
    const room = new Room(code, hostId, this.hooks);
    this.rooms.set(code, room);
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
    return true;
  }

  /** Rooms a player currently sits in (for bans and admin lookups). */
  roomsOf(playerId: string): Room[] {
    return [...this.rooms.values()].filter(r => r.seat(playerId));
  }

  snapshot(): RoomSnapshot[] {
    return [...this.rooms.values()].filter(r => r.status !== 'finished').map(r => r.snapshot());
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
    for (const [code, r] of this.rooms) {
      const idle = !r.hasConnectedHumans() && r.spectators === 0 && now - r.lastActivity > IDLE_ROOM_MS;
      const done = r.status === 'finished' && now - (r.finishedAt ?? now) > FINISHED_ROOM_MS;
      if (idle || done) this.delete(code);
    }
  }
}

