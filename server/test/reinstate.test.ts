// Putting one player back after they were removed for a reason that was not
// their doing. This is deliberately NOT re-entry: no extra entry is bought,
// the prize pool does not move, and the field is not reopened to everyone
// else who busted fairly.
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

function makeT(over: Partial<TournamentConfig> = {}) {
  const config = {
    name: `Reinstate ${Math.random()}`, startingStack: 10_000, levelMinutes: 60,
    structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0,
    approveRegistrations: false, buyIn: 100, prizeText: null, breakEveryLevels: 0,
    seatsPerTable: 9, social: null, maxReentries: 0, rabbitHunting: false,
    displayMode: 'chips', ...over,
  } as TournamentConfig;
  const t = new Tournament(config, { id: 'host', name: 'Host' }, cb as never);
  for (let i = 0; i < 6; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  return t;
}

test('a removed player comes back with the stack they had', () => {
  const t = makeT();
  t.start();
  joinEveryone(t);
  // Give p2 a distinctive stack, then knock them out.
  const table = [...t.tables.values()][0];
  const seat = table.playerSeat('p2')!;
  table.seats[seat]!.stack = 7_350;
  t.kick('p2');
  assert.equal(t.players.get('p2')!.busted, true);

  t.reinstate('p2');
  const p = t.players.get('p2')!;
  assert.equal(p.busted, false, 'back in');
  assert.equal(p.place, null, 'and no longer counted as finished');
  const back = [...t.tables.values()].find(x => x.playerSeat('p2') !== null)!;
  assert.equal(back.seats[back.playerSeat('p2')!]!.stack, 7_350, 'with what they had');
  t.cancel();
});

test('it does not buy an entry or move the prize pool', () => {
  const t = makeT();
  t.start();
  joinEveryone(t);
  const entriesBefore = t.totalEntries;
  const poolBefore = t.prizePool;
  t.kick('p3');
  t.reinstate('p3');

  assert.equal(t.totalEntries, entriesBefore, 'no extra entry');
  assert.equal(t.prizePool, poolBefore, 'prize pool untouched');
  assert.equal(t.players.get('p3')!.entries, 1, 'still a single entry');
  t.cancel();
});

test('it does not reopen the field to everyone else', () => {
  const t = makeT({ maxReentries: 0 });
  t.start();
  joinEveryone(t);
  t.kick('p4');
  t.kick('p5');
  t.reinstate('p4');
  // p5 busted fairly and re-entry is off — the correction must not help them.
  assert.equal(t.canReenter('p5'), false, 're-entry stays closed');
  assert.equal(t.players.get('p5')!.busted, true, 'and they are still out');
  t.cancel();
});

test('it refuses the cases that would corrupt the standings', () => {
  const t = makeT();
  t.start();
  joinEveryone(t);
  assert.throws(() => t.reinstate('p0'), /still in the tournament/i, 'not busted');
  assert.throws(() => t.reinstate('nobody'), /not registered/i, 'unknown player');
  t.kick('p1');
  t.cancel();
  assert.throws(() => t.reinstate('p1'), /not running/i, 'after the event is over');
});

test('the field grows, and the next player out finishes below them', () => {
  const t = makeT();
  t.start();
  joinEveryone(t);
  t.kick('p5');                       // 6 alive -> finishes 6th
  assert.equal(t.players.get('p5')!.place, 6);
  t.reinstate('p5');                  // back to 6 alive
  assert.equal(t.alivePlayers().length, 6);
  t.kick('p4');
  assert.equal(t.players.get('p4')!.place, 6, 'the next out takes 6th, not 5th');
  t.cancel();
});
