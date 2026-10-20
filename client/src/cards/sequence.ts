// Staging for the card table, in one place so the 2D table today and a 3D
// table later read the same plan. The server has already moved on when a view
// arrives; this decides what the player sees, and when.
//
// Each new play (CardsView.lastPlay, by seq) is planned once, on the clock,
// the moment a view carrying it is first seen: every step gets a start and an
// end (shared/cards/pacing.ts, the very sums the server's bots and turn clock
// wait for). Plays queue one after another, never far behind. While a play is
// staging, the table shows the pose the steps have reached (the top card, the
// colour, the direction, each hand's size, our own hand) and the HUD (action
// buttons, prompts, the feed) is held until the play is over, like Monopoly's
// three/sequence.ts holds it for the dice and the walk.

import { useEffect, useRef, useState } from 'react';
import { CARDS_MAX_QUEUE_MS, CARDS_SETTLE_MS, cardsStepTimes } from '../../../shared/cards/pacing.ts';
import type { Card, CardColor } from '../../../shared/cards/deck.ts';
import type { CardsDirection, CardsStep, CardsView } from '../../../shared/cards/types.ts';

/** What the table looks like at one moment: the things a play animates. */
export interface TablePose {
  top: Card | null;
  color: CardColor | null;
  direction: CardsDirection;
  /** Cards in each hand. */
  counts: Record<string, number>;
  /** Our own hand (null: spectating). */
  hand: Card[] | null;
}

export interface StagedStep {
  step: CardsStep;
  index: number;
  /** performance.now() times. */
  at: number;
  end: number;
}

export interface StagedPlay {
  seq: number;
  player: string;
  steps: StagedStep[];
  start: number;
  /** When the table may move on (the last step plus a short settle). */
  end: number;
  /** The table just before this play. */
  before: TablePose;
}

/** The table as it should look at one moment. */
export interface CardsFrame extends TablePose {
  /** Whose turn to show: the player acting while a play stages, then the live current player. */
  current: string;
  /** A play is still staging: hold the HUD. */
  busy: boolean;
  /** The play staging now. */
  play: StagedPlay | null;
  /** Steps animating at this moment. */
  active: StagedStep[];
  /** Every play up to this seq has been shown in full (log lines with play <= doneSeq may show). */
  doneSeq: number;
  /** When this frame next changes (performance.now() time; Infinity: not until a new view). */
  next: number;
}

export function poseOf(v: CardsView): TablePose {
  return {
    top: v.top, color: v.color, direction: v.direction,
    counts: Object.fromEntries(v.players.map(p => [p.id, p.cards])),
    hand: v.you ? v.you.hand : null,
  };
}

/** The table before a match's first deal: nothing dealt, nothing turned up. */
function emptyPose(v: CardsView): TablePose {
  return {
    top: null, color: null, direction: 1,
    counts: Object.fromEntries(v.players.map(p => [p.id, 0])),
    hand: v.you ? [] : null,
  };
}

/** Plans plays as views arrive and answers what to show at any moment. */
export class CardsSequencer {
  private plays: StagedPlay[] = [];
  private lastSeq: number | null = null;
  private lastPose: TablePose | null = null;
  private live: CardsView | null = null;

  /**
   * A view arrived. `animateFirst`: the first view this table sees is a
   * fresh deal (we came from the lobby), so stage it rather than show it.
   */
  push(view: CardsView, animateFirst = false, now = performance.now()): void {
    const seq = view.lastPlay?.seq ?? 0;
    const pose = poseOf(view);
    this.live = view;
    if (this.lastSeq === null) {
      this.lastSeq = seq;
      this.lastPose = pose;
      const deal = view.lastPlay?.steps[0]?.type === 'deal';
      if (animateFirst && deal && view.lastPlay) this.plan(view, emptyPose(view), now);
      return;
    }
    if (seq !== this.lastSeq && view.lastPlay) this.plan(view, this.lastPose ?? pose, now);
    this.lastSeq = seq;
    this.lastPose = pose;
  }

  private plan(view: CardsView, before: TablePose, now: number) {
    const play = view.lastPlay!;
    this.plays = this.plays.filter(p => p.end > now);
    let start = Math.max(now, this.plays.at(-1)?.end ?? 0);
    // Too far behind: drop what is queued and show this one now.
    if (start - now > CARDS_MAX_QUEUE_MS) {
      this.plays = [];
      start = now;
    }
    const times = cardsStepTimes(play.steps);
    const steps = play.steps.map((step, index) => ({ step, index, at: start + times[index].at, end: start + times[index].at + times[index].dur }));
    const last = steps.at(-1);
    const end = last ? last.end + CARDS_SETTLE_MS : start;
    if (end <= now) return;
    this.plays.push({ seq: play.seq, player: play.player, steps, start, end, before });
  }

  /** When everything planned so far will have played (performance.now() time). */
  freeAt(): number {
    return this.plays.at(-1)?.end ?? 0;
  }

  planned(): readonly StagedPlay[] {
    return this.plays;
  }

