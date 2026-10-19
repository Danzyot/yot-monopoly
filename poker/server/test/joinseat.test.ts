// Registering holds your place; Join table is what seats you.
//
// The failure this replaces: a player registered, wasn't at their screen when
// the clock started, was seated anyway, blinded off in five hands, removed —
// and then told they had "already finished" a tournament they never played a
// hand of. Their seat now waits for them instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_JOIN_MINUTES, Tournament } from '../src/tournament/tournament.ts';
import { playerConnected, playerDisconnected } from '../src/presence.ts';
import type { TournamentConfig } from '../../shared/types.ts';

const cb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
  lobbyChanged: () => {}, finished: () => {}, eliminated: () => {},
};

let n = 0;
function makeT(ctx: { after: (fn: () => void) => void }, over: Partial<TournamentConfig> = {}) {
  const config = {
    name: `Join ${++n}`, startingStack: 10_000, levelMinutes: 60,
    structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0,
    approveRegistrations: false, buyIn: 0, prizeText: null, breakEveryLevels: 0,
    seatsPerTable: 9, social: null, maxReentries: 0, rabbitHunting: false,
    displayMode: 'chips', ...over,
  } as TournamentConfig;
  const t = new Tournament(config, { id: 'host', name: 'Host' }, cb as never);
  ctx.after(() => t.dispose());
  return t;
}

const seated = (t: Tournament, id: string) => {
  const p = t.players.get(id);
  if (!p?.tableId) return false;
  return t.tables.get(p.tableId)?.playerSeat(id) != null;
};

function online(ctx: { after: (fn: () => void) => void }, ...ids: string[]) {
  for (const id of ids) playerConnected(id);
  ctx.after(() => { for (const id of ids) playerDisconnected(id); });
}

test('starting seats nobody — registering is not a seat', ctx => {
  const t = makeT(ctx);
  for (const id of ['a', 'b', 'c', 'away']) t.register({ id, name: id, avatar: '🙂' });
  // Being connected is not the same as having asked to play, so it earns
  // nothing here: the button is the only way in.
  online(ctx, 'a', 'b', 'c');

  t.start();
  for (const id of ['a', 'b', 'c', 'away']) {
    assert.equal(seated(t, id), false, `${id} is not dealt in by registering`);
    assert.equal(t.view(id, false).myStatus, 'seating');
    assert.equal(t.players.get(id)!.busted, false, 'and is still in the field');
    assert.equal(t.players.get(id)!.place, null, 'and has certainly not "finished"');
  }
  assert.equal(t.tables.size, 0, 'no tables exist until somebody arrives');
});

test('joining seats them, mid-event, with a full stack', ctx => {
  const t = makeT(ctx);
  for (const id of ['a', 'b', 'c', 'away']) t.register({ id, name: id, avatar: '🙂' });
  online(ctx, 'a', 'b', 'c');
  t.start();
  for (const id of ['a', 'b', 'c']) t.joinTable(id);

  assert.equal(t.canJoinTable('away'), true);
  const tableId = t.joinTable('away');
  assert.ok(tableId, 'they are given a table');
  assert.equal(seated(t, 'away'), true);
  const table = t.tables.get(tableId)!;
  assert.equal(table.seats[table.playerSeat('away')!]!.stack, t.config.startingStack);
  assert.equal(t.view('away', false).myStatus, 'playing');
  // And not twice.
  assert.throws(() => t.joinTable('away'), /already have a seat/);
});

