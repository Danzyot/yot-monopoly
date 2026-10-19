// Crash recovery: a tournament serialized to disk and restored must come back
// with every chip accounted for, every seat intact, and the clock sensible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {}, lobbyChanged: () => {},
};

function makeT(n: number, over: Partial<TournamentConfig> = {}): Tournament {
  const config: TournamentConfig = {
    name: 'Restartable', startingStack: 10_000, levelMinutes: 8, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips', ...over,
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
  for (let i = 0; i < n; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  return t;
}

function totalChips(t: Tournament): number {
  let sum = 0;
  for (const table of t.tables.values()) {
    for (const snap of table.snapshotSeats()) sum += snap.stack;
  }
  return sum;
}

test('a running tournament survives snapshot → restore with every chip intact', () => {
  const t = makeT(18);
  t.start();
  joinEveryone(t);
  const snap = JSON.parse(JSON.stringify(t.snapshot())); // through-disk simulation

  const r = Tournament.restore(snap, noopCb);
  assert.equal(r.id, t.id, 'same tournament id — links keep working');
  assert.equal(r.players.size, 18);
  assert.equal(r.state, 'paused', 'comes back paused so players can reconnect');
  assert.deepEqual(
    [...r.tables.keys()].sort(), [...t.tables.keys()].sort(),
    'table ids preserved — everyone lands back on their own table URL',
  );
  assert.equal(totalChips(r), 18 * 10_000, 'chips conserved exactly');
  for (const table of r.tables.values()) assert.equal(table.paused, true);

  // The clock picks back up on resume.
  r.resume();
  assert.equal(r.state, 'running');
  assert.ok(r.levelEndsAt && r.levelEndsAt > Date.now());
  t.cancel();
  r.cancel();
});

test('a hand in progress is rolled back — committed chips come home', () => {
  const t = makeT(9);
  t.start();
  joinEveryone(t);
  const [table] = t.tables.values();
  table.startHand();
  assert.ok(table.hand, 'hand is live');
  const potNow = table.hand!.totalPot;
  assert.ok(potNow > 0, 'blinds are in the pot');

  const snap = JSON.parse(JSON.stringify(t.snapshot()));
  const r = Tournament.restore(snap, noopCb);
  assert.equal(totalChips(r), 9 * 10_000,
    'every chip committed to the abandoned hand is refunded');
  for (const rt of r.tables.values()) assert.equal(rt.hand, null, 'no ghost hand');
  t.cancel();
  r.cancel();
});

test('a registering tournament restores its field and scheduled start', () => {
  const t = makeT(5, { approveRegistrations: true });
  const snap = JSON.parse(JSON.stringify(t.snapshot()));
  const r = Tournament.restore(snap, noopCb);
  assert.equal(r.state, 'registering');
  assert.equal(r.players.size, 5);
  assert.equal(r.pendingPlayers().length, t.pendingPlayers().length, 'approval queue intact');
  t.cancel();
  r.cancel();
});

test('restore lands on a playable level even if the snapshot caught a break', () => {
  const t = makeT(9, {
    customLevels: [
      { sb: 25, bb: 50, ante: 0, minutes: 5 },
      { sb: 0, bb: 0, ante: 0, minutes: 5, isBreak: true },
      { sb: 50, bb: 100, ante: 0, minutes: 0 },
    ],
  });
  t.start();
  joinEveryone(t);
  (t as unknown as { advanceLevel: () => void }).advanceLevel(); // into the break
  assert.equal(t.state, 'break');

  const snap = JSON.parse(JSON.stringify(t.snapshot()));
  const r = Tournament.restore(snap, noopCb);
  assert.equal(!!r.level.isBreak, false, 'never restores onto a break row');
  assert.equal(r.level.bb, 100, 'the interrupted break just ends');
  r.resume();
  assert.equal(r.levelEndsAt, null, 'final forever level restores without a clock');
  t.cancel();
  r.cancel();
});

test('the blind schedule can be rewritten mid-game', () => {
  const t = makeT(9, {
    customLevels: [
      { sb: 25, bb: 50, ante: 0, minutes: 5 },
      { sb: 50, bb: 100, ante: 0, minutes: 0 },
    ],
  });
  t.start();
  joinEveryone(t);
  t.updateSettings({
    customLevels: [
      { sb: 100, bb: 200, ante: 25, minutes: 10 },
      { sb: 200, bb: 400, ante: 50, minutes: 0 },
    ],
  });
  assert.equal(t.structure.length, 2);
  assert.equal(t.level.bb, 200, 'current level takes the matching new row');
  for (const table of t.tables.values()) {
    assert.equal(table.bb, 200, 'tables pick up the new blinds');
    assert.equal(table.ante, 25);
  }
  assert.ok(t.levelEndsAt && t.levelEndsAt - Date.now() > 9 * 60_000, 'clock re-based to the new duration');
  t.cancel();
});

test('session log and replayer hands ride along through a restore', () => {
  const t = makeT(9);
  t.start();
  joinEveryone(t);
  const [table] = t.tables.values();
  table.startHand();
  const logLenBefore = table.eventLog.length;
  assert.ok(logLenBefore > 0, 'dealing wrote to the session log');

  const snap = JSON.parse(JSON.stringify(t.snapshot()));
  const r = Tournament.restore(snap, noopCb);
  const [rt] = r.tables.values();
  assert.equal(rt.eventLog.length, logLenBefore, 'session log restored');
  assert.deepEqual(
    rt.eventLog.map(e => e.text), table.eventLog.map(e => e.text),
    'log entries identical',
  );
  t.cancel();
  r.cancel();
});
