// The Poker Daily's hands (shared/poker/daily.ts): each one is dealt from a
// seed, and graded by expected value (EV) in big blinds. Server only: the
// seeds are secret, and so are the answers until a hand is answered.
//
// The model, kept simple enough to explain on the reveal:
//  - The villain's range is a share of starting hands, best first by the Chen
//    formula (shared/poker/hands.ts): wider from later seats. After the flop he
//    bets his strongest hands and some bluffs (draws first, then air); on the
//    river at the balanced rate bet / (pot + bet).
//  - Your equity is your share of the pot against every hand in that range:
//    exact with one card or none to come, sampled (seeded) before that.
//  - Fold is 0. Call: you win your equity of the final pot, and the rest of the
//    hand is checked down. Raise: he keeps calling with his best hands, as
//    often as a sound player must (minimum defence: pot / (pot + raise)), and
//    folds the rest; he never re-raises. Called, it is checked down again.
//  - Every move's points come from its EV next to the best one (scoreMove).
import {
  ALL_COMBOS, CAT, cardCode, comboClass, cardText, categoryOf, drawScore, evaluate, handName, topRange,
  type Card, type Combo,
} from '../../../shared/poker/hands.ts';
import { blocked, equityByCombo, equityVsRange, makeRng, meanEquity, pick, shuffle } from '../../../shared/poker/equity.ts';
import {
  POKER_DAILY_HANDS, scoreMove,
  type PokerMove, type PokerOption, type PokerPos, type PokerReveal, type PokerSpot, type PokerStreet,
} from '../../../shared/poker/daily.ts';

/** What the reveal shows, worked out with the hand: never sent before it is answered. */
export type SpotAnswer = Pick<PokerReveal, 'best' | 'options' | 'equity' | 'needed' | 'range' | 'combos'>;

export interface DealtSpot {
  spot: PokerSpot;
  answer: SpotAnswer;
}

type Kind = 'shove' | 'reshove' | Exclude<PokerStreet, 'preflop'>;
/** The day's ten hands: two before the flop, then three flops, three turns and two rivers. */
export const DAY_PLAN: readonly Kind[] = ['shove', 'reshove', 'flop', 'flop', 'flop', 'turn', 'turn', 'turn', 'river', 'river'];

/** The share of hands each seat opens with. */
const OPEN: Record<PokerPos, number> = { UTG: 0.15, HJ: 0.19, CO: 0.26, BTN: 0.42, SB: 0.36, BB: 0 };
/** Before the flop, short: the share each seat goes all-in with at 12 bb (wider when shorter). */
const SHOVE: Partial<Record<PokerPos, number>> = { HJ: 0.2, CO: 0.28, BTN: 0.4, SB: 0.55 };
/** After the flop: the strongest share of his range he bets for value, by street. */
const VALUE: Record<'flop' | 'turn' | 'river', number> = { flop: 0.45, turn: 0.45, river: 0.4 };
/** Bluffs per value bet before the river (the river's is bet / (pot + bet)). */
const BLUFFS: Record<'flop' | 'turn', number> = { flop: 0.75, turn: 0.55 };
/** His bet sizes, as shares of the pot. */
const SIZES: Record<'flop' | 'turn' | 'river', number[]> = {
  flop: [1 / 3, 1 / 2, 2 / 3],
  turn: [1 / 2, 2 / 3, 3 / 4],
  river: [1 / 2, 2 / 3, 1, 1.25],
};
const SIZE_TEXT = (f: number) => (Math.abs(f - 1) < 1e-9 ? 'pot' : Math.abs(f - 1.25) < 1e-9 ? '1¼ pot' : f < 0.34 ? '1/3 pot' : f < 0.51 ? '1/2 pot' : f < 0.67 ? '2/3 pot' : '3/4 pot');

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
/** 2.5, 13, 4.3 */
export const bb = (x: number) => String(r1(x));
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A decision before it is graded: the table, the range and what it costs. */
interface Table {
  kind: Kind;
  street: PokerStreet;
  heroPos: PokerPos;
  villainPos: PokerPos;
  board: Card[];
  /** In the pot from earlier streets and from players who folded. */
  potBefore: number;
  /** His total on this street (the bet you face). */
  villainIn: number;
  /** Yours on this street so far (a blind). */
  heroIn: number;
  /** Behind, after what each has put in. */
  heroBehind: number;
  villainBehind: number;
  history: string[];
  facing: string;
  range: Combo[];
  rangeText: string;
  /** The raises on offer, as street totals. */
  raises: { to: number; allin: boolean }[];
  /** No call on offer (short stack: all-in or fold). */
  noCall?: boolean;
}

