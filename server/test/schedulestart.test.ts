// The start time is the host's to set, move, and take away — from the lobby,
// after registration has opened. The original timer was armed once in the
// constructor with no handle, which made the schedule write-once: whatever
// was typed at creation was what the room got.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';

const cb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
  lobbyChanged: () => {}, finished: () => {}, eliminated: () => {},
};

let n = 0;
function makeT(ctx: { after: (fn: () => void) => void }, scheduled?: number | null) {
  const config = {
    name: `Sched ${++n}`, startingStack: 10_000, levelMinutes: 30,
    structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0,
    approveRegistrations: false, buyIn: 0, prizeText: null, breakEveryLevels: 0,
    seatsPerTable: 9, social: null, maxReentries: 0, rabbitHunting: false,
    displayMode: 'chips',
  } as TournamentConfig;
  const t = new Tournament(config, { id: 'host', name: 'Host' }, cb as never, scheduled);
  for (const id of ['a', 'b', 'c']) t.register({ id, name: id, avatar: '🙂' });
  ctx.after(() => t.dispose());
  return t;
}

test('setting a start time after creation arms the auto-start', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2); // created with no schedule at all
  t.updateSettings({ scheduledStart: Date.now() + 5 * 60_000 });
  assert.equal(t.state, 'registering');
  t2.mock.timers.tick(5 * 60_000 + 1_000);
  assert.equal(t.state, 'running', 'the clock struck and the event started itself');
});

test('moving the start time cancels the old alarm', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2, Date.now() + 5 * 60_000);
  // Pushed back to twenty minutes out.
  t.updateSettings({ scheduledStart: Date.now() + 20 * 60_000 });
  t2.mock.timers.tick(6 * 60_000);
  assert.equal(t.state, 'registering', 'the original five-minute alarm no longer fires');
  t2.mock.timers.tick(15 * 60_000);
  assert.equal(t.state, 'running', 'the moved one does');
});

test('clearing it means nothing starts on its own', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2, Date.now() + 5 * 60_000);
  t.updateSettings({ scheduledStart: null });
  assert.equal(t.scheduledStart, null);
  t2.mock.timers.tick(60 * 60_000);
  assert.equal(t.state, 'registering', 'an hour later, still waiting for the host');
});

test('nonsense times are refused', ctx => {
  const t = makeT(ctx);
  assert.throws(() => t.updateSettings({ scheduledStart: Date.now() - 60_000 }), /at least a minute/);
  assert.throws(() => t.updateSettings({ scheduledStart: Number.NaN }), /makes no sense/);
  assert.throws(
    () => t.updateSettings({ scheduledStart: Date.now() + 60 * 24 * 3_600_000 }),
    /30 days/,
  );
  assert.equal(t.scheduledStart, null, 'and none of them stuck');
});

test('the start time cannot be edited once the event is running', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2);
  t.start();
  assert.throws(() => t.updateSettings({ scheduledStart: Date.now() + 5 * 60_000 }), /before the start/);
});
