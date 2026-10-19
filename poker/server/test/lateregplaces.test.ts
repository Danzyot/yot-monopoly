// Finishing places when players register after the start.
//
// The auto-approved late-reg path seated the player without growing the
// finishing-place pool, so every late registrant burned one place. In the
// first live event (349 entries, 15-minute late reg) the counter ran out with
// dozens still playing: "finished 1st" announced mid-game, then 0th, then
// negative places all over the live standings. Places are now derived from
// the number of players alive at the bust, so no registration path can drift
// them again — these tests hold both doors shut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { joinEveryone } from './seating.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-latereg-'));
const { Tournament } = await import('../src/tournament/tournament.ts');
const { addRecord, findRecord, repairKnownRecords, repairTournamentPlaces } = await import('../src/store.ts');

const cb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
  lobbyChanged: () => {},
};

function mk(over: Record<string, unknown> = {}) {
  return new Tournament({
    name: `LateReg ${Math.random()}`, startingStack: 1000, levelMinutes: 60,
    structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 60,
    approveRegistrations: false, buyIn: 0, prizeText: null,
    breakEveryLevels: 0, seatsPerTable: 9, social: null, maxReentries: 0,
    rabbitHunting: false, displayMode: 'chips',
    ...over,
  } as never, { id: 'host', name: 'Host' }, cb as never);
}
const reg = (t: InstanceType<typeof Tournament>, id: string) =>
  t.register({ id, name: id, avatar: 'x' });

test('late registrants do not burn finishing places', () => {
  const t = mk();
  for (let i = 0; i < 4; i++) reg(t, `pre${i}`);
  t.start();
  joinEveryone(t);
  for (let i = 0; i < 3; i++) reg(t, `late${i}`); // auto-approved late reg

  // Bust everyone down to a winner, in a fixed order.
  const order = ['pre0', 'pre1', 'late0', 'pre2', 'late1', 'pre3'];
  for (const id of order) t.kick(id);

  const places = [...t.players.values()]
    .map(p => ({ id: p.id, place: p.place }))
    .filter(p => p.place !== null);
  const nums = places.map(p => p.place as number).sort((a, b) => a - b);
  // 7 players: winner is 1st (assigned by finish()), busts fill 7..2.
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7], `got ${JSON.stringify(places)}`);
  assert.equal(places.find(p => p.id === 'late2')?.place, 1, 'last one standing wins');
  // First out of a 7-player field finished 7th, even though only 4 were in at the start.
  assert.equal(places.find(p => p.id === 'pre0')?.place, 7);
});

test('places derive from the live field even if the counter is corrupted', () => {
  const t = mk();
  for (let i = 0; i < 5; i++) reg(t, `p${i}`);
  t.start();
  joinEveryone(t);
  // Simulate the historical drift: something ate most of the counter.
  (t as never as { nextPlace: number }).nextPlace = 1;
  t.kick('p0');
  const p0 = t.players.get('p0')!;
  assert.equal(p0.place, 5, 'first bust of five alive is 5th, whatever the counter said');
});

test('the record repair rebuilds the order and refuses to guess the winner', () => {
  const t = mk();
  for (let i = 0; i < 6; i++) reg(t, `r${i}`);
  t.start();
  joinEveryone(t);
  // Recreate the corrupt shape by stamping places the broken way.
  const seq = ['r0', 'r1', 'r2', 'r3', 'r4'];
  let counter = 2; // drifted: far too low for a six-player field
  for (const id of seq) {
    const p = t.players.get(id)!;
    (t as never as { nextPlace: number }).nextPlace = counter;
    // Write the drifted stamp directly, mimicking the old eliminate().
    p.busted = true; p.place = counter; counter -= 1;
  }
  t.players.get('r5')!.place = 1; // finish() pins the winner — collides with r1's stamp
  // Snapshot into a record via the tournament's own writer path.
  const rec = {
    id: t.id, name: 'x', finishedAt: Date.now(), entrants: 6, totalEntries: 6,
    buyIn: 0, prizePool: 0, structure: 'regular',
    results: [...t.players.values()].map(p => ({
      playerId: p.id, name: p.id, avatar: 'x', place: p.place as number,
      prize: 0, entries: 1, discordTag: null, discordVerified: false,
    })),
  };
  addRecord(rec as never);

  const bad = repairTournamentPlaces(t.id, 'nobody', false);
  assert.equal(bad.ok, false, 'unknown winner refused');

  const dry = repairTournamentPlaces(t.id, 'r5', false);
  assert.equal(dry.ok, true);
  const after = Object.fromEntries(dry.after!.map(r => [r.name, r.place]));
  // r0 busted first of six -> 6th; r4 last of the busts -> 2nd; r5 wins.
  assert.deepEqual(after, { r5: 1, r4: 2, r3: 3, r2: 4, r1: 5, r0: 6 });
});

test('a named record repairs itself at boot', () => {
  // The corrupt shape a real record took once: drifted stamps down into the
  // negatives, and the true winner pinned to 1 by finish() — colliding with
  // the busted player whose drifted stamp also reached 1. This deployment
  // ships no entries in the list, so the fixture supplies its own.
  const names = ['early', 'mid', 'stampOne', 'Kim', 'fourth', 'third', 'second'];
  const stamps = [3, 2, 1, 1, 0, -1, -2]; // Kim is the pinned 1
  addRecord({
    id: 'live-1', name: 'CHOG POKER TOURNAMENT - 1', finishedAt: Date.now(),
    entrants: 7, totalEntries: 7, buyIn: 0, prizePool: 0, structure: 'regular',
    results: names.map((n, i) => ({
      playerId: `id-${n}`, name: n, avatar: 'x', place: stamps[i],
      prize: 0, entries: 1, discordTag: null, discordVerified: false,
    })),
  } as never);

  const KNOWN = [{ tourney: 'CHOG POKER TOURNAMENT - 1', winner: 'Kim' }];
  repairKnownRecords(KNOWN);
  const rec = findRecord('live-1')!;
  const by = Object.fromEntries(rec.results.map(r => [r.name, r.place]));
  assert.deepEqual(by, {
    Kim: 1, second: 2, third: 3, fourth: 4, stampOne: 5, mid: 6, early: 7,
  });
  // Healthy now — running again must not disturb it.
  repairKnownRecords(KNOWN);
  assert.equal(findRecord('live-1')!.results.find(r => r.name === 'Kim')!.place, 1);
});