  frame(now = performance.now()): CardsFrame | null {
    const v = this.live;
    if (!v) return null;
    const live = poseOf(v);
    const play = this.plays.find(p => p.end > now) ?? null;
    if (!play) {
      return { ...live, current: v.current, busy: false, play: null, active: [], doneSeq: this.lastSeq ?? 0, next: Infinity };
    }
    const pose = replay(play, v, now);
    const active = play.steps.filter(s => s.at <= now && now < s.end);
    const edges = play.steps.flatMap(s => [s.at, s.end]).concat(play.end).filter(t => t > now);
    const doneBefore = this.plays.filter(p => p.end <= now).map(p => p.seq);
    const prior = Math.max(0, ...doneBefore, play.seq - 1);
    return { ...pose, current: play.player, busy: true, play, active, doneSeq: prior, next: Math.min(...edges) };
  }
}

/** The pose `play` has reached at `now`: its `before`, with the steps that have landed applied. */
function replay(play: StagedPlay, v: CardsView, now: number): TablePose {
  const b = play.before;
  let top = b.top, color = b.color, direction = b.direction;
  const counts = { ...b.counts };
  for (const p of v.players) counts[p.id] ??= 0;
  const me = v.you?.id;
  let hand: Card[] | null = b.hand ? [...b.hand] : null;
  const liveHand = v.you?.hand ?? null;
  /** Our live hand, less what later steps of this play have yet to bring. */
  const handFrom = (k: number) => {
    if (!liveHand) return null;
    const later = new Set(play.steps.slice(k + 1).flatMap(s => (s.step.type === 'draw' && s.step.player === me ? s.step.cards ?? [] : []).map(c => c.id)));
    return liveHand.filter(c => !later.has(c.id));
  };
  for (const s of play.steps) {
    const st = s.step;
    const started = s.at <= now;
    const landed = s.end <= now;
    switch (st.type) {
      case 'play':
        // The card leaves the hand as it starts to fly, and lands on the pile.
        if (started) {
          counts[st.player] = Math.max(0, (counts[st.player] ?? 0) - 1);
          if (st.player === me && hand) hand = hand.filter(c => c.id !== st.card.id);
        }
        if (landed) {
          top = st.card;
          if (st.card.color) color = st.card.color;
        }
        break;
      case 'flip':
        if (landed && !st.back) { top = st.card; color = st.card.color; }
        break;
      case 'deal':
        if (landed) {
          for (const id of st.order) counts[id] = st.count;
          if (hand) hand = handFrom(s.index);
        }
        break;
      case 'draw':
        if (landed) {
          counts[st.player] = (counts[st.player] ?? 0) + st.count;
          if (st.player === me && hand && st.cards) hand = [...hand, ...st.cards.filter(c => !hand!.some(h => h.id === c.id))];
        }
        break;
      case 'color':
        if (landed) color = st.color;
        break;
      case 'reverse':
        if (started) direction = st.direction;
        break;
      case 'swap':
        if (landed) {
          [counts[st.player], counts[st.target]] = [counts[st.target] ?? 0, counts[st.player] ?? 0];
          if (me === st.player || me === st.target) hand = handFrom(s.index);
        }
        break;
      case 'rotate':
        if (landed) {
          const alive = v.players.filter(p => !p.left).map(p => p.id);
          const n = alive.length;
          const was = alive.map(id => counts[id] ?? 0);
          alive.forEach((_id, i) => { counts[alive[((i + st.direction) % n + n) % n]] = was[i]; });
          hand = handFrom(s.index);
        }
        break;
      case 'purge':
        // The cleared colour leaves the hand as it starts to fly (the Purge itself is the play step after).
        if (started) {
          counts[st.player] = Math.max(0, (counts[st.player] ?? 0) - st.cards.length);
          if (st.player === me && hand) {
            const gone = new Set(st.cards.map(c => c.id));
            hand = hand.filter(c => !gone.has(c.id));
          }
        }
        break;
      case 'mercy':
        // Knocked out: the hand goes back under the pile.
        if (landed) {
          counts[st.player] = 0;
          if (st.player === me && hand) hand = [];
        }
        break;
      case 'leave':
        if (landed) counts[st.player] = 0;
        break;
      default:
        break;
    }
  }
  return { top, color, direction, counts, hand };
}

/**
 * The table's frame for this view, re-rendering at each step boundary (a
 * timer per boundary, no frame loop). Call it with every view.
 */
export function useCardsSequence(view: CardsView | null, animateFirst: boolean): { frame: CardsFrame | null; seq: CardsSequencer } {
  const ref = useRef<CardsSequencer | null>(null);
  ref.current ??= new CardsSequencer();
  const seq = ref.current;
  // During render, so this very render already shows the play starting.
  if (view) seq.push(view, animateFirst);
  const [ticks, tick] = useState(0);
  const frame = seq.frame();
  const next = frame?.next ?? Infinity;
  // Re-armed after every tick too: a timer that fires before the clock has
  // reached `next` (throttled or clamped timers, a clock that stood still)
  // would otherwise leave the same `next` and no timer, and the table would
  // wait on a view that may never come (the match's last play).
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => tick(n => n + 1), Math.max(0, next - performance.now()) + 5);
    return () => clearTimeout(id);
  }, [next, view?.seq, ticks]);
  return { frame, seq };
}
