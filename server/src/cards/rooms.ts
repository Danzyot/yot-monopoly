// Card game rooms, built like the Monopoly rooms (server/src/rooms.ts): a
// short join code, a lobby where the host sets the table up, and once started
// one CardsGame. The room owns everything time-based: the turn clock and the
// round break (the engine's clockDeadline/clockTimeout), bots, reactions and
// autopilot for players who dropped.
//
// Unlike Monopoly, every automated seat has its own timer. Reactions (a
// catch, a late call, a jump-in) belong to whoever is quickest, not to the
// player whose turn it is: one "current player first" timer would starve them.

import { randomInt } from 'node:crypto';
import { CardsError, CardsGame, type CardsSnapshot } from './game.ts';
import { cardsAutopilotAction, cardsBotAction, cardsBotThinkMs } from './bot.ts';
import { CARDS_MAX_PLAYERS, CARDS_MIN_PLAYERS } from '../../../shared/cards/meta.ts';
import { bestColor } from '../../../shared/cards/deck.ts';
import { DEFAULT_CARDS_RULES, normalizeCardsRules, type CardsRules } from '../../../shared/cards/rules.ts';
import type { CardsAction, CardsBotLevel } from '../../../shared/cards/types.ts';
import { cardsPlayMs, CARDS_MAX_QUEUE_MS } from '../../../shared/cards/pacing.ts';
import {
  CARDS_AUTOPLAY_GRACE_MS, CARDS_DEFAULT_MAX_PLAYERS, CARDS_SEAT_COLORS, matchLabel,
  type CardsConfigure, type CardsRoomStatus, type CardsRoomSummary, type CardsRoomView, type CardsSeatView,
} from '../../../shared/cards/room.ts';
import { CHARACTERS, isCharacterId, migrateCharacter, type CharacterId } from '../../../shared/characters.ts';

/** A disconnected player's moves are made for them after this long. */
export const CARDS_AUTOPILOT_GRACE_MS = CARDS_AUTOPLAY_GRACE_MS;
/** A host away this long hands the room to someone who is here. */
export const CARDS_HOST_GRACE_MS = 2 * 60_000;
/** Rooms with no connected humans are removed after this long; a running match nobody is at is ended first. */
export const CARDS_IDLE_ROOM_MS = 30 * 60_000;
/** Finished rooms linger this long so people can read the result... */
const FINISHED_ROOM_MS = 10 * 60_000;
/** ...or longer while someone is still at the table, up to this. */
const FINISHED_ROOM_MAX_MS = 3 * 60 * 60_000;
/** After a timer body throws, the room's timers are re-armed this much later. */
const TIMER_RETRY_MS = 5_000;
export const CARDS_MAX_ROOMS = 500;
export const CARDS_CREATES_PER_WINDOW = 5;
const CREATE_WINDOW_MS = 10 * 60_000;
const BOT_NAMES = ['Ace', 'Joker', 'Shuffles', 'Wildcard', 'Lucky', 'Maverick', 'Dazzle', 'Domino', 'Trickster', 'Dealer'];
const BOT_LEVELS: CardsBotLevel[] = ['easy', 'normal', 'hard'];
/** A table's default: one quick round, with a turn timer. */
export const CARDS_LOBBY_RULES: CardsRules = { ...DEFAULT_CARDS_RULES, match: 'single' };

export class CardsRoomError extends Error {}

function fail(msg: string): never {
  throw new CardsRoomError(msg);
}

export interface CardsMember {
  id: string;
  name: string;
  avatar: string;
}

interface Seat extends CardsSeatView {
  disconnectedAt: number | null;
}

export interface CardsRoomHooks {
  /** State changed outside a request (timers, bots): broadcast it. */
  onChange(room: CardsRoom): void;
  /** Something worth keeping in the durable room log. */
  onEvent(room: CardsRoom, text: string): void;
  /** The match just ended (phase 'over'). */
  onFinished(room: CardsRoom): void;
  /** The last human left the lobby: the registry closes it. */
  onEmpty?(room: CardsRoom): void;
}

/** Injected for tests: the clock and the shuffle. */
export interface CardsRoomOptions {
  now?: () => number;
  rng?: (n: number) => number;
}

