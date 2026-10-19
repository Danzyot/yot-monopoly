// A finished tournament has a duration, not a stopwatch.
//
// The lobby pill read "112:49 elapsed" and kept counting, because it was
// computed from the start time against the current clock with nothing to stop
// it. Days later the same finished event would claim to have run for days.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';

const cb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
  lobbyChanged: () => {}, finished: () => {}, eliminated: () => {},
};

function makeT(ctx: { after: (fn: () => void) => void }) {
  const config = {
    name: `Ended ${Math.random()}`, startingStack: 10_000, levelMinutes: 60,
    structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0,
    approveRegistrations: false, buyIn: 0, prizeText: null, breakEveryLevels: 0,
    seatsPerTable: 9, social: null, maxReentries: 0, rabbitHunting: false,
    displayMode: 'chips',
  } as TournamentConfig;
  const t = new Tournament(config, { id: 'host', name: 'Host' }, cb as never);
  for (let i = 0; i < 4; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  ctx.after(() => t.dispose());
  return t;
}

test('a running tournament has no end time', ctx => {
  const t = makeT(ctx);
  assert.equal(t.endedAt, null, 'not before it starts');
  t.start();
  assert.equal(t.endedAt, null, 'and not while it runs');
  assert.equal(t.view(null, false).endedAt, null, 'the view agrees');
});

test('finishing stamps the end, and the view reports it', ctx => {
  const t = makeT(ctx);
  t.start();
  const startedAt = t.startedAt!;
  t.endNow();
  assert.equal(t.state, 'finished');
  assert.ok(typeof t.endedAt === 'number', 'the end is recorded');
  assert.ok(t.endedAt! >= startedAt, 'and it is not before the start');
  assert.equal(t.view(null, false).endedAt, t.endedAt, 'the view carries it');
});

test('cancelling stamps it too', ctx => {
  const t = makeT(ctx);
  t.start();
  t.cancel();
  assert.equal(t.state, 'cancelled');
  assert.ok(typeof t.endedAt === 'number', 'a cancelled event stops the clock as well');
});

test('the end time survives a restart', ctx => {
  const t = makeT(ctx);
  t.start();
  t.endNow();
  const snap = t.snapshot();
  assert.equal(snap.endedAt, t.endedAt);
  const back = Tournament.restore(snap, cb as never);
  ctx.after(() => back.dispose());
  assert.equal(back.endedAt, t.endedAt, 'so a deploy does not restart the stopwatch');
});
