import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Game, type GameSnapshot } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { DEFAULT_RULES, resolveTheme, type RuleConfig } from '../../shared/themes.ts';
import { WHEEL_SEGMENTS, type MinigameKind, type MinigameMove } from '../../shared/minigames.ts';
import { DUEL_MS, DUEL_PRIZE, type DuelState } from '../src/engine/minigames/diceDuel.ts';
import { HIGHLOW_MAX, HIGHLOW_START, HIGHLOW_STEP_MS, type HighLowState } from '../src/engine/minigames/highLow.ts';
import { REACTION_PRIZE, REACTION_WINDOW_MS, type ReactionState } from '../src/engine/minigames/reaction.ts';
import { MATH_MS, MATH_PRIZE, makeQuestion, type MathState } from '../src/engine/minigames/quickMath.ts';
import { pickSegment, type WheelState } from '../src/engine/minigames/wheel.ts';
import { seeded } from './helpers.ts';

/** A game with a scripted rng (queue of raw values) and a hand-cranked clock. */
function setup(o: { n?: number; rules?: Partial<RuleConfig>; map?: string; enabled?: boolean } = {}) {
  const queue: number[] = [];
  let clock = 1_000_000;
  let enabled = o.enabled ?? true;
  const g = new Game({
    theme: resolveTheme('classic', o.map ?? 'speed'),
    rules: { ...DEFAULT_RULES, ...o.rules },
    players: Array.from({ length: o.n ?? 2 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, character: 'spiky' as const, color: '#fff', isBot: false,
    })),
    rng: k => (queue.length ? queue.shift()! % k : 0),
    now: () => clock,
    minigamesEnabled: () => enabled,
  });
  return {
    g,
    queue,
    tick(ms: number) { clock += ms; },
    get clock() { return clock; },
    setEnabled(v: boolean) { enabled = v; },
    move(id: string, move: MinigameMove) { g.apply(id, { type: 'minigame', move }); },
    /** Start a specific game for `host` as if they had just landed on an arcade. */
    start<S>(kind: MinigameKind, host = 'p0'): S {
      g.phase = 'done';
      g['startMinigame'](g.player(host), kind);
      return g.minigame!.data as S;
    },
    /** Skip the result screen. */
    closeResult() {
      assert.equal(g.minigame?.stage, 'result');
      clock += 10_000;
      assert.equal(g.minigameTimeout(), true);
      assert.equal(g.minigame, null);
    },
  };
}

const viewJson = (g: Game) => JSON.stringify(g.view());

// ---- triggers ----------------------------------------------------------------

