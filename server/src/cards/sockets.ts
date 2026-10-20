// Socket.IO wiring for card tables, on the same server and sign-in as
// Monopoly (../sockets.ts sets socket.data.profile in its io.use). Every event
// is namespaced `cards:*`, and every socket joins `cards:<code>` for the table
// it has open. State goes out per viewer: each seated player gets a view with
// their own hand and no one else's; spectators get no hand at all.

import type { Server, Socket } from 'socket.io';
import { banMessage, findBan } from '../bans.ts';
import { ChatError, checkChat } from '../chat.ts';
import { logGameEvent } from '../eventlog.ts';
import { isOn } from '../features.ts';
import { CardsError } from './game.ts';
import { CardsRegistry, CardsRoom, CardsRoomError, type CardsMember } from './rooms.ts';
import { recordCardsResult } from './stats.ts';
import { QUICK_BOTS, pickQuickTable } from '../quickJoin.ts';
import { CARDS_GAME_NAME } from '../../../shared/cards/meta.ts';
import type { CardsAction } from '../../../shared/cards/types.ts';
import type { CardsChatMsg, CardsConfigure, CardsRoomView } from '../../../shared/cards/room.ts';
import type { PlayerProfile } from '../../../shared/types.ts';

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

/** What ../sockets.ts keeps on every socket, plus the card table it has open. */
interface CardsSocketData {
  profile: PlayerProfile | null;
  ip: string | null;
  cardsRoom?: string | null;
  cardsTokens?: number;
  cardsRefilledAt?: number;
}

const ACTIONS_PER_SEC = 12;
const ACTION_BURST = 30;
const SPECTATOR_REFRESH_MS = 1_000;
/** Lobbies one account may have open at once. */
const OPEN_LOBBIES = 3;

export interface CardsSocketLayer {
  registry: CardsRegistry;
  broadcast(room: CardsRoom): void;
}

export interface CardsSocketOptions {
  /** Codes in use by other games, so a code is never ambiguous. */
  taken?: (code: string) => boolean;
  /** Whether an account's linked wallets hold a Chog Genesis token (../wallet/holders.ts); without it nobody plays as one. */
  holdsChog?: (userId: string, tokenId: number) => boolean;
}

const channel = (code: string) => `cards:${code}`;

