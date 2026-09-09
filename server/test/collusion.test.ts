// Chip-dumping detection. The bar is deliberately two-sided: it must catch a
// deliberate donation, and it must NOT flag a player who simply lost a big
// pot honestly — a false accusation is worse than a missed one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CardT } from '../../shared/types.ts';

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'wawa-collusion-'));
const { flaggedHands, preflopStrength, recordHandResult, suspiciousPairs } =
  await import('../src/audit.ts');

const C = (r: number, s: CardT['s']): CardT => ({ r, s });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TABLE = { id: 't1', name: 'Table 1' } as any;

function hand(opts: {
  loser: { id: string; name: string; cards: CardT[]; committed: number; stack: number; allIn?: boolean };
  winner: { id: string; name: string; cards: CardT[]; committed: number; stack: number };
  board: CardT[];
  handNumber?: number;
}) {
  const { loser, winner, board } = opts;
  const pot = loser.committed + winner.committed;
  const contenders = [
    {
      id: loser.id, name: loser.name, net: -loser.committed, cards: loser.cards,
      committed: loser.committed, startStack: loser.stack, allIn: !!loser.allIn,
      wentToShowdown: true,
    },
    {
      id: winner.id, name: winner.name, net: pot - winner.committed, cards: winner.cards,
      committed: winner.committed, startStack: winner.stack, allIn: false,
      wentToShowdown: true,
    },
  ];
  recordHandResult(TABLE, contenders, {
    contenders, board, tableName: 'Table 1', handNumber: opts.handNumber ?? 1,
  });
}

test('preflop strength ranks holdings sensibly', () => {
  const aces = preflopStrength([C(14, 0), C(14, 1)]);
  const kings = preflopStrength([C(13, 0), C(13, 1)]);
  const sevenDeuce = preflopStrength([C(7, 0), C(2, 1)]);
  const akSuited = preflopStrength([C(14, 0), C(13, 0)]);
  assert.ok(aces > kings, 'aces beat kings');
  assert.ok(kings > akSuited, 'a big pair beats a big suited ace');
  assert.ok(akSuited > sevenDeuce, 'AKs beats 72o');
  assert.ok(sevenDeuce <= 5, `72o is bottom-tier (got ${sevenDeuce})`);
});

test('shoving trash preflop into the same player is flagged', () => {
  hand({
    loser: { id: 'dumper', name: 'Dumper', cards: [C(7, 0), C(2, 1)], committed: 10_000, stack: 10_000, allIn: true },
    winner: { id: 'mule', name: 'Mule', cards: [C(14, 2), C(14, 3)], committed: 10_000, stack: 20_000 },
    board: [],
    handNumber: 1,
  });
  const flags = flaggedHands();
  assert.equal(flags.length, 1, 'one flagged hand');
  assert.equal(flags[0].playerName, 'Dumper');
  assert.equal(flags[0].toName, 'Mule');
  assert.match(flags[0].reason, /all-in preflop/);
  assert.equal(flags[0].stackPct, 100);
});

test('losing a big pot with a real hand is NOT flagged', () => {
  const before = flaggedHands().length;
  // Aces into a set — a cooler, the most normal way to lose a stack.
  hand({
    loser: { id: 'honest', name: 'Honest', cards: [C(14, 0), C(14, 1)], committed: 9_000, stack: 10_000, allIn: true },
    winner: { id: 'lucky', name: 'Lucky', cards: [C(5, 2), C(5, 3)], committed: 9_000, stack: 12_000 },
    board: [C(5, 0), C(11, 1), C(2, 2), C(8, 3), C(3, 0)],
    handNumber: 2,
  });
  // A strong-but-second-best made hand on a big board.
  hand({
    loser: { id: 'honest', name: 'Honest', cards: [C(13, 0), C(12, 0)], committed: 8_000, stack: 10_000, allIn: true },
    winner: { id: 'lucky', name: 'Lucky', cards: [C(14, 1), C(13, 1)], committed: 8_000, stack: 15_000 },
    board: [C(13, 2), C(12, 3), C(4, 0), C(9, 1), C(2, 2)],
    handNumber: 3,
  });
  assert.equal(flaggedHands().length, before, 'honest coolers raise no flags');
});

test('small pots and short commitments are ignored', () => {
  const before = flaggedHands().length;
  hand({
    loser: { id: 'nit', name: 'Nit', cards: [C(7, 0), C(2, 1)], committed: 200, stack: 10_000 },
    winner: { id: 'reg', name: 'Reg', cards: [C(14, 2), C(14, 3)], committed: 200, stack: 10_000 },
    board: [C(9, 0), C(4, 1), C(3, 2)],
    handNumber: 4,
  });
  assert.equal(flaggedHands().length, before, '2% of a stack is just a hand of poker');
});

test('repeat donations surface the pair, with direction and totals', () => {
  for (let i = 0; i < 3; i++) {
    hand({
      loser: { id: 'dumper', name: 'Dumper', cards: [C(8, 0), C(3, 1)], committed: 5_000, stack: 5_000, allIn: true },
      winner: { id: 'mule', name: 'Mule', cards: [C(14, 2), C(9, 3)], committed: 5_000, stack: 30_000 },
      board: [],
      handNumber: 10 + i,
    });
  }
  const pair = suspiciousPairs().find(p =>
    (p.aName === 'Dumper' && p.bName === 'Mule') || (p.aName === 'Mule' && p.bName === 'Dumper'));
  assert.ok(pair, 'the pair is reported');
  assert.ok(pair!.dumpHands >= 4, `flagged hands counted (got ${pair!.dumpHands})`);
  assert.ok(pair!.dumpChips >= 20_000, `donated chips totalled (got ${pair!.dumpChips})`);
  // Direction: chips left Dumper and reached Mule.
  const toMule = pair!.aName === 'Dumper' ? pair!.netAtoB > 0 : pair!.netAtoB < 0;
  assert.ok(toMule, 'flow points from the dumper to the beneficiary');
});

test('a clean pair never reaches the report', () => {
  hand({
    loser: { id: 'clean1', name: 'Clean1', cards: [C(14, 0), C(13, 0)], committed: 4_000, stack: 10_000 },
    winner: { id: 'clean2', name: 'Clean2', cards: [C(14, 1), C(14, 2)], committed: 4_000, stack: 10_000 },
    board: [C(14, 3), C(7, 0), C(2, 1), C(5, 2), C(9, 3)],
    handNumber: 20,
  });
  const pair = suspiciousPairs().find(p =>
    (p.aName === 'Clean1' && p.bName === 'Clean2') || (p.aName === 'Clean2' && p.bName === 'Clean1'));
  assert.equal(pair, undefined, 'one honest hand between two players is not a report');
});