test('landing on an arcade starts a mini-game and pauses the turn', () => {
  const { g, queue, move } = setup();
  queue.push(0, 4, 4); // dice 1 + 5 → space 6 (Arcade); then game #4 = wheel
  g.apply('p0', { type: 'roll' });
  assert.equal(g.spaces[g.player('p0').position].kind, 'arcade');
  assert.equal(g.phase, 'minigame');
  assert.equal(g.minigame?.kind, 'wheel');
  assert.equal(g.view().minigame?.kind, 'wheel');
  assert.ok(g.log.some(l => l.text.includes('Wheel Spin')));
  // Turn actions wait, like during an auction.
  assert.throws(() => g.apply('p0', { type: 'endTurn' }), /Can't do that now/);
  assert.throws(() => g.apply('p0', { type: 'roll' }), /Can't do that now/);
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.throws(() => g.apply('p0', { type: 'mortgage', space: 1 }), /mini-game/);
  assert.throws(() => move('p1', { kind: 'spin' }), /not playing/);
  assert.throws(() => move('p0', { kind: 'roll' }), /Spin/);
});

test('house rule off, or the site switch off: arcades do nothing', () => {
  for (const o of [{ rules: { minigames: false } }, { enabled: false }]) {
    const { g, queue } = setup(o);
    queue.push(0, 4);
    g.apply('p0', { type: 'roll' });
    assert.equal(g.player('p0').position, 6);
    assert.equal(g.phase, 'done');
    assert.equal(g.minigame, null);
  }
  // The site switch is read live: flipping it mid-game stops the next round.
  const s = setup();
  s.setEnabled(false);
  s.queue.push(0, 4);
  s.g.apply('p0', { type: 'roll' });
  assert.equal(s.g.phase, 'done');
});

test('arcadeParking makes Free Parking an arcade on Classic', () => {
  const { g, queue } = setup({ map: 'classic', rules: { arcadeParking: true } });
  g.player('p0').position = 17;
  queue.push(0, 1); // 1 + 2 → 20, Free Parking
  g.apply('p0', { type: 'roll' });
  assert.equal(g.phase, 'minigame');
  const off = setup({ map: 'classic' });
  off.g.player('p0').position = 17;
  off.queue.push(0, 1);
  off.g.apply('p0', { type: 'roll' });
  assert.equal(off.g.phase, 'done');
});

test('after the round, doubles still earn the extra roll', () => {
  const { g, queue, move, closeResult } = setup();
  g.player('p0').position = 2;
  queue.push(1, 1, 4); // 2 + 2 (doubles) → space 6, the arcade; game #4 = wheel
  g.apply('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 6);
  assert.equal(g.phase, 'minigame');
  assert.equal(g.extraRoll, true);
  move('p0', { kind: 'spin' });
  assert.equal(g.minigame?.stage, 'result');
  closeResult();
  assert.equal(g.phase, 'roll');
  assert.equal(g.current.id, 'p0');
});

// ---- Dice Duel -----------------------------------------------------------------

test('dice duel: higher total wins the prize, then the lander continues', () => {
  const { g, queue, move, start } = setup({ n: 3 });
  queue.push(1); // opponent: others[1] = p2
  const s = start<DuelState>('diceDuel');
  assert.equal(s.opponent, 'p2');
  assert.throws(() => move('p1', { kind: 'roll' }), /not playing/);
  queue.push(5, 5); // p0 rolls 6 + 6
  move('p0', { kind: 'roll' });
  assert.throws(() => move('p0', { kind: 'roll' }), /already rolled/);
  const mid = g.view().minigame!;
  assert.ok(mid.kind === 'diceDuel');
  assert.deepEqual(mid.rolls, { p0: [6, 6] });
  assert.deepEqual(mid.players, ['p0', 'p2']);
  queue.push(0, 0); // p2 rolls 1 + 1
  move('p2', { kind: 'roll' });
  assert.equal(g.minigame?.stage, 'result');
  assert.equal(g.player('p0').cash, 1500 + DUEL_PRIZE);
  assert.equal(g.player('p2').cash, 1500);
  assert.deepEqual(g.minigame?.result?.payouts, [{ player: 'p0', amount: DUEL_PRIZE }]);
  assert.ok(g.log.some(l => l.text.includes('P0 12 vs P2 2')));
  assert.throws(() => move('p2', { kind: 'continue' }), /Waiting for P0/);
  move('p0', { kind: 'continue' });
  assert.equal(g.minigame, null);
  assert.equal(g.phase, 'done');
});

test('dice duel: ties split; the clock rolls for whoever stalls', () => {
  const { g, queue, move, start, tick } = setup();
  start<DuelState>('diceDuel');
  queue.push(2, 3); // p0: 3 + 4
  move('p0', { kind: 'roll' });
  tick(DUEL_MS - 1);
  assert.equal(g.minigameTimeout(), false);
  tick(1);
  queue.push(4, 1); // auto-roll for p1: 5 + 2
  assert.equal(g.minigameTimeout(), true);
  assert.equal(g.minigame?.stage, 'result');
  assert.equal(g.player('p0').cash, 1500 + DUEL_PRIZE / 2);
  assert.equal(g.player('p1').cash, 1500 + DUEL_PRIZE / 2);
});

// ---- High or Low ---------------------------------------------------------------

test('high or low: right guesses double, cash out banks, deck stays hidden', () => {
  const { g, move, start } = setup();
  const s = start<HighLowState>('highLow');
  assert.equal(s.deck.length, 51);
  // Stack the deck: showing a 5, then a 9 (higher), then a 2 (lower).
  s.cards = [4];
  s.deck = [1, 8];
  const v = g.view().minigame!;
  assert.ok(v.kind === 'highLow');
  assert.deepEqual(v.cards, [4]);
  assert.equal(v.prize, HIGHLOW_START);
  assert.ok(!('deck' in v), 'the rest of the deck is never sent');
  assert.ok(!viewJson(g).includes('"deck"'));
  move('p0', { kind: 'higher' });
  assert.equal(s.prize, HIGHLOW_START * 2);
  move('p0', { kind: 'lower' });
  assert.equal(s.prize, HIGHLOW_START * 4);
  move('p0', { kind: 'cashOut' });
  assert.equal(g.minigame?.stage, 'result');
  assert.equal(g.player('p0').cash, 1500 + HIGHLOW_START * 4);
  assert.throws(() => move('p0', { kind: 'higher' }), /over/);
});

test('high or low: a wrong guess loses it all; same rank counts as right', () => {
  const { g, move, start } = setup();
  const s = start<HighLowState>('highLow');
  s.cards = [6]; // a 7
  s.deck = [2, 19]; // next: another 7 (tie), then a 3
  move('p0', { kind: 'higher' });
  assert.equal(s.prize, 100);
  move('p0', { kind: 'higher' });
  assert.equal(g.minigame?.stage, 'result');
  assert.equal(g.player('p0').cash, 1500);
  assert.deepEqual(g.minigame?.result?.payouts, []);
  const v = g.view().minigame!;
  assert.ok(v.kind === 'highLow' && v.outcome === 'bust');
});

test('high or low: capped prize auto-banks; running out of time cashes out', () => {
  const a = setup();
  const s = a.start<HighLowState>('highLow');
  s.cards = [0]; // ace: everything is higher or equal
  s.deck = [8, 7, 6, 5]; // drawn from the end: 6, 7, 8
  for (let i = 0; i < 3; i++) a.move('p0', { kind: 'higher' });
  assert.equal(s.prize, HIGHLOW_MAX);
  assert.equal(a.g.minigame?.stage, 'result');
  assert.equal(a.g.player('p0').cash, 1500 + HIGHLOW_MAX);

  const b = setup();
  b.start<HighLowState>('highLow');
  b.tick(HIGHLOW_STEP_MS);
  assert.equal(b.g.minigameTimeout(), true);
  assert.equal(b.g.player('p0').cash, 1500 + HIGHLOW_START);
});

// ---- Reaction Race ------------------------------------------------------------

test('reaction race: GO time is secret, early taps are out, first tap after GO wins', () => {
  const { g, move, start, tick, clock, queue } = setup({ n: 3 });
  queue.push(1000); // wait 1.5 s + 1000 ms
  const s = start<ReactionState>('reaction');
  assert.equal(s.goAt, clock + 2_500);
  const before = g.view().minigame!;
  assert.equal(before.endsAt, null, 'no countdown that would reveal GO');
  assert.ok(!viewJson(g).includes(String(s.goAt)), 'GO time never leaves the server');
  assert.deepEqual(before.players, ['p0', 'p1', 'p2']);
  move('p1', { kind: 'tap' }); // jumped the gun
  assert.throws(() => move('p1', { kind: 'tap' }), /jumped the gun/);
  tick(2_500);
  assert.equal(g.minigameTimeout(), true); // GO!
  const go = g.view().minigame!;
  assert.ok(go.kind === 'reaction' && go.go);
  assert.equal(go.endsAt, s.goAt + REACTION_WINDOW_MS);
  tick(240);
  move('p2', { kind: 'tap' });
  assert.equal(g.minigame?.stage, 'result');
  assert.equal(s.winnerMs, 240);
  assert.equal(g.player('p2').cash, 1500 + REACTION_PRIZE);
  assert.equal(g.player('p1').cash, 1500);
});

test('reaction race: a tap that beats the GO broadcast still counts; all early ends it', () => {
  const a = setup();
  const s = a.start<ReactionState>('reaction');
  a.tick(s.goAt - a.clock); // exactly GO, timer not fired yet
  a.move('p1', { kind: 'tap' });
  assert.equal(s.winner, 'p1');

  const b = setup();
  b.start<ReactionState>('reaction');
  b.move('p0', { kind: 'tap' });
  b.move('p1', { kind: 'tap' });
  assert.equal(b.g.minigame?.stage, 'result');
  assert.deepEqual(b.g.minigame?.result?.payouts, []);

  const c = setup();
  const t = c.start<ReactionState>('reaction');
  c.tick(t.goAt - c.clock);
  c.g.minigameTimeout();
  c.tick(REACTION_WINDOW_MS);
  c.g.minigameTimeout();
  assert.match(c.g.minigame!.result!.headline, /Nobody tapped/);
});

// ---- Quick Math ---------------------------------------------------------------

test('quick math: answer hidden until decided, wrong locks out, first right wins', () => {
  const { g, move, start } = setup({ n: 3 });
  const s = start<MathState>('quickMath');
  assert.equal(s.options.length, 4);
  assert.equal(new Set(s.options).size, 4);
  assert.ok(s.options.includes(s.answer));
  const v = g.view().minigame!;
  assert.ok(v.kind === 'quickMath' && v.answer === null);
  const wrong = s.options.find(x => x !== s.answer)!;
  move('p1', { kind: 'answer', value: wrong });
  assert.throws(() => move('p1', { kind: 'answer', value: s.answer }), /locked out/);
  assert.throws(() => move('p2', { kind: 'answer', value: Number.NaN }), /Bad answer/);
  move('p2', { kind: 'answer', value: s.answer });
  assert.equal(g.player('p2').cash, 1500 + MATH_PRIZE);
  const after = g.view().minigame!;
  assert.ok(after.kind === 'quickMath' && after.answer === s.answer && after.winner === 'p2');
});

test('quick math: nobody right in time pays nothing', () => {
  const { g, start, tick } = setup();
  start<MathState>('quickMath');
  tick(MATH_MS);
  assert.equal(g.minigameTimeout(), true);
  assert.match(g.minigame!.result!.headline, /Nobody got it/);
  assert.equal(g.player('p0').cash + g.player('p1').cash, 3000);
});

test('quick math questions are always well-formed', () => {
  const rng = seeded(7);
  for (let i = 0; i < 2000; i++) {
    const q = makeQuestion(rng);
    assert.equal(q.options.length, 4);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.options.every(x => Number.isInteger(x) && x > 0));
    assert.ok(q.options.includes(q.answer));
  }
});

// ---- Wheel Spin -----------------------------------------------------------------

test('wheel: weighted pick, cash prizes, a loss paid to the pot, jail card', () => {
  // Weighted pick walks the segments in order.
  assert.equal(pickSegment(() => 0), 0);
  const total = WHEEL_SEGMENTS.reduce((a, s) => a + s.weight, 0);
  assert.equal(pickSegment(() => total - 1), WHEEL_SEGMENTS.length - 1);

  const seg = (pred: (s: typeof WHEEL_SEGMENTS[number]) => boolean) => WHEEL_SEGMENTS.findIndex(pred);
  const rollFor = (i: number) => WHEEL_SEGMENTS.slice(0, i).reduce((a, s) => a + s.weight, 0);

  const win = setup();
  const w = win.start<WheelState>('wheel');
  assert.equal(win.g.view().minigame!.kind === 'wheel' && (win.g.view().minigame as { segment: number | null }).segment, null);
  win.queue.push(rollFor(seg(s => s.amount === 100)));
  win.move('p0', { kind: 'spin' });
  assert.equal(WHEEL_SEGMENTS[w.segment!].amount, 100);
  assert.equal(win.g.player('p0').cash, 1600);
  assert.throws(() => win.move('p0', { kind: 'spin' }), /over/);

  const lose = setup({ rules: { freeParkingPot: true } });
  lose.start<WheelState>('wheel');
  lose.queue.push(rollFor(seg(s => s.amount < 0)));
  lose.move('p0', { kind: 'spin' });
  assert.equal(lose.g.player('p0').cash, 1450);
  assert.equal(lose.g.pot, 50);

  // Can't cover the loss: it becomes a debt like any other bank payment.
  const broke = setup();
  broke.g.player('p0').cash = 20;
  broke.start<WheelState>('wheel');
  broke.queue.push(rollFor(seg(s => s.amount < 0)));
  broke.move('p0', { kind: 'spin' });
  assert.equal(broke.g.debtOf('p0'), 50);
  broke.closeResult();
  assert.equal(broke.g.phase, 'done');
  assert.throws(() => broke.g.apply('p0', { type: 'endTurn' }), /debts/);

  const jail = setup();
  jail.start<WheelState>('wheel');
  jail.queue.push(rollFor(seg(s => !!s.jailCard)));
  jail.move('p0', { kind: 'spin' });
  assert.deepEqual(jail.g.player('p0').jailCards, ['chance']);
  const chanceJail = jail.g.theme.chance.findIndex(c => c.effect.type === 'jailFree');
  assert.ok(!jail.g.decks.chance.includes(chanceJail), 'the card left the deck, so it exists once');
});

test('wheel: jail card falls back to cash when both are held; timeout spins', () => {
  const { g, start, tick, queue } = setup();
  for (const deck of ['chance', 'chest'] as const) {
    const idx = g.theme[deck].findIndex(c => c.effect.type === 'jailFree');
    g.decks[deck] = g.decks[deck].filter(i => i !== idx);
  }
  start<WheelState>('wheel');
  queue.push(WHEEL_SEGMENTS.slice(0, WHEEL_SEGMENTS.findIndex(s => s.jailCard)).reduce((a, s) => a + s.weight, 0));
  tick(8_000);
  assert.equal(g.minigameTimeout(), true);
  assert.equal(g.player('p0').jailCards.length, 0);
  assert.equal(g.player('p0').cash, 1550);
});

// ---- lifecycle ------------------------------------------------------------------

test('snapshot/restore mid-round keeps secrets server-side and shifts the clock', () => {
  const a = setup({ n: 3 });
  const s = a.start<ReactionState>('reaction');
  a.move('p1', { kind: 'tap' });
  const snap: GameSnapshot = a.g.snapshot();
  assert.equal(snap.minigame?.kind, 'reaction');
  // The same JSON the server writes to disk.
  const disk = JSON.parse(JSON.stringify(snap)) as GameSnapshot;
  const later = a.clock + 60_000;
  const g2 = Game.restore({ theme: a.g.theme, rules: a.g.rules, now: () => later, rng: () => 0 }, disk);
  assert.equal(g2.phase, 'minigame');
  const r = g2.minigame!.data as ReactionState;
  assert.deepEqual(r.early, ['p1']);
  assert.equal(r.goAt, s.goAt + 60_000, 'the wait carries on where it stood');
  assert.equal(g2.minigameTimeout(), false);
  // Restored rounds still finish and pay out.
  let t = a.clock;
  const g3 = Game.restore({ theme: a.g.theme, rules: a.g.rules, now: () => t, rng: () => 0 }, a.g.snapshot());
  t = s.goAt;
  assert.equal(g3.minigameTimeout(), true);
  t += 100;
  g3.apply('p2', { type: 'minigame', move: { kind: 'tap' } });
  assert.equal(g3.player('p2').cash, 1500 + REACTION_PRIZE);

  // Result screen survives too, then the turn resumes.
  const b = setup();
  b.start<WheelState>('wheel');
  b.move('p0', { kind: 'spin' });
  const g4 = Game.restore({ theme: b.g.theme, rules: b.g.rules, now: () => b.clock + 20_000, rng: () => 0 }, b.g.snapshot());
  assert.equal(g4.minigame?.stage, 'result');
  assert.equal(g4.minigameTimeout(), false);
  g4.apply('p0', { type: 'minigame', move: { kind: 'continue' } });
  assert.equal(g4.phase, 'done');

  // Snapshots from before mini-games existed still load.
  const old = b.g.snapshot() as Partial<GameSnapshot>;
  delete old.minigame; delete old.minigameSeq; delete old.savedAt;
  old.phase = 'done';
  const g5 = Game.restore({ theme: b.g.theme, rules: b.g.rules }, old as GameSnapshot);
  assert.equal(g5.minigame, null);
  assert.equal(g5.view().minigame, null);
});

test('bankruptcy mid-round: the lander leaving ends it; a duel opponent leaving calls it off', () => {
  const a = setup({ n: 3 });
  a.start<ReactionState>('reaction');
  a.g.apply('p0', { type: 'bankrupt' });
  assert.equal(a.g.minigame, null);
  assert.equal(a.g.current.id, 'p1');
  assert.equal(a.g.phase, 'roll');

  const b = setup({ n: 3 });
  b.queue.push(0);
  b.start<DuelState>('diceDuel'); // vs p1
  b.g.apply('p1', { type: 'bankrupt' });
  assert.equal(b.g.minigame, null);
  assert.equal(b.g.current.id, 'p0');
  assert.equal(b.g.phase, 'done');

  // Group games carry on without them; if only locked-out players remain it ends.
  const c = setup({ n: 3 });
  const m = c.start<MathState>('quickMath');
  c.move('p0', { kind: 'answer', value: m.options.find(x => x !== m.answer)! });
  c.move('p1', { kind: 'answer', value: m.options.find(x => x !== m.answer)! });
  c.g.apply('p2', { type: 'bankrupt' });
  assert.equal(c.g.minigame?.stage, 'result');

  // Last opponent out: the game is over, and so is the round.
  const d = setup();
  d.start<DuelState>('diceDuel');
  d.g.apply('p1', { type: 'bankrupt' });
  assert.equal(d.g.phase, 'over');
  assert.equal(d.g.minigame, null);
});

test('bots play every mini-game legally, at a human pace, and never jump the gun', () => {
  for (const kind of ['diceDuel', 'highLow', 'reaction', 'quickMath', 'wheel'] as MinigameKind[]) {
    for (let seed = 1; seed <= 20; seed++) {
      let clock = 0;
      const g = new Game({
        theme: resolveTheme('classic', 'speed'), rules: DEFAULT_RULES,
        players: Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, character: 'spiky' as const, color: '#fff', isBot: true })),
        rng: seeded(seed), now: () => clock,
      });
      g.phase = 'done';
      g['startMinigame'](g.player('b0'), kind);
      const seq = g.minigame!.seq;
      let first: number | null = null;
      while (g.minigame?.seq === seq && g.minigame.stage === 'play') {
        clock += 50;
        let acted = false;
        for (const p of g.players) {
          const a = botAction(g, p.id);
          if (!a) continue;
          assert.equal(a.type, 'minigame');
          if (kind === 'reaction') assert.ok((g.minigame.data as ReactionState).go, 'bot tapped before GO');
          first ??= clock;
          g.apply(p.id, a);
          acted = true;
          break;
        }
        if (!acted) g.minigameTimeout();
      }
      assert.equal(g.minigame?.stage, 'result', `${kind} seed ${seed}`);
      assert.ok(first !== null, `${kind}: bots never moved (seed ${seed})`);
      // No bot fires the instant a round opens.
      assert.ok(first! >= 300, `${kind}: bot moved after only ${first} ms`);
    }
  }
});

