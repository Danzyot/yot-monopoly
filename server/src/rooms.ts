// Rooms: many independent games at once. Each room has a short join code, a
// lobby where the host picks the edition and house rules, and — once started —
// one Game. Rooms own everything time-based: auction deadlines, bot pacing,
// and autopilot for players who drop mid-game.

import { randomInt } from 'node:crypto';
import { Game, EngineError } from './engine/game.ts';
import { botAction } from './engine/bot.ts';
import { DEFAULT_RULES, getTheme, type RuleConfig } from '../../shared/themes.ts';
import {
  PLAYER_COLORS, TOKENS, type Action, type RoomSeat, type RoomSummary, type RoomView, type TokenId,
} from '../../shared/types.ts';

const BOT_DELAY_MS = 900;
/** A disconnected player's turn is auto-played after this long. */
const AUTOPILOT_GRACE_MS = 45_000;
/** Empty rooms (no connected humans) are removed after this long. */
const IDLE_ROOM_MS = 30 * 60_000;
const BOT_NAMES = ['Rich Uncle', 'Tycoon', 'Landlord', 'Baron', 'Mogul', 'Magnate', 'Banker'];

type Listener = (room: Room) => void;

interface Seat extends RoomSeat {
  disconnectedAt: number | null;
}

export class RoomError extends Error {}

function fail(msg: string): never {
  throw new RoomError(msg);
}

export class Room {
  seats: Seat[] = [];
  status: RoomView['status'] = 'lobby';
  game: Game | null = null;
  themeId = 'classic';
  rules: RuleConfig = { ...DEFAULT_RULES };
  lastActivity = Date.now();
  private botTimer: NodeJS.Timeout | null = null;
  private auctionTimer: NodeJS.Timeout | null = null;
  private autopilotTimer: NodeJS.Timeout | null = null;

  constructor(readonly code: string, public hostId: string, private onChange: Listener) {}

  // ---- lobby ----------------------------------------------------------------

  seat(id: string): Seat | undefined {
    return this.seats.find(s => s.id === id);
  }

