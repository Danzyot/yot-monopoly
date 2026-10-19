// The collusion flags, rebuilt against real hands from a live event.
//
// The old detector produced 356 flags from one tournament and every one of
// them was ordinary poker: short stacks getting the last of it in, and good
// hands losing. This replays the exact hands from that report and asserts the
// ones that should never have been flagged are not, while the shape that
// actually matters still is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flaggedHands, preflopStrength, recordHandResult, suspiciousPairs } from '../src/audit.ts';
import type { CardT } from '../../shared/types.ts';

const S = { s: 0, h: 1, d: 2, c: 3 } as const;
const c = (r: number, s: keyof typeof S): CardT => ({ r, s: S[s] });

// A stand-in for the table: judging only ever reads the big blind off it.
const tableWith = (bb: number) => ({ bb, id: 't', name: 'T' }) as never;

let n = 0;
function playHand(opts: {
  bb: number;
  loser: { name: string; cards: CardT[]; startStack: number; committed: number; allIn?: boolean };
  winnerName?: string;
  board: CardT[];
}) {
  n += 1;
  const loserId = `L${n}`;
  const winnerId = `W${n}`;
  const contenders = [
    { id: loserId, name: opts.loser.name, net: -opts.loser.committed, cards: opts.loser.cards,
      committed: opts.loser.committed, startStack: opts.loser.startStack,
      allIn: opts.loser.allIn ?? true, wentToShowdown: true },
    { id: winnerId, name: opts.winnerName ?? 'Winner', net: opts.loser.committed, cards: [c(14, 's'), c(14, 'h')],
      committed: opts.loser.committed, startStack: 1_000_000, allIn: false, wentToShowdown: true },
  ];
  const before = flaggedHands(500).length;
  recordHandResult(
    tableWith(opts.bb),
    contenders.map(x => ({ id: x.id, name: x.name, net: x.net })),
    { contenders, board: opts.board, tableName: 'Table 4', handNumber: n },
  );
  return flaggedHands(500).length > before;
}

test('a short stack getting it in is never flagged, whatever they hold', () => {
  // Straight from the report: Joker all-in for 900 with AK, at a table where
  // stacks ran to six figures. The blinds alone were most of that stack.
  const flagged = playHand({
    bb: 400,
    loser: { name: 'Joker', cards: [c(13, 'h'), c(14, 's')], startStack: 900, committed: 900 },
    board: [c(2, 'd'), c(7, 'c'), c(9, 'h'), c(3, 's'), c(4, 'c')],
  });
  assert.equal(flagged, false, 'two big blinds deep is not a decision');
});

test('junk from a short stack is still not flagged', () => {
  // justice, all-in for 100. The old list called this collusion-adjacent.
  const flagged = playHand({
    bb: 200,
    loser: { name: 'justice', cards: [c(8, 'h'), c(5, 's')], startStack: 100, committed: 100 },
    board: [c(2, 'd'), c(7, 'c'), c(9, 'h'), c(3, 's'), c(13, 'c')],
  });
  assert.equal(flagged, false, 'below half a big blind there is no fold button worth pressing');
});

test('a premium hand that missed is a lost race, not a flag', () => {
  // duniya, 579,391 deep with AQ. Deep enough to have chosen — and AQ is a
  // hand you choose with. The old detector flagged it for "no pair".
  const flagged = playHand({
    bb: 5_000,
    loser: { name: 'duniya', cards: [c(14, 'h'), c(12, 'c')], startStack: 579_391, committed: 579_391 },
    board: [c(2, 'd'), c(7, 'c'), c(9, 'h'), c(3, 's'), c(4, 'c')],
  });
  assert.equal(flagged, false, 'ace-queen is not junk in any structure');
});

test('a pocket pair is never "bottom-tier"', () => {
  // Ash with pocket fives, 35,432 deep. Chen scores 55 the same as junk; a
  // player does not.
  const flagged = playHand({
    bb: 500,
    loser: { name: 'Ash', cards: [c(5, 's'), c(5, 'c')], startStack: 35_432, committed: 35_432 },
    board: [c(2, 'd'), c(7, 'c'), c(9, 'h'), c(13, 's'), c(4, 'c')],
  });
  assert.equal(flagged, false, 'shoving a pair is standard, at any depth');
});

