// A ban has to hold against the ways a cheat actually comes back: a new
// account, the same Discord, or the same machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-bans-'));
const {
  addBan, banMessage, findBan, isBanned, listBans, normaliseIp, removeBan, removeGameBans,
} = await import('../src/bans.ts');
const { BAN_REASONS, banMessageFor } = await import('../../shared/types.ts');
const { BRAND } = await import('../../shared/brand.ts');

test('banning the account stops that account', () => {
  addBan({ kind: 'player', value: 'p1', name: 'Cheat', reason: 'chip dumping', by: 'Danz' });
  assert.equal(isBanned({ id: 'p1' }), true);
  assert.equal(isBanned({ id: 'p2' }), false, 'and nobody else');
});

test('a banned Discord cannot come back as a fresh account', () => {
  addBan({ kind: 'player', value: '340404007639973888', name: 'Cheat', reason: '', by: 'Danz' });
  // New guest account, brand new id — same person behind it.
  assert.equal(isBanned({ id: 'brand-new-id', discordId: '340404007639973888' }), true);
});

test('an IP ban catches a new account from the same machine', () => {
  addBan({ kind: 'ip', value: '203.0.113.7', name: 'Cheat', reason: 'alts', by: 'Danz' });
  assert.equal(isBanned({ id: 'someone-else', ip: '203.0.113.7' }), true);
  assert.equal(isBanned({ id: 'someone-else', ip: '203.0.113.8' }), false);
});

