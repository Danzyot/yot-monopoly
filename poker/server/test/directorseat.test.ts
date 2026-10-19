// The director's override: seat anyone, at any time, with any stack.
//
// Everything else that seats a player enforces a rule — late registration
// open, the field under its cap, re-entries remaining. This is the escape
// hatch for when those rules are the problem, so the test's job is to prove
// it ignores them AND that the accounting behind it stays honest: who owns an
// entry, whether the prize pool moved, and how many places are left to award.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const cb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
  lobbyChanged: () => {},
};

// Started tournaments hold live timers — the level clock and each table's
// next-hand timer. Left running they keep the test process alive after the
// last assertion, so every tournament this file makes is disposed with its test.
function makeT(ctx: { after: (fn: () => void) => void }, over: Partial<TournamentConfig> = {}) {
  const config = {
    name: `Director ${Math.random()}`, startingStack: 10_000, levelMinutes: 60,
    structure: 'regular', maxPlayers: 6, minPlayers: 2, lateRegMinutes: 0,
    approveRegistrations: false, buyIn: 100, prizeText: null, breakEveryLevels: 0,
    seatsPerTable: 9, social: null, maxReentries: 0, rabbitHunting: false,
    displayMode: 'chips', ...over,
  } as TournamentConfig;
  const t = new Tournament(config, { id: 'host', name: 'Host' }, cb as never);
  for (let i = 0; i < 6; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  ctx.after(() => t.dispose());
  return t;
}

const stackOf = (t: Tournament, id: string): number | null => {
  const p = t.players.get(id);
  if (!p?.tableId) return null;
  const table = t.tables.get(p.tableId)!;
  const idx = table.playerSeat(id);
  return idx === null ? null : table.seats[idx]!.stack;
};

test('a name the site has never entered is added mid-game', ctx => {
  const t = makeT(ctx);
  t.start();
  joinEveryone(t);
  // Late reg is closed (0 minutes) and the field is at its cap of 6. Both of
  // those stop a normal registration dead.
  assert.throws(() => t.register({ id: 'walkin', name: 'Walk In', avatar: '🙂' }));

  const pool = t.prizePool;
  const r = t.directorSeat({ id: 'walkin', name: 'Walk In', avatar: '🐴' }, 4_200);
  assert.equal(r.action, 'added');
  assert.equal(stackOf(t, 'walkin'), 4_200, 'seated with exactly what was asked for');
  assert.equal(t.players.get('walkin')!.entries, 1);
  assert.equal(t.prizePool, pool + t.config.buyIn, 'a genuinely new entry does grow the pool');
  assert.equal(t.alivePlayers().length, 7);
});

test('a busted player goes back in without buying an entry', ctx => {
  const t = makeT(ctx);
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];
  table.seats[table.playerSeat('p2')!]!.stack = 7_350;
  t.kick('p2');
  assert.equal(t.players.get('p2')!.busted, true);

  const pool = t.prizePool;
  const entries = t.totalEntries;
  const r = t.directorSeat({ id: 'p2', name: 'P2', avatar: '🙂' });
  assert.equal(r.action, 'reinstated');
  // No stack given, so they get back what they were sitting behind.
  assert.equal(stackOf(t, 'p2'), 7_350);
  assert.equal(t.players.get('p2')!.busted, false);
  assert.equal(t.players.get('p2')!.place, null, 'they have not finished after all');
  assert.equal(t.prizePool, pool, 'a correction does not move the prize pool');
  assert.equal(t.totalEntries, entries, 'and does not cost an entry');
});

test('an override stack beats the stack they went out with', ctx => {
  const t = makeT(ctx);
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];
  table.seats[table.playerSeat('p3')!]!.stack = 500;
  t.kick('p3');
  t.directorSeat({ id: 'p3', name: 'P3', avatar: '🙂' }, 25_000);
  assert.equal(stackOf(t, 'p3'), 25_000);
});

test('someone in the field with no seat is seated, keeping their entry', ctx => {
  const t = makeT(ctx, { maxReentries: 0 });
  t.start();
  joinEveryone(t);
  // Take p4 off the felt the way a between-tables gap looks: seat cleared,
  // still alive in the field.
  const p = t.players.get('p4')!;
  const table = t.tables.get(p.tableId!)!;
  table.seats[table.playerSeat('p4')!] = null;
  p.tableId = null;
  p.seatIdx = null;

  const entries = t.totalEntries;
  const r = t.directorSeat({ id: 'p4', name: 'P4', avatar: '🙂' }, 3_000);
  assert.equal(r.action, 'seated');
  assert.equal(stackOf(t, 'p4'), 3_000);
  assert.equal(t.totalEntries, entries, 'they already owned their entry');
});

test('a player already at a table is refused, not duplicated', ctx => {
  const t = makeT(ctx);
  t.start();
  joinEveryone(t);
  assert.throws(
    () => t.directorSeat({ id: 'p1', name: 'P1', avatar: '🙂' }, 9_999),
    /already at a table/,
  );
  assert.equal(stackOf(t, 'p1'), 10_000, 'their stack is untouched');
});

test('the picker lists who can be seated, most likely first', ctx => {
  const t = makeT(ctx);
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];
  table.seats[table.playerSeat('p5')!]!.stack = 1_234;
  t.kick('p5');

  const rows = t.directorPeople([
    { id: 'p1', name: 'P1', avatar: '🙂' },   // already in — must not double up
    { id: 'stranger', name: 'Stranger', avatar: '👽' },
  ]);
  assert.equal(rows.filter(r => r.id === 'p1').length, 1, 'no duplicate rows');
  assert.equal(rows.find(r => r.id === 'p5')!.status, 'busted');
  assert.equal(rows.find(r => r.id === 'p5')!.lastStack, 1_234, 'their stack is offered as the default');
  assert.equal(rows.find(r => r.id === 'stranger')!.status, 'new');
  assert.equal(rows.find(r => r.id === 'p1')!.status, 'playing');
  // Players already at a table sort last: they are the least likely answer.
  assert.ok(
    rows.findIndex(r => r.status === 'busted') < rows.findIndex(r => r.status === 'playing'),
  );
});

test('the override refuses to run before the tournament starts or after it ends', ctx => {
  const t = makeT(ctx);
  assert.throws(
    () => t.directorSeat({ id: 'walkin', name: 'Walk In', avatar: '🙂' }, 5_000),
    /register them normally/,
  );
  t.start();
  joinEveryone(t);
  t.endNow();
  assert.throws(
    () => t.directorSeat({ id: 'walkin', name: 'Walk In', avatar: '🙂' }, 5_000),
    /over/,
  );
});