test('the window defaults to fifteen minutes and ignores late registration', ctx => {
  const t = makeT(ctx, { lateRegMinutes: 0 });
  for (const id of ['a', 'b', 'away']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  assert.equal(t.lateRegEndsAt, null, 'late registration is not open at all');
  assert.equal(t.joinEndsAt! - t.startedAt!, DEFAULT_JOIN_MINUTES * 60_000);
});

test('the host can set the window, and change it mid-event', ctx => {
  const t = makeT(ctx, { joinMinutes: 40 });
  for (const id of ['a', 'b', 'away']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  assert.equal(t.joinEndsAt! - t.startedAt!, 40 * 60_000, 'the setting is honoured');

  t.updateSettings({ joinMinutes: 5 });
  assert.equal(t.joinEndsAt! - t.startedAt!, 5 * 60_000, 'and can be shortened while running');
});

test('the first two through the door do not play the opening hand alone', ctx => {
  // Seats are claimed one press at a time, so without a grace the opening
  // hand at table one would be heads-up while everyone else was still filing
  // in. The table holds its first deal until the rush is over.
  const t = makeT(ctx, { minPlayers: 3 });
  for (const id of ['a', 'b', 'c', 'd', 'e']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  t.joinTable('a');
  t.joinTable('b');
  const table = [...t.tables.values()][0];
  assert.ok(table.dealNotBefore > Date.now(), 'the deal is held');
  assert.equal(table.hand, null, 'and no hand has been dealt to the two of them');

  // Everyone else arrives into the same table, before a card is out.
  for (const id of ['c', 'd', 'e']) t.joinTable(id);
  assert.equal(table.seatedCount(), 5, 'all five are seated for the first hand');
});

test('a busted or unregistered player cannot claim a seat', ctx => {
  const t = makeT(ctx);
  for (const id of ['a', 'b', 'c', 'away']) t.register({ id, name: id, avatar: '🙂' });
  online(ctx, 'a', 'b', 'c');
  t.start();
  for (const id of ['a', 'b', 'c']) t.joinTable(id);

  assert.equal(t.canJoinTable('stranger'), false);
  assert.throws(() => t.joinTable('stranger'), /not registered/);

  t.kick('away');
  assert.equal(t.canJoinTable('away'), false, 'being removed closes the door');
  assert.throws(() => t.joinTable('away'), /out of this tournament/);
});

test('an unclaimed seat forfeits at the bottom when the window closes', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  // A one-minute window and a two-minute action clock: time can be advanced
  // past the deadline without any hand in progress reaching a decision, so
  // what is measured is the window closing and nothing else.
  const t = makeT(t2, { lateRegMinutes: 0, joinMinutes: 1, actionSeconds: 120 });
  for (const id of ['a', 'b', 'c', 'away1', 'away2']) t.register({ id, name: id, avatar: '🙂' });
  playerConnected('a'); playerConnected('b'); playerConnected('c');
  t2.after(() => { playerDisconnected('a'); playerDisconnected('b'); playerDisconnected('c'); });

  t.start();
  for (const id of ['a', 'b', 'c']) t.joinTable(id);
  assert.equal(t.alivePlayers().length, 5, 'the unseated pair are still in the field');

  t2.mock.timers.tick(61_000);
  assert.equal(t.state, 'running', 'the event carries on — three players are at the felt');

  assert.equal(t.players.get('away1')!.busted, true);
  assert.equal(t.players.get('away2')!.busted, true);
  // Below every player who actually sat down.
  assert.ok(t.players.get('away1')!.place! > 3, 'ranked beneath the three who played');
  assert.ok(t.players.get('away2')!.place! > 3);
  assert.equal(t.alivePlayers().length, 3, 'and the field is the three who are playing');
  assert.equal(t.canJoinTable('away1'), false, 'the window is shut');
});

// Pause was asked for as "everything stops", and the seat-claiming window is
// the one clock a waiting player can do nothing about. A director who pauses
// for twenty minutes must not come back to a field where everyone who had not
// yet pressed the button had forfeited during the freeze.
test('pausing freezes the window to claim a seat', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2, { joinMinutes: 1, actionSeconds: 120 });
  for (const id of ['a', 'b', 'away']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  t.joinTable('a');
  t.joinTable('b');

  t.pause();
  const leftAtPause = t.joinEndsAt! - Date.now();
  t2.mock.timers.tick(5 * 60_000); // five minutes of being paused
  assert.equal(
    t.joinEndsAt! - Date.now(), leftAtPause,
    'the countdown a waiting player watches sits still',
  );
  assert.equal(t.players.get('away')!.busted, false, 'and nobody forfeits during the freeze');

  t.resume();
  assert.ok(t.joinEndsAt! - Date.now() > 55_000, 'the full remainder is handed back');
  assert.equal(t.canJoinTable('away'), true, 'they can still take their seat');

  // And it still closes on time once play is running again.
  t2.mock.timers.tick(61_000);
  assert.equal(t.players.get('away')!.busted, true, 'the window closes after the resume');
});

// Fewer than two people ever sitting down used to leave a "running" event with
// no tables, no hands, and no way to reach a winner — it simply ran forever.
test('an event nobody joins resolves instead of running forever', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2, { joinMinutes: 1 });
  for (const id of ['a', 'b', 'c']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  t2.mock.timers.tick(61_000);
  assert.equal(t.state, 'cancelled', 'nobody played, so nobody is crowned');
});

test('an event only one player joins is theirs by walkover', t2 => {
  t2.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = makeT(t2, { joinMinutes: 1 });
  for (const id of ['a', 'b', 'c']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  t.joinTable('a');
  t2.mock.timers.tick(61_000);
  assert.equal(t.state, 'finished');
  assert.equal(t.players.get('a')!.place, 1, 'the one who turned up wins it');
  assert.equal(t.players.get('b')!.busted, true);
});

// Every healthy tournament reported itself corrupt for the length of the join
// window, because a player who has not claimed a seat has no seat by design.
test('a field still claiming seats is not reported as corrupt', ctx => {
  const t = makeT(ctx);
  for (const id of ['a', 'b', 'c', 'd']) t.register({ id, name: id, avatar: '🙂' });
  t.start();
  assert.equal(t.integrity().ok, true, 'nobody has joined yet, and that is fine');
  t.joinTable('a');
  t.joinTable('b');
  assert.equal(t.integrity().ok, true, 'half the field in, still fine');
  assert.deepEqual(t.integrity().seatless, [], 'an unclaimed seat is not a fault');
});