test('addresses match whatever shape the proxy hands over', () => {
  assert.equal(normaliseIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(normaliseIp('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normaliseIp('  203.0.113.7  '), '203.0.113.7');
  // An IPv6-mapped address is the same machine as its plain form.
  assert.equal(isBanned({ id: 'x', ip: '::ffff:203.0.113.7' }), true);
});

test('re-banning updates the note instead of stacking duplicates', () => {
  const before = listBans().length;
  addBan({ kind: 'player', value: 'p1', name: 'Cheat', reason: 'a better reason', by: 'Danz' });
  assert.equal(listBans().length, before, 'no duplicate row');
  assert.equal(findBan({ id: 'p1' })!.reason, 'a better reason');
});

test('unbanning lets them back in, and says whether it did anything', () => {
  assert.equal(removeBan('player', 'p1'), true);
  assert.equal(isBanned({ id: 'p1' }), false);
  assert.equal(removeBan('player', 'p1'), false, 'nothing left to remove');

  assert.equal(removeBan('ip', '::ffff:203.0.113.7'), true, 'unban matches the same shapes as the ban');
  assert.equal(isBanned({ id: 'x', ip: '203.0.113.7' }), false);
});

test('an empty value is not a ban', () => {
  assert.throws(() => addBan({ kind: 'ip', value: '   ', name: '', reason: '', by: 'Danz' }), /Nothing to ban/);
});

// ---------- scope ----------

test('a game ban costs them that game and nothing else', () => {
  addBan({ kind: 'player', scope: 'game', gameId: 't1', gameName: 'Sunday Major', value: 'gp', name: 'Grubby', reason: 'angle shooting', by: 'Danz' });

  // The narrow question: barred from that game.
  assert.equal(isBanned({ id: 'gp' }, 't1'), true);
  // The broad one: still welcome on the site, and in every other game.
  assert.equal(isBanned({ id: 'gp' }), false, 'not a site ban');
  assert.equal(isBanned({ id: 'gp' }, 't2'), false, 'not other games either');
});

test('a lifetime ban answers both questions', () => {
  addBan({ kind: 'player', scope: 'lifetime', value: 'lp', name: 'Cheat', reason: 'bots', by: 'Danz' });
  assert.equal(isBanned({ id: 'lp' }), true);
  assert.equal(isBanned({ id: 'lp' }, 't1'), true, 'and inside any game');
});

test('game and lifetime bans on the same person coexist', () => {
  addBan({ kind: 'player', scope: 'game', gameId: 't9', gameName: 'Nine', value: 'both', name: 'B', reason: 'game', by: 'Danz' });
  addBan({ kind: 'player', scope: 'lifetime', value: 'both', name: 'B', reason: 'lifetime', by: 'Danz' });
  assert.equal(listBans().filter(b => b.value === 'both').length, 2, 'two separate rows');
  // Lifetime is the more serious answer, so it is the one reported.
  assert.equal(findBan({ id: 'both' }, 't9')!.scope, 'lifetime');

  // Lifting the lifetime one leaves the game ban standing.
  assert.equal(removeBan('player', 'both', 'lifetime'), true);
  assert.equal(isBanned({ id: 'both' }), false, 'back on the site');
  assert.equal(isBanned({ id: 'both' }, 't9'), true, 'still out of that game');
});

test('a game IP ban bars the machine from that game only', () => {
  addBan({ kind: 'ip', scope: 'game', gameId: 't1', gameName: 'Sunday Major', value: '198.51.100.4', name: '', reason: '', by: 'Danz' });
  assert.equal(isBanned({ id: 'anyone', ip: '198.51.100.4' }, 't1'), true);
  assert.equal(isBanned({ id: 'anyone', ip: '198.51.100.4' }), false);
});

test('unbanning has to name the same scope and game', () => {
  assert.equal(removeBan('player', 'gp'), false, 'a lifetime unban does not lift a game ban');
  assert.equal(removeBan('player', 'gp', 'game', 'wrong-game'), false);
  assert.equal(removeBan('player', 'gp', 'game', 't1'), true);
  assert.equal(isBanned({ id: 'gp' }, 't1'), false);
});

test('a game ban needs a game', () => {
  assert.throws(
    () => addBan({ kind: 'player', scope: 'game', gameId: '', gameName: '', value: 'x', name: '', reason: '', by: 'D' }),
    /needs a game/,
  );
});

test('deleting a game takes its bans with it, and leaves the rest alone', () => {
  addBan({ kind: 'player', scope: 'game', gameId: 'doomed', gameName: 'Doomed', value: 'd1', name: '', reason: '', by: 'D' });
  addBan({ kind: 'ip', scope: 'game', gameId: 'doomed', gameName: 'Doomed', value: '198.51.100.9', name: '', reason: '', by: 'D' });
  addBan({ kind: 'player', scope: 'game', gameId: 'keeper', gameName: 'Keeper', value: 'k1', name: '', reason: '', by: 'D' });

  assert.equal(removeGameBans('doomed'), 2);
  assert.equal(isBanned({ id: 'd1' }, 'doomed'), false);
  assert.equal(isBanned({ id: 'k1' }, 'keeper'), true, 'another game keeps its own');
});

// ---------- what the player is told ----------

test('a game suspension names the room', () => {
  const b = addBan({
    kind: 'player', scope: 'game', gameId: 'msg1', gameName: 'Sunday Major',
    value: 'm1', name: 'M', reason: '', by: 'Danz',
  });
  assert.equal(banMessage(b), `You have been suspended from ${BRAND.room}.`);
});

test('a lifetime suspension names the tournaments', () => {
  const b = addBan({
    kind: 'player', scope: 'lifetime', value: 'm2', name: 'M', reason: '', by: 'Danz',
  });
  assert.equal(
    banMessage(b),
    `You have been suspended from participating in ${BRAND.tournaments}.`,
  );
});

test('a reason is appended, and only when there is one', () => {
  const withReason = addBan({
    kind: 'player', scope: 'game', gameId: 'msg1', gameName: 'Sunday Major',
    value: 'm3', name: 'M', reason: 'Chip dumping', by: 'Danz',
  });
  assert.equal(
    banMessage(withReason),
    `You have been suspended from ${BRAND.room}. Reason: Chip dumping`,
  );
  // Whitespace is not a reason — no dangling "Reason:" on the end.
  const blank = addBan({
    kind: 'player', scope: 'lifetime', value: 'm4', name: 'M', reason: '   ', by: 'Danz',
  });
  assert.ok(!banMessage(blank).includes('Reason'));
});

test('every stock reason produces a readable line', () => {
  for (const r of BAN_REASONS) {
    assert.equal(
      banMessageFor('lifetime', r),
      `You have been suspended from participating in ${BRAND.tournaments}. Reason: ${r}`,
    );
  }
});
