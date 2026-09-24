// Table social on the client: listens for reactions and pokes relayed by the
// server and keeps the ones still on screen. Separate from useRoom because
// these are fleeting events, not room state.
import { useEffect, useState } from 'react';
import type { PokeMsg, ReactionMsg } from '../../shared/types.ts';
import { call, getSocket } from './net.ts';
import { playPoke, playReaction } from './sound.ts';

/** How long a reaction stays up (keep in step with the CSS float animations). */
export const REACTION_MS = 3_200;
/** How long a poke's nudge is shown. */
export const POKE_MS = 3_500;

export interface Social {
  /** Reactions still showing, oldest first. */
  reactions: ReactionMsg[];
  /** The latest poke while it is still showing. */
  poke: PokeMsg | null;
}

export function useSocial(me: string): Social {
  const [reactions, setReactions] = useState<ReactionMsg[]>([]);
  const [poke, setPoke] = useState<PokeMsg | null>(null);

  useEffect(() => {
    const s = getSocket();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };
    const onReaction = (r: ReactionMsg) => {
      // A dozen at once is plenty on screen; older ones make way.
      setReactions(list => [...list.slice(-11), r]);
      if (r.id !== me) playReaction();
      later(() => setReactions(list => list.filter(x => x.seq !== r.seq)), REACTION_MS);
    };
    const onPoke = (p: PokeMsg) => {
      setPoke(p);
      if (p.to === me) playPoke();
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

  return { reactions, poke };
}

export const sendReaction = (emoji: string) => call('room:react', { emoji });
export const sendPoke = () => call('room:poke');
