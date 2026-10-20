// Cash tables are retired. A live snapshot written before that can still
// hold open cash tables; at boot they are cashed out and filed under Past
// games instead of being brought back, tournaments beside them come back as
// before, and nothing in an old or broken file can stop the server starting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TournamentConfig } from '../../shared/types.ts';

const DATA = mkdtempSync(join(tmpdir(), 'chog-legacycash-'));
process.env.DATA_DIR = DATA;
const { restoreLive, snapshotLive } = await import('../src/persist.ts');
const { allCashRecords, loadCashRecords } = await import('../src/store.ts');
const { registry } = await import('../src/registry.ts');
const { settleCashSnapshot } = await import('../src/legacycash.ts');

registry.emitter = {
  broadcastTable() {}, tableChat() {}, tableEvent() {}, tableReaction() {},
  broadcastTourney() {}, tourneyChat() {}, assigned() {}, tourneyFinished() {}, tourneyEliminated() {}, lobbyChanged() {},
};

const LIVE = join(DATA, 'live.json');
const CASH = join(DATA, 'cash-history.json');

// What the old server wrote for an open cash table (registry.cashSnapshot):
// stacks already rolled back to before any hand in progress.
const oldCashTable = (id: string, name: string) => ({
  id, name, sb: 25, bb: 50, ante: 0, maxSeats: 6, minBuy: 1000, maxBuy: 5000,
  hostId: 'dc_host', hostName: 'Danz', playerHosted: false,
  actionTimeMs: 22_000, timebankMs: 0, rabbitHunting: false, theme: null,
  buttonSeat: 2, handNumber: 41,
  seats: [
    { idx: 0, player: { id: 'dc_a', name: 'Ann', avatar: '🙂' }, stack: 1200, sittingOut: false, timebankMs: 0, buyInTotal: 2000 },
    { idx: 3, player: { id: 'dc_b', name: 'Ben', avatar: '😎' }, stack: 3800, sittingOut: true, timebankMs: 0, buyInTotal: 2000 },
  ],
  history: { eventLog: [], handRecords: [], chatLog: [] },
});

const config = (name: string): TournamentConfig => ({
  name, startingStack: 10_000, levelMinutes: 8, structure: 'regular', maxPlayers: null, minPlayers: 2,
  lateRegMinutes: 15, approveRegistrations: false, buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9,
  social: null, maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
});

test('a cash table from an old snapshot settles the way a host closing it did', () => {
  const rec = settleCashSnapshot(oldCashTable('c0ffee01', 'Friday Cash'), 5_000)!;
  assert.equal(rec.id, 'c0ffee01');
  assert.equal(rec.name, 'Friday Cash');
  assert.equal(rec.hostName, 'Danz');
  assert.deepEqual([rec.sb, rec.bb, rec.hands, rec.closedAt], [25, 50, 41, 5_000]);
  // Everyone cashed out at their stack, best result first.
  assert.deepEqual(rec.ledger.map(l => [l.name, l.buyIn, l.cashOut, l.stack, l.net]), [
    ['Ben', 2000, 3800, null, 1800],
    ['Ann', 2000, 1200, null, -800],
  ]);
});

test('whatever is in the file, settling never throws', () => {
  for (const junk of [null, undefined, 42, 'table', [], {}, { id: '' }, { id: 7 }]) {
    assert.equal(settleCashSnapshot(junk), null, JSON.stringify(junk));
  }
  // A table with unreadable parts still files what it can.
  const rec = settleCashSnapshot({ id: 'beefbeef', seats: [null, 'x', { player: null }, { player: { id: 'dc_c' }, stack: 'lots' }] })!;
  assert.equal(rec.name, 'Cash table');
  assert.deepEqual(rec.ledger.map(l => [l.playerId, l.name, l.cashOut, l.net]), [['dc_c', 'Player', 0, 0]]);
});

test('at boot: tournaments come back, cash tables are closed and filed, once', () => {
  // Past cash sessions already on disk must survive the new ones being added.
  writeFileSync(CASH, JSON.stringify([{
    id: 'old00001', name: 'Long Gone', hostName: 'Danz', openedAt: 1, closedAt: 2, sb: 1, bb: 2, hands: 3, ledger: [],
  }]));
  loadCashRecords();

  const t = registry.createTournament(config('Survivor Cup'), { id: 'dc_op', name: 'Op' });
  t.register({ id: 'dc_p', name: 'P', avatar: '🙂' });
  const tourneySnap = JSON.parse(JSON.stringify(t.snapshot()));
  registry.deleteGame(t.id);

  writeFileSync(LIVE, JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    tournaments: [tourneySnap],
    cashTables: [oldCashTable('c0ffee02', 'Late Cash'), 'garbage', { id: 'c0ffee03', name: 'Empty Cash', seats: [] }],
  }));

  const out = restoreLive();
  assert.equal(out.tournaments, 1);
  assert.deepEqual(out.closedCash, ['c0ffee02', 'c0ffee03']);
  assert.ok(registry.tournaments.has(tourneySnap.id), 'the tournament is back');
  assert.equal(registry.findTable('c0ffee02'), null, 'the cash table is not');
  assert.equal('cashTables' in registry, false, 'there is nowhere for one to live');

  const onDisk = JSON.parse(readFileSync(CASH, 'utf8')) as { id: string; ledger: unknown[] }[];
  assert.deepEqual(onDisk.map(r => r.id).sort(), ['c0ffee02', 'c0ffee03', 'old00001']);
  assert.equal(allCashRecords().find(r => r.id === 'c0ffee02')?.ledger.length, 2);

  // The next snapshot no longer carries them, and a second boot from the old
  // file (a crash before that snapshot) files nothing twice.
  restoreLive();
  assert.equal(allCashRecords().filter(r => r.id === 'c0ffee02').length, 1);
  snapshotLive();
  const fresh = JSON.parse(readFileSync(LIVE, 'utf8')) as Record<string, unknown>;
  assert.equal('cashTables' in fresh, false);
  assert.equal((fresh.tournaments as unknown[]).length, 1);
  for (const id of [...registry.tournaments.keys()]) registry.deleteGame(id);
});

test('a stale snapshot restores no tournament but still files its cash tables', () => {
  writeFileSync(LIVE, JSON.stringify({
    v: 1, savedAt: Date.now() - 24 * 3_600_000, tournaments: [], cashTables: [oldCashTable('c0ffee04', 'Stale Cash')],
  }));
  const out = restoreLive();
  assert.deepEqual(out, { tournaments: 0, closedCash: ['c0ffee04'] });
  assert.ok(allCashRecords().some(r => r.id === 'c0ffee04'));
});

test('a broken or foreign live file never stops the server starting', () => {
  for (const body of ['{not json', 'null', '[]', '{"v":2,"cashTables":[1]}', '{"v":1,"savedAt":0,"cashTables":"nope","tournaments":"nope"}']) {
    writeFileSync(LIVE, body);
    assert.doesNotThrow(() => restoreLive(), body);
  }
  assert.ok(existsSync(CASH));
});
