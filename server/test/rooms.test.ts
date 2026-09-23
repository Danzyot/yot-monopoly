import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, sanitizeRules } from '../src/rooms.ts';

test('rooms: many at once, unique codes, lobby rules', () => {
  const reg = new Registry(() => {});
  const a = reg.create('host-a');
  const b = reg.create('host-b');
  assert.notEqual(a.code, b.code);
  assert.equal(reg.get(a.code.toLowerCase()), a);

  a.join('host-a', 'Alice');
  a.join('bob', 'Bob');
  assert.throws(() => a.start('bob'), /host/);
  assert.throws(() => a.pickToken('bob', a.seat('host-a')!.token), /taken/);
  a.configure('host-a', 'yot');
  assert.equal(a.rules.freeParkingPot, true, 'edition brings its house rules');
  a.configure('host-a', undefined, { maxPlayers: 3 });
  a.addBot('host-a');
  assert.throws(() => a.addBot('host-a'), /full/);
  assert.throws(() => a.join('carol', 'Carol'), /full/);

  a.start('host-a');
  assert.equal(a.status, 'playing');
  assert.equal(a.view().game!.players.length, 3);
  assert.throws(() => a.join('dave', 'Dave'), /started/);
  // Rejoining an existing seat is always allowed (reconnect).
  assert.doesNotThrow(() => a.join('bob', 'Bob'));
  a.dispose();
  b.dispose();
});

test('rules are clamped', () => {
  const r = sanitizeRules({ startingCash: -5, maxPlayers: 99, auctions: false });
  assert.equal(r.startingCash, 100);
  assert.equal(r.maxPlayers, 8);
  assert.equal(r.auctions, false);
});
