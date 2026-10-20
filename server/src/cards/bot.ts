// A decent heuristic card player. It also stands in for absent players
// (autopilot). Pure: it reads only what its own seat's view shows (never
// another hand, never the pile), and returns the next action, or null when it
// has nothing to do right now. Choices that look random are seeded from the
// game state, so the same position always gets the same move.

import { DRAW_VALUE, bestColor, cardPoints, deckSize, handAfter, handPoints, isWild, type Card, type CardColor } from '../../../shared/cards/deck.ts';
import { CARDS_MERCY_LIMIT } from '../../../shared/cards/meta.ts';
import type { CardsAction, CardsBotLevel, CardsPlayerView, CardsView } from '../../../shared/cards/types.ts';
import { hash } from '../engine/minigames/types.ts';
import { LAST_CARD_GRACE_MS, type CardsGame } from './game.ts';

/** The usual pause before a bot acts on its turn (rooms may pass their own). */
export const CARDS_BOT_BASE_MS = 900;
/** Chance (in %) an easy bot plays down to one card without calling, and calls a moment later. */
const EASY_LATE_CALL = 35;

export function cardsBotAction(g: CardsGame, id: string): CardsAction | null {
  const p = g.players.find(q => q.id === id);
  if (!p || p.left) return null;
  return decide(g.view(id, { log: false }), p.level ?? 'normal');
}

/** The decision itself, from a seat's view alone. */
export function decide(v: CardsView, level: CardsBotLevel): CardsAction | null {
  const me = v.you;
  if (!me || v.paused || v.phase === 'over' || v.phase === 'roundOver') return null;
  const roll = (salt: string | number) => hash('cards', v.round, v.turn, v.lastPlay?.seq ?? 0, me.id, salt) % 100;

  // 1. Our own call, if we went down to one card without it (easy bots do, now and then).
  const mine = v.oneCard.find(o => o.player === me.id);
  if (mine && mine.calledAt === null && mine.catchable) return { type: 'callLastCard' };

  // 2. Catch anyone who forgot. Easy bots notice only half the time.
  for (const o of v.oneCard) {
    if (o.player === me.id || !o.catchable) continue;
    if (level === 'easy' && roll(`catch:${o.player}`) >= 50) continue;
    return { type: 'catch', target: o.player };
  }

  // 3. Out of turn: jump in with an identical card (if the table allows it).
  if (v.current !== me.id) {
    if (!me.playable.length) return null;
    const keen = level === 'hard' ? 100 : level === 'normal' ? 70 : 30;
    if (roll('jump') >= keen) return null;
    return playOf(v, level, cardById(v, me.playable[0]), roll);
  }

  switch (v.phase) {
    case 'color':
      return { type: 'chooseColor', color: pickColor(me.hand) };
    case 'swap':
      return { type: 'swap', target: fewestCards(v)?.id ?? me.id };
    case 'drawn': {
      const c = cardById(v, me.drawn!);
      if (!me.canPass) return playOf(v, level, c, roll);
      // Keep a drawn Wild for later unless someone is close to winning; never bluff with it.
      if (isWild(c) && !inDanger(v) && me.hand.length > 3) return { type: 'pass' };
      if (c.kind === 'wild4' && !wild4Legal(v, c)) return { type: 'pass' };
      return playOf(v, level, c, roll);
    }
    case 'play': {
      const options = me.hand.filter(c => me.playable.includes(c.id));
      if (v.pendingDraw) {
        // Pass the penalty on if we can, with the smallest Draw card that answers it (keep the big ones).
        const stack = options.sort((a, b) => (DRAW_VALUE[a.kind] ?? 0) - (DRAW_VALUE[b.kind] ?? 0))[0];
        if (stack) return playOf(v, level, stack, roll);
        if (me.canChallenge && shouldChallenge(v, level, roll)) return { type: 'challenge' };
        return { type: 'draw' };
      }
      const best = options
        .map(c => ({ c, s: score(v, level, c, roll) }))
        .sort((a, b) => b.s - a.s)[0];
      // Only a bluff left to play (easy and normal bots never bluff): draw instead.
      if (!best || best.s <= -500) return { type: 'draw' };
      return playOf(v, level, best.c, roll);
    }
  }
  return null;
}

/**
 * The move for a player who is away: keep their game moving, call "Last
 * card!" for them, but no risks or reactions in their name (no challenges,
 * no jump-ins, no catches).
 */
