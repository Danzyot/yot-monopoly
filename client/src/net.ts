import { io, type Socket } from 'socket.io-client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Action, RequirementFailure, RoomSummary, RoomView } from '../../shared/types.ts';

import { getToken } from './api.ts';

let socket: Socket | null = null;
let myId = '';
const idListeners = new Set<() => void>();
const banListeners = new Set<(msg: string) => void>();

/** Called when the server refuses us for a ban (at connect or mid-session). */
export function onBanned(fn: (msg: string) => void): () => void {
  banListeners.add(fn);
  return () => { banListeners.delete(fn); };
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      auth: cb => cb({ token: getToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
    });
    socket.on('hello', (h: { profile: { id: string } | null }) => {
      myId = h.profile?.id ?? '';
      idListeners.forEach(f => f());
    });
    const banned = (msg: string) => banListeners.forEach(f => f(msg));
    socket.on('connect_error', (e: Error) => {
      if (e.message.startsWith('banned:')) {
        banned(e.message.slice(7));
        socket?.disconnect(); // stop the reconnect loop
      }
    });
    socket.on('banned', (b: { message: string }) => banned(b.message));
  }
  return socket;
}

/** Reconnect with the current token (after signing in or out). */
export function resetSocket() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

export function useMyId(): string {
  return useSyncExternalStore(
    cb => { idListeners.add(cb); return () => idListeners.delete(cb); },
    () => myId,
  );
}

type Reply = { ok: true; [k: string]: unknown } | { ok: false; error: string };

/** Emit with an ack; rejects with the server's error message. */
export function call<T = Record<string, unknown>>(event: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    getSocket().timeout(10_000).emit(event, payload, (err: Error | null, res: Reply) => {
      if (err) return reject(new Error('The server did not answer — check your connection'));
      if (!res.ok) return reject(new Error(res.error));
      resolve(res as unknown as T);
    });
  });
}

export const act = (a: Action) => call('game:action', a);

/** Runs `fn` now (if connected) and after every reconnect. */
export function onEveryConnect(fn: () => void): () => void {
  const s = getSocket();
  if (s.connected) fn();
  s.on('connect', fn);
  return () => { s.off('connect', fn); };
}

export function useConnected(): boolean {
  const s = getSocket();
  const [c, setC] = useState(s.connected);
  useEffect(() => {
    const up = () => setC(true), down = () => setC(false);
    s.on('connect', up);
    s.on('disconnect', down);
    return () => { s.off('connect', up); s.off('disconnect', down); };
  }, [s]);
  return c;
}

export interface ChatMsg { t: number; id: string; name: string; color: string; text: string; spectator?: boolean; admin?: boolean }

/** `watch` joins as a spectator even when a lobby seat is free (operators looking in). */
export function useRoom(code: string, watch = false) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [skew, setSkew] = useState(0);
  /** Set when the room's Discord requirements refused us a seat (we watch instead). */
  const [blocked, setBlocked] = useState<RequirementFailure | null>(null);

  useEffect(() => {
    setBlocked(null);
    const s = getSocket();
    const onState = (v: RoomView) => {
      setRoom(v);
      setSkew(v.now - Date.now());
    };
    const onChat = (m: ChatMsg) => setChat(c => [...c.slice(-150), m]);
    s.on('room:state', onState);
    s.on('chat', onChat);
    const off = onEveryConnect(() => {
      call<{ spectating: boolean; blocked?: RequirementFailure | null }>('room:join', { code, watch })
        .then(r => { setSpectating(r.spectating); setBlocked(r.blocked ?? null); setError(null); })
        .catch(e => setError(e.message));
    });
    return () => {
      off();
      s.off('room:state', onState);
      s.off('chat', onChat);
      // Leaving the page is not leaving the game: the server keeps the seat but
      // marks it away, so autopilot can cover it until we come back.
      if (s.connected) s.emit('room:away', { code });
    };
  }, [code, watch]);

  /** Ask for a seat again (after joining the Discord server, say). Resolves with the new refusal, if any. */
  const recheck = useCallback(async (): Promise<RequirementFailure | null> => {
    const r = await call<{ spectating: boolean; blocked?: RequirementFailure | null }>('room:join', { code, watch });
    setSpectating(r.spectating);
    setBlocked(r.blocked ?? null);
    return r.blocked ?? null;
  }, [code, watch]);

  return { room, error, spectating, chat, skew, blocked, recheck };
}

export function useRoomList(): RoomSummary[] {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  useEffect(() => {
    const s = getSocket();
    s.on('rooms', setRooms);
    const off = onEveryConnect(() => {
      call<{ rooms: RoomSummary[] }>('rooms:list', { subscribe: true }).then(r => setRooms(r.rooms)).catch(() => {});
    });
    return () => { off(); s.off('rooms', setRooms); };
  }, []);
  return rooms;
}
