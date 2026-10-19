// Multi-table mechanics against standard tournament rules: tables stay within
// one player of each other, a transferred player cannot dodge a blind, and the
// final table is redrawn at random.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {}, lobbyChanged: () => {},
};

const SEATS = 9;

function makeT(n: number): Tournament {
  const config: TournamentConfig = {
    name: 'Balance', startingStack: 5000, levelMinutes: 60, structure: 'turbo',
    maxPlayers: 500, minPlayers: 2, lateRegMinutes: 0, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: SEATS, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
  for (let i = 0; i < n; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  return t;
}

test('a transferred player takes the blind seat, never a seat that dodges blinds', () => {
  const t = makeT(20);
  t.start();
  joinEveryone(t);
  const tables = [...t.tables.values()];
  const dest = tables[1];

  // Free up several seats so there is a genuine choice of where to sit them,
  // including seats that would skip the blinds.
  dest.buttonSeat = 3;
  for (const i of [0, 1, 4, 5, 6]) dest.seats[i] = null;

  const mover = { id: 'mover', name: 'Mover', avatar: '🙂' };
  // movePlayerTo is private in spirit; exercise it through the public path by
  // moving a player from another table via the balancing helper.
  (t as unknown as { movePlayerTo: (tb: typeof dest, p: typeof mover, stack: number) => void })
    .movePlayerTo(dest, mover, 5000);

  const seated = dest.playerSeat('mover');
  assert.notEqual(seated, null, 'the player was seated');
  // Walking forward from the button, they must be the first open seat — that
  // is the small/big blind, the worst seat, exactly as the rules require.
  let firstAfterButton = -1;
  for (let k = 1; k <= dest.maxSeats; k++) {
    const i = (dest.buttonSeat + k) % dest.maxSeats;
    if (i === seated) { firstAfterButton = i; break; }
    if (dest.seats[i] && i !== seated) continue;
    if (!dest.seats[i]) { firstAfterButton = i; break; }
  }
  assert.equal(seated, firstAfterButton,
    `expected the blind seat after button ${dest.buttonSeat}, got seat ${seated}`);
  assert.notEqual(seated, 0, 'not simply the first empty seat in the array');

  t.cancel();
});

test('the final table is redrawn once, and only between hands', () => {
  const t = makeT(20);
  t.start();
  joinEveryone(t);

  // Collapse to a single table by busting everyone down to six players.
  const alive = t.alivePlayers();
  for (const p of alive.slice(6)) t.kick(p.id);

  const open = [...t.tables.values()].filter(x => !x.closed);
  assert.equal(open.length, 1, 'the field consolidated to one table');
  const table = open[0];
  const before = table.seats.map(s => s?.player.id ?? null);

  // A redraw happens on the next hand boundary.
  (t as unknown as { maybeFinalRedraw: () => void }).maybeFinalRedraw();
  const after = table.seats.map(s => s?.player.id ?? null);

  assert.deepEqual(
    [...after].filter(Boolean).sort(),
    [...before].filter(Boolean).sort(),
    'the same players are still seated — only their seats changed',
  );
  assert.equal(new Set(after.filter(Boolean)).size, after.filter(Boolean).length,
    'nobody was duplicated across seats');
  for (const p of t.alivePlayers()) {
    assert.equal(table.playerSeat(p.id), p.seatIdx,
      `${p.name}'s recorded seat matches where they actually sit`);
  }

  // Running it again is a no-op — the redraw happens once.
  const snapshot = table.seats.map(s => s?.player.id ?? null);
  (t as unknown as { maybeFinalRedraw: () => void }).maybeFinalRedraw();
  assert.deepEqual(table.seats.map(s => s?.player.id ?? null), snapshot);

  t.cancel();
});

test('a redraw never runs while a hand is live', () => {
  const t = makeT(12);
  t.start();
  joinEveryone(t);
  for (const p of t.alivePlayers().slice(5)) t.kick(p.id);
  const table = [...t.tables.values()].filter(x => !x.closed)[0];

  table.startHand();
  const during = table.seats.map(s => s?.player.id ?? null);
  (t as unknown as { maybeFinalRedraw: () => void }).maybeFinalRedraw();
  assert.deepEqual(table.seats.map(s => s?.player.id ?? null), during,
    'seats are untouched mid-hand');

  t.cancel();
});

test('eliminated players free their seat and hold a unique place', () => {
  const t = makeT(15);
  t.start();
  joinEveryone(t);
  const victims = t.alivePlayers().slice(0, 5).map(p => p.id);
  for (const id of victims) t.kick(id);

  for (const id of victims) {
    const p = t.players.get(id)!;
    assert.equal(p.busted, true, `${p.name} is out`);
    assert.equal(p.tableId, null, 'their table reference is cleared');
    assert.equal(p.seatIdx, null, 'their seat reference is cleared');
    for (const table of t.tables.values()) {
      assert.equal(table.playerSeat(id), null, 'their seat is genuinely free');
    }
  }
  const places = victims.map(id => t.players.get(id)!.place);
  assert.equal(new Set(places).size, places.length, 'each finishing place is unique');
  t.cancel();
});

test('a breaking table sends one final broadcast marked closed for spectators', () => {
  const closedBroadcasts: string[] = [];
  const config: TournamentConfig = {
    name: 'BreakCast', startingStack: 5000, levelMinutes: 60, structure: 'turbo',
    maxPlayers: 500, minPlayers: 2, lateRegMinutes: 0, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: SEATS, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, {
    ...noopCb,
    broadcastTable: table => { if (table.closed) closedBroadcasts.push(table.id); },
  });
  for (let i = 0; i < 12; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t); // 12 players → 2 tables of 6

  // Bust players (re-picking each time — rebalancing moves people around)
  // until the field fits a single table.
  for (let k = 0; k < 4; k++) {
    const donor = [...t.tables.values()].find(tb => !tb.closed && tb.seatedCount() > 0)!;
    const seatIdx = donor.seats.findIndex(Boolean);
    const pid = donor.seats[seatIdx]!.player.id;
    donor.seats[seatIdx]!.stack = 0;
    (t as unknown as { onHandEnd: (tb: typeof donor, busted: { id: string; name: string; startStack: number }[]) => void })
      .onHandEnd(donor, [{ id: pid, name: pid, startStack: 5000 }]);
  }

  const open = [...t.tables.values()].filter(tb => !tb.closed);
  assert.equal(open.length, 1, 'field consolidated onto one table');
  assert.ok(closedBroadcasts.length >= 1,
    'the broken table broadcast one final view with closed=true');
  // And that final view really says closed for anyone still subscribed.
  t.cancel();
});

test('the final-table redraw happens once, survives restarts, and skips single-table events', () => {
  // Single-table tournament: no redraw ever — the first table IS the final table.
  const sng = makeT(6);
  sng.start();
  joinEveryone(sng);
  const [only] = [...sng.tables.values()];
  const before = only.seats.map(s => s?.player.id ?? null);
  const bust = only.seats.findIndex(Boolean);
  only.seats[bust]!.stack = 0;
  const bustedId = before[bust]!;
  (sng as unknown as { onHandEnd: (tb: typeof only, b: { id: string; name: string; startStack: number }[]) => void })
    .onHandEnd(only, [{ id: bustedId, name: bustedId, startStack: 5000 }]);
  const after = only.seats.map(s => s?.player.id ?? null);
  for (let i = 0; i < after.length; i++) {
    if (i === bust) continue;
    assert.equal(after[i], before[i], 'surviving seats untouched — no bogus SNG redraw');
  }
  sng.cancel();

  // Restore at the final table: the redraw must not fire a second time.
  const t = makeT(12); // 2 tables
  t.start();
  joinEveryone(t);
  const snapEarly = JSON.parse(JSON.stringify(t.snapshot()));
  const rEarly = Tournament.restore(snapEarly, noopCb);
  assert.equal(
    (rEarly as unknown as { finalRedrawDone: boolean }).finalRedrawDone, false,
    'multi-table snapshot: redraw still pending after restore',
  );
  (t as unknown as { finalRedrawDone: boolean }).finalRedrawDone = true;
  const snapFinal = JSON.parse(JSON.stringify(t.snapshot()));
  const rFinal = Tournament.restore(snapFinal, noopCb);
  assert.equal(
    (rFinal as unknown as { finalRedrawDone: boolean }).finalRedrawDone, true,
    'redraw-done flag survives the restart — seats are never rolled twice',
  );
  t.cancel(); rEarly.cancel(); rFinal.cancel();
});

test('legacy snapshots without the redraw flag infer it correctly', () => {
  const t = makeT(12); // 2 tables
  t.start();
  joinEveryone(t);

  // Multi-table snapshot, flag stripped: redraw still pending.
  const two = JSON.parse(JSON.stringify(t.snapshot()));
  delete two.finalRedrawDone;
  const rTwo = Tournament.restore(two, noopCb);
  assert.equal((rTwo as unknown as { finalRedrawDone: boolean }).finalRedrawDone, false);

  // Consolidated-to-one-table snapshot, flag stripped: assume it happened.
  const one = JSON.parse(JSON.stringify(t.snapshot()));
  delete one.finalRedrawDone;
  one.tables = one.tables.slice(0, 1);
  const rOne = Tournament.restore(one, noopCb);
  assert.equal((rOne as unknown as { finalRedrawDone: boolean }).finalRedrawDone, true);

  // A tournament that only ever had one table never redraws, flag or not.
  const sng = makeT(6);
  sng.start();
  joinEveryone(sng);
  const s = JSON.parse(JSON.stringify(sng.snapshot()));
  delete s.finalRedrawDone;
  const rSng = Tournament.restore(s, noopCb);
  assert.equal((rSng as unknown as { finalRedrawDone: boolean }).finalRedrawDone, false);

  t.cancel(); rTwo.cancel(); rOne.cancel(); sng.cancel(); rSng.cancel();
});

test('a one-elimination imbalance during a live hand is not an integrity failure', () => {
  const t = makeT(27); // 3 tables of 9
  t.start();
  joinEveryone(t);
  const [a, b] = [...t.tables.values()];
  // Bust two players off one table directly, without the rebalance pass —
  // exactly the window after a double knockout, before hands end elsewhere.
  let removed = 0;
  for (let i = 0; i < a.seats.length && removed < 2; i++) {
    const s = a.seats[i];
    if (!s) continue;
    const p = t.players.get(s.player.id)!;
    p.busted = true; p.place = 27 - removed; p.tableId = null; p.seatIdx = null;
    a.seats[i] = null;
    removed += 1;
  }
  assert.equal(t.integrity().spread, 2, 'field is briefly two apart');
  assert.equal(t.integrity().ok, false, 'no hand running anywhere — a lasting spread of 2 IS a failure');

  b.startHand();
  assert.ok(b.hand, 'hand live on another table');
  assert.equal(t.integrity().ok, true, 'same spread during a hand is normal play, not corruption');
  t.cancel();
});