export function cardsAutopilotAction(g: CardsGame, id: string, action: CardsAction): CardsAction | null {
  switch (action.type) {
    case 'catch': return null;
    case 'challenge': return { type: 'draw' };
    case 'play': return g.current.id === id ? action : null;
    default: return action;
  }
}

/** How long a bot "thinks" before `action`: human-like, and long enough for any catch grace to pass. */
export function cardsBotThinkMs(g: CardsGame, id: string, action: CardsAction, base = CARDS_BOT_BASE_MS): number {
  const level = g.players.find(p => p.id === id)?.level ?? 'normal';
  const h = hash('think', g.seq, id, action.type);
  const quick = level === 'hard' ? 0.7 : level === 'easy' ? 1.4 : 1;
  switch (action.type) {
    case 'catch': {
      const oc = g.view(id, { log: false }).oneCard.find(o => o.player === action.target);
      const wait = Math.max(0, (oc?.catchFrom ?? g.clock() + LAST_CARD_GRACE_MS) - g.clock());
      return wait + Math.round((250 + h % 900) * quick);
    }
    case 'callLastCard':
      // Only easy bots ever call late, and then it takes them a moment to remember.
      return level === 'easy' ? 1500 + h % 2000 : 250 + h % 400;
    case 'chooseColor':
    case 'swap':
      return Math.round((500 + h % 700) * quick);
    case 'challenge':
      return Math.round((1200 + h % 1300) * quick);
    case 'pass':
      return 500 + h % 500;
    case 'play':
      // Jump-ins are reflexes; ordinary plays take a look at the hand.
      if (g.current.id !== id) return Math.round((350 + h % 600) * quick);
      return Math.round((base + h % 1100) * quick);
    default:
      return Math.round((base + h % 700) * quick);
  }
}

// ---- heuristics ---------------------------------------------------------------

function cardById(v: CardsView, id: number): Card {
  return v.you!.hand.find(c => c.id === id)!;
}

/** A play of `c` with the colour, swap partner and call it needs. */
function playOf(v: CardsView, level: CardsBotLevel, c: Card, roll: (s: string) => number): CardsAction {
  const me = v.you!;
  const rest = handAfter(me.hand, c);
  const a: Extract<CardsAction, { type: 'play' }> = { type: 'play', card: c.id };
  if (isWild(c)) a.color = pickColor(rest);
  if (v.rules.sevenZero && c.kind === 'number' && c.value === 7) {
    const t = fewestCards(v);
    if (t) a.target = t.id;
  }
  // Going down to one card: call it with the play. Easy bots sometimes forget and call a beat later.
  if (rest.length === 1 && !(level === 'easy' && roll('late') < EASY_LATE_CALL)) a.callLastCard = true;
  return a;
}

function pickColor(hand: readonly Card[]): CardColor {
  return bestColor(hand);
}

/** Seats in play order from the one after `id` (players still at the table). */
function after(v: CardsView, id: string): CardsPlayerView[] {
  const n = v.players.length;
  const from = v.players.findIndex(p => p.id === id);
  const out: CardsPlayerView[] = [];
  for (let k = 1; k < n; k++) {
    const p = v.players[((from + k * v.direction) % n + n) % n];
    if (!p.left && !p.out) out.push(p);
  }
  return out;
}

function opponents(v: CardsView): CardsPlayerView[] {
  return after(v, v.you!.id);
}

function fewestCards(v: CardsView): CardsPlayerView | undefined {
  return opponents(v).reduce<CardsPlayerView | undefined>((b, p) => (!b || p.cards < b.cards ? p : b), undefined);
}

/** Someone is about to go out (the next player most of all). */
function inDanger(v: CardsView): boolean {
  return opponents(v).some(p => p.cards <= 2);
}

function wild4Legal(v: CardsView, c: Card): boolean {
  if (v.rules.noBluff || v.pendingDraw) return true;
  return !v.you!.hand.some(x => x.id !== c.id && x.color === v.color);
}

/**
 * Higher is better. Dumps points and hurts a player close to winning; keeps
 * Wilds for when they are needed. Chog Chaos: a Purge is worth what it clears,
 * and a big Draw card is saved for someone about to win, or for knocking out a
 * player near the Mercy limit.
 */