export function attachCardsSockets(io: Server, opts: CardsSocketOptions = {}): CardsSocketLayer {
  // Broadcasts are coalesced per tick, like Monopoly's: an action and the
  // timers it re-arms go out as one state.
  const pending = new Set<CardsRoom>();
  const flush = () => {
    if (!pending.size) return;
    const rooms = [...pending];
    pending.clear();
    for (const r of rooms) sendState(r);
  };
  const broadcast = (room: CardsRoom) => {
    if (!pending.size) setImmediate(flush);
    pending.add(room);
  };
  const lazy = new Map<string, ReturnType<typeof setTimeout>>();
  const broadcastSoon = (room: CardsRoom) => {
    if (lazy.has(room.code)) return;
    lazy.set(room.code, setTimeout(() => { lazy.delete(room.code); broadcast(room); }, SPECTATOR_REFRESH_MS));
  };

  /** Who this socket sees the table as: their seat, or a spectator. */
  const viewerOf = (s: Socket, room: CardsRoom): string => {
    const id = (s.data as CardsSocketData).profile?.id;
    return id && room.seat(id) ? id : '';
  };
  const sendState = (room: CardsRoom) => {
    const t = lazy.get(room.code);
    if (t) { clearTimeout(t); lazy.delete(room.code); }
    const ids = io.sockets.adapter.rooms.get(channel(room.code));
    if (!ids) return;
    const views = new Map<string, CardsRoomView>();
    for (const sid of ids) {
      const s = io.sockets.sockets.get(sid);
      if (!s) continue;
      const who = viewerOf(s, room);
      let v = views.get(who);
      if (!v) { v = room.view(who || undefined); views.set(who, v); }
      s.emit('cards:state', v);
    }
  };
  const sendStateTo = (s: Socket, room: CardsRoom) => s.emit('cards:state', room.view(viewerOf(s, room) || undefined));

  let lobbyQueued = false;
  const lobbyChanged = () => {
    if (lobbyQueued) return;
    lobbyQueued = true;
    setImmediate(() => { lobbyQueued = false; io.to('cards:lobby').emit('cards:rooms', registry.list()); });
  };

  const registry = new CardsRegistry({
    onChange: room => broadcast(room),
    onEvent: (room, text) => logGameEvent(room.code, `${CARDS_GAME_NAME} · ${room.hostName()}`, text),
    onFinished: room => {
      try { recordCardsResult(room); } catch (e) { console.error('[cards] could not record result', e); }
      lobbyChanged();
    },
    holdsChog: opts.holdsChog,
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as CardsSocketData;
    data.cardsRoom = null;
    data.cardsTokens = ACTION_BURST;
    data.cardsRefilledAt = Date.now();

    const me = () => data.profile?.id ?? '';
    const isAdmin = () => !!data.profile?.isAdmin;
    const member = (): CardsMember => {
      const p = data.profile;
      if (!p) throw new CardsRoomError('Sign in first');
      return { id: p.id, name: p.name, avatar: p.avatar };
    };
    const inRoom = (room: CardsRoom | null): CardsRoom => room ?? (() => { throw new CardsRoomError('Open a table first'); })();

    /** Every handler goes through here: errors become acks, never crashes. */
    const on = <T>(event: string, fn: (payload: T, room: CardsRoom | null) => Record<string, unknown> | void, limited = true) => {
      socket.on(event, (payload: T, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => {};
        if (limited && !take(data)) return reply({ ok: false, error: 'Slow down' });
        if (!plain(payload)) return reply({ ok: false, error: 'Bad request' });
        try {
          const room = data.cardsRoom ? registry.get(data.cardsRoom) ?? null : null;
          const extra = fn((payload ?? {}) as T, room) ?? {};
          flush();
          reply({ ok: true, ...extra });
        } catch (e) {
          flush();
          if (e instanceof CardsError || e instanceof CardsRoomError || e instanceof ChatError) reply({ ok: false, error: e.message });
          else {
            console.error(`[cards socket] ${event} failed`, e);
            reply({ ok: false, error: 'Server error' });
          }
        }
      });
    };

    const otherSocketAt = (code: string, id: string, except: string) => {
      for (const s of io.sockets.sockets.values()) {
        const d = s.data as CardsSocketData;
        if (s.id !== except && d.cardsRoom === code && d.profile?.id === id) return true;
      }
      return false;
    };

    const enter = (room: CardsRoom, seated: boolean) => {
      if (data.cardsRoom && data.cardsRoom !== room.code) leaveCurrent(false);
      if (data.cardsRoom !== room.code && !seated) room.spectators++;
      data.cardsRoom = room.code;
      socket.join(channel(room.code));
      if (seated) {
        room.setConnected(me(), true);
        broadcast(room);
        lobbyChanged();
      } else {
        sendStateTo(socket, room);
        broadcastSoon(room);
      }
    };

    const leaveCurrent = (forfeit: boolean) => {
      const room = data.cardsRoom ? registry.get(data.cardsRoom) : undefined;
      data.cardsRoom = null;
      if (!room) return;
      socket.leave(channel(room.code));
      const seated = !!room.seat(me());
      if (!seated) room.spectators = Math.max(0, room.spectators - 1);
      else if (forfeit) room.leave(me());
      else if (!otherSocketAt(room.code, me(), socket.id)) room.setConnected(me(), false);
      if (seated) { broadcast(room); lobbyChanged(); }
      else broadcastSoon(room);
    };

    on<{ subscribe?: boolean }>('cards:list', p => {
      if (p.subscribe) socket.join('cards:lobby');
      return { rooms: registry.list() };
    });

    const openTable = (m: CardsMember, chogToken: unknown): CardsRoom => {
      if (!isOn('publicRooms') && !isAdmin()) throw new CardsRoomError('Only operators can open tables right now');
      if (registry.roomsOf(m.id).filter(r => r.hostId === m.id && r.status === 'lobby').length >= OPEN_LOBBIES) {
        throw new CardsRoomError(`You already have ${OPEN_LOBBIES} open tables — start or leave one first`);
      }
      const room = registry.create(m.id, isAdmin(), opts.taken);
      room.join(m, typeof chogToken === 'number' ? chogToken : undefined);
      return room;
    };

    on<{ chogToken?: unknown }>('cards:create', p => {
      const room = openTable(member(), p.chogToken);
      enter(room, true);
      return { code: room.code };
    });

    // "Play now" on the home page (../quickJoin.ts): a seat at the public table
    // nearest to filling up, or a new public table with bots.
    on<{ chogToken?: unknown }>('cards:quickJoin', p => {
      const m = member();
      const prof = data.profile!;
      const chogToken = typeof p.chogToken === 'number' ? p.chogToken : undefined;
      const pick = pickQuickTable(
        [...registry.rooms.values()].map(room => ({
          room, code: room.code, private: room.private, status: room.status, seats: room.seats,
          maxPlayers: room.maxPlayers, createdAt: room.createdAt, restricted: !!room.tournament,
        })),
        m.id,
        t => t.room.wasKicked(m.id) || !!findBan({ id: prof.id, discordId: prof.discord?.id, ip: data.ip }, t.code),
      );
      if (pick) {
        pick.room.join(m, chogToken);
        enter(pick.room, true);
        return { code: pick.room.code, created: false };
      }
      const room = openTable(m, chogToken);
      if (isOn('bots') || isAdmin()) for (let i = 0; i < QUICK_BOTS.cards; i++) room.addBot(m.id, isAdmin());
      enter(room, true);
      return { code: room.code, created: true };
    });

    // Seated if there is a seat (or it is yours already), watching otherwise.
    on<{ code: string; watch?: boolean; chogToken?: unknown }>('cards:join', p => {
      const room = registry.get(String(p.code ?? '').slice(0, 8)) ?? (() => { throw new CardsRoomError('No table with that code'); })();
      const prof = data.profile;
      const ban = findBan({ id: prof?.id, discordId: prof?.discord?.id, ip: data.ip }, room.code);
      if (ban) throw new CardsRoomError(banMessage(ban));
      const watchingHere = data.cardsRoom === room.code && !!prof && !room.seat(prof.id);
      let seated = false;
      if (prof && (p.watch !== true || room.seat(prof.id))) {
        try {
          room.join({ id: prof.id, name: prof.name, avatar: prof.avatar }, typeof p.chogToken === 'number' ? p.chogToken : undefined);
          seated = true;
        } catch (e) {
          if (!(e instanceof CardsRoomError)) throw e;
        }
      }
      if (seated && watchingHere) room.spectators = Math.max(0, room.spectators - 1);
      enter(room, seated);
      return { spectating: !seated };
    });

    on('cards:leave', () => { leaveCurrent(true); });

    // Navigating away without leaving: the seat is kept but shows as away.
    on<{ code?: string }>('cards:away', p => {
      if (data.cardsRoom && data.cardsRoom === String(p.code ?? '').toUpperCase()) leaveCurrent(false);
    }, false);

    on<CardsConfigure>('cards:configure', (p, room) => {
      const r = inRoom(room);
      r.configure(me(), isAdmin(), {
        rules: p.rules && typeof p.rules === 'object' && !Array.isArray(p.rules) ? p.rules : undefined,
        maxPlayers: typeof p.maxPlayers === 'number' ? p.maxPlayers : undefined,
        private: typeof p.private === 'boolean' ? p.private : undefined,
      });
      broadcast(r);
      lobbyChanged();
    });

    on<{ character?: string; chogToken?: unknown; color?: string; outfit?: unknown }>('cards:seat', (p, room) => {
      const r = inRoom(room);
      if (p.character !== undefined) r.pickCharacter(me(), p.character, p.chogToken ?? undefined);
      if (p.color !== undefined) r.pickColor(me(), p.color);
      if (p.outfit !== undefined) r.pickOutfit(me(), p.outfit);
      broadcast(r);
    });

    on<{ level?: string }>('cards:addBot', (p, room) => {
      if (!isOn('bots') && !isAdmin()) throw new CardsRoomError('Bots are switched off');
      const r = inRoom(room);
      r.addBot(me(), isAdmin(), p.level);
      broadcast(r);
      lobbyChanged();
    });

    on<{ id: string; level: string }>('cards:botLevel', (p, room) => {
      const r = inRoom(room);
      r.setBotLevel(me(), isAdmin(), String(p.id), p.level);
      broadcast(r);
    });

    on<{ id: string }>('cards:kick', (p, room) => {
      const r = inRoom(room);
      r.kick(me(), String(p.id), isAdmin());
      broadcast(r);
      lobbyChanged();
    });

    on<{ id: string }>('cards:host', (p, room) => {
      const r = inRoom(room);
      r.transferHost(me(), String(p.id), isAdmin());
      broadcast(r);
      lobbyChanged();
    });

    on('cards:start', (_p, room) => {
      const r = inRoom(room);
      r.start(me(), isAdmin());
      broadcast(r);
      lobbyChanged();
    });

    on<CardsAction>('cards:act', (a, room) => {
      const r = inRoom(room);
      if (!data.profile) throw new CardsRoomError('Sign in first');
      if (!a || typeof (a as { type?: unknown }).type !== 'string') throw new CardsRoomError('Bad action');
      r.act(me(), a);
      broadcast(r);
    });

    on('cards:back', (_p, room) => {
      const r = inRoom(room);
      r.back(me());
      broadcast(r);
    });

    on<{ paused?: boolean }>('cards:pause', (p, room) => {
      const r = inRoom(room);
      const name = data.profile?.name ?? 'the host';
      if (p.paused === false) r.resume(me(), isAdmin(), name);
      else r.pause(me(), isAdmin(), name);
      broadcast(r);
    });

    on<{ id: string; on: boolean }>('cards:autopilot', (p, room) => {
      const r = inRoom(room);
      r.setAutopilot(me(), String(p.id), p.on === true, isAdmin());
      broadcast(r);
    });

    on('cards:rematch', (_p, room) => {
      const r = inRoom(room);
      r.rematch(me(), isAdmin(), id => {
        for (const s of io.sockets.sockets.values()) {
          const d = s.data as CardsSocketData;
          if (d.cardsRoom === r.code && d.profile?.id === id) return true;
        }
        return false;
      });
      broadcast(r);
      lobbyChanged();
    });

    on<{ text: string }>('cards:chat', (p, room) => {
      const r = inRoom(room);
      if (!isOn('chat')) throw new CardsRoomError('Chat is switched off');
      const prof = data.profile ?? (() => { throw new CardsRoomError('Sign in to chat'); })();
      const text = checkChat(prof.id, p.text);
      const seat = r.seat(prof.id);
      const msg: CardsChatMsg = {
        t: Date.now(), id: prof.id, name: seat?.name ?? prof.name, color: seat?.color ?? '#aaa', text,
        ...(!seat && { spectator: true }), ...(prof.isAdmin && { admin: true }),
      };
      io.to(channel(r.code)).emit('cards:chat', msg);
      logGameEvent(r.code, CARDS_GAME_NAME, `💬 ${msg.name}: ${text}`);
    });

    socket.on('disconnect', () => { leaveCurrent(false); });
  });

  return {
    registry,
    broadcast: room => { broadcast(room); flush(); },
  };
}

function plain(p: unknown): boolean {
  if (p === undefined || p === null) return true;
  if (typeof p !== 'object' || Array.isArray(p)) return false;
  const proto = Object.getPrototypeOf(p);
  return proto === Object.prototype || proto === null;
}

function take(d: CardsSocketData): boolean {
  const now = Date.now();
  d.cardsTokens = Math.min(ACTION_BURST, (d.cardsTokens ?? ACTION_BURST) + ((now - (d.cardsRefilledAt ?? now)) / 1000) * ACTIONS_PER_SEC);
  d.cardsRefilledAt = now;
  if (d.cardsTokens < 1) return false;
  d.cardsTokens -= 1;
  return true;
}
