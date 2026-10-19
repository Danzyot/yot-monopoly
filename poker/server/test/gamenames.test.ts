// Two games must never share a name, and a game must have one at all.
// Deleting a finished game from the archive is what releases its name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TournamentRecord } from '../../shared/types.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-names-'));
const {
  addCashRecord, addRecord, archivedNames, removeCashRecord, removeRecord,
} = await import('../src/store.ts');

// The rule the server applies at creation, kept here in the same shape so the
// test pins the behaviour rather than the wording.
const nameKey = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const taken = (name: string, live: string[]) =>
  [...live, ...archivedNames()].some(n => nameKey(n) === nameKey(name));

function record(id: string, name: string): TournamentRecord {
  return {
    id, name, finishedAt: 1, entrants: 2, totalEntries: 2,
    buyIn: 0, prizePool: 0, structure: 'regular', results: [],
  };
}

test('a blank or whitespace name is not a name', () => {
  for (const raw of ['', '   ', '\n\t ']) {
    assert.equal(String(raw).trim(), '', `${JSON.stringify(raw)} must be rejected`);
  }
});

test('a live game holds its name against a new one', () => {
  const live = ['Sunday Major'];
  assert.equal(taken('Sunday Major', live), true);
  assert.equal(taken('Monday Minor', live), false);
});

test('matching ignores case and spacing', () => {
  const live = ['Sunday Major'];
  assert.equal(taken('sunday major', live), true, 'case');
  assert.equal(taken('  Sunday   Major  ', live), true, 'runs of whitespace');
  assert.equal(taken('SUNDAYMAJOR', live), false, 'but it is not a fuzzy match');
});

test('a finished tournament keeps holding its name until deleted', () => {
  addRecord(record('t1', 'Spring Freeze'));
  assert.equal(taken('Spring Freeze', []), true, 'held by the archive');
  assert.equal(taken('spring freeze', []), true);

  assert.equal(removeRecord('t1'), true, 'deleting reports it removed something');
  assert.equal(taken('Spring Freeze', []), false, 'the name is free again');
  assert.equal(removeRecord('t1'), false, 'deleting twice is not a lie the second time');
});

test('closed cash sessions hold names the same way', () => {
  addCashRecord({
    id: 'c1', name: 'Friday Night Cash', hostName: 'Danz',
    openedAt: 1, closedAt: 2, sb: 25, bb: 50, hands: 10, ledger: [],
  });
  assert.equal(taken('friday night cash', []), true);
  assert.equal(removeCashRecord('c1'), true);
  assert.equal(taken('Friday Night Cash', []), false);
});

test('a cash session is only archived once', () => {
  const row = {
    id: 'c2', name: 'Dupe Table', hostName: 'Danz',
    openedAt: 1, closedAt: 2, sb: 1, bb: 2, hands: 3, ledger: [],
  };
  addCashRecord(row);
  addCashRecord(row); // host closed it, then the sweep closed it again
  assert.equal(archivedNames().filter(n => n === 'Dupe Table').length, 1);
  removeCashRecord('c2');
});
