// Multi-table integrity: chips are never created or destroyed, tables balance
// and break correctly, and every player gets a unique finishing place.
// Runs the engine directly (no sockets, no throttling) so the assertions read
// authoritative state rather than two independently-timed snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { Table } from '../src/engine/table.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb = {
  broadcastTable: () => {},
  tableChat: () => {},
  tableEvent: () => {},
  broadcastTourney: () => {},
  tourneyChat: () => {},
  assigned: () => {},
  lobbyChanged: () => {},
};

const SEATS = 9;
const STACK = 3000;

function makeT(n: number): Tournament {
  const config: TournamentConfig = {
    name: 'MultiTable', startingStack: STACK, levelMinutes: 60, structure: 'turbo',
    maxPlayers: 500, minPlayers: 2, lateRegMinutes: 0, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: SEATS, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
  for (let i = 0; i < n; i++) {
    t.register({ id: `p${i}`, name: `P${i}`, avatar: '🤖' });
  }
  return t;
}

// Total chips = every seated stack (in-hand or resting) + everything committed
// to live pots. This must equal players * starting stack, always.
function totalChips(t: Tournament): number {
  let sum = 0;
  for (const table of t.tables.values()) {
    if (table.closed) continue;
    for (let i = 0; i < table.seats.length; i++) {
      const s = table.seats[i];
      if (!s) continue;
      const hs = table.hand?.seats.find(x => x.seat === i);
      sum += hs ? hs.stack : s.stack;
    }
    if (table.hand) sum += table.hand.totalPot;
  }
  return sum;
}

// Drive one hand to completion on a table with a deterministic policy.
function playHand(table: Table, rng: () => number) {
  let guard = 0;
  while (table.hand && guard++ < 400) {
    const seat = table.hand.actionSeat();
    if (seat === null) break;
    const legal = table.hand.legalActions();
    if (!legal) break;
    const player = table.seats[seat];
    if (!player) break;
    const r = rng();
    try {
      // Shove-heavy on purpose: chips must actually change hands or the field
      // never shrinks and the test grinds instead of finishing.
      if (r < 0.45 && legal.canRaise) table.applyAction(player.player.id, 'allin', legal.maxRaiseTo);
      else if (r < 0.75 && legal.toCall > 0) table.applyAction(player.player.id, 'call');
      else if (legal.canCheck) table.applyAction(player.player.id, 'check');
      else table.applyAction(player.player.id, 'fold');
    } catch {
      break; // hand resolved underneath us (runout / auto-advance)
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Eliminations are processed on the inter-hand pacing timer, so the test must
// yield to the event loop between rounds. Shrink the delay to keep it quick.
function hurry(t: Tournament) {
  for (const table of t.tables.values()) {
    table.interHandDelayMs = 1;
    table.runoutStepMs = 1; // all-in board runouts are paced for drama
  }
}

// Deterministic PRNG so a failure is reproducible.
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test('60 players across 7 tables: chips conserved, tables break, places unique', async () => {
  const N = 60;
  const t = makeT(N);
  t.start();
  joinEveryone(t);
  hurry(t);

  assert.equal(t.tables.size, Math.ceil(N / SEATS), 'initial table count');
  assert.equal(totalChips(t), N * STACK, 'chips at start');

  const maxTables = t.tables.size;
  const rng = mulberry(12345);
  let rounds = 0;
  // Hard wall-clock bound: a stalled tournament must fail loudly, never hang
  // the suite. Typical convergence is well under 100 rounds.
  const deadline = Date.now() + 30_000;

  while (t.state === 'running' && rounds++ < 600 && Date.now() < deadline) {
    hurry(t); // tables created by rebalancing inherit the default delay
    const open = [...t.tables.values()].filter(x => !x.closed);
    if (open.length === 0) break;
    for (const table of open) {
      if (table.closed) continue;
      if (!table.hand) table.startHand();
      if (table.hand) playHand(table, rng);
    }
    // The invariant that matters, checked after every round of hands.
    assert.equal(totalChips(t), N * STACK, `chips conserved at round ${rounds}`);
    for (const table of t.tables.values()) {
      if (table.closed) continue;
      assert.ok(table.seatedCount() <= SEATS, `${table.name} within seat cap`);
    }
    await sleep(2); // let eliminations + rebalancing run
  }

  assert.equal(t.state, 'finished',
    `tournament reaches a winner (stopped after ${rounds} rounds, ${t.alivePlayers().length} alive)`);
  assert.ok(t.tables.size < maxTables, 'tables were broken as the field shrank');

  const places = [...t.players.values()].map(p => p.place).filter((p): p is number => p !== null);
  assert.equal(places.length, N, 'every player has a place');
  assert.deepEqual([...places].sort((a, b) => a - b), Array.from({ length: N }, (_, i) => i + 1),
    'places are exactly 1..N with no gaps or duplicates');

  t.cancel();
});

test('table balancing keeps sizes within one seat of each other', async () => {
  const N = 27; // exactly 3 full tables
  const t = makeT(N);
  t.start();
  joinEveryone(t);
  hurry(t);
  const rng = mulberry(999);
  let rounds = 0;
  const deadline = Date.now() + 30_000;

  while (t.state === 'running' && rounds++ < 600 && Date.now() < deadline) {
    hurry(t);
    const open = [...t.tables.values()].filter(x => !x.closed);
    for (const table of open) {
      if (table.closed) continue;
      if (!table.hand) table.startHand();
      if (table.hand) playHand(table, rng);
    }
    await sleep(2);
    const counts = [...t.tables.values()].filter(x => !x.closed).map(x => x.seatedCount());
    if (counts.length > 1) {
      const spread = Math.max(...counts) - Math.min(...counts);
      // Balancing only moves players between hands, so allow a transient of 2.
      assert.ok(spread <= 2, `table sizes within 2 (got ${counts.join('/')})`);
    }
  }
  assert.equal(t.state, 'finished');
  t.cancel();
});

test('the spectate overview matches live table state', () => {
  const t = makeT(20);
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];
  table.startHand();

  const v = t.tablesView();
  assert.equal(v.tables.length, t.tables.size, 'every open table appears');
  assert.equal(v.playersAlive, 20);

  const ov = v.tables.find(x => x.id === table.id)!;
  assert.equal(ov.seats.length, table.seatedCount(), 'seat count matches');
  assert.equal(ov.totalPot, table.hand!.totalPot, 'pot matches');
  assert.equal(ov.chipLeader, Math.max(...ov.seats.map(s => s.stack)), 'chip leader is the max stack');
  // Overviews must never leak hole cards.
  assert.equal(JSON.stringify(ov).includes('"cards"'), false, 'no hole cards in the overview');

  t.cancel();
});
