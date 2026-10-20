// Who may reverse a turn or move chips. These rewrite a live game, so the
// rule gets its own test rather than being trusted by inspection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mayRunTable } from '../src/sockets.ts';

const host = { id: 'host', isAdmin: false };
const rando = { id: 'rando', isAdmin: false };
const operator = { id: 'danz', isAdmin: true };

test('the site operator can run any table', () => {
  assert.equal(mayRunTable(operator), true);
});

test('every table belongs to a tournament, so only the operator may touch it', () => {
  // This is the case that matters: a player sitting at a table — or the
  // player who hosts its tournament — must not qualify by default.
  assert.equal(mayRunTable(rando), false);
  assert.equal(mayRunTable(host), false);
});

test('a missing isAdmin flag is not permission', () => {
  assert.equal(mayRunTable({ id: 'x' }), false);
  // Truthy-but-not-true must not slip through either.
  assert.equal(mayRunTable({ id: 'x', isAdmin: 1 as unknown as boolean }), false);
});
