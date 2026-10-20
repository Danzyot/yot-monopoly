// Removing a player from the audit: what goes, and what deliberately stays.
//
// The operator uses this to clear out accounts that were never really players
// — test sign-ins and demo runs — so the list shows the room rather than its
// setup history. It is housekeeping, not moderation, and it must not quietly
// destroy the case against somebody else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';
import {
  auditCounts, flaggedHands, forgetPlayer, noteAction, noteSeen,
  playerRows, recentActions, recordHandResult, suspiciousPairs,
} from '../src/audit.ts';
import type { CardT } from '../../shared/types.ts';

const P = (id: string, name: string) => ({ id, name, avatar: '🙂', discord: null });

const table = new Table({ name: 'T', sb: 1, bb: 2 }, {
  broadcast: () => {}, chat: () => {}, event: () => {},
});

const move = (playerId: string, playerName: string) => noteAction({
  ts: Date.now(), tableId: 'tbl-forget', tableName: 'T', handNumber: 1,
  playerId, playerName, action: 'bet', amount: 10, pot: 20,
});

test('removing a player takes their record, their moves and their pairings', () => {
  noteSeen(P('fg-gone', 'Goner'), '203.0.113.71');
  noteSeen(P('fg-stay', 'Stayer'), '203.0.113.72');

  for (let i = 0; i < 3; i++) move('fg-gone', 'Goner');
  for (let i = 0; i < 2; i++) move('fg-stay', 'Stayer');

  // Eight heads-up hands one way: enough to register as a pairing.
  for (let i = 0; i < 8; i++) {
    recordHandResult(table, [
      { id: 'fg-gone', name: 'Goner', net: -500 },
      { id: 'fg-stay', name: 'Stayer', net: +500 },
    ]);
  }

  assert.ok(playerRows().some(p => p.id === 'fg-gone'), 'seeded player is present first');
  assert.equal(recentActions(500, 'fg-gone').length, 3, 'their moves are on record first');
  const pairedBefore = suspiciousPairs(1).some(p => p.a === 'fg-gone' || p.b === 'fg-gone');
  assert.ok(pairedBefore, 'the pairing exists first');

  const r = forgetPlayer('fg-gone');

  assert.equal(r.found, true);
  assert.equal(r.actions, 3, 'reports the moves it removed');
  assert.ok(r.pairs >= 1, 'reports the pairings it removed');

  assert.equal(playerRows().some(p => p.id === 'fg-gone'), false, 'the record is gone');
  assert.equal(recentActions(500, 'fg-gone').length, 0, 'the moves are gone');
  assert.equal(
    suspiciousPairs(1).some(p => p.a === 'fg-gone' || p.b === 'fg-gone'), false,
    'the pairing is gone',
  );

  // The other side of every one of those is untouched.
  assert.ok(playerRows().some(p => p.id === 'fg-stay'), 'the other player stays');
  assert.equal(recentActions(500, 'fg-stay').length, 2, 'their moves stay');
});

test('a flag that indicts someone else survives removing the player who received the chips', () => {
  noteSeen(P('fg-dumper', 'Dumper'), '203.0.113.81');
  noteSeen(P('fg-taker', 'Taker'), '203.0.113.82');

  // A hand shaped like a deliberate donation: the dumper puts most of their
  // stack in with nothing and loses it to the taker.
  const cards: CardT[] = [{ r: 7, s: 0 }, { r: 2, s: 1 }];
  recordHandResult(
    table,
    [{ id: 'fg-dumper', name: 'Dumper', net: -900 }, { id: 'fg-taker', name: 'Taker', net: +900 }],
    {
      contenders: [
        {
          id: 'fg-dumper', name: 'Dumper', net: -900, cards,
          committed: 900, startStack: 1000, allIn: false, wentToShowdown: true,
        },
        {
          id: 'fg-taker', name: 'Taker', net: +900, cards: [{ r: 14, s: 2 }, { r: 14, s: 3 }] as CardT[],
          committed: 900, startStack: 1000, allIn: false, wentToShowdown: true,
        },
      ],
      board: [{ r: 3, s: 0 }, { r: 9, s: 1 }, { r: 11, s: 2 }, { r: 4, s: 3 }, { r: 6, s: 0 }] as CardT[],
      tableName: 'T', handNumber: 42,
    },
  );

  const flagged = flaggedHands(200).filter(f => f.playerId === 'fg-dumper');
  assert.ok(flagged.length > 0, 'the donation was flagged against the dumper');

  // Remove the player who only RECEIVED the chips. The flag is evidence about
  // the dumper, so it has to stay — and it still reads, because the names on
  // it were captured when the hand was played.
  const r = forgetPlayer('fg-taker');
  assert.equal(r.found, true);
  assert.equal(r.flagged, 0, 'no flag is removed for the recipient');

  const after = flaggedHands(200).filter(f => f.playerId === 'fg-dumper');
  assert.equal(after.length, flagged.length, 'the case against the dumper is intact');
  assert.equal(after[0].toName, 'Taker', 'and it still names who received the chips');
});

test('removing the flagged player takes their flag with them', () => {
  const mine = flaggedHands(200).filter(f => f.playerId === 'fg-dumper').length;
  assert.ok(mine > 0, 'there is a flag to remove');

  const r = forgetPlayer('fg-dumper');
  assert.equal(r.flagged, mine, 'reports the flags it removed');
  assert.equal(
    flaggedHands(200).some(f => f.playerId === 'fg-dumper'), false,
    'their flag is gone',
  );
});

test('removing someone the audit never saw changes nothing', () => {
  const before = auditCounts();
  const r = forgetPlayer('fg-never-existed');
  assert.deepEqual(r, { found: false, actions: 0, pairs: 0, flagged: 0 });
  assert.deepEqual(auditCounts(), before, 'the audit is untouched');
});
