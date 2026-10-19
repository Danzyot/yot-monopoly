// Who may reverse a turn or move chips. These rewrite a live game, so the
// rule gets its own test rather than being trusted by inspection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mayRunTable } from '../src/sockets.ts';

const host = { id: 'host', isAdmin: false };
const rando = { id: 'rando', isAdmin: false };
const operator = { id: 'danz', isAdmin: true };

test('a cash table answers to its own host', () => {
  assert.equal(mayRunTable('host', host), true);
  assert.equal(mayRunTable('host', rando), false, 'and to nobody else');
});

test('the site operator can run any table', () => {
  assert.equal(mayRunTable('host', operator), true);
  assert.equal(mayRunTable(null, operator), true);
});

test('a tournament table has no host, so only the operator may touch it', () => {
  // This is the case that matters: tournament tables carry hostId === null,
  // and a player sitting at one must not qualify by default.
  assert.equal(mayRunTable(null, rando), false);
  assert.equal(mayRunTable(null, host), false);
});

test('a missing isAdmin flag is not permission', () => {
  assert.equal(mayRunTable(null, { id: 'x' }), false);
  assert.equal(mayRunTable('host', { id: 'x' }), false);
  // Truthy-but-not-true must not slip through either.
  assert.equal(mayRunTable(null, { id: 'x', isAdmin: 1 as unknown as boolean }), false);
});
