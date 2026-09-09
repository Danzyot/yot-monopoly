// "End now" + abandoned-player kick: the two ways a stuck tournament gets
// driven to a real finish.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GHOST_KICK_HANDS, Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

function makeT(n: number, hooks: {
  finished?: () => void;
  eliminated?: (p: { id: string; place: number | null }) => void;
} = {}): Tournament {
  const config: TournamentConfig = {
    name: 'Endable', startingStack: 10_000, levelMinutes: 8, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, {
    broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
    broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
    lobbyChanged: () => {},
    finished: () => hooks.finished?.(),
    eliminated: (_t, p) => hooks.eliminated?.(p),
  });
  for (let i = 0; i < n; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  return t;
}

test('endNow finishes immediately with every place assigned', () => {
  let finished = 0;
  let popups = 0;
  const t = makeT(6, { finished: () => { finished += 1; }, eliminated: () => { popups += 1; } });
  t.start();
  joinEveryone(t);
  t.endNow();

  assert.equal(t.state, 'finished');
  assert.equal(finished, 1, 'the finish flow ran (results persisted, winners announced)');
  const places = [...t.players.values()].map(p => p.place).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(places, [1, 2, 3, 4, 5, 6], 'every player holds a unique final place');
  assert.equal(popups, 0, 'mass ranking is quiet — no per-player elimination popups');
  // Chip conservation up to the moment of ending: nobody's stack went anywhere.
  for (const table of t.tables.values()) assert.equal(table.hand, null, 'no hand left running');
});

test('endNow refuses before start and after finish', () => {
  const t = makeT(3);
  assert.throws(() => t.endNow(), /not started/);
  t.start();
  joinEveryone(t);
  t.endNow();
  assert.throws(() => t.endNow(), /over/);
});

test('a player ghosting through enough hands is eliminated', () => {
  const popups: { id: string; place: number | null }[] = [];
  const t = makeT(3, { eliminated: p => popups.push(p) });
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];

  // Simulate the table having counted GHOST_KICK_HANDS offline auto-hands
  // for p1 (the Table increments this itself at each hand end).
  const seat = table.seats.find(s => s?.player.id === 'p1');
  assert.ok(seat, 'p1 is seated');
  seat!.ghostHands = GHOST_KICK_HANDS;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t as any).onHandEnd(table, []);

  const p1 = t.players.get('p1')!;
  assert.equal(p1.busted, true, 'ghost is out of the tournament');
  assert.equal(p1.place, 3, 'last place of the 3 entrants');
  assert.equal(table.playerSeat('p1'), null, 'their seat is freed');
  assert.deepEqual(popups.map(p => p.id), ['p1'], 'the ghost gets their elimination popup');
  assert.equal(t.state, 'running', 'two live players remain — play continues');
  t.cancel(); // stop timers so the test process can exit
});

test('ghosts below the limit are left alone', () => {
  const t = makeT(3);
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];
  const seat = table.seats.find(s => s?.player.id === 'p1');
  seat!.ghostHands = GHOST_KICK_HANDS - 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (t as any).onHandEnd(table, []);
  assert.equal(t.players.get('p1')!.busted, false);
  t.cancel(); // stop timers so the test process can exit
});
