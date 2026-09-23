import { io, type Socket } from 'socket.io-client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Action, RoomSummary, RoomView } from '../../shared/types.ts';

// Identity: a random secret kept in this browser. The server derives your
// public player id from it, so the same browser always gets its seat back.
function secret(): string {
  let k = localStorage.getItem('yot:key');
  if (!k) {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    k = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('yot:key', k);
  }
  return k;
}

export function getName(): string {
  return localStorage.getItem('yot:name') ?? '';
}

export function setName(n: string) {
  localStorage.setItem('yot:name', n.trim().slice(0, 20));
}

let socket: Socket | null = null;
let myId = '';
const idListeners = new Set<() => void>();

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      auth: cb => cb({ key: secret(), name: getName() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
    });
    socket.on('hello', (h: { playerId: string }) => {
      myId = h.playerId;
      idListeners.forEach(f => f());
    });
  }
  return socket;
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

export interface ChatMsg { t: number; name: string; color: string; text: string }

export function useRoom(code: string) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [skew, setSkew] = useState(0);

  useEffect(() => {
    const s = getSocket();
    const onState = (v: RoomView) => {
      setRoom(v);
      setSkew(v.now - Date.now());
    };
    const onChat = (m: ChatMsg) => setChat(c => [...c.slice(-150), m]);
    s.on('room:state', onState);
    s.on('chat', onChat);
    const off = onEveryConnect(() => {
      call<{ spectating: boolean }>('room:join', { code, name: getName() })
        .then(r => { setSpectating(r.spectating); setError(null); })
        .catch(e => setError(e.message));
    });
    return () => {
      off();
      s.off('room:state', onState);
      s.off('chat', onChat);
    };
  }, [code]);

  return { room, error, spectating, chat, skew };
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
