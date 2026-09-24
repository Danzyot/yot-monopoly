// Socket.IO wiring. Identity comes from the signed session token (Discord or
// demo sign-in); anyone may connect to browse and watch, but taking a seat,
// creating rooms and chatting need an account. Bans are enforced at every door:
// connecting, joining a room, and again whenever an operator adds one.

import type { Server, Socket } from 'socket.io';
import { verifyToken } from './auth.ts';
import { banMatches, banMessage, findBan, type Ban } from './bans.ts';
import { checkChat } from './chat.ts';
import { recordConnection } from './connections.ts';
import { announceChannelId, postToChannel } from './discord.ts';
import { EngineError } from './engine/game.ts';
import { logGameEvent } from './eventlog.ts';
import { isOn } from './features.ts';
import { isLibraryFile } from './graphics.ts';
import { clientIp } from './ip.ts';
import { Registry, Room, RoomError, type Member } from './rooms.ts';
import { recordResult } from './stats.ts';
import { resolveRequirements } from './requirements.ts';
import { takeSeat } from './seating.ts';
import { getMap } from '../../shared/maps.ts';
import { getTheme } from '../../shared/themes.ts';
import { DEFAULT_TABLE_STYLE, libraryFileOf, sanitizeTableStyle } from '../../shared/tableStyles.ts';
import type { Action, CharacterId, PlayerProfile, RequirementFailure } from '../../shared/types.ts';
import type { RuleConfig } from '../../shared/themes.ts';

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

interface SocketData {
  profile: PlayerProfile | null;
  ip: string | null;
  room: string | null;
  /** Token bucket for action flood control. */
  tokens: number;
  refilledAt: number;
}

const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP ?? 24);
const ACTIONS_PER_SEC = 12;
const ACTION_BURST = 30;
/** A player's Discord requirement check is repeated at most this often. */
const GATE_CHECK_GAP_MS = 2_500;

export interface SocketLayer {
  registry: Registry;
  /** Apply a new ban right now: disconnect and unseat whoever it matches. */
  enforceBan(ban: Ban): number;
  /** Broadcast a room's state (after an admin HTTP action). */
  broadcast(room: Room): void;
  connectedCount(): number;
  /** Everyone currently connected, for the admin view. */
  online(): { id: string; name: string; ip: string | null; room: string | null }[];
}

