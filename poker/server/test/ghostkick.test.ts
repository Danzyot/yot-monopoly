// "Make sure kicking after 5 offline turns" — end to end.
//
// The existing endnow test presets ghostHands and checks the tournament
// removes that player. This one never touches the counter: it disconnects a
// player for real and plays real hands, so the whole chain has to work —
// the action clock firing, the auto-fold, the per-hand accounting, and the
// eventual elimination.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GHOST_KICK_HANDS, IDLE_KICK_HANDS, Tournament } from '../src/tournament/tournament.ts';
import { playerConnected, playerDisconnected } from '../src/presence.ts';
import type { Table } from '../src/engine/table.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const CONFIG: TournamentConfig = {
  name: 'Ghosts', startingStack: 10_000, levelMinutes: 30, structure: 'regular',
  maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0, approveRegistrations: false,
  buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9, social: null,
  maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  // A five-second clock is the floor the table accepts; the test drives it
  // with fake timers, so this only decides how far to tick.
  actionSeconds: 5,
};

function makeT(ids: string[], onEliminated: (id: string) => void): Tournament {
  const t = new Tournament(CONFIG, { id: 'host', name: 'Host' }, {
    broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
    broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
    lobbyChanged: () => {}, finished: () => {},
    eliminated: (_t, p) => onEliminated(p.id),
  });
  for (const id of ids) t.register({ id, name: id.toUpperCase(), avatar: '🙂' });
  return t;
}

// Time has to be advanced in small steps, not one big jump: the table
// schedules the next player's clock the moment the current one resolves, so
// a single long tick cascades through the whole hand and times everyone out.
function step(clock: (ms: number) => void, done: () => boolean, whatFor: string) {
  for (let i = 0; i < 400; i++) {
    if (done()) return;
    clock(100);
  }
  assert.fail(`timed out waiting for ${whatFor}`);
}

// The live players check or call, never fold — that way the hand always
// reaches the ghost and they are genuinely asked to act. (Folding to them in
// the big blind would end the hand without a turn, which correctly does not
// count against a player: the limit is five offline *turns*.) The clock takes
// the ghost's turn. Returns once the hand in progress has finished.
function playHand(
  table: Table, ghostId: string, clock: (ms: number) => void,
  opts: { ghostActs?: boolean } = {},
) {
  const guard = 200; // a hand cannot need more decisions than this
  for (let i = 0; i < guard; i++) {
    if (!table.hand) return;
    const seat = table.hand.actionSeat();
    if (seat === null || seat < 0) return;
    const st = table.seats[seat];
    if (!st) return;
    if (st.player.id === ghostId && !opts.ghostActs) {
      // Nobody is home: let their action clock run out, and no further.
      step(clock, () => !table.hand || table.hand.actionSeat() !== seat, "the ghost's clock");
      continue;
    }
    const legal = table.hand.legalActions();
    table.applyAction(st.player.id, legal?.canCheck ? 'check' : 'call');
  }
  assert.fail('hand never finished');
}

// The table starts each hand off a timer of its own.
function nextHand(table: Table, clock: (ms: number) => void) {
  step(clock, () => !!table.hand, 'the next hand to be dealt');
}

test('a genuinely offline player is kicked after GHOST_KICK_HANDS hands', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });

  const eliminated: string[] = [];
  const tour = makeT(['alice', 'bob', 'ghost'], id => eliminated.push(id));
  // All three are at their screens when the clock strikes, so all three are
  // dealt in. Somebody who never connects at all is no longer seated in the
  // first place — they hold their place until they press Join table — so the
  // player this rule is actually for is one who sat down and then vanished.
  playerConnected('alice');
  playerConnected('bob');
  playerConnected('ghost');
  t.after(() => {
    playerDisconnected('alice');
    playerDisconnected('bob');
  });

  tour.start();

  joinEveryone(tour);
  playerDisconnected('ghost'); // and immediately drops
  const table = [...tour.tables.values()][0];
  const seatOf = (id: string) => table.seats.find(s => s?.player.id === id)!;

  const tick = (ms: number) => t.mock.timers.tick(ms);
  nextHand(table, tick);

  for (let hand = 1; hand <= GHOST_KICK_HANDS; hand++) {
    playHand(table, 'ghost', tick);
    assert.equal(
      seatOf('ghost').ghostHands, hand,
      `after ${hand} hand(s) offline the counter reads ${hand}`,
    );
    if (hand < GHOST_KICK_HANDS) {
      assert.equal(eliminated.length, 0, 'not kicked before the limit');
      nextHand(table, tick);
    }
  }

  // The kick runs off the tournament's post-hand hook.
  tick(5_000);
  assert.deepEqual(eliminated, ['ghost'], 'the ghost, and only the ghost, is out');
  assert.equal(tour.players.get('ghost')!.busted, true);
  assert.equal(tour.players.get('alice')!.busted, false, 'live players untouched');
  assert.equal(tour.players.get('bob')!.busted, false);
});