  join(id: string, name: string): Seat {
    this.lastActivity = Date.now();
    const existing = this.seat(id);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      if (this.status === 'lobby') existing.name = name;
      return existing;
    }
    if (this.status !== 'lobby') fail('This game has already started — you can watch');
    if (this.seats.length >= this.rules.maxPlayers) fail('The room is full');
    const s: Seat = {
      id, name, isBot: false, connected: true, disconnectedAt: null,
      token: this.freeToken(), color: this.freeColor(),
    };
    this.seats.push(s);
    return s;
  }

  private freeToken(): TokenId {
    return TOKENS.find(t => !this.seats.some(s => s.token === t)) ?? 'car';
  }

  private freeColor(): string {
    return PLAYER_COLORS.find(c => !this.seats.some(s => s.color === c)) ?? '#ffffff';
  }

  leave(id: string) {
    const s = this.seat(id);
    if (!s) return;
    if (this.status === 'lobby') {
      this.seats = this.seats.filter(x => x.id !== id);
      if (this.hostId === id) this.hostId = this.seats.find(x => !x.isBot)?.id ?? '';
    } else if (this.game && !this.game.player(id).bankrupt && this.game.phase !== 'over') {
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

  requireHost(id: string) {
    if (id !== this.hostId) fail('Only the host can do that');
  }

  requireLobby() {
    if (this.status !== 'lobby') fail('The game has already started');
  }

  configure(id: string, themeId?: string, rules?: Partial<RuleConfig>) {
    this.requireHost(id);
    this.requireLobby();
    if (themeId) {
      this.themeId = getTheme(themeId).id;
      // An edition brings its own default house rules.
      this.rules = { ...DEFAULT_RULES, ...getTheme(this.themeId).rules };
    }
    if (rules) this.rules = sanitizeRules({ ...this.rules, ...rules });
    while (this.seats.length > this.rules.maxPlayers) {
      const bot = [...this.seats].reverse().find(s => s.isBot);
      if (!bot) break;
      this.seats = this.seats.filter(s => s !== bot);
    }
  }

  pickToken(id: string, token: TokenId) {
    this.requireLobby();
    if (!TOKENS.includes(token)) fail('Unknown token');
    const s = this.seat(id) ?? fail('You are not seated');
    if (this.seats.some(o => o !== s && o.token === token)) fail('That token is taken');
    s.token = token;
  }

  addBot(id: string) {
    this.requireHost(id);
    this.requireLobby();
    if (this.seats.length >= this.rules.maxPlayers) fail('The room is full');
    const used = new Set(this.seats.map(s => s.name));
    const name = BOT_NAMES.find(n => !used.has(n)) ?? `Bot ${this.seats.length + 1}`;
    this.seats.push({
      id: `bot-${this.code}-${randomInt(1e9)}`, name, isBot: true, connected: true, disconnectedAt: null,
      token: this.freeToken(), color: this.freeColor(),
    });
  }

  kick(id: string, target: string) {
    this.requireHost(id);
    if (target === id) fail('Use leave instead');
    if (this.status === 'lobby') this.seats = this.seats.filter(s => s.id !== target);
    else if (this.game && !this.game.player(target).bankrupt) this.act(target, { type: 'bankrupt' });
  }

  start(id: string) {
    this.requireHost(id);
    this.requireLobby();
    if (this.seats.length < 2) fail('Need at least 2 players (add a bot?)');
    // Shuffle turn order.
    const order = [...this.seats];
    for (let i = order.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.game = new Game({
      theme: getTheme(this.themeId),
      rules: this.rules,
      players: order.map(s => ({ id: s.id, name: s.name, token: s.token, color: s.color, isBot: s.isBot })),
      rng: n => randomInt(n),
    });
    this.status = 'playing';
    this.schedule();
  }

  // ---- play -----------------------------------------------------------------

  act(id: string, a: Action) {
    if (!this.game) fail('The game has not started');
    this.lastActivity = Date.now();
    this.game.apply(id, a);
    if (this.game.phase === 'over') this.status = 'finished';
    this.schedule();
  }

  /** Is this seat played by the computer right now? */
  private automated(s: Seat, now: number): boolean {
    return s.isBot || (s.disconnectedAt !== null && now - s.disconnectedAt >= AUTOPILOT_GRACE_MS);
  }

  /** Re-arm timers after any change. */
  private schedule() {
    const g = this.game;
    this.clearTimers();
    if (!g || g.phase === 'over') return;

    if (g.auction) {
      const wait = Math.max(0, g.auction.endsAt - Date.now()) + 50;
      this.auctionTimer = setTimeout(() => {
        if (this.game?.auctionTimeout()) {
          if (this.game.phase === 'over') this.status = 'finished';
          this.onChange(this);
        }
        this.schedule();
      }, wait);
    }

    const now = Date.now();
    const next = this.nextAutomatedAction(now);
    if (next) {
      this.botTimer = setTimeout(() => {
        const again = this.nextAutomatedAction(Date.now());
        if (!again) return;
        try {
          this.act(again.id, again.action);
        } catch (e) {
          // A bot choosing an illegal move is a bug, but it must never wedge the
          // room: log it and fall back to ending the turn / leaving the auction.
          console.error(`[room ${this.code}] automated ${again.action.type} failed:`, (e as Error).message);
          this.fallback(again.id);
        }
        this.onChange(this);
      }, BOT_DELAY_MS);
      return;
    }

    // Nobody automated has anything to do yet; wake up when a disconnected
    // player's grace period runs out.
    const pending = this.seats
      .filter(s => !s.isBot && s.disconnectedAt !== null && !g.player(s.id).bankrupt)
      .map(s => s.disconnectedAt! + AUTOPILOT_GRACE_MS - now)
      .filter(ms => ms > 0);
    if (pending.length) {
      this.autopilotTimer = setTimeout(() => { this.schedule(); this.onChange(this); }, Math.min(...pending) + 50);
    }
  }

  private nextAutomatedAction(now: number): { id: string; action: Action } | null {
    const g = this.game;
    if (!g || g.phase === 'over') return null;
    // Current player first so turns flow; then anyone else (debts, auctions, trades).
    const order = [g.current.id, ...g.players.map(p => p.id).filter(id => id !== g.current.id)];
    for (const id of order) {
      const s = this.seat(id);
      if (!s || !this.automated(s, now)) continue;
      const action = botAction(g, id);
      if (action) return { id, action };
    }
    return null;
  }

  private fallback(id: string) {
    for (const a of [{ type: 'pass' }, { type: 'endTurn' }, { type: 'bankrupt' }] as Action[]) {
      try { this.act(id, a); return; } catch (e) { if (!(e instanceof EngineError)) throw e; }
    }
  }

  private clearTimers() {
    for (const t of [this.botTimer, this.auctionTimer, this.autopilotTimer]) if (t) clearTimeout(t);
    this.botTimer = this.auctionTimer = this.autopilotTimer = null;
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
      rules: this.rules,
      status: this.status,
      seats: this.seats.map(({ disconnectedAt: _d, ...s }) => s),
      game: this.game?.view() ?? null,
      now: Date.now(),
    };
  }

  summary(): RoomSummary {
    return {
      code: this.code,
      themeId: this.themeId,
      status: this.status,
      players: this.seats.length,
      maxPlayers: this.rules.maxPlayers,
      hostName: this.seat(this.hostId)?.name ?? '—',
    };
  }
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

export function sanitizeRules(r: Partial<RuleConfig>): RuleConfig {
  const d = DEFAULT_RULES;
  return {
    startingCash: clampInt(r.startingCash, 100, 100_000, d.startingCash),
    goSalary: clampInt(r.goSalary, 0, 10_000, d.goSalary),
    doubleOnGo: !!r.doubleOnGo,
    freeParkingPot: !!r.freeParkingPot,
    auctions: r.auctions === undefined ? d.auctions : !!r.auctions,
    evenBuild: r.evenBuild === undefined ? d.evenBuild : !!r.evenBuild,
    limitedBuildings: r.limitedBuildings === undefined ? d.limitedBuildings : !!r.limitedBuildings,
    jailFine: clampInt(r.jailFine, 0, 10_000, d.jailFine),
    maxPlayers: clampInt(r.maxPlayers, 2, 8, d.maxPlayers),
  };
}

// Unambiguous characters only — codes get read out loud and typed on phones.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Registry {
  rooms = new Map<string, Room>();

  constructor(private onChange: Listener) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  create(hostId: string): Room {
    let code: string;
    do code = Array.from({ length: 5 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
    while (this.rooms.has(code));
    const room = new Room(code, hostId, this.onChange);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter(r => r.hasConnectedHumans())
      .map(r => r.summary())
      .sort((a, b) => Number(a.status !== 'lobby') - Number(b.status !== 'lobby'));
  }

  private sweep() {
    const now = Date.now();
    for (const [code, r] of this.rooms) {
      if (!r.hasConnectedHumans() && now - r.lastActivity > IDLE_ROOM_MS) {
        r.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