export interface CardsRoomSnapshot {
  code: string;
  hostId: string;
  createdAt: number;
  startedAt: number | null;
  rules: CardsRules;
  maxPlayers: number;
  private: boolean;
  status: CardsRoomStatus;
  seats: Seat[];
  game: CardsSnapshot | null;
  departed: string[];
  kicked: string[];
}

export class CardsRoom {
  seats: Seat[] = [];
  status: CardsRoomStatus = 'lobby';
  game: CardsGame | null = null;
  rules: CardsRules = { ...CARDS_LOBBY_RULES };
  maxPlayers = CARDS_DEFAULT_MAX_PLAYERS;
  private = false;
  createdAt: number;
  startedAt: number | null = null;
  finishedAt: number | null = null;
  /** Last human sign of life (never bots or autopilot). */
  lastActivity: number;
  /** Sockets watching without a seat; kept by the socket layer. */
  spectators = 0;
  /** Changed since the last live snapshot was written. */
  dirty = true;
  /** One timer per automated seat (bot or autopilot), keyed by the move it will make. */
  private seatTimers = new Map<string, { key: string; timer: NodeJS.Timeout }>();
  private clockTimer: NodeJS.Timeout | null = null;
  private autopilotTimer: NodeJS.Timeout | null = null;
  private hostTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  /** Per seat, the automated move that just failed: not tried again until the game changes. */
  private failedMoves = new Map<string, string>();
  /** When clients should be done staging the plays seen so far (see shared/cards/pacing.ts). */
  private sceneUntil = 0;
  /** The last CardsPlay.seq staged (null: nothing seen yet, so nothing to stage). */
  private seenPlay: number | null = null;
  private departed = new Set<string>();
  private kicked = new Set<string>();
  private readonly now: () => number;
  private readonly rng: (n: number) => number;

  constructor(readonly code: string, public hostId: string, private hooks: CardsRoomHooks, opts: CardsRoomOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? (n => randomInt(n));
    this.createdAt = this.now();
    this.lastActivity = this.now();
  }

  // ---- lobby ----------------------------------------------------------------

  seat(id: string): Seat | undefined {
    return this.seats.find(s => s.id === id);
  }

  hostName(): string {
    return this.seat(this.hostId)?.name ?? '—';
  }

