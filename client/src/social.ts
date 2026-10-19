// Table social on the client: listens for reactions and pokes relayed by the
// server and keeps the ones still on screen. Separate from useRoom because
// these are fleeting events, not room state.
import { useEffect, useRef, useState } from 'react';
import { POKE_EMOJI, type PokeMsg, type ReactionMsg, type RoomView } from '../../shared/types.ts';
import { call, getSocket } from './net.ts';
import { playPoke, playReaction } from './sound.ts';
import { toastSocial } from './toast.tsx';

/** How long a reaction stays up (keep in step with the CSS float animations). */
export const REACTION_MS = 3_200;
/** How long a poke's nudge is shown. */
export const POKE_MS = 3_500;
/** Most recently sent reactions, newest first (persisted per browser). */
const RECENT_KEY = 'yot.recentReactions';

export interface Social {
  /** Reactions still showing, oldest first. */
  reactions: ReactionMsg[];
  /** The latest poke while it is still showing. */
  poke: PokeMsg | null;
  /** Server seq of the last reaction this player sent, for the dock button's burst. */
  sentSeq: number;
}

/** Avatar for a player in the room, for toasts (falls back to a neutral face). */
function avatarOf(room: RoomView | null | undefined, id: string): string {
  return room?.seats.find(s => s.id === id)?.avatar ?? '🙂';
}

export function useSocial(me: string, room?: RoomView | null): Social {
  const [reactions, setReactions] = useState<ReactionMsg[]>([]);
  const [poke, setPoke] = useState<PokeMsg | null>(null);
  const [sentSeq, setSentSeq] = useState(0);
  // Read in the socket handlers without re-binding them on every room update.
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const s = getSocket();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };
    const show = (r: ReactionMsg) => {
      // A dozen at once is plenty on screen; older ones make way.
      setReactions(list => [...list.slice(-11), r]);
      later(() => setReactions(list => list.filter(x => x.seq !== r.seq)), REACTION_MS);
    };
    const onReaction = (r: ReactionMsg) => {
      show(r);
      if (r.id === me) { setSentSeq(r.seq); return; }
      playReaction();
      toastSocial({ key: `react-${r.seq}`, avatar: avatarOf(roomRef.current, r.id), name: r.name, emoji: r.emoji });
    };
    const onPoke = (p: PokeMsg) => {
      setPoke(p);
      const target = roomRef.current?.seats.find(s => s.id === p.to);
      if (p.to === me) {
        playPoke();
        toastSocial({ key: `poke-${p.seq}`, avatar: avatarOf(roomRef.current, p.from), name: p.fromName, emoji: POKE_EMOJI, text: 'poked you' });
      }
      // A little hand over the poked piece, through the same path a reaction
      // takes. Local only: the server never relays 👉 as a reaction. A negative
      // seq keeps it clear of the server's numbering.
      show({ seq: -p.seq, id: p.to, name: target?.name ?? '', emoji: POKE_EMOJI, spectator: false });
      later(() => setPoke(cur => (cur?.seq === p.seq ? null : cur)), POKE_MS);
    };
    s.on('reaction', onReaction);
    s.on('poke', onPoke);
    return () => {
      s.off('reaction', onReaction);
      s.off('poke', onPoke);
      timers.forEach(clearTimeout);
    };
  }, [me]);

  return { reactions, poke, sentSeq };
}

export const sendReaction = (emoji: string) => {
  rememberReaction(emoji);
  return call('room:react', { emoji });
};
export const sendPoke = () => call('room:poke');
/** A canned line goes through the ordinary chat handler: filter and cooldown apply. */
export const sendQuickChat = (text: string) => call('chat', { text, quick: true });

// ---- recent reactions ---------------------------------------------------------

export function recentReactions(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 3) : [];
  } catch { return []; }
}

function rememberReaction(emoji: string) {
  try {
    const next = [emoji, ...recentReactions().filter(e => e !== emoji)].slice(0, 3);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode: the row just stays empty */ }
}

// ---- system lines: who came and went ---------------------------------------

export interface SystemLine { t: number; text: string; kind: 'join' | 'leave' | 'away' | 'back' }

/**
 * A disconnected player's turn is auto-played after this long. Keep in step
 * with AUTOPILOT_GRACE_MS in server/src/rooms.ts (not shared with the client).
 */
const AUTOPILOT_GRACE_MS = 45_000;
/** "Lost connection" waits this long, and a player back by then (a refresh, a blip) gets neither line. */
const AWAY_LINE_DELAY_MS = 10_000;

/**
 * Chat has no server-side system messages; derive them from the seats as they
 * change (someone sits down, leaves, drops offline, comes back). Lives in
 * GameScreen so the list survives the chat tab being closed.
 */
export function useSystemLines(room: RoomView | null | undefined): SystemLine[] {
  const [lines, setLines] = useState<SystemLine[]>([]);
  const prev = useRef<Map<string, { name: string; connected: boolean }> | null>(null);
  /** "Lost connection" lines still waiting out AWAY_LINE_DELAY_MS, by player. */
  const away = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { away.current.forEach(clearTimeout); away.current.clear(); }, []);
  const seatsKey = room?.seats.map(s => `${s.id}:${s.connected ? 1 : 0}:${s.isBot ? 1 : 0}`).join('|') ?? '';
  useEffect(() => {
    if (!room) return;
    const now = new Map(room.seats.filter(s => !s.isBot).map(s => [s.id, { name: s.name, connected: s.connected }]));
    const before = prev.current;
    prev.current = now;
    if (!before) return; // first sight of the room: nothing has changed yet
    const out: SystemLine[] = [];
    const t = Date.now();
    const post = (add: SystemLine[]) => setLines(l => [...l.slice(-60), ...add]);
    /** Forget a "lost connection" line not posted yet; true if there was one. */
    const unpost = (id: string) => {
      const timer = away.current.get(id);
      if (timer === undefined) return false;
      clearTimeout(timer);
      away.current.delete(id);
      return true;
    };
    for (const [id, s] of now) {
      const was = before.get(id);
      if (!was) out.push({ t, text: `${s.name} joined`, kind: 'join' });
      else if (was.connected && !s.connected) {
        unpost(id);
        const left = Math.round((AUTOPILOT_GRACE_MS - AWAY_LINE_DELAY_MS) / 1000);
        away.current.set(id, setTimeout(() => {
          away.current.delete(id);
          post([{ t: Date.now(), text: `${s.name} lost connection — autopilot takes over in ${left} s if not back`, kind: 'away' }]);
        }, AWAY_LINE_DELAY_MS));
      } else if (!was.connected && s.connected && !unpost(id)) out.push({ t, text: `${s.name} is back`, kind: 'back' });
    }
    for (const [id, was] of before) {
      if (now.has(id)) continue;
      unpost(id);
      out.push({ t, text: `${was.name} left the game`, kind: 'leave' });
    }
    if (out.length) post(out);
  }, [seatsKey, room?.code]);
  return lines;
}