test('acting once clears the slate', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });

  const eliminated: string[] = [];
  const tour = makeT(['alice', 'bob', 'ghost'], id => eliminated.push(id));
  playerConnected('alice');
  playerConnected('bob');
  playerConnected('ghost'); // seated with everyone else, then loses the connection
  t.after(() => {
    playerDisconnected('alice');
    playerDisconnected('bob');
    playerDisconnected('ghost');
  });

  tour.start();

  joinEveryone(tour);
  playerDisconnected('ghost');
  const table = [...tour.tables.values()][0];
  const seatOf = (id: string) => table.seats.find(s => s?.player.id === id)!;
  const tick = (ms: number) => t.mock.timers.tick(ms);

  nextHand(table, tick);
  for (let i = 0; i < GHOST_KICK_HANDS - 1; i++) {
    playHand(table, 'ghost', tick);
    nextHand(table, tick);
  }
  assert.equal(seatOf('ghost').ghostHands, GHOST_KICK_HANDS - 1, 'one hand from the limit');
  assert.equal(seatOf('ghost').sittingOut, true, 'flagged away after missing turns');

  // They come back and actually play a hand.
  playerConnected('ghost');
  playHand(table, 'ghost', tick, { ghostActs: true });
  assert.equal(seatOf('ghost').ghostHands, 0, 'the slate is wiped');
  assert.equal(seatOf('ghost').sittingOut, false, 'and they are back on the normal clock');
  tick(5_000);
  assert.deepEqual(eliminated, [], 'nobody is removed');
});

// Two failures, opposite directions, same rule.
//
// Judging presence by the socket alone meant a tab left open on a sleeping
// phone read as "online", wiped the counter every hand, and was never
// removed. Ignoring the socket entirely was worse: players who had registered
// but not yet clicked through to their table were removed inside five hands
// and told they had already finished, having never played one. So a dropped
// connection costs five hands, and a live one costs many more.
test('a connected player who never acts is removed eventually, not in five hands', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });

  const eliminated: string[] = [];
  const tour = makeT(['alice', 'bob', 'idler'], id => eliminated.push(id));
  playerConnected('alice');
  playerConnected('bob');
  playerConnected('idler'); // tab open the whole time — never touches it
  t.after(() => {
    playerDisconnected('alice');
    playerDisconnected('bob');
    playerDisconnected('idler');
  });

  tour.start();

  joinEveryone(tour);
  const table = [...tour.tables.values()][0];
  const tick = (ms: number) => t.mock.timers.tick(ms);
  nextHand(table, tick);

  // Five silent hands is what removes someone who has DROPPED. A player who
  // is still connected has to be given room to arrive.
  for (let hand = 1; hand <= GHOST_KICK_HANDS; hand++) {
    playHand(table, 'idler', tick);
    if (hand < GHOST_KICK_HANDS) nextHand(table, tick);
  }
  tick(5_000);
  assert.deepEqual(eliminated, [], 'still connected, so still in at five hands');

  // Keep going and the abandoned tab does clear.
  for (let hand = GHOST_KICK_HANDS + 1; hand <= IDLE_KICK_HANDS; hand++) {
    nextHand(table, tick);
    playHand(table, 'idler', tick);
  }
  tick(5_000);
  assert.deepEqual(eliminated, ['idler'], 'an abandoned seat still clears in the end');
});