const streetOf = (k: Kind): PokerStreet => (k === 'shove' || k === 'reshove' ? 'preflop' : k);
const boardLen = (s: PokerStreet) => ({ preflop: 0, flop: 3, turn: 4, river: 5 })[s];

function dealBoard(rng: () => number): Card[] {
  const deck = shuffle(rng, Array.from({ length: 52 }, (_, i) => i));
  return deck.slice(0, 5);
}

/** A hand's strength on a board: its made hand, a strong draw counted a level up (flop and turn). */
function strength(c: Combo, board: Card[]): number {
  const s = evaluate([c[0], c[1], ...board]);
  if (board.length < 5 && drawScore(c, board) >= 2 && categoryOf(s) <= CAT.PAIR) return s + (1 << 20);
  return s;
}

/** The hands in `range` he bets on this street: his strongest, and some bluffs. */
function betRange(range: Combo[], board: Card[], street: 'flop' | 'turn' | 'river', bet: number, pot: number): Combo[] {
  const dead = new Set(board);
  const live = range.filter(c => !blocked(c, dead)).map(c => ({ c, s: evaluate([c[0], c[1], ...board]), d: drawScore(c, board) }));
  live.sort((a, b) => b.s - a.s);
  const valueN = Math.round(live.length * VALUE[street]);
  const rest = live.slice(valueN);
  const ratio = street === 'river' ? bet / (pot + bet) : BLUFFS[street];
  const bluffN = Math.min(rest.length, Math.round(valueN * ratio));
  // The river bluffs with the hands that cannot win at showdown; earlier, draws come first.
  const bluffs = street === 'river' ? rest.slice(rest.length - bluffN) : [...rest].sort((a, b) => b.d - a.d || a.s - b.s).slice(0, bluffN);
  return [...live.slice(0, valueN), ...bluffs].map(x => x.c);
}

function boardText(cards: Card[]): string {
  return cards.map(cardText).join(' ');
}

/** Before the flop: he goes all-in, you are in the big blind. Fold or call. */
function shoveTable(rng: () => number): Table {
  const villainPos = (['HJ', 'CO', 'BTN', 'SB'] as const)[pick(rng, 4)];
  const stack = [8, 10, 12, 14, 16, 18, 20][pick(rng, 7)];
  const share = Math.min(0.75, Math.max(0.1, SHOVE[villainPos]! * Math.sqrt(12 / stack)));
  return {
    kind: 'shove', street: 'preflop', heroPos: 'BB', villainPos, board: [],
    potBefore: villainPos === 'SB' ? 0 : 0.5, villainIn: stack, heroIn: 1, heroBehind: stack - 1, villainBehind: 0,
    history: [`Blinds 0.5/1. You are in the big blind, ${stack} bb deep.`, `Everyone folds to Villain (${villainPos}).`],
    facing: `Villain goes all-in for ${stack}`,
    range: topRange(share),
    rangeText: `He goes all-in with his best ${pct(share)} of hands from the ${villainPos}.`,
    raises: [],
  };
}