  /** Take a seat (lobby) or reclaim one (any time). Throws when neither is possible. */
  join(m: CardsMember): Seat {
    this.dirty = true;
    this.lastActivity = this.now();
    const existing = this.seat(m.id);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.avatar = m.avatar;
      if (this.status === 'lobby') existing.name = this.uniqueName(m.name, m.id);
      this.schedule();
      this.watchHost();
      return existing;
    }
    if (this.status !== 'lobby') fail('This game has already started — you can watch');
    if (this.kicked.has(m.id)) fail('You were removed from this table — you can watch');
    if (this.seats.length >= this.maxPlayers) fail('The table is full — you can watch');
    const s: Seat = {
      id: m.id, name: this.uniqueName(m.name, m.id), avatar: m.avatar, isBot: false, connected: true, disconnectedAt: null,
      character: this.freeCharacter(), color: this.freeColor(),
    };
    this.seats.push(s);
    if (!this.seat(this.hostId)) this.hostId = m.id;
    this.hooks.onEvent(this, `${s.name} joined`);
    return s;
  }

  private freeCharacter(): CharacterId {
    return CHARACTERS.find(c => !this.seats.some(s => s.character === c)) ?? CHARACTERS[0];
  }

  private freeColor(): string {
    return CARDS_SEAT_COLORS.find(c => !this.seats.some(s => s.color === c)) ?? '#ffffff';
  }

  /** `name`, or "name 2"... when someone else at the table goes by it already. */
  private uniqueName(name: string, self: string): string {
    const taken = new Set(this.seats.filter(s => s.id !== self).map(s => s.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let k = 2; ; k++) if (!taken.has(`${name} ${k}`.toLowerCase())) return `${name} ${k}`;
  }

  /** Leave for good: the lobby frees the seat; in a match the player is out (their cards go back). */
  leave(id: string) {
    this.dirty = true;
    const s = this.seat(id);
    if (!s) return;
    if (this.status === 'lobby') {
      if (this.hostId === id) this.passHost(id, 'left');
      this.seats = this.seats.filter(x => x.id !== id);
      this.hooks.onEvent(this, `${s.name} left`);
      this.closeIfEmpty();
      return;
    }
    this.departed.add(id);
    if (this.hostId === id) this.passHost(id, 'left');
    if (this.status === 'playing' && this.game && this.game.phase !== 'over' && !this.game.player(id).left) {
      this.hooks.onEvent(this, `${s.name} left the match`);
      this.lastActivity = this.now();
      this.game.forfeit(id);
      this.afterChange();
    }
    this.setConnected(id, false);
  }

  private closeIfEmpty() {
    if (this.status === 'lobby' && !this.seats.some(s => !s.isBot)) this.hooks.onEmpty?.(this);
  }

  // ---- host -----------------------------------------------------------------

  requireHost(id: string, isAdmin = false) {
    if (id !== this.hostId && !isAdmin) fail('Only the host can do that');
  }

  requireLobby() {
    if (this.status !== 'lobby') fail('The game has already started');
  }

  transferHost(byId: string, target: string, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(byId, isAdmin);
    const s = this.seat(target) ?? fail('Not at this table');
    if (s.isBot) fail('A bot cannot be the host');
    if (target === this.hostId) fail(`${s.name} is already the host`);
    if (!s.connected || this.departed.has(target)) fail(`${s.name} is not at the table right now`);
    const by = byId === this.hostId ? this.hostName() : 'an operator';
    this.hostId = target;
    this.hooks.onEvent(this, `${s.name} is now the host (handed over by ${by})`);
    this.watchHost();
  }

  /** The longest-seated connected human still in the match. */
  private successor(except: string): Seat | undefined {
    const here = this.seats.filter(s => !s.isBot && s.connected && s.id !== except && !this.departed.has(s.id));
    const stillIn = (s: Seat) => !this.game || !this.game.players.find(p => p.id === s.id)?.left;
    return here.find(stillIn) ?? here[0];
  }

  private passHost(from: string, why: string): boolean {
    const next = this.successor(from);
    if (!next) {
      if (this.status === 'lobby') this.hostId = this.seats.find(x => !x.isBot && x.id !== from)?.id ?? '';
      return false;
    }
    const was = this.seat(from)?.name;
    this.dirty = true;
    this.hostId = next.id;
    this.hooks.onEvent(this, `${next.name} is now the host (${was ?? 'the host'} ${why})`);
    return true;
  }

  /** Hand the room on when its host has left, or been away for CARDS_HOST_GRACE_MS. */
  private watchHost() {
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
    const h = this.seat(this.hostId);
    let gone = !h || this.departed.has(this.hostId);
    if (h && !gone && h.disconnectedAt !== null) {
      const due = h.disconnectedAt + CARDS_HOST_GRACE_MS - this.now();
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

  setConnected(id: string, connected: boolean) {
    this.dirty = true;
    const s = this.seat(id);
    if (!s || s.isBot) return;
    s.connected = connected;
    s.disconnectedAt = connected ? null : this.now();
    this.lastActivity = this.now();
    this.schedule();
    this.watchHost();
  }

  configure(id: string, isAdmin: boolean, p: CardsConfigure) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    if (p.rules && typeof p.rules === 'object') {
      const next = normalizeCardsRules({ ...this.rules, ...p.rules });
      // Mixed stacking only means something with stacking on.
      if (!next.stacking) next.stackMixed = false;
      this.rules = next;
    }
    if (p.maxPlayers !== undefined) {
      const n = Math.round(Number(p.maxPlayers));
      if (!Number.isFinite(n)) fail('Bad player limit');
      this.maxPlayers = Math.min(CARDS_MAX_PLAYERS, Math.max(CARDS_MIN_PLAYERS, n));
      // Bots make room first; people are never removed by a setting.
      while (this.seats.length > this.maxPlayers) {
        const bot = [...this.seats].reverse().find(s => s.isBot);
        if (!bot) break;
        this.seats = this.seats.filter(s => s !== bot);
      }
      if (this.seats.length > this.maxPlayers) this.maxPlayers = this.seats.length;
    }
    if (typeof p.private === 'boolean') this.private = p.private;
  }

  pickCharacter(id: string, character: unknown) {
    this.dirty = true;
    this.requireLobby();
    if (!isCharacterId(character)) fail('Unknown character');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.character === character)) fail('That character is taken');
    s.character = character;
  }

  pickColor(id: string, color: unknown) {
    this.dirty = true;
    this.requireLobby();
    if (typeof color !== 'string' || !CARDS_SEAT_COLORS.includes(color)) fail('Unknown colour');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.color === color)) fail('That colour is taken');
    s.color = color;
  }

  addBot(id: string, isAdmin: boolean, level: unknown = 'normal') {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    if (this.seats.length >= this.maxPlayers) fail('The table is full');
    const lvl = BOT_LEVELS.includes(level as CardsBotLevel) ? level as CardsBotLevel : 'normal';
    const used = new Set(this.seats.map(s => s.name.toLowerCase()));
    const name = this.uniqueName(BOT_NAMES.find(n => !used.has(n.toLowerCase())) ?? 'Bot', '');
    this.seats.push({
      id: `bot-${this.code}-${randomInt(1e9)}`, name, avatar: '🤖', isBot: true, level: lvl, connected: true, disconnectedAt: null,
      character: this.freeCharacter(), color: this.freeColor(),
    });
  }

  setBotLevel(id: string, isAdmin: boolean, botId: string, level: unknown) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    const s = this.seat(botId);
    if (!s?.isBot) fail('No such bot');
    if (!BOT_LEVELS.includes(level as CardsBotLevel)) fail('Unknown difficulty');
    s.level = level as CardsBotLevel;
  }

  /** Host (or operator) removes someone: lobby seat freed, in a match they are out. */
  kick(byId: string, target: string, isAdmin: boolean) {
    this.requireHost(byId, isAdmin);
    if (target === byId) fail('Use leave instead');
    const s = this.seat(target) ?? fail('Not at this table');
    this.hooks.onEvent(this, `${s.name} was removed by ${this.seat(byId)?.name ?? 'an operator'}`);
    if (!s.isBot) this.kicked.add(target);
    this.remove(target);
  }

  wasKicked(id: string): boolean {
    return this.kicked.has(id);
  }

  /** Remove a player regardless of who asks (kicks, bans). */
  remove(target: string) {
    this.dirty = true;
    if (this.status === 'lobby') {
      if (this.hostId === target) this.passHost(target, 'was removed');
      this.seats = this.seats.filter(s => s.id !== target);
      this.closeIfEmpty();
      return;
    }
    if (this.seat(target)) this.departed.add(target);
    if (this.hostId === target) this.passHost(target, 'was removed');
    if (this.status === 'playing' && this.game && this.game.phase !== 'over' && !this.game.player(target).left) {
      this.game.forfeit(target);
      this.afterChange();
    }
    this.setConnected(target, false);
  }

  start(id: string, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.requireLobby();
    if (this.seats.length < CARDS_MIN_PLAYERS) fail('Need at least 2 players (add a bot?)');
    // Seats are dealt round the table in a random order.
    const order = [...this.seats];
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.game = new CardsGame({
      players: order.map(s => ({ id: s.id, name: s.name, isBot: s.isBot, ...(s.isBot && { level: s.level ?? 'normal' }) })),
      rules: this.rules,
      rng: this.rng,
      now: this.now,
      onLog: text => this.hooks.onEvent(this, text),
    });
    this.status = 'playing';
    this.startedAt = this.now();
    this.finishedAt = null;
    // Clients coming from the lobby stage the first deal: so do the timers.
    this.seenPlay = 0;
    this.sceneUntil = 0;
    this.hooks.onEvent(this, `Match started: ${this.seats.length} players, ${matchLabel(this.rules).toLowerCase()}`);
    this.afterChange();
  }

  /** Host sends a finished table back to the lobby: same settings, same bots, humans still here. */
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
    this.departed.clear();
    this.lastActivity = this.now();
    this.hooks.onEvent(this, `Rematch! Back to the lobby${gone.length ? ` (${gone.map(s => s.name).join(', ')} left)` : ''}`);
  }

  /** Operator stop, or nobody left at a running table: the match ends without a result. */
  end(reason: string) {
    this.dirty = true;
    this.clearTimers();
    this.hooks.onEvent(this, `Game ended: ${reason}`);
    this.status = 'finished';
    this.finishedAt = this.now();
  }

  // ---- play -----------------------------------------------------------------

  /** `auto`: the computer is moving for this seat (bot or autopilot), not the player. */
  act(id: string, a: CardsAction, auto = false) {
    if (!this.game || this.status === 'lobby') fail('The game has not started');
    if (this.status === 'finished') fail('The game is over');
    if (!this.seat(id) && !auto) fail('You are not at this table');
    if (!auto) this.lastActivity = this.now();
    this.game.apply(id, a, { auto });
    const s = this.seat(id);
    if (!auto && s?.autopilot) {
      s.autopilot = false;
      this.hooks.onEvent(this, `${s.name} is back — auto-play is off`);
    }
    this.afterChange();
  }

  /** "I'm back": off autopilot (host-set or after timing out), without having to make a move. */
  back(id: string) {
    const g = this.runningGame();
    const s = this.seat(id) ?? fail('You are not at this table');
    const p = g.players.find(q => q.id === id);
    if (!p || p.left) fail('You are out of this match');
    s.autopilot = false;
    s.connected = true;
    s.disconnectedAt = null;
    if (p.afk) {
      p.afk = false;
      this.hooks.onEvent(this, `${s.name} is back`);
    }
    this.lastActivity = this.now();
    this.afterChange();
  }

  pause(id: string, isAdmin: boolean, byName: string) {
    this.dirty = true;
    this.requireHost(id, isAdmin);
    this.runningGame().pause(byName);
    this.afterChange();
  }

  resume(id: string, isAdmin: boolean, byName: string) {
    this.requireHost(id, isAdmin);
    this.runningGame().resume(byName);
    this.afterChange();
  }

  /** Host (or operator) hands a connected but absent player to autopilot, or takes them off it. */
  setAutopilot(byId: string, target: string, on: boolean, isAdmin: boolean) {
    this.dirty = true;
    this.requireHost(byId, isAdmin);
    const g = this.runningGame();
    const s = this.seat(target) ?? fail('Not at this table');
    if (s.isBot) fail('Bots already play themselves');
    const p = g.players.find(q => q.id === target);
    if (!p || p.left) fail(`${s.name} is out of the match`);
    s.autopilot = on;
    if (!on) p.afk = false;
    this.afterChange();
  }

  private runningGame(): CardsGame {
    if (!this.game || this.status !== 'playing' || this.game.phase === 'over') fail('No game is running');
    return this.game;
  }

  private afterChange() {
    this.dirty = true;
    this.failedMoves.clear();
    if (this.game?.phase === 'over' && this.status === 'playing') {
      this.status = 'finished';
      this.finishedAt = this.now();
      this.clearTimers();
      this.hooks.onFinished(this);
    }
    this.schedule();
  }

  /** Is this seat played by the computer right now? */
  automated(s: Seat, now = this.now()): 'bot' | 'autopilot' | null {
    if (s.isBot) return 'bot';
    if (s.disconnectedAt !== null && now - s.disconnectedAt >= CARDS_AUTOPILOT_GRACE_MS) return 'autopilot';
    if (s.autopilot || this.game?.players.find(p => p.id === s.id)?.afk) return 'autopilot';
    return null;
  }

  /** Note how long clients will spend staging the latest play; the turn clock waits for it. */
  private noteScene(g: CardsGame) {
    const now = this.now();
    const seq = g.lastPlay?.seq ?? 0;
    if (this.seenPlay === null) this.seenPlay = seq;
    if (seq !== this.seenPlay) {
      this.seenPlay = seq;
      const ms = cardsPlayMs(g.lastPlay?.steps ?? []);
      // Plays queue on the client, one after another, never far behind.
      if (ms) this.sceneUntil = Math.min(Math.max(this.sceneUntil, now) + ms, now + CARDS_MAX_QUEUE_MS);
    }
    if (this.sceneUntil > now) g.holdTurnClock(this.sceneUntil);
  }

  /** Re-arm every timer after a change. */
  private schedule() {
    const g = this.game;
    if (!g || g.phase === 'over' || this.status !== 'playing') {
      this.clearTimers();
      return;
    }
    this.noteScene(g);
    const now = this.now();

    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    // While paused this is the pause time limit, which resumes the game.
    const due = g.clockDeadline();
    if (due !== null) {
      this.clockTimer = setTimeout(() => this.guarded('clock', () => {
        this.clockTimer = null;
        if (this.game?.clockTimeout()) {
          this.afterChange();
          this.hooks.onChange(this);
        } else {
          this.schedule();
        }
      }), Math.max(0, due - now) + 50);
    }

    if (this.autopilotTimer) clearTimeout(this.autopilotTimer);
    this.autopilotTimer = null;

    // Paused: nothing else moves, not even bots.
    if (g.paused) {
      this.clearSeatTimers();
      return;
    }

    // Every automated seat plans its own next move, reactions included.
    const want = new Map<string, { key: string; action: CardsAction }>();
    for (const s of this.seats) {
      const mode = this.automated(s, now);
      if (!mode) continue;
      const action = this.automatedAction(s.id, mode);
      if (!action) continue;
      const key = `${g.round}|${g.turn}|${g.phase}|${JSON.stringify(action)}`;
      if (this.failedMoves.get(s.id) === key) continue;
      want.set(s.id, { key, action });
    }
    for (const [id, t] of this.seatTimers) {
      if (want.get(id)?.key === t.key) continue;
      clearTimeout(t.timer);
      this.seatTimers.delete(id);
    }
    for (const [id, w] of want) {
      // The same move still pending keeps its timer: think time is not restarted by others' calls.
      if (this.seatTimers.has(id)) continue;
      let think: number;
      try { think = cardsBotThinkMs(g, id, w.action); } catch { think = 1_000; }
      const wait = Math.max(think, this.sceneUntil - now);
      const timer = setTimeout(() => this.guarded('bot', () => this.runSeat(id, w.key)), wait);
      this.seatTimers.set(id, { key: w.key, timer });
    }

    // Wake when a disconnected player's grace runs out, so autopilot takes over on time.
    const waits = this.seats
      .filter(s => !s.isBot && s.disconnectedAt !== null && !g.players.find(p => p.id === s.id)?.left)
      .map(s => s.disconnectedAt! + CARDS_AUTOPILOT_GRACE_MS - now)
      .filter(ms => ms > 0);
    if (waits.length) {
      this.autopilotTimer = setTimeout(() => this.guarded('autopilot', () => {
        this.autopilotTimer = null;
        this.schedule();
        this.hooks.onChange(this);
      }), Math.min(...waits) + 50);
    }
  }

  /** What an automated seat would do now (autopilot takes no risks). */
  private automatedAction(id: string, mode: 'bot' | 'autopilot'): CardsAction | null {
    const g = this.game;
    if (!g) return null;
    const p = g.players.find(q => q.id === id);
    if (!p || p.left) return null;
    try {
      let a = cardsBotAction(g, id);
      if (a && mode === 'autopilot') a = cardsAutopilotAction(g, id, a);
      return a;
    } catch (e) {
      console.error(`[cards ${this.code}] bot for ${id} failed:`, e);
      return null;
    }
  }

  /** An automated seat's timer fired: make its move (fresh, the table may have moved on). */
  private runSeat(id: string, key: string) {
    const t = this.seatTimers.get(id);
    if (t?.key === key) this.seatTimers.delete(id);
    const g = this.game;
    const s = this.seat(id);
    if (!g || this.status !== 'playing' || !s) return;
    const mode = this.automated(s);
    const action = mode ? this.automatedAction(id, mode) : null;
    if (!action) {
      this.schedule();
      return;
    }
    try {
      this.act(id, action, true);
    } catch (e) {
      if (!(e instanceof CardsError) && !(e instanceof CardsRoomError)) throw e;
      console.error(`[cards ${this.code}] automated ${action.type} failed:`, e.message);
      this.failedMoves.set(id, `${g.round}|${g.turn}|${g.phase}|${JSON.stringify(action)}`);
      this.fallback(id);
    }
    this.hooks.onChange(this);
  }

  /** An automated move failed: something harmless instead, or wait for the game to move on. */
  private fallback(id: string) {
    const g = this.game!;
    const p = g.players.find(q => q.id === id);
    const tries: CardsAction[] = [{ type: 'draw' }, { type: 'pass' }];
    if (p) tries.push({ type: 'chooseColor', color: bestColor(p.hand) });
    try { tries.push({ type: 'swap', target: g.defaultSwapTarget(id) }); } catch { /* not seated */ }
    for (const a of tries) {
      try {
        this.act(id, a, true);
        return;
      } catch (e) {
        if (!(e instanceof CardsError) && !(e instanceof CardsRoomError)) throw e;
      }
    }
    this.schedule();
  }

  /** Every timer body runs through here: a bug is logged, and the room re-arms a little later. */
  private guarded(what: string, fn: () => void, rearm = true) {
    try {
      fn();
    } catch (e) {
      console.error(`[cards ${this.code}] ${what} timer failed:`, e);
      if (!rearm) return;
      this.clearTimers();
      this.retryTimer = setTimeout(() => this.guarded('retry', () => {
        this.retryTimer = null;
        this.schedule();
        this.hooks.onChange(this);
      }), TIMER_RETRY_MS);
    }
  }

  private clearSeatTimers() {
    for (const t of this.seatTimers.values()) clearTimeout(t.timer);
    this.seatTimers.clear();
  }

  private clearTimers() {
    this.clearSeatTimers();
    for (const t of [this.clockTimer, this.autopilotTimer, this.retryTimer]) if (t) clearTimeout(t);
    this.clockTimer = this.autopilotTimer = this.retryTimer = null;
  }

  /** Timers armed right now, for tests and the admin view. */
  pendingTimers(): { seats: string[]; clock: boolean } {
    return { seats: [...this.seatTimers.keys()], clock: this.clockTimer !== null };
  }

  dispose() {
    this.clearTimers();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
  }

  hasConnectedHumans(): boolean {
    return this.seats.some(s => !s.isBot && s.connected);
  }

  /** What `forId` sees: their own hand only (spectators: none). */
  view(forId?: string): CardsRoomView {
    return {
      kind: 'cards',
      code: this.code,
      hostId: this.hostId,
      private: this.private,
      spectators: this.spectators,
      maxPlayers: this.maxPlayers,
      rules: { ...this.rules },
      status: this.status,
      seats: this.seats.map(({ disconnectedAt, ...s }) => ({ ...s, ...(disconnectedAt !== null && { awayAt: disconnectedAt }) })),
      game: this.game?.view(forId) ?? null,
      now: Date.now(),
      startedAt: this.startedAt,
    };
  }

  summary(): CardsRoomSummary {
    return {
      code: this.code, status: this.status, players: this.seats.length, maxPlayers: this.maxPlayers,
      hostName: this.hostName(), match: matchLabel(this.rules),
    };
  }

  // ---- persistence ----------------------------------------------------------

  snapshot(): CardsRoomSnapshot {
    return {
      code: this.code, hostId: this.hostId, createdAt: this.createdAt, startedAt: this.startedAt,
      rules: { ...this.rules }, maxPlayers: this.maxPlayers, private: this.private, status: this.status,
      seats: structuredClone(this.seats), game: this.game?.snapshot() ?? null,
      departed: [...this.departed], kicked: [...this.kicked],
    };
  }

  static restore(s: CardsRoomSnapshot, hooks: CardsRoomHooks, opts: CardsRoomOptions = {}): CardsRoom {
    const r = new CardsRoom(s.code, s.hostId, hooks, opts);
    r.createdAt = s.createdAt;
    r.startedAt = s.startedAt;
    r.rules = normalizeCardsRules(s.rules);
    r.maxPlayers = Math.min(CARDS_MAX_PLAYERS, Math.max(CARDS_MIN_PLAYERS, Math.round(Number(s.maxPlayers) || CARDS_DEFAULT_MAX_PLAYERS)));
    r.private = !!s.private;
    r.status = s.status;
    if (Array.isArray(s.departed)) r.departed = new Set(s.departed.filter(x => typeof x === 'string'));
    if (Array.isArray(s.kicked)) r.kicked = new Set(s.kicked.filter(x => typeof x === 'string'));
    const now = r.now();
    // Everyone starts disconnected: they reclaim their seats on reconnect, and
    // autopilot covers anyone who never comes back.
    r.seats = s.seats.map(x => ({
      ...x, character: migrateCharacter(x), connected: x.isBot, disconnectedAt: x.isBot ? null : now,
    }));
    if (s.game) {
      r.game = CardsGame.restore({ rng: r.rng, now: r.now, onLog: text => hooks.onEvent(r, text) }, s.game);
      // What was on screen before the restart has played already.
      r.seenPlay = r.game.lastPlay?.seq ?? 0;
    }
    if (r.status === 'finished') r.finishedAt = now;
    try {
      r.schedule();
      r.watchHost();
    } catch (e) {
      r.dispose();
      throw e;
    }
    return r;
  }
}

