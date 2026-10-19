// The operator's extra standings columns.
//
// These exist because the standings themselves cannot carry them: that list
// is broadcast to every player and built once for all of them, and a site
// player id is a Discord snowflake with `dc_` in front. Handing the room its
// own ids, and a map of who shares an address with whom, would out every
// household and alt account at the table.
//
// So what is tested here is the flag MEANING something. A shared-address
// marker that lights up for half the field because they are all on the same
// mobile carrier is worse than no marker: it trains the operator to ignore it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-ident-'));
const { noteSeen, standingIdentities } = await import('../src/audit.ts');

const seen = (id: string, ip: string, name = id) =>
  noteSeen({ id, name, avatar: 'x', discord: null }, ip);

test('two people on one address see each other, by name', () => {
  seen('a', '198.51.100.4', 'Ana');
  seen('b', '198.51.100.4', 'Ben');
  seen('c', '198.51.100.9', 'Cal');

  const rows = standingIdentities(['a', 'b', 'c']);
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(by.a.sharesWith, ['Ben']);
  assert.deepEqual(by.b.sharesWith, ['Ana']);
  assert.deepEqual(by.c.sharesWith, [], 'alone on their address');
});

test('a carrier-sized address links nobody', () => {
  // Nine strangers behind one exit. Flagging all nine as each other's alts is
  // the failure this rule exists to prevent.
  for (let i = 0; i < 9; i++) seen(`crowd${i}`, '203.0.113.50', `Crowd${i}`);
  const rows = standingIdentities(Array.from({ length: 9 }, (_, i) => `crowd${i}`));
  for (const r of rows) {
    assert.deepEqual(r.sharesWith, [], `${r.id} must not be linked through a crowded address`);
  }
});

test('our own proxy is not an address anyone shares', () => {
  seen('infraA', '::ffff:100.64.0.22', 'InfraA');
  seen('infraB', '::ffff:100.64.0.22', 'InfraB');
  const rows = standingIdentities(['infraA', 'infraB']);
  for (const r of rows) assert.deepEqual(r.sharesWith, []);
});

test('someone on two addresses picks up the people on each', () => {
  seen('d', '198.51.100.20', 'Dee');
  seen('e', '198.51.100.20', 'Eve');
  seen('d', '198.51.100.21');
  seen('f', '198.51.100.21', 'Fay');
  const [dee] = standingIdentities(['d']);
  assert.deepEqual(dee.sharesWith, ['Eve', 'Fay'], 'both households, sorted, no duplicates');
});

test('the Discord snowflake is offered when the account is a linked one', () => {
  noteSeen({ id: 'dc_909', name: 'Gil', avatar: 'x', discord: { id: '909', username: 'gil' } }, '198.51.100.30');
  seen('guest1', '198.51.100.31', 'Guest');
  const by = Object.fromEntries(standingIdentities(['dc_909', 'guest1']).map(r => [r.id, r]));
  assert.equal(by['dc_909'].discordId, '909');
  assert.equal(by.guest1.discordId, null, 'a guest has no Discord id to offer');
});

test('a player with no record at all still comes back, rather than vanishing', () => {
  // Standings can name someone the audit has never seen — seated by the
  // director, say. A missing row must not shorten the list and silently
  // misalign every column after it.
  const rows = standingIdentities(['a', 'nobody-here', 'b']);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].id, 'nobody-here');
  assert.deepEqual(rows[1].sharesWith, []);
  assert.equal(rows[1].discordId, null);
});