export function attachSockets(io: Server): SocketLayer {
  const broadcast = (room: Room) => io.to(`room:${room.code}`).emit('room:state', room.view());
  const lobbyChanged = () => io.to('lobby').emit('rooms', registry.list());

  const registry: Registry = new Registry({
    onChange: room => { broadcast(room); },
    onEvent: (room, text) => logGameEvent(room.code, `${getMap(room.mapId).name} · ${room.hostName()}`, text),
    onFinished: room => finished(room),
  });

  function finished(room: Room) {
    const g = room.game;
    if (!g) return;
    const standings = g.standings();
    recordResult({
      code: room.code, mapId: room.mapId, themeId: room.themeId,
      startedAt: room.startedAt ?? Date.now(), endedAt: Date.now(), turns: g.turnNumber,
      places: standings.map(s => {
        const p = g.player(s.id);
        // Character and avatar feed public profiles (older records lack them).
        const avatar = p.isBot ? undefined : room.seat(p.id)?.avatar;
        return { id: p.id, name: p.name, isBot: p.isBot, netWorth: s.netWorth, character: p.character, ...(avatar ? { avatar } : {}) };
      }),
    });
    lobbyChanged();
    const channel = announceChannelId();
    if (channel && isOn('announceResults')) {
      const medals = ['🥇', '🥈', '🥉'];
      const lines = standings.slice(0, 5).map((s, i) => `${medals[i] ?? `**${i + 1}.**`} ${g.player(s.id).name}`);
      void postToChannel(channel, {
        title: `🏆 ${g.player(standings[0].id).name} wins!`,
        description: `${lines.join('\n')}\n\n${getMap(room.mapId).name} · ${getTheme(room.themeId).name} · ${g.turnNumber} turns`,
      });
    }
  }

  const perIp = new Map<string, number>();
  /** Last requirement refusal per player (see room:join). */
  const recentRefusals = new Map<string, { code: string; at: number; blocked: RequirementFailure }>();

  io.use((socket, next) => {
    const data = socket.data as SocketData;
    data.ip = clientIp(socket.handshake.headers['x-forwarded-for'], socket.handshake.address || null, socket.handshake.headers);
    data.profile = verifyToken(socket.handshake.auth?.token);
    data.room = null;
    data.tokens = ACTION_BURST;
    data.refilledAt = Date.now();
    const ban = findBan({ id: data.profile?.id, discordId: data.profile?.discord?.id, ip: data.ip });
    if (ban) return next(new Error(`banned:${banMessage(ban)}`));
    if (data.ip) {
      const n = perIp.get(data.ip) ?? 0;
      if (n >= MAX_SOCKETS_PER_IP) return next(new Error('Too many connections from your network'));
      perIp.set(data.ip, n + 1);
    }
    next();
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    if (data.profile) recordConnection(data.profile, data.ip);
    socket.emit('hello', { profile: data.profile });

    const member = (): Member => {
      const p = data.profile;
      if (!p) throw new RoomError('Sign in first');
      return { id: p.id, name: p.name, avatar: p.avatar };
    };
    const isAdmin = () => !!data.profile?.isAdmin;
    const me = () => data.profile?.id ?? '';

    /** Every handler goes through here: errors become acks, never crashes. */
    const on = <T>(event: string, fn: (payload: T, room: Room | null) => Record<string, unknown> | void, limited = true) => {
      socket.on(event, (payload: T, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => {};
        if (limited && !take(data)) return reply({ ok: false, error: 'Slow down' });
        try {
          const room = data.room ? registry.get(data.room) ?? null : null;
          const extra = fn((payload ?? {}) as T, room) ?? {};
          reply({ ok: true, ...extra });
        } catch (e) {
          if (e instanceof EngineError || e instanceof RoomError) reply({ ok: false, error: e.message });
          else {
            console.error(`[socket] ${event} failed`, e);
            reply({ ok: false, error: 'Server error' });
          }
        }
      });
    };

    /**
     * `on` for handlers that must wait on something (Discord lookups). Same
     * contract: errors become acks, never crashes.
     */
    const onAsync = <T>(event: string, fn: (payload: T, room: Room | null) => Promise<Record<string, unknown> | void>) => {
      socket.on(event, async (payload: T, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => {};
        if (!take(data)) return reply({ ok: false, error: 'Slow down' });
        try {
          const room = data.room ? registry.get(data.room) ?? null : null;
          const extra = (await fn((payload ?? {}) as T, room)) ?? {};
          reply({ ok: true, ...extra });
        } catch (e) {
          if (e instanceof EngineError || e instanceof RoomError) reply({ ok: false, error: e.message });
          else {
            console.error(`[socket] ${event} failed`, e);
            reply({ ok: false, error: 'Server error' });
          }
        }
      });
    };

    const inRoom = (room: Room | null): Room => room ?? (() => { throw new RoomError('Join a room first'); })();

    const enter = (room: Room, seated: boolean) => {
      if (data.room && data.room !== room.code) leaveCurrent(false);
      if (data.room !== room.code && !seated) room.spectators++;
      data.room = room.code;
      socket.join(`room:${room.code}`);
      if (seated) room.setConnected(me(), true);
      broadcast(room);
      lobbyChanged();
    };

    const leaveCurrent = (forfeit: boolean) => {
      const room = data.room ? registry.get(data.room) : undefined;
      data.room = null;
      if (!room) return;
      socket.leave(`room:${room.code}`);
      const seated = !!room.seat(me());
      if (!seated) room.spectators = Math.max(0, room.spectators - 1);
      else if (forfeit) room.leave(me());
      else if (!otherSocketInRoom(room.code, me(), socket.id)) room.setConnected(me(), false);
      broadcast(room);
      lobbyChanged();
    };

    const otherSocketInRoom = (code: string, id: string, except: string) => {
      for (const s of io.sockets.sockets.values()) {
        const d = s.data as SocketData;
        if (s.id !== except && d.room === code && d.profile?.id === id) return true;
      }
      return false;
    };

    on<{ subscribe?: boolean }>('rooms:list', p => {
      if (p.subscribe) socket.join('lobby');
      return { rooms: registry.list() };
    });

    on('room:create', () => {
      const m = member();
      if (!isOn('publicRooms') && !isAdmin()) throw new RoomError('Only operators can create rooms right now');
      if (registry.roomsOf(m.id).filter(r => r.hostId === m.id && r.status === 'lobby').length >= 3) {
        throw new RoomError('You already have 3 open lobbies — start or leave one first');
      }
      const room = registry.create(m.id);
      room.join(m);
      enter(room, true);
      return { code: room.code };
    });

    // `watch` lets someone (typically an operator opening a room from the
    // dashboard) look in without taking a free lobby seat.
    // Async because a Discord-gated room asks Discord before seating anyone
    // new (seating.ts). Someone refused a seat watches instead and gets
    // `blocked` back, which the client shows as the requirements modal.
    onAsync<{ code: string; watch?: boolean }>('room:join', async p => {
      const room = registry.get(String(p.code ?? '').slice(0, 8)) ?? (() => { throw new RoomError('No room with that code'); })();
      const prof = data.profile;
      const ban = findBan({ id: prof?.id, discordId: prof?.discord?.id, ip: data.ip }, room.code);
      if (ban) throw new RoomError(banMessage(ban));
      // "Check again" and reconnects ask Discord; a refusal from moments ago is
      // reused rather than asking again, so nobody can hammer the Discord API.
      const recent = prof ? recentRefusals.get(prof.id) : undefined;
      if (prof && recent && recent.code === room.code && Date.now() - recent.at < GATE_CHECK_GAP_MS
        && room.requirements && !room.seat(prof.id) && p.watch !== true) {
        enter(room, false);
        return { spectating: true, blocked: recent.blocked };
      }
      const watchingHere = data.room === room.code && !!prof && !room.seat(prof.id);
      const { seated, blocked } = await takeSeat(room, prof, p.watch === true);
      if (prof && blocked) {
        if (recentRefusals.size > 5_000) recentRefusals.clear();
        recentRefusals.set(prof.id, { code: room.code, at: Date.now(), blocked });
      }
      // The room can close while Discord is being asked.
      if (registry.get(room.code) !== room) throw new RoomError('That room has closed');
      // A spectator who has now sat down stops counting as one.
      if (seated && watchingHere) room.spectators = Math.max(0, room.spectators - 1);
      enter(room, seated);
      return { spectating: !seated, blocked };
    });

    on<{ id: string }>('room:host', (p, room) => {
      const r = inRoom(room);
      r.transferHost(me(), String(p.id), isAdmin());
      broadcast(r);
      lobbyChanged();
    });

    onAsync<{ member?: boolean; roleId?: string | null }>('room:requirements', async (p, room) => {
      const r = inRoom(room);
      // Check rights before asking Discord anything.
      r.requireHost(me(), isAdmin());
      r.requireLobby();
      let req;
      try {
        req = await resolveRequirements(p);
      } catch (e) {
        throw new RoomError(e instanceof Error ? e.message : 'Could not set that requirement');
      }
      r.setRequirements(me(), isAdmin(), req);
      broadcast(r);
      lobbyChanged();
    });

    on('room:leave', () => { leaveCurrent(true); });

    on<{ themeId?: string; mapId?: string; rules?: Partial<RuleConfig>; private?: boolean }>('room:configure', (p, room) => {
      const r = inRoom(room);
      r.configure(me(), isAdmin(), {
        themeId: typeof p.themeId === 'string' ? p.themeId : undefined,
        mapId: typeof p.mapId === 'string' ? p.mapId : undefined,
        rules: p.rules && typeof p.rules === 'object' ? p.rules : undefined,
        private: typeof p.private === 'boolean' ? p.private : undefined,
      });
      broadcast(r);
      lobbyChanged();
    });

    // A patch: only the fields sent change, so two quick picks in a row (a
    // swatch, then a logo) cannot undo each other.
    on<unknown>('room:style', (p, room) => {
      const r = inRoom(room);
      const patch = Object.fromEntries(Object.entries(p && typeof p === 'object' ? p : {})
        .filter(([k]) => k in DEFAULT_TABLE_STYLE));
      const style = sanitizeTableStyle({ ...r.style, ...patch });
      // Library images must still exist; a stale pick would 404 for everyone.
      for (const url of [style.boardLogoUrl, style.backgroundUrl]) {
        const file = libraryFileOf(url);
        if (file && !isLibraryFile(file)) throw new RoomError('That image is no longer in the library');
      }
      r.setStyle(me(), isAdmin(), style);
      broadcast(r);
    });

    on<{ character?: CharacterId; color?: string }>('room:seat', (p, room) => {
      const r = inRoom(room);
      if (p.character) r.pickCharacter(me(), p.character);
      if (p.color) r.pickColor(me(), String(p.color));
      broadcast(r);
    });

    on('room:addBot', (_p, room) => {
      if (!isOn('bots') && !isAdmin()) throw new RoomError('Bots are switched off');
      const r = inRoom(room);
      r.addBot(me(), isAdmin());
      broadcast(r);
      lobbyChanged();
    });

    on<{ id: string }>('room:kick', (p, room) => {
      const r = inRoom(room);
      r.kick(me(), String(p.id), isAdmin());
      broadcast(r);
      lobbyChanged();
    });

    // Host (or operator) game controls: freeze every clock, or let autopilot
    // play for someone who is connected but not at the screen.
    on<{ paused?: boolean }>('room:pause', (p, room) => {
      const r = inRoom(room);
      const name = data.profile?.name ?? 'the host';
      if (p.paused === false) r.resume(me(), isAdmin(), name);
      else r.pause(me(), isAdmin(), name);
      broadcast(r);
    });

    on<{ id: string; on: boolean }>('room:autopilot', (p, room) => {
      const r = inRoom(room);
      r.setAutopilot(me(), String(p.id), p.on === true, isAdmin());
      broadcast(r);
    });

    on('room:start', (_p, room) => {
      const r = inRoom(room);
      r.start(me(), isAdmin());
      logGameEvent(r.code, getMap(r.mapId).name, `Game started: ${getMap(r.mapId).name} / ${getTheme(r.themeId).name}, ${r.seats.length} players`);
      broadcast(r);
      lobbyChanged();
    });

    on<Action>('game:action', (a, room) => {
      const r = inRoom(room);
      if (!data.profile) throw new RoomError('Sign in first');
      if (!a || typeof a !== 'object' || typeof (a as { type?: unknown }).type !== 'string') throw new RoomError('Bad action');
      r.act(me(), a);
      broadcast(r);
    });

    on<{ text: string }>('chat', (p, room) => {
      const r = inRoom(room);
      if (!isOn('chat')) throw new RoomError('Chat is switched off');
      const prof = data.profile ?? (() => { throw new RoomError('Sign in to chat'); })();
      const text = checkChat(prof.id, p.text);
      const seat = r.seat(prof.id);
      const msg = {
        t: Date.now(), id: prof.id, name: prof.name, color: seat?.color ?? '#aaa', text,
        spectator: !seat, admin: !!prof.isAdmin,
      };
      io.to(`room:${r.code}`).emit('chat', msg);
      logGameEvent(r.code, getMap(r.mapId).name, `💬 ${prof.name}: ${text}`);
    });

    socket.on('disconnect', () => {
      leaveCurrent(false);
      if (data.ip) {
        const n = (perIp.get(data.ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(data.ip);
        else perIp.set(data.ip, n);
      }
    });
  });

  return {
    registry,
    broadcast,
    enforceBan(ban: Ban): number {
      let hit = 0;
      for (const s of io.sockets.sockets.values()) {
        const d = s.data as SocketData;
        if (!banMatches(ban, { id: d.profile?.id, discordId: d.profile?.discord?.id, ip: d.ip })) continue;
        hit++;
        const id = d.profile?.id;
        const rooms = ban.scope === 'room' ? [registry.get(ban.gameId ?? '')].filter(Boolean) as Room[] : id ? registry.roomsOf(id) : [];
        for (const r of rooms) {
          if (id && r.seat(id)) {
            try { r.remove(id); } catch { /* already out */ }
            broadcast(r);
          }
        }
        s.emit('banned', { message: banMessage(ban) });
        if (ban.scope === 'lifetime') s.disconnect(true);
        else if (d.room === ban.gameId) { s.leave(`room:${d.room}`); d.room = null; }
      }
      lobbyChanged();
      return hit;
    },
    connectedCount: () => io.engine.clientsCount,
    online: () => [...io.sockets.sockets.values()].map(s => {
      const d = s.data as SocketData;
      return { id: d.profile?.id ?? '(guest)', name: d.profile?.name ?? '(not signed in)', ip: d.ip, room: d.room };
    }),
  };
}

function take(d: SocketData): boolean {
  const now = Date.now();
  d.tokens = Math.min(ACTION_BURST, d.tokens + ((now - d.refilledAt) / 1000) * ACTIONS_PER_SEC);
  d.refilledAt = now;
  if (d.tokens < 1) return false;
  d.tokens -= 1;
  return true;
}
