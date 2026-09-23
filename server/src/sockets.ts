// Socket.IO wiring. A player is identified by a random secret their browser
// keeps in localStorage; the public id is its hash, so ids can be broadcast
// without letting anyone impersonate anyone else. Reconnecting with the same
// secret resumes the same seat in every room.

import { createHash } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { EngineError } from './engine/game.ts';
import { Registry, Room, RoomError } from './rooms.ts';
import type { Action, TokenId } from '../../shared/types.ts';
import type { RuleConfig } from '../../shared/themes.ts';

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

interface SocketData {
  playerId: string;
  name: string;
  room: string | null;
}

export function playerIdFor(secret: string): string {
  return createHash('sha256').update(`yot:${secret}`).digest('hex').slice(0, 16);
}

function cleanName(v: unknown): string {
  const s = String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 20);
  return s || 'Player';
}

export function attachSockets(io: Server) {
  const broadcast = (room: Room) => io.to(`room:${room.code}`).emit('room:state', room.view());
  const registry = new Registry(broadcast);
  const lobbyChanged = () => io.to('lobby').emit('rooms', registry.list());

  io.use((socket, next) => {
    const secret = String(socket.handshake.auth?.key ?? '');
    if (secret.length < 16 || secret.length > 128) return next(new Error('bad key'));
    const data = socket.data as SocketData;
    data.playerId = playerIdFor(secret);
    data.name = cleanName(socket.handshake.auth?.name);
    data.room = null;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    socket.emit('hello', { playerId: data.playerId });

    // Wrap a handler so every failure becomes a tidy ack instead of a crash.
    const on = <T>(event: string, fn: (payload: T, room: Room | null) => Record<string, unknown> | void) => {
      socket.on(event, (payload: T, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => {};
        try {
          const room = data.room ? registry.get(data.room) ?? null : null;
          const extra = fn(payload ?? ({} as T), room) ?? {};
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

    const enter = (room: Room, spectate: boolean) => {
      if (data.room && data.room !== room.code) leaveCurrent(false);
      data.room = room.code;
      socket.join(`room:${room.code}`);
      if (!spectate) room.setConnected(data.playerId, true);
      broadcast(room);
      lobbyChanged();
    };

    const leaveCurrent = (forfeit: boolean) => {
      const room = data.room ? registry.get(data.room) : undefined;
      if (!room) return;
      socket.leave(`room:${room.code}`);
      data.room = null;
      if (forfeit) room.leave(data.playerId);
      else room.setConnected(data.playerId, false);
      broadcast(room);
      lobbyChanged();
    };

    on<{ subscribe?: boolean }>('rooms:list', p => {
      if (p.subscribe) socket.join('lobby');
      return { rooms: registry.list() };
    });

    on<{ name?: string }>('room:create', p => {
      data.name = cleanName(p.name ?? data.name);
      const room = registry.create(data.playerId);
      room.join(data.playerId, data.name);
      enter(room, false);
      return { code: room.code };
    });

    on<{ code: string; name?: string }>('room:join', p => {
      const room = registry.get(String(p.code ?? '')) ?? (() => { throw new RoomError('No room with that code'); })();
      data.name = cleanName(p.name ?? data.name);
      let spectating = false;
      try {
        room.join(data.playerId, data.name);
      } catch (e) {
        if (!(e instanceof RoomError)) throw e;
        spectating = true; // started or full: watch instead
      }
      enter(room, spectating);
      return { spectating };
    });

    on('room:leave', () => { leaveCurrent(true); });

    on<{ themeId?: string; rules?: Partial<RuleConfig> }>('room:configure', (p, room) => {
      inRoom(room).configure(data.playerId, p.themeId, p.rules);
      broadcast(room!);
      lobbyChanged();
    });

    on<{ token: TokenId }>('room:token', (p, room) => {
      inRoom(room).pickToken(data.playerId, p.token);
      broadcast(room!);
    });

    on('room:addBot', (_p, room) => {
      inRoom(room).addBot(data.playerId);
      broadcast(room!);
      lobbyChanged();
    });

    on<{ id: string }>('room:kick', (p, room) => {
      inRoom(room).kick(data.playerId, String(p.id));
      broadcast(room!);
      lobbyChanged();
    });

    on('room:start', (_p, room) => {
      inRoom(room).start(data.playerId);
      broadcast(room!);
      lobbyChanged();
    });

    on<Action>('game:action', (a, room) => {
      inRoom(room).act(data.playerId, a);
      broadcast(room!);
      if (room!.status === 'finished') lobbyChanged();
    });

    on<{ text: string }>('chat', (p, room) => {
      const r = inRoom(room);
      const text = String(p.text ?? '').trim().slice(0, 300);
      if (!text) return;
      const seat = r.seat(data.playerId);
      io.to(`room:${r.code}`).emit('chat', {
        t: Date.now(), name: seat?.name ?? `${data.name} (watching)`, color: seat?.color ?? '#aaa', text,
      });
    });

    socket.on('disconnect', () => leaveCurrent(false));
  });

  return registry;
}
