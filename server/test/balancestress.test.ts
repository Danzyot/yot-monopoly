// Table balancing under the shape of a real event: a big field, late
// registration still open while people are already busting, and eliminations
// arriving in no particular order.
//
// The rule tournaments are held to is that no table may be more than one
// player larger than any other. With no hand in progress there is no excuse
// for a bigger spread — a table between hands can always give a player up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {}, lobbyChanged: () => {},
};

function makeT(seats: number, lateRegMinutes = 60): Tournament {
  const config: TournamentConfig = {
    name: 'Stress', startingStack: 5000, levelMinutes: 60, structure: 'regular',
    maxPlayers: 1000, minPlayers: 2, lateRegMinutes, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: seats, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  return new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
}

// A deterministic shuffle, so a failure can be reproduced exactly.
function order(n: number, seed: number): number[] {
  const a = [...Array(n).keys()];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function spreadOf(t: Tournament): { spread: number; counts: number[] } {
  const counts = [...t.tables.values()].filter(x => !x.closed).map(x => x.seatedCount());
  const spread = counts.length > 1 ? Math.max(...counts) - Math.min(...counts) : 0;
  return { spread, counts };
}

test('a big field stays balanced as it busts down', () => {
  const t = makeT(9);
  for (let i = 0; i < 349; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);

  const ids = order(349, 7).map(i => `p${i}`);
  for (let k = 0; k < 300; k++) {
    t.kick(ids[k]);
    if (t.state === 'finished') break;
    const { spread, counts } = spreadOf(t);
    assert.ok(
      spread <= 1,
      `after ${k + 1} eliminations the tables are ${counts.join('/')} — spread ${spread}`,
    );
  }
  t.cancel();
});

test('late registrants arriving mid-bust do not unbalance the field', () => {
  const t = makeT(9);
  for (let i = 0; i < 120; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);

  // The shape of the live event: people still joining while others bust.
  let late = 0;
  const ids = order(120, 3).map(i => `p${i}`);
  for (let k = 0; k < 100; k++) {
    t.kick(ids[k]);
    if (t.state === 'finished') break;
    if (k % 2 === 0 && late < 150) {
      t.register({ id: `late${late}`, name: `L${late}`, avatar: '🙂' });
      late += 1;
    }
    const { spread, counts } = spreadOf(t);
    assert.ok(
      spread <= 1,
      `after ${k + 1} outs and ${late} late entries the tables are ${counts.join('/')} — spread ${spread}`,
    );
  }
  t.cancel();
});

test('the field collapses onto as few tables as it fits', () => {
  const t = makeT(9);
  for (let i = 0; i < 90; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);
  assert.equal([...t.tables.values()].filter(x => !x.closed).length, 10, 'ten tables to start');

  const ids = order(90, 11).map(i => `p${i}`);
  for (let k = 0; k < 81; k++) {
    t.kick(ids[k]);
    if (t.state === 'finished') break;
    const alive = t.alivePlayers().length;
    const open = [...t.tables.values()].filter(x => !x.closed).length;
    const needed = Math.ceil(alive / 9);
    assert.ok(
      open <= needed,
      `${alive} players are spread over ${open} tables when ${needed} would hold them`,
    );
  }
  t.cancel();
});
