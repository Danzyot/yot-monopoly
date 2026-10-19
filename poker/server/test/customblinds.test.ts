// Host-authored blind schedules: rows play in order with their own durations,
// break rows pause play, and a final 0-minute row runs forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { CustomBlindLevel, TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {}, lobbyChanged: () => {},
};

function makeT(customLevels: CustomBlindLevel[], n = 9): Tournament {
  const config: TournamentConfig = {
    name: 'Custom', startingStack: 5000, levelMinutes: 8, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 6, seatsPerTable: 9, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
    customLevels,
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
  for (let i = 0; i < n; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  return t;
}

test('a custom schedule replaces the generated structure exactly', () => {
  const t = makeT([
    { sb: 10, bb: 20, ante: 0, minutes: 7 },
    { sb: 25, bb: 50, ante: 0, minutes: 7 },
    { sb: 0, bb: 0, ante: 0, minutes: 10, isBreak: true },
    { sb: 100, bb: 200, ante: 25, minutes: 0 },
  ]);
  assert.equal(t.structure.length, 4);
  assert.deepEqual(
    t.structure.map(l => [l.level, l.sb, l.bb, !!l.isBreak]),
    [[1, 10, 20, false], [2, 25, 50, false], [2, 25, 50, true], [3, 100, 200, false]],
    'levels number 1..3 with the break inheriting the blinds before it',
  );

  t.start();

  joinEveryone(t);
  for (const table of t.tables.values()) {
    assert.equal(table.sb, 10);
    assert.equal(table.bb, 20);
  }
  assert.ok(t.levelEndsAt !== null, 'level 1 runs on its own 7-minute clock');
  t.cancel();
});

test('a final level with no duration runs forever', () => {
  const t = makeT([{ sb: 500, bb: 1000, ante: 0, minutes: 0 }]);
  t.start();
  joinEveryone(t);
  assert.equal(t.level.bb, 1000);
  assert.equal(t.levelEndsAt, null, 'no clock — the last level never expires');
  t.cancel();
});

test('advancing into a break row pauses play for its duration', () => {
  const t = makeT([
    { sb: 25, bb: 50, ante: 0, minutes: 5 },
    { sb: 0, bb: 0, ante: 0, minutes: 4, isBreak: true },
    { sb: 50, bb: 100, ante: 0, minutes: 0 },
  ]);
  t.start();
  joinEveryone(t);
  (t as unknown as { advanceLevel: () => void }).advanceLevel();
  assert.equal(t.state, 'break', 'the break row pauses the tournament');
  for (const table of t.tables.values()) assert.equal(table.paused, true, 'tables pause too');
  assert.ok(t.levelEndsAt && t.levelEndsAt - Date.now() > 3 * 60_000,
    'the break runs on its own 4-minute clock');
  t.cancel();
});

test('level jumps skip break rows', () => {
  const t = makeT([
    { sb: 25, bb: 50, ante: 0, minutes: 5 },
    { sb: 0, bb: 0, ante: 0, minutes: 5, isBreak: true },
    { sb: 75, bb: 150, ante: 0, minutes: 0 },
  ]);
  t.start();
  joinEveryone(t);
  t.updateSettings({ jumpLevel: 2 }); // index 1 is the break — must land on 75/150
  assert.equal(t.level.bb, 150);
  assert.equal(!!t.level.isBreak, false);
  t.cancel();
});
