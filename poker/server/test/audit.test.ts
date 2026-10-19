// Operator audit: alt-account grouping and one-way chip-flow detection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../src/engine/table.ts';
import { altGroups, noteSeen, recordHandResult, suspiciousPairs } from '../src/audit.ts';

const P = (id: string, name: string) => ({ id, name, avatar: '🙂', discord: null });

// A throwaway table — recordHandResult only uses it for context.
const table = new Table({ name: 'T', mode: 'cash', sb: 1, bb: 2 }, {
  broadcast: () => {}, chat: () => {}, event: () => {},
});

test('accounts seen from the same address are grouped', () => {
  noteSeen(P('alt1', 'Alt One'), '203.0.113.9');
  noteSeen(P('alt2', 'Alt Two'), '203.0.113.9');
  noteSeen(P('solo', 'Solo'), '198.51.100.4');

  const groups = altGroups();
  const shared = groups.find(g => g.addresses.some(a => a.ip === '203.0.113.9'));
  assert.ok(shared, 'the shared address is reported');
  assert.deepEqual(shared!.players.map(p => p.id).sort(), ['alt1', 'alt2']);
  assert.equal(groups.some(g => g.addresses.some(a => a.ip === '198.51.100.4')), false,
    'an address with only one account is not a group');
});

test('a one-way chip flow between the same two players surfaces', () => {
  // dumper loses 500 to farmer, eight times heads-up.
  for (let i = 0; i < 8; i++) {
    recordHandResult(table, [
      { id: 'dumper', name: 'Dumper', net: -500 },
      { id: 'farmer', name: 'Farmer', net: 500 },
    ]);
  }
  noteSeen(P('dumper', 'Dumper'), '203.0.113.77');
  noteSeen(P('farmer', 'Farmer', ), '203.0.113.77');

  const pairs = suspiciousPairs(5);
  const pair = pairs.find(p => [p.a, p.b].includes('dumper') && [p.a, p.b].includes('farmer'));
  assert.ok(pair, 'the pair is reported');
  assert.equal(pair!.headsUpPots, 8);
  assert.equal(Math.abs(pair!.netAtoB), 4000, 'the full one-way flow is totalled');
  // Direction must name the loser correctly whichever way round the pair is stored.
  const loserIsDumper = pair!.a === 'dumper' ? pair!.netAtoB > 0 : pair!.netAtoB < 0;
  assert.ok(loserIsDumper, 'the flow points from dumper to farmer');
  assert.deepEqual(pair!.sharedIps, ['203.0.113.77'], 'their shared address is attached');
  assert.equal(pair!.sameIpOnly, true, 'both accounts only ever used that one address');
});

test('players who trade pots evenly are not flagged as a flow', () => {
  // Players are always recorded on connect before they can play.
  noteSeen(P('even1', 'Even One'), '198.51.100.11');
  noteSeen(P('even2', 'Even Two'), '198.51.100.12');
  for (let i = 0; i < 10; i++) {
    const aWins = i % 2 === 0;
    recordHandResult(table, [
      { id: 'even1', name: 'Even One', net: aWins ? 300 : -300 },
      { id: 'even2', name: 'Even Two', net: aWins ? -300 : 300 },
    ]);
  }
  const pair = suspiciousPairs(5).find(p => [p.a, p.b].includes('even1'));
  assert.ok(pair, 'the pair still appears for review');
  assert.equal(pair!.netAtoB, 0, 'but the net flow is zero, so it ranks last');
});

test('pairs below the hand threshold are not reported', () => {
  noteSeen(P('rare1', 'Rare One'), '198.51.100.21');
  noteSeen(P('rare2', 'Rare Two'), '198.51.100.22');
  recordHandResult(table, [
    { id: 'rare1', name: 'Rare One', net: -100 },
    { id: 'rare2', name: 'Rare Two', net: 100 },
  ]);
  assert.equal(suspiciousPairs(5).some(p => [p.a, p.b].includes('rare1')), false);
});

test('multi-way pots are not counted as heads-up flow', () => {
  for (const id of ['m1', 'm2', 'm3']) noteSeen(P(id, id.toUpperCase()), `198.51.100.3${id.slice(1)}`);
  for (let i = 0; i < 10; i++) {
    recordHandResult(table, [
      { id: 'm1', name: 'M1', net: -200 },
      { id: 'm2', name: 'M2', net: 400 },
      { id: 'm3', name: 'M3', net: -200 },
    ]);
  }
  assert.equal(suspiciousPairs(5).some(p => [p.a, p.b].includes('m1')), false,
    'three-way pots tell you nothing about a pair');
});
