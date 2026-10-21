// Card tables over the shared socket (../net.ts): the same sign-in and
// connection as Monopoly, with every event under `cards:`.
import { useCallback, useEffect, useState } from 'react';
import { call, getSocket, onEveryConnect, type ChatMsg } from '../net.ts';
import type { CardsAction } from '../../../shared/cards/types.ts';
import type { CardsChatMsg, CardsConfigure, CardsRoomSummary, CardsRoomView } from '../../../shared/cards/room.ts';
// Not from ChogPicker: that would put the trait table in the home page's first download.
import { loadChogTokenPref } from '../chogTokenPref.ts';

export const cardsCall = call;
export const cardsAct = (a: CardsAction) => call('cards:act', a);
export const cardsChat = (text: string) => call('cards:chat', { text });
export const cardsConfigure = (p: CardsConfigure) => call('cards:configure', p);

/**
 * Sent with a create or join: a new seat sits down as the player's own Chog when
 * they picked one before (the server seats it only if their wallet holds it).
 */
export function chogPref(): { chogToken?: number } {
  const chogToken = loadChogTokenPref();
  return chogToken ? { chogToken } : {};
}
const joinPayload = (code: string, watch: boolean) => ({ code, watch, ...chogPref() });

/** Join (or watch) a table and follow it: the latest state, chat, and the server clock skew. */
export function useCardsRoom(code: string, watch = false) {
  const [room, setRoom] = useState<CardsRoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spectating, setSpectating] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [skew, setSkew] = useState(0);

  useEffect(() => {
    const s = getSocket();
    const onState = (v: CardsRoomView) => {
      if (v.code !== code) return;
      setRoom(v);
      setSkew(v.now - Date.now());
    };
    const onChat = (m: CardsChatMsg) => setChat(c => [...c.slice(-150), m]);
    s.on('cards:state', onState);
    s.on('cards:chat', onChat);
    const off = onEveryConnect(() => {
      call<{ spectating: boolean }>('cards:join', joinPayload(code, watch))
        .then(r => { setSpectating(r.spectating); setError(null); })
        .catch(e => setError(e.message));
    });
    return () => {
      off();
      s.off('cards:state', onState);
      s.off('cards:chat', onChat);
      // Leaving the page is not leaving the table: the seat is kept, marked away.
      if (s.connected) s.emit('cards:away', { code });
    };
  }, [code, watch]);

  const rejoin = useCallback(async () => {
    const r = await call<{ spectating: boolean }>('cards:join', joinPayload(code, watch));
    setSpectating(r.spectating);
  }, [code, watch]);

  return { room, error, spectating, chat, skew, rejoin };
}

/** The open tables, kept up to date. */
export function useCardsRoomList(): CardsRoomSummary[] {
  const [rooms, setRooms] = useState<CardsRoomSummary[]>([]);
  useEffect(() => {
    const s = getSocket();
    s.on('cards:rooms', setRooms);
    const off = onEveryConnect(() => {
      call<{ rooms: CardsRoomSummary[] }>('cards:list', { subscribe: true }).then(r => setRooms(r.rooms)).catch(() => {});
    });
    return () => { off(); s.off('cards:rooms', setRooms); };
  }, []);
  return rooms;
}