// Unambiguous characters only: codes get read out loud and typed on phones.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class CardsRegistry {
  rooms = new Map<string, CardsRoom>();
  private hooks: CardsRoomHooks;
  private created = new Map<string, number[]>();
  private dirty = true;
  private opts: CardsRoomOptions;

  constructor(hooks: CardsRoomHooks, sweepEveryMs = 60_000, opts: CardsRoomOptions = {}) {
    this.hooks = { ...hooks, onEmpty: r => { if (this.rooms.get(r.code) === r) this.delete(r.code); } };
    this.opts = opts;
    setInterval(() => this.sweep(), sweepEveryMs).unref();
  }

  /** `exempt`: operators open as many tables as they like. `taken`: codes in use elsewhere (Monopoly rooms). */
  create(hostId: string, exempt = false, taken: (code: string) => boolean = () => false): CardsRoom {
    if (this.rooms.size >= CARDS_MAX_ROOMS) throw new CardsRoomError('The server is at its table limit — try again later');
    if (!exempt) {
      const now = Date.now();
      const recent = (this.created.get(hostId) ?? []).filter(t => now - t < CREATE_WINDOW_MS);
      if (recent.length >= CARDS_CREATES_PER_WINDOW) throw new CardsRoomError('You have opened a lot of tables — try again in a few minutes');
      recent.push(now);
      this.created.set(hostId, recent);
    }
    let code: string;
    do code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    while (this.rooms.has(code) || taken(code));
    const room = new CardsRoom(code, hostId, this.hooks, this.opts);
    this.rooms.set(code, room);
    this.dirty = true;
    return room;
  }

  get(code: string): CardsRoom | undefined {
    return this.rooms.get(String(code).toUpperCase());
  }

  /** Public list: open tables with someone at them. */
  list(): CardsRoomSummary[] {
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

  roomsOf(playerId: string): CardsRoom[] {
    return [...this.rooms.values()].filter(r => r.seat(playerId));
  }

  snapshot(): CardsRoomSnapshot[] {
    return [...this.rooms.values()].filter(r => r.status !== 'finished').map(r => r.snapshot());
  }

  takeDirty(): boolean {
    let dirty = this.dirty;
    this.dirty = false;
    for (const r of this.rooms.values()) {
      if (r.dirty) dirty = true;
      r.dirty = false;
    }
    return dirty;
  }

  markDirty() {
    this.dirty = true;
  }

  restore(snaps: CardsRoomSnapshot[]): number {
    let n = 0;
    for (const s of snaps) {
      try {
        this.rooms.set(s.code, CardsRoom.restore(s, this.hooks, this.opts));
        n++;
      } catch (e) {
        console.error(`Could not restore card table ${s?.code}:`, e);
      }
    }
    return n;
  }

  /** The idle sweep (also callable from tests). */
  sweep(now = Date.now()) {
    for (const [id, times] of this.created) {
      if (times.every(t => now - t >= CREATE_WINDOW_MS)) this.created.delete(id);
    }
    for (const [code, r] of this.rooms) {
      try {
        const away = !r.hasConnectedHumans() && now - r.lastActivity > CARDS_IDLE_ROOM_MS;
        // Bots would play an abandoned match forever: end it.
        if (away && r.status === 'playing') {
          r.end('nobody has been at the table for 30 minutes');
          this.hooks.onChange(r);
        }
        const idle = away && r.spectators === 0;
        const since = now - (r.finishedAt ?? now);
        const occupied = r.hasConnectedHumans() || r.spectators > 0;
        const done = r.status === 'finished' && since > FINISHED_ROOM_MS && (!occupied || since > FINISHED_ROOM_MAX_MS);
        if (idle || done) this.delete(code);
      } catch (e) {
        console.error(`[cards ${code}] sweep failed:`, e);
      }
    }
  }
}