test('rooms: sanitised rules carry the mini-game switches; the site switch reaches running games', async () => {
  // Features persist to DATA_DIR, so point it somewhere disposable before loading them.
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-mg-'));
  const { sanitizeRules, Room } = await import('../src/rooms.ts');
  const { setFeatures } = await import('../src/features.ts');
  assert.equal(sanitizeRules({}).minigames, true);
  assert.equal(sanitizeRules({}).arcadeParking, false);
  assert.equal(sanitizeRules({ minigames: 'yes' as unknown as boolean }).minigames, true);
  assert.equal(sanitizeRules({ minigames: false, arcadeParking: true }).arcadeParking, true);

  const hooks = { onChange() {}, onEvent() {}, onFinished() {} };
  const room = new Room('MGTST', 'h', hooks);
  room.join({ id: 'h', name: 'Host', avatar: '🙂' });
  room.join({ id: 'g', name: 'Guest', avatar: '🙂' });
  room.configure('h', false, { mapId: 'speed' });
  room.start('h', false);
  try {
    const g = room.game!;
    const p = g.current;
    setFeatures({ minigames: false });
    p.position = 6;
    g['resolveLanding'](p);
    assert.equal(g.minigame, null, 'switched off site-wide');
    setFeatures({ minigames: true });
    g['resolveLanding'](p);
    assert.equal(g.phase, 'minigame');
    assert.ok(room.view().game!.minigame);
  } finally {
    room.dispose();
  }
});