/** Before the flop: he opens, you are short. All-in or fold. */
function reshoveTable(rng: () => number): Table {
  const villainPos = (['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const)[pick(rng, 5)];
  const order: PokerPos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const after = order.slice(order.indexOf(villainPos) + 1);
  const heroPos = after[pick(rng, after.length)];
  const stack = [10, 12, 14, 16, 18, 20, 22][pick(rng, 7)];
  const open = villainPos === 'SB' ? 3 : villainPos === 'BTN' || villainPos === 'CO' ? 2.2 : 2.5;
  const heroIn = heroPos === 'SB' ? 0.5 : heroPos === 'BB' ? 1 : 0;
  const dead = (heroPos !== 'SB' && villainPos !== 'SB' ? 0.5 : 0) + (heroPos !== 'BB' ? 1 : 0);
  const share = OPEN[villainPos];
  const seat = heroPos === 'BB' ? 'in the big blind' : heroPos === 'SB' ? 'in the small blind' : `on the ${heroPos}`;
  return {
    kind: 'reshove', street: 'preflop', heroPos, villainPos, board: [],
    potBefore: dead, villainIn: open, heroIn, heroBehind: stack - heroIn, villainBehind: 100 - open,
    history: [`Blinds 0.5/1. You are ${seat} with ${stack} bb, short. He has 100.`, `Villain (${villainPos}) raises to ${bb(open)}.`],
    facing: `Villain raises to ${bb(open)}`,
    range: topRange(share),
    rangeText: `He opens his best ${pct(share)} of hands from the ${villainPos}. Against an all-in he calls with the hands that win often enough against a typical one (the best ${pct(SHOVE_RANGE)} of hands).`,
    raises: [{ to: stack, allin: true }],
    noCall: true,
  };
}

/** After the flop: he opened, you called, and he bets on every street up to this one. */
function postflopTable(rng: () => number, street: 'flop' | 'turn' | 'river'): Table {
  const pairs: [PokerPos, PokerPos][] = [['UTG', 'BTN'], ['HJ', 'BTN'], ['CO', 'BTN'], ['CO', 'BB'], ['BTN', 'BB'], ['SB', 'BB']];
  const [villainPos, heroPos] = pairs[pick(rng, pairs.length)];
  const stack = [60, 80, 100, 100, 100, 125, 150][pick(rng, 7)];
  const open = villainPos === 'SB' ? 3 : 2.5;
  const heroIP = heroPos === 'BTN' || villainPos === 'SB';
  const dead = heroPos === 'BTN' ? 1.5 : villainPos === 'SB' ? 0 : 0.5;
  let pot = 2 * open + dead;
  let behind = stack - open;
  const share = OPEN[villainPos];
  let range = topRange(share);
  const board = dealBoard(rng);
  const history = [
    `Blinds 0.5/1, ${stack} bb each.`,
    `Villain (${villainPos}) raises to ${bb(open)}, you call ${heroPos === 'BB' ? 'in the big blind' : `on the ${heroPos}`}.`,
  ];
  const streets = (['flop', 'turn', 'river'] as const).slice(0, ['flop', 'turn', 'river'].indexOf(street) + 1);
  let facing = '';
  let bet = 0;
  let potBefore = pot;
  for (const s of streets) {
    const cards = board.slice(0, boardLen(s));
    const sizes = SIZES[s];
    const f = sizes[pick(rng, sizes.length)];
    bet = Math.min(behind, Math.max(1, r1(f * pot)));
    range = betRange(range, cards, s, bet, pot);
    const shown = s === 'flop' ? boardText(cards) : cardText(cards[cards.length - 1]);
    const label = s[0].toUpperCase() + s.slice(1);
    const bets = bet >= behind ? `goes all-in for ${bb(bet)}` : `bets ${bb(bet)} (${SIZE_TEXT(f)})`;
    if (s === street) {
      history.push(`${label} ${shown}${heroIP ? '' : ': you check'}.`);
      facing = `Villain ${bets}`;
      potBefore = pot;
    } else {
      history.push(`${label} ${shown}: ${heroIP ? '' : 'you check, '}Villain ${bets}, you call.`);
      pot += 2 * bet;
      behind -= bet;
    }
  }
  const raises: Table['raises'] = [];
  if (bet < behind) {
    const to = Math.round(bet * 3 * 2) / 2;
    if (to < behind * 0.6) raises.push({ to, allin: false });
    if (!raises.length || behind <= 3 * (potBefore + 2 * bet)) raises.push({ to: behind, allin: true });
  }
  const streetsBet = streets.length === 1 ? 'bets his strongest hands and some bluffs here' : 'keeps betting his strongest hands and some bluffs';
  return {
    kind: street, street, heroPos, villainPos, board: board.slice(0, boardLen(street)),
    potBefore, villainIn: bet, heroIn: 0, heroBehind: behind, villainBehind: behind - bet,
    history, facing, range,
    rangeText: `He opens his best ${pct(share)} of hands from the ${villainPos}, then ${streetsBet}.`,
    raises,
  };
}

/** What he expects your all-in before the flop to hold: the best 20% of hands. */
const SHOVE_RANGE = 0.2;
let vsShove: Map<string, number> | null = null;
/** A starting hand's equity against a typical all-in (SHOVE_RANGE), by its class; worked out once. */
function equityVsShove(c: Combo): number {
  if (!vsShove) {
    vsShove = new Map();
    const rng = makeRng('vs-shove');
    const shoves = topRange(SHOVE_RANGE);
    for (const x of ALL_COMBOS) {
      const k = comboClass(x);
      if (!vsShove.has(k)) vsShove.set(k, equityVsRange(x, [], shoves, rng, { samples: 3000 }));
    }
  }
  return vsShove.get(comboClass(c))!;
}

/** The hands you might hold here: plausible for how you played it so far. */
function heroCandidates(rng: () => number, t: Table): Combo[] {
  const dead = new Set(t.board);
  let pool: readonly Combo[];
  if (t.kind === 'shove') pool = ALL_COMBOS;
  else if (t.kind === 'reshove') pool = topRange(0.7);
  else {
    // You called the raise: not your very best hands (they raise), nor the worst.
    pool = t.heroPos === 'BTN' ? topRange(0.38).slice(Math.round(1326 * 0.03)) : topRange(0.6).slice(Math.round(1326 * 0.04));
  }
  const ok = (c: Combo) => {
    if (blocked(c, dead)) return false;
    // Calling a bet on an earlier street: you had a pair or better, or a draw.
    // (A pair on the board alone is no reason to call.)
    for (let n = 3; n < t.board.length; n++) {
      const b = t.board.slice(0, n);
      if (drawScore(c, b) > 0) continue;
      const cat = categoryOf(evaluate([c[0], c[1], ...b]));
      if (cat < CAT.PAIR || (cat === CAT.PAIR && boardPairOnly(c, b))) return false;
    }
    return true;
  };
  return shuffle(rng, pool.filter(ok)).slice(0, 60);
}

/** The only pair is on the board (the hand's own cards play no part in it). */
function boardPairOnly(c: Combo, board: Card[]): boolean {
  const ranks = board.map(x => x >> 2);
  const own = [c[0] >> 2, c[1] >> 2];
  if (own[0] === own[1]) return false;
  return !own.some(r => ranks.includes(r));
}

interface Graded {
  hero: Combo;
  answer: SpotAnswer;
  options: PokerOption[];
  gap: number;
  bestKind: PokerMove;
}

/** Every option's EV for `hero` at table `t`. */
function grade(t: Table, hero: Combo, rng: () => number, samples: number): Graded {
  const eq = equityByCombo(hero, t.board, t.range, rng, { samples });
  const equity = meanEquity(eq);
  const potNow = t.potBefore + t.villainIn + t.heroIn;
  const toCall = Math.min(t.villainIn - t.heroIn, t.heroBehind);
  const dead = new Set([...hero, ...t.board]);
  // His hands, strongest first, for when he faces a raise.
  // (Before the flop the range is already best first.)
  const live = t.range.map((c, i) => ({ i, k: t.board.length ? strength(c, t.board) : -i })).filter(x => !blocked(t.range[x.i], dead));
  live.sort((a, b) => b.k - a.k);

  const opts: (PokerOption & { ev: number; foldPct?: number; eqCalled?: number })[] = [{ id: 'fold', kind: 'fold', label: 'Fold', add: 0, ev: 0 }];
  if (!t.noCall) {
    const final = t.potBefore + 2 * t.villainIn;
    opts.push({ id: 'call', kind: 'call', label: `Call ${bb(toCall)}`, add: r1(toCall), ev: equity * final - toCall });
  }
  for (const r of t.raises) {
    let kept: Set<number>;
    if (t.kind === 'reshove') {
      // Your all-in before the flop: he calls with every hand that wins often enough against a typical one.
      const need = (r.to - t.villainIn) / (t.potBefore + 2 * r.to);
      kept = new Set(live.filter(x => equityVsShove(t.range[x.i]) >= need).map(x => x.i));
    } else {
      // Minimum defence: he calls often enough that the raise cannot profit with any two cards.
      const defend = Math.min(1, (t.potBefore + 2 * t.villainIn) / (t.potBefore + t.villainIn + r.to));
      kept = new Set(live.slice(0, Math.max(1, Math.ceil(defend * live.length))).map(x => x.i));
    }
    const keep = kept.size;
    const eqCalled = keep ? meanEquity(eq, i => kept.has(i)) : 0;
    const fold = 1 - keep / live.length;
    const add = r.to - t.heroIn;
    const ev = fold * potNow + (1 - fold) * (eqCalled * (t.potBefore + 2 * r.to) - add);
    opts.push({
      id: r.allin ? 'allin' : 'raise', kind: r.allin ? 'allin' : 'raise',
      label: r.allin ? `All-in ${bb(r.to)}` : `Raise to ${bb(r.to)}`, add: r1(add), ev, foldPct: fold, eqCalled,
    });
  }
  const evs = opts.map(o => o.ev);
  const sorted = [...evs].sort((a, b) => b - a);
  const best = opts.find(o => o.ev === sorted[0])!;
  return {
    hero,
    options: opts.map(({ id, kind, label, add }) => ({ id, kind, label, add })),
    gap: sorted[0] - (sorted[1] ?? -Infinity),
    bestKind: best.kind,
    answer: {
      best: best.id,
      options: opts.map(o => ({
        id: o.id, label: o.label, ev: r2(o.ev), points: scoreMove(o.ev, evs),
        ...(o.foldPct !== undefined && { foldPct: r2(o.foldPct), eqCalled: r2(o.eqCalled!) }),
      })),
      equity: r2(equity),
      needed: toCall > 0 ? r2(toCall / (potNow + toCall)) : 0,
      range: t.rangeText,
      combos: live.length,
    },
  };
}

/** A hand worth asking: a clear best move, but not an obvious one; neither hopeless nor a lock. */
function interesting(g: Graded, t: Table, minGap: number): boolean {
  const potNow = t.potBefore + t.villainIn + t.heroIn;
  return g.gap >= minGap && g.gap <= Math.max(1.2, 0.3 * potNow) && g.answer.equity >= 0.12 && g.answer.equity <= 0.92;
}

/** Monte Carlo runouts for the final grade (before the turn); exact after. */
const FINAL_SAMPLES = 24_000;
const QUICK_SAMPLES = 1_200;
/** Tables tried, and hands tried at each, before settling for the clearest hand seen. */
const TABLES = 8;
const HANDS_PER_TABLE = 30;

function toSpot(t: Table, g: Graded, index: number, total: number): PokerSpot {
  const made = t.board.length ? handName(evaluate([g.hero[0], g.hero[1], ...t.board])) : g.hero[0] >> 2 === g.hero[1] >> 2 ? 'Pair' : 'High card';
  const hole = [...g.hero].sort((a, b) => b - a).map(cardCode) as [string, string];
  return {
    index, total, street: t.street, hole, board: t.board.map(cardCode),
    you: { pos: t.heroPos, stack: r1(t.heroBehind) },
    villain: { pos: t.villainPos, stack: r1(t.villainBehind) },
    pot: r1(t.potBefore + t.villainIn + t.heroIn),
    toCall: r1(Math.min(t.villainIn - t.heroIn, t.heroBehind)),
    history: t.history,
    facing: t.facing,
    made,
    options: g.options,
  };
}

/**
 * Hand `index` of the run seeded by `seed`, aiming for `target` as its best move
 * (so a day mixes folds, calls and raises). The same seed and index always deal
 * and grade the same hand. A generator: it yields after every hand it tries, so
 * the server can deal without holding everything else up (dealSpotAsync).
 */
export function* dealSpotSteps(seed: string, index: number, kind: Kind, target: PokerMove | null, total = POKER_DAILY_HANDS): Generator<void, DealtSpot> {
  const rng = makeRng(`${seed}:spot:${index}`);
  const eqRng = makeRng(`${seed}:eq:${index}`);
  const exact = boardLen(streetOf(kind)) >= 4;
  let fallback: { t: Table; g: Graded } | null = null;
  for (let attempt = 0; attempt < TABLES; attempt++) {
    const t = kind === 'shove' ? shoveTable(rng) : kind === 'reshove' ? reshoveTable(rng) : postflopTable(rng, kind as 'flop' | 'turn' | 'river');
    // The aimed-for move for most tries, then any good hand.
    const wantTarget = attempt < TABLES - 2 && target;
    for (const hero of heroCandidates(rng, t).slice(0, HANDS_PER_TABLE)) {
      const quick = grade(t, hero, eqRng, exact ? 0 : QUICK_SAMPLES);
      yield;
      const matches = !wantTarget || quick.bestKind === target || (target === 'raise' && quick.bestKind === 'allin');
      if (!interesting(quick, t, 0.4) || !matches) {
        if (!fallback || (!interesting(fallback.g, fallback.t, 0.25) && interesting(quick, t, 0.25))) fallback = { t, g: quick };
        continue;
      }
      const g = exact ? quick : grade(t, hero, eqRng, FINAL_SAMPLES);
      yield;
      if (g.bestKind === quick.bestKind && interesting(g, t, 0.25)) return { spot: toSpot(t, g, index, total), answer: g.answer };
    }
  }
  // Nothing fit (rare): the best hand seen, graded properly.
  const { t, g: q } = fallback!;
  const g = exact ? q : grade(t, q.hero, eqRng, FINAL_SAMPLES);
  return { spot: toSpot(t, g, index, total), answer: g.answer };
}

/** The best moves a day aims for, hand by hand: a mix, in a seeded order. */
export function dayTargets(seed: string): (PokerMove | null)[] {
  const rng = makeRng(`${seed}:targets`);
  const post = shuffle(rng, ['fold', 'fold', 'call', 'call', 'call', 'raise', 'raise', (['fold', 'call', 'raise'] as const)[pick(rng, 3)]] as PokerMove[]);
  return [pick(rng, 2) ? 'call' : 'fold', pick(rng, 2) ? 'allin' : 'fold', ...post];
}

/** Hand `index` of the day (or a practice run) seeded by `seed`, all at once. */
export function daySpot(seed: string, index: number): DealtSpot {
  const steps = dealSpotSteps(seed, index, DAY_PLAN[index], dayTargets(seed)[index]);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** The same hand, dealt a step at a time with the event loop let through in between. */
export async function daySpotAsync(seed: string, index: number): Promise<DealtSpot> {
  const steps = dealSpotSteps(seed, index, DAY_PLAN[index], dayTargets(seed)[index]);
  let last = Date.now();
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
    // Let sockets and requests through every ~15 ms of dealing.
    if (Date.now() - last > 15) {
      await new Promise<void>(res => setImmediate(res));
      last = Date.now();
    }
  }
}
