// Host editing a tournament after creation, including mid-game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Tournament } from '../src/tournament/tournament.ts';
import type { TournamentConfig } from '../../shared/types.ts';
import { joinEveryone } from './seating.ts';

const noopCb = {
  broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
  broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {}, lobbyChanged: () => {},
};

function makeT(n = 6, over: Partial<TournamentConfig> = {}): Tournament {
  const config: TournamentConfig = {
    name: 'Editable', startingStack: 5000, levelMinutes: 8, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips', ...over,
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
  for (let i = 0; i < n; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  return t;
}

test('name, prizes, level length and late reg can be edited before the start', () => {
  const t = makeT();
  t.updateSettings({
    name: 'Lucid Sunday Major',
    prizeText: '  1st: prop firm evaluation  ',
    levelMinutes: 12,
    lateRegMinutes: 30,
  });
  assert.equal(t.config.name, 'Lucid Sunday Major');
  assert.equal(t.config.prizeText, '1st: prop firm evaluation', 'prize text is trimmed');
  assert.equal(t.config.levelMinutes, 12);
  assert.equal(t.config.lateRegMinutes, 30);
  t.cancel();
});

test('custom blinds mid-game reach every table and keep climbing from there', () => {
  const t = makeT(12);
  t.start();
  joinEveryone(t);
  const before = t.level.bb;

  t.updateSettings({ blinds: { sb: 500, bb: 1000, ante: 100 } });
  assert.equal(t.level.sb, 500);
  assert.equal(t.level.bb, 1000);
  assert.equal(t.level.ante, 100);
  for (const table of t.tables.values()) {
    assert.equal(table.sb, 500, 'table small blind updated');
    assert.equal(table.bb, 1000, 'table big blind updated');
    assert.equal(table.ante, 100, 'table ante updated');
  }
  assert.notEqual(before, 1000, 'sanity: the structure did not already say 1000');
  // The next level in the generated structure is untouched, so play continues.
  assert.ok(t.nextLevel, 'structure still has further levels');
  t.cancel();
});

test('a blind change never mutates a hand already in progress', () => {
  const t = makeT(9);
  t.start();
  joinEveryone(t);
  const table = [...t.tables.values()][0];
  table.startHand();
  const handBlinds = { sb: table.hand!.sb, bb: table.hand!.bb };

  t.updateSettings({ blinds: { sb: 999, bb: 1998, ante: 50 } });

  assert.equal(table.hand!.sb, handBlinds.sb, 'live hand keeps its small blind');
  assert.equal(table.hand!.bb, handBlinds.bb, 'live hand keeps its big blind');
  assert.equal(table.bb, 1998, 'the table itself is updated for the next hand');
  t.cancel();
});

test('jumping levels moves the structure and the tables together', () => {
  const t = makeT(9);
  t.start();
  joinEveryone(t);
  assert.equal(t.level.level, 1);
  t.updateSettings({ jumpLevel: 5 });
  assert.equal(t.level.level, 5);
  for (const table of t.tables.values()) assert.equal(table.bb, t.level.bb);
  // Clamped to the structure, never out of range.
  t.updateSettings({ jumpLevel: 9999 });
  assert.equal(t.level.level, t.structure.length);
  t.updateSettings({ jumpLevel: -5 });
  assert.equal(t.level.level, 1);
  t.cancel();
});

test('turning approval off admits everyone already queued', () => {
  const t = makeT(0, { approveRegistrations: true });
  for (let i = 0; i < 4; i++) t.register({ id: `q${i}`, name: `Q${i}`, avatar: '🙂' });
  assert.equal(t.pendingPlayers().length, 4);
  assert.equal(t.approvedPlayers().length, 0);

  t.updateSettings({ approveRegistrations: false });
  assert.equal(t.pendingPlayers().length, 0, 'queue is drained, nobody is stranded');
  assert.equal(t.approvedPlayers().length, 4);
  t.cancel();
});

test('action time is clamped and applied to live tables', () => {
  const t = makeT(9);
  t.start();
  joinEveryone(t);
  t.updateSettings({ actionSeconds: 45 });
  for (const table of t.tables.values()) assert.equal(table.actionTimeMs, 45_000);
  t.updateSettings({ actionSeconds: 9999 });
  for (const table of t.tables.values()) assert.equal(table.actionTimeMs, 120_000, 'clamped to the max');
  t.cancel();
});

test('a finished tournament refuses edits', () => {
  const t = makeT(2);
  t.cancel();
  assert.throws(() => t.updateSettings({ name: 'nope' }), /over/);
});

test('the configured time limit per turn reaches every table from the first hand', () => {
  const t = makeT(9, { actionSeconds: 45 });
  assert.equal(t.actionTimeMs, 45_000, 'config actionSeconds seeds the clock');
  t.start();
  joinEveryone(t);
  for (const table of t.tables.values()) assert.equal(table.actionTimeMs, 45_000);
  t.cancel();
});

test('max players, re-entries, rabbit hunting and display mode are editable', () => {
  const t = makeT(6);
  t.updateSettings({ maxPlayers: 200, maxReentries: 3, rabbitHunting: true, displayMode: 'bb' });
  assert.equal(t.config.maxPlayers, 200);
  assert.equal(t.config.maxReentries, 3);
  assert.equal(t.config.rabbitHunting, true);
  assert.equal(t.config.displayMode, 'bb');

  // The cap can never drop below the people already registered.
  t.updateSettings({ maxPlayers: 2 });
  assert.equal(t.config.maxPlayers, 6, 'cap clamps to the current field');

  // A full field turns players away; lifting the cap opens it to everyone.
  assert.throws(() => t.register({ id: 'late', name: 'Late', avatar: '🙂' }), /full/);
  t.updateSettings({ maxPlayers: null });
  assert.equal(t.config.maxPlayers, null);
  t.register({ id: 'late', name: 'Late', avatar: '🙂' });
  assert.equal(t.players.size, 7);

  // Rabbit hunting toggles propagate to live tables.
  t.start();
  joinEveryone(t);
  t.updateSettings({ rabbitHunting: false });
  for (const table of t.tables.values()) assert.equal(table.rabbitHunting, false);
  t.cancel();
});

test('the turn clock is exactly the turn clock unless a time bank is configured', () => {
  // No time bank by default: a 10-second limit is 10 seconds, full stop.
  const plain = makeT(6, { actionSeconds: 10 });
  plain.start();
  joinEveryone(plain);
  for (const table of plain.tables.values()) {
    assert.equal(table.actionTimeMs, 10_000);
    assert.equal(table.timebankMs, 0, 'no hidden extra time');
    for (const s of table.seats) if (s) assert.equal(s.timebankMs, 0);
  }
  plain.cancel();

  // Opting in grants the extra time explicitly.
  const banked = makeT(6, { actionSeconds: 10, timebankSeconds: 15 });
  banked.start();
  joinEveryone(banked);
  for (const table of banked.tables.values()) {
    assert.equal(table.timebankMs, 15_000);
    for (const s of table.seats) if (s) assert.equal(s.timebankMs, 15_000);
  }
  // And it is editable live.
  banked.updateSettings({ timebankSeconds: 0 });
  for (const table of banked.tables.values()) assert.equal(table.timebankMs, 0);
  banked.cancel();
});

test('players can still chat in the lobby after the tournament is over', () => {
  const seen: string[] = [];
  const config: TournamentConfig = {
    name: 'Afterparty', startingStack: 5000, levelMinutes: 8, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 0, approveRegistrations: false,
    buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9, social: null,
    maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  const t = new Tournament(config, { id: 'host', name: 'Host' }, {
    ...noopCb,
    tourneyChat: (_t, m) => { seen.push(m.text); },
  });
  for (let i = 0; i < 4; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);

  // Force the terminal state, then talk.
  (t as unknown as { state: string }).state = 'finished';
  t.userChat({ id: 'p1', name: 'P1', avatar: '🙂' }, 'gg everyone');
  assert.ok(seen.includes('gg everyone'), 'chat still reaches the room after the win');
  assert.ok(t.chatLog.some(m => m.text === 'gg everyone'), 'and is kept in the backlog for late joiners');

  // Cancelled events behave the same way.
  (t as unknown as { state: string }).state = 'cancelled';
  t.userChat({ id: 'p2', name: 'P2', avatar: '🙂' }, 'next time');
  assert.ok(seen.includes('next time'));

  // Put it back in a live state so cancel() actually runs: it early-returns
  // on a terminal state and would leave the level clock ticking.
  (t as unknown as { state: string }).state = 'running';
  t.cancel();
});

test('a finished tournament leaves a record its link can still show', async () => {
  const { addRecord, findRecord } = await import('../src/store.ts');
  addRecord({
    id: 'arch-test', name: 'Sunday Major', finishedAt: Date.now(),
    entrants: 3, totalEntries: 4, buyIn: 0, prizePool: 0, structure: 'regular',
    results: [
      { playerId: 'a', name: 'Ada', avatar: '🙂', place: 1, prize: 0, entries: 1, discordTag: 'ada', discordVerified: true },
      { playerId: 'b', name: 'Bo', avatar: '🙂', place: 2, prize: 0, entries: 2, discordTag: null, discordVerified: false },
      { playerId: 'c', name: 'Cy', avatar: '🙂', place: 3, prize: 0, entries: 1, discordTag: null, discordVerified: false },
    ],
  });
  const rec = findRecord('arch-test');
  assert.ok(rec, 'the link resolves to a record instead of nothing');
  assert.equal(rec!.results[0].name, 'Ada', 'winner first');
  assert.equal(rec!.results.length, 3, 'every finishing place is kept');
  assert.equal(findRecord('never-existed'), null, 'an unknown id stays unknown');
});