// ---- held behind the scene ---------------------------------------------------

test('holdMinigame: a round waits for the move that landed on it, clocks and bots alike', () => {
  for (const kind of ['diceDuel', 'highLow', 'reaction', 'quickMath', 'wheel'] as MinigameKind[]) {
    const { g, start, tick, clock } = setup();
    start(kind);
    const due = g.minigameDeadline()!;
    const shown = g.view().minigame!;
    assert.equal(shown.startsAt, clock, `${kind}: play starts now`);
    // The dice, the walk and a card still have 6 s to play.
    g.holdMinigame(clock + 6000);
    assert.equal(g.minigameDeadline(), due + 6000, `${kind}: every deadline moves on`);
    const view = g.view().minigame!;
    assert.equal(view.startsAt, clock + 6000);
    if (shown.endsAt !== null) assert.equal(view.endsAt, shown.endsAt + 6000, `${kind}: the clients' countdown too`);
    // A shorter hold later (or the same one again) changes nothing.
    g.holdMinigame(clock + 2000);
    g.holdMinigame(clock + 6000);
    assert.equal(g.minigameDeadline(), due + 6000);
    // Bots wait for the scene like everyone else: nothing while it plays.
    for (let t = 0; t < 6000; t += 250) {
      for (const p of g.players) assert.equal(g.minigameBotMove(p.id), null, `${kind}: a bot moved ${t} ms into the scene`);
      tick(250);
    }
    assert.equal(g.minigameTimeout(), false, `${kind}: no deadline passes during the scene`);
    // Once play has begun the round's clocks are live and stay put.
    tick(1);
    g.holdMinigame(clock + 12_000);
    assert.equal(g.minigameDeadline(), due + 6000, `${kind}: not moved once play began`);
  }
});