test('an ace-high holding is not junk either', () => {
  const flagged = playHand({
    bb: 500,
    loser: { name: 'KC', cards: [c(14, 'd'), c(5, 'h')], startStack: 31_100, committed: 31_100 },
    board: [c(2, 'd'), c(7, 'c'), c(9, 'h'), c(13, 's'), c(4, 'c')],
  });
  assert.equal(flagged, false, 'an ace is a reason, even a thin one');
});

test('a deep stack shoving genuine junk IS flagged', () => {
  // The shape the panel exists for: 60 big blinds behind, no short-stack
  // excuse, seven-three offsuit.
  const flagged = playHand({
    bb: 1_000,
    loser: { name: 'Suspect', cards: [c(7, 'h'), c(3, 'd')], startStack: 60_000, committed: 60_000 },
    board: [c(2, 'd'), c(9, 'c'), c(11, 'h'), c(13, 's'), c(4, 'c')],
  });
  assert.equal(flagged, true, 'this is the thing the detector is for');
  const top = flaggedHands(1)[0];
  assert.match(top.reason, /60 BB deep/, 'and the depth is stated, so it can be judged');
  assert.equal(top.playerName, 'Suspect');
});

test('the Chen score keeps its ordering where it matters', () => {
  const pair66 = preflopStrength([c(6, 'h'), c(6, 'c')]);
  const junk73 = preflopStrength([c(7, 'h'), c(3, 'd')]);
  assert.ok(pair66 > junk73, 'a pair outranks unconnected junk');
  assert.ok(preflopStrength([c(14, 's'), c(13, 's')]) > pair66, 'and ace-king outranks the pair');
});

// The chip flow panel had 450 rows reading "0 pots, net 0" — pairs invented
// out of single flagged hands between players who had never met heads-up.
test('two players who never played a pot are not a pair', () => {
  const before = suspiciousPairs(3).length;
  // A three-way pot: nobody here is a "pair", even though one of them shoved junk.
  const contenders = [
    { id: 'm1', name: 'Multi1', net: -50_000, cards: [c(7, 'h'), c(3, 'd')],
      committed: 50_000, startStack: 50_000, allIn: true, wentToShowdown: true },
    { id: 'm2', name: 'Multi2', net: -20_000, cards: [c(9, 'h'), c(9, 'd')],
      committed: 20_000, startStack: 80_000, allIn: false, wentToShowdown: true },
    { id: 'm3', name: 'Multi3', net: 70_000, cards: [c(14, 's'), c(14, 'h')],
      committed: 20_000, startStack: 200_000, allIn: false, wentToShowdown: true },
  ];
  recordHandResult(
    tableWith(500),
    contenders.map(x => ({ id: x.id, name: x.name, net: x.net })),
    { contenders, board: [c(2, 'd'), c(8, 'c'), c(12, 'h'), c(4, 's'), c(6, 'c')], tableName: 'T', handNumber: 900 },
  );
  const after = suspiciousPairs(3);
  assert.equal(after.length, before, 'no new pair appeared out of a multiway pot');
  assert.equal(after.every(p => p.headsUpPots > 0), true, 'and every reported pair has real history');
});

test('repeated one-way flow between two players ranks at the top', () => {
  // Modelled on the two pairs that mattered in the real report and were
  // buried under 450 rows of noise.
  for (let i = 0; i < 20; i++) {
    recordHandResult(
      tableWith(1_000),
      [{ id: 'donor', name: 'Donor', net: -100_000 }, { id: 'taker', name: 'Taker', net: 100_000 }],
    );
  }
  const rows = suspiciousPairs(3);
  const top = rows[0];
  assert.equal(top.aName === 'Donor' || top.bName === 'Donor', true, 'the big flow leads the list');
  assert.equal(Math.abs(top.netAtoB), 2_000_000);
  assert.equal(top.headsUpPots, 20);
});
