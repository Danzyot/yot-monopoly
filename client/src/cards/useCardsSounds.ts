// What the table sounds like: each step of a staged play (cards/sequence.ts)
// is given its sound at the moment it animates, on timers set from the plan
// (a card's slap as it lands, each penalty card's whoosh as it leaves the
// pile), so the ear and the eye agree. Your own plays are a touch louder
// than everyone else's, as the Monopoly pieces are. A hidden tab stays
// quiet: nothing is scheduled while it is hidden, and a sound that falls due
// after the tab was hidden is skipped.

import { useEffect, useRef } from 'react';
import { CARDS_DRAW_GAP_MS, CARDS_DRAW_MS } from '../../../shared/cards/pacing.ts';
import { playYourTurn } from '../sound.ts';
import type { CardsFrame } from './sequence.ts';
import {
  playBlitz, playCardFlip, playCardSlap, playCardWhoosh, playCatch, playChallenge, playCombo, playDeal, playIgnite, playKnockout,
  playLastCard, playMatchWin, playMercy, playPenalty, playPurge, playReverse, playRiffle, playRoulette, playRoundWin, playSkip,
  playSoft, playSwap, playWild,
} from './sounds.ts';

export function useCardsSounds(frame: CardsFrame | null, me: string | null, myTurn: boolean): void {
  const seen = useRef(-1);
  /** Sounds still to come; each one leaves the set as it fires. */
  const timers = useRef(new Set<number>());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const play = frame?.play ?? null;
  useEffect(() => {
    if (!play || play.seq === seen.current) return;
    seen.current = play.seq;
    // A play staged while nobody is looking is not heard later either.
    if (document.hidden) return;
    const now = performance.now();
    const sched = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.current.delete(id);
        if (!document.hidden) fn();
      }, Math.max(0, ms - now));
      timers.current.add(id);
    };
    // Plays queue one after another: a new one never cancels the sounds the one before still owes.
    for (const s of play.steps) {
      const st = s.step;
      const v = 'player' in st && st.player === me ? 1 : 0.7;
      const dur = s.end - s.at;
      switch (st.type) {
        case 'play':
          sched(s.at, () => playCardWhoosh(0, v, Math.min(0.32, dur / 1000 * 0.6)));
          sched(s.at + dur * 0.8, () => playCardSlap(0, v));
          break;
        case 'draw': {
          const n = Math.min(st.count, 8);
          const fly = Math.min(CARDS_DRAW_MS, dur);
          const gap = n > 1 ? Math.min(CARDS_DRAW_GAP_MS, (dur - fly) / (n - 1)) : 0;
          if (st.reason !== 'turn' && st.reason !== 'start') sched(s.at, () => playPenalty(0, 1));
          for (let k = 0; k < n; k++) sched(s.at + k * gap, () => playCardWhoosh(0, v * 0.8, 0.24));
          break;
        }
        case 'deal':
          sched(s.at, () => playDeal(0, st.order.length * st.count, dur / 1000));
          break;
        case 'flip':
          sched(s.at, () => playCardFlip(0, 0.9));
          if (!st.back) sched(s.end - 120, () => playCardSlap(0, 0.6));
          break;
        case 'reshuffle': sched(s.at, () => playRiffle(0, 0.9, 18)); break;
        case 'skip': sched(s.at, () => playSkip(0, 1)); break;
        case 'reverse': sched(s.at, () => playReverse(0, 1)); break;
        case 'color': sched(s.at, () => playWild(0, 1)); break;
        case 'swap':
        case 'rotate': sched(s.at, () => playSwap(0, 1)); break;
        case 'challenge': sched(s.at, () => playChallenge(0, 1)); break;
        case 'call':
          sched(s.at, () => playLastCard(0, v));
          sched(s.at + 120, () => playIgnite(0, v));
          break;
        case 'purge': sched(s.at, () => playPurge(0, v, st.cards.length)); break;
        case 'blitz': sched(s.at, () => playBlitz(0, v)); break;
        case 'stack': sched(s.at, () => playCombo(0, 1, st.chain)); break;
        case 'roulette': sched(s.at, () => playRoulette(0, 1, dur / 1000)); break;
        case 'mercy': sched(s.at, () => playMercy(0, 1)); break;
        case 'catch': sched(s.at, () => playCatch(0, 1)); break;
        case 'pass':
        case 'timeout': sched(s.at, () => playSoft(0, v)); break;
        case 'roundEnd':
          // Out of cards: the last one lands hard first.
          if (!st.blocked) sched(s.at, () => playKnockout(0, 1));
          sched(s.at + 150, () => (st.matchOver ? playMatchWin(0, 1) : playRoundWin(0, 1)));
          break;
        default: break;
      }
    }
  }, [play, me]);

  // Your turn: the Monopoly chime.
  const wasMine = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMine.current) playYourTurn();
    wasMine.current = myTurn;
  }, [myTurn]);
}