function score(v: CardsView, level: CardsBotLevel, c: Card, roll: (s: string | number) => number): number {
  const me = v.you!;
  const opp = opponents(v);
  const next = opp[0];
  const prev = opp.at(-1)!;
  const nextLow = next.cards <= 2;
  const anyLow = opp.some(p => p.cards <= 2);
  const two = opp.length === 1;
  const left = me.hand.length - 1;
  const ofColor = (col: CardColor | null) => me.hand.filter(x => x.id !== c.id && x.color === col).length;
  /** The next player could be pushed over the Mercy limit by `n` more cards. */
  const knockout = (n: number) => v.rules.mercy && next.cards + n >= CARDS_MERCY_LIMIT;

  // Shed points: the winner scores what is left in our hand.
  let s = cardPoints(c) / 2;
  // Stay in a colour we hold plenty of, so the next turn has a play too.
  if (c.color) s += ofColor(c.color) * 3;
  switch (c.kind) {
    case 'draw2': s += nextLow ? 40 : 4; break;
    case 'skip': s += nextLow ? 30 : 2; break;
    case 'reverse':
      if (two) s += nextLow ? 30 : 2;
      else s += nextLow && prev.cards > next.cards ? 25 : 0;
      break;
    case 'wild':
      s += anyLow ? 5 : -30;
      break;
    case 'wild4':
      s += nextLow ? 45 : anyLow ? 10 : -40;
      if (!wild4Legal(v, c)) {
        // Hard bots bluff now and then when it matters; the others play it straight.
        const bluff = level === 'hard' && nextLow && roll(`bluff:${c.id}`) < 30;
        s += bluff ? -10 : -1000;
      }
      break;
    case 'purge': {
      // Everything of its colour goes: the more (and the dearer), the better.
      const gone = me.hand.filter(x => x.id !== c.id && x.color === c.color);
      s += gone.length * 10 + handPoints(gone) / 3 - (gone.length ? 0 : 8);
      break;
    }
    case 'blitz':
      // A free extra turn: best with something to follow it.
      s += (anyLow ? 20 : 6) + (left > 0 && me.hand.some(x => x.id !== c.id && x.color === c.color) ? 6 : 0);
      break;
    case 'wild6':
      s += knockout(6) ? 70 : nextLow ? 50 : anyLow ? 12 : -35;
      break;
    case 'wild10':
      s += knockout(10) ? 80 : nextLow ? 60 : anyLow ? 14 : -45;
      break;
    case 'roulette':
      s += knockout(6) ? 45 : nextLow ? 42 : anyLow ? 8 : -30;
      break;
    case 'number':
      if (v.rules.sevenZero && c.value === 7) {
        const gain = left - Math.min(...opp.map(p => p.cards));
        s += gain > 0 ? gain * 8 : -20;
      }
      if (v.rules.sevenZero && c.value === 0) {
        // Hands move on in the direction of play: ours goes to the next player, the previous one's comes to us.
        s += (left - prev.cards) * 6;
      }
      break;
  }
  // Finishing: a Wild is as good a last card as any.
  if (left <= 1 && isWild(c)) s += 35;
  // A Purge that clears the rest of the hand wins the round.
  if (c.kind === 'purge' && !handAfter(me.hand, c).length) s += 200;
  if (level === 'easy') s += roll(c.id) % 25;
  return s;
}

/**
 * Challenge a Wild Draw Four? It was a bluff if its player held the colour
 * in play before it; the more cards they hold, the likelier that is. A
 * failed challenge costs 6 instead of 4, a successful one costs them 4.
 */
function shouldChallenge(v: CardsView, level: CardsBotLevel, roll: (s: string) => number): boolean {
  const pd = v.pendingDraw!;
  const off = v.players.find(p => p.id === pd.from);
  const n = off?.cards ?? 0;
  if (level === 'easy') return roll('challenge') < 25;
  // Of the cards we cannot see, roughly how many are in that colour?
  const me = v.you!;
  const seen = me.hand.filter(c => c.color === pd.prevColor).length;
  const total = deckSize(v.rules.mode);
  const perColor = v.rules.mode === 'chaos' ? 29 : 25;
  const unseen = Math.max(1, total - me.hand.length - v.discardCount);
  const q = Math.max(0, perColor - seen) / unseen;
  const pHeld = 1 - (1 - q) ** n;
  // Players with a legal choice rarely spend a Draw Four: discount by how often a play is a bluff at all.
  const prior = level === 'hard' ? 0.6 : 0.5;
  if (prior * pHeld > (level === 'hard' ? 0.38 : 0.42)) return true;
  // Someone about to go out: worth a punt.
  return n <= 2 && roll('challenge') < 30;
}
