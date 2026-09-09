import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tournament, type TournamentCallbacks } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb: TournamentCallbacks = {
  broadcastTable: () => {},
  tableChat: () => {},
  tableEvent: () => {},
  broadcastTourney: () => {},
  tourneyChat: () => {},
  assigned: () => {},
  lobbyChanged: () => {},
};

function makeT(maxReentries: number): Tournament {
  const config: TournamentConfig = {
    name: 'ReentryTest', startingStack: 5000, levelMinutes: 60, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 60, approveRegistrations: false, buyIn: 100,
    breakEveryLevels: 0, seatsPerTable: 9, social: null, maxReentries, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  return new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
}

const P = (n: number) => ({ id: `p${n}`, name: `P${n}`, avatar: '🙂' });

test('prize pool counts re-entries', () => {
  const t = makeT(2);
  for (let i = 1; i <= 4; i++) t.register(P(i));
  assert.equal(t.prizePool, 400);
  t.start();
  joinEveryone(t);
  // Simulate a bust of p1 through the internal elimination path:
  const p1 = t.players.get('p1')!;
  p1.busted = true;
  p1.place = 4;
  const table = t.tables.get(p1.tableId!)!;
  const idx = table.playerSeat('p1')!;
  table.seats[idx] = null;
  p1.tableId = null;

  assert.ok(t.canReenter('p1'));
  t.reenter('p1');
  assert.equal(t.players.get('p1')!.entries, 2);
  assert.equal(t.players.get('p1')!.busted, false);
  assert.equal(t.prizePool, 500); // 5 entries x 100
  assert.ok(t.players.get('p1')!.tableId, 'reseated at a table');
  t.cancel(); // clear level clock + table timers so the process can exit
});

test('freezeout blocks re-entry', () => {
  const t = makeT(0);
  for (let i = 1; i <= 3; i++) t.register(P(i));
  t.start();
  joinEveryone(t);
  const p1 = t.players.get('p1')!;
  p1.busted = true;
  p1.place = 3;
  assert.equal(t.canReenter('p1'), false);
  assert.throws(() => t.reenter('p1'), /re-entry is closed/);
  t.cancel();
});

test('re-entry limit enforced', () => {
  const t = makeT(1);
  for (let i = 1; i <= 3; i++) t.register(P(i));
  t.start();
  joinEveryone(t);
  const bust = () => {
    const p1 = t.players.get('p1')!;
    p1.busted = true;
    if (p1.tableId) {
      const table = t.tables.get(p1.tableId)!;
      const idx = table.playerSeat('p1');
      if (idx !== null) table.seats[idx] = null;
      p1.tableId = null;
    }
  };
  bust();
  t.reenter('p1'); // entry #2 (1 re-entry used)
  bust();
  assert.equal(t.canReenter('p1'), false); // limit reached
  t.cancel();
});