test('holdMinigame: never moves a round that is decided, or one from an old snapshot', () => {
  const a = setup();
  a.start<DuelState>('diceDuel');
  a.queue.push(0, 0, 1, 1);
  a.move('p0', { kind: 'roll' });
  a.move('p1', { kind: 'roll' });
  assert.equal(a.g.minigame?.stage, 'result');
  const res = a.g.minigameDeadline();
  a.g.holdMinigame(a.clock + 5000);
  assert.equal(a.g.minigameDeadline(), res, 'the result screen keeps its time');

  const b = setup();
  b.start<DuelState>('diceDuel');
  delete b.g.minigame!.playFrom; // a round saved before holds existed
  const due = b.g.minigameDeadline();
  b.g.holdMinigame(b.clock + 5000);
  assert.equal(b.g.minigameDeadline(), due);
  assert.equal(b.g.view().minigame!.startsAt, undefined);
});

test('room: an arcade round starts once the move that got there has played out', async () => {
  process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'yot-mg-'));
  const { Room } = await import('../src/rooms.ts');
  const room = new Room('MGHLD', 'h', { onChange() {}, onEvent() {}, onFinished() {} });
  room.join({ id: 'h', name: 'Host', avatar: '🙂' });
  room.join({ id: 'g', name: 'Guest', avatar: '🙂' });
  room.configure('h', false, { mapId: 'speed' });
  room.start('h', false);
  try {
    const before = Date.now();
    // Walked six spaces onto the Arcade: clients play that walk before the round.
    room.adminFix(g => { g.current.position = 6; g.phase = 'done'; g['startMinigame'](g.current, 'diceDuel'); }, 'arcade', 'Operator');
    const g = room.game!;
    const until = (room as unknown as { sceneUntil: number }).sceneUntil;
    assert.ok(until > before, 'the walk is a scene');
    assert.equal(g.minigame!.playFrom, until, 'play starts when the scene is over');
    assert.equal(g.minigameDeadline(), until + DUEL_MS, 'the full 10 s count from there');
    assert.equal(g.view().minigame!.endsAt, until + DUEL_MS);
  } finally {
    room.dispose();
  }
});

test('holdMinigame: the room asking a few ms after the round opened still holds it', () => {
  const { g, start, tick, clock } = setup();
  start('diceDuel');
  const due = g.minigameDeadline()!;
  // The room notes the scene right after the action that opened the round; a
  // millisecond or two may have passed. That is not "play has begun".
  tick(3);
  g.holdMinigame(clock + 6000);
  assert.equal(g.minigameDeadline(), due + 6000 - 0, 'held for the scene');
  assert.equal(g.view().minigame!.startsAt, clock + 6000);
});
