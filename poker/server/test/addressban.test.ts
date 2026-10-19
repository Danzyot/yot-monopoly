// Banning an address, and the accounts behind it.
//
// An address ban on its own is a door, not a verdict: it shuts out a router
// and leaves the accounts untouched, so the same people return from a phone
// under the same names while the operator believes they are gone. These tests
// pin down who "behind this address" means — because that set is used twice,
// once to throw people out of live games and once to suspend their accounts,
// and the two must never disagree about who they are talking about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-addrban-'));
const { accountsOnAddress, altGroups, noteSeen } = await import('../src/audit.ts');

const seen = (id: string, name: string, ips: string[]) => {
  for (const ip of ips) noteSeen({ id, name, avatar: '' }, ip);
};

test('everyone on an address is found, and nobody else', () => {
  seen('a', 'Ann', ['203.0.113.7']);
  seen('b', 'Ben', ['203.0.113.7', '198.51.100.9']);
  seen('c', 'Cal', ['198.51.100.9']);

  assert.deepEqual(accountsOnAddress('203.0.113.7').map(x => x.name).sort(), ['Ann', 'Ben']);
  assert.deepEqual(accountsOnAddress('198.51.100.9').map(x => x.name).sort(), ['Ben', 'Cal']);
  assert.deepEqual(accountsOnAddress('192.0.2.1'), [], 'an address nobody holds returns nobody');
});

test('an address is matched after normalisation, not as a raw string', () => {
  // The same person can be recorded either way depending on how the request
  // reached us. If these did not match, a ban placed from one row would miss
  // the account that the other row is about.
  seen('d', 'Dot', ['::ffff:192.0.2.50']);
  assert.deepEqual(accountsOnAddress('192.0.2.50').map(x => x.name), ['Dot']);
  assert.deepEqual(accountsOnAddress('::ffff:192.0.2.50').map(x => x.name), ['Dot']);
});

test('an account on an address twice is still one account', () => {
  // ips is a map keyed by address, but the same person reached through both
  // spellings would otherwise be counted — and then banned — twice.
  seen('e', 'Eve', ['::ffff:192.0.2.77']);
  noteSeen({ id: 'e', name: 'Eve', avatar: '' }, '192.0.2.77');
  assert.equal(accountsOnAddress('192.0.2.77').length, 1);
});

test('a shared-address group names who is behind each of its addresses', () => {
  // The panel offers a ban per address, so each one has to carry its OWN
  // people. A group spanning four addresses that reported the whole roster
  // on every row would tell the operator that banning one address reaches
  // everyone, and they would agree to something far wider than they meant.
  const g = altGroups().find(x => x.addresses.some(a => a.ip === '203.0.113.7'));
  assert.ok(g, 'Ann and Ben share an address, so there is a group');
  const here = g.addresses.find(a => a.ip === '203.0.113.7')!;
  const there = g.addresses.find(a => a.ip === '198.51.100.9')!;
  assert.deepEqual(here.accounts.map(x => x.name).sort(), ['Ann', 'Ben']);
  assert.deepEqual(there.accounts.map(x => x.name).sort(), ['Ben', 'Cal']);
  assert.ok(!here.accounts.some(x => x.name === 'Cal'),
    'Cal has never been seen from this address and must not be offered up with it');
});

test('a crowded address still reports its accounts, so the operator can see the size', () => {
  // altGroups refuses to MERGE through a crowded address, which is a separate
  // thing from refusing to describe one. The dialog decides what to warn
  // about; it can only do that if it is told how many people are there.
  for (let i = 0; i < 12; i++) seen(`crowd${i}`, `Crowd ${i}`, ['192.0.2.200']);
  assert.equal(accountsOnAddress('192.0.2.200').length, 12);
  const g = altGroups().find(x => x.addresses.some(a => a.ip === '192.0.2.200'));
  assert.equal(g?.addresses.find(a => a.ip === '192.0.2.200')?.accounts.length, 12);
});
