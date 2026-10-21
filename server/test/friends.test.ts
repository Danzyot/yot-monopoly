// Friends (src/friends.ts): requests, accepting, removing, the caps, what a
// friend sees of another, and bans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FriendsDeps } from '../src/friends.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-friends-'));

const { FriendStore, MAX_OUTGOING, MAX_INCOMING } = await import('../src/friends.ts');

function setup(over: Partial<FriendsDeps> = {}) {
  const banned = new Set<string>();
  const presence = new Map<string, ReturnType<FriendsDeps['presence']>>();
  const deps: FriendsDeps = {
    account: id => (id.startsWith('ghost') ? null : { name: id.toUpperCase(), avatar: '🎩' }),
    banned: id => banned.has(id),
    presence: id => presence.get(id) ?? { online: false },
    joinable: (_g, code) => code === 'OPEN1',
    ...over,
  };
  return { store: new FriendStore(deps, null), banned, presence };
}

test('friends: ask, accept, both see each other; remove undoes it', () => {
  const { store } = setup();
  assert.equal(store.request('ann', 'bob', 1), 'sent');
  assert.equal(store.status('ann', 'bob'), 'sent');
  assert.equal(store.status('bob', 'ann'), 'received');
  assert.deepEqual(store.view('bob').incoming.map(r => r.id), ['ann']);
  assert.deepEqual(store.view('ann').outgoing.map(r => r.id), ['bob']);
  store.accept('bob', 'ann', 2);
  assert.equal(store.status('ann', 'bob'), 'friends');
  assert.deepEqual(store.view('ann').friends.map(f => f.id), ['bob']);
  assert.deepEqual(store.view('bob').friends.map(f => f.id), ['ann']);
  assert.equal(store.view('bob').incoming.length, 0);
  assert.equal(store.remove('ann', 'bob'), true);
  assert.equal(store.status('bob', 'ann'), 'none');
  assert.equal(store.remove('ann', 'bob'), false);
});

test('friends: asking someone who asked you makes you friends at once', () => {
  const { store } = setup();
  store.request('ann', 'bob');
  assert.equal(store.request('bob', 'ann'), 'friends');
  assert.ok(store.areFriends('ann', 'bob'));
});

test('friends: decline and cancel both go through remove', () => {
  const { store } = setup();
  store.request('ann', 'bob');
  assert.equal(store.remove('bob', 'ann'), true, 'declined');
  assert.equal(store.status('ann', 'bob'), 'none');
  store.request('ann', 'bob');
  assert.equal(store.remove('ann', 'bob'), true, 'cancelled');
  assert.throws(() => store.accept('bob', 'ann'), /no longer open/);
});

test('friends: refused for yourself, unknown accounts, friends already, and bans', () => {
  const { store, banned } = setup();
  assert.throws(() => store.request('ann', 'ann'), /That is you/);
  assert.throws(() => store.request('ann', 'ghost-1'), /No player/);
  store.request('ann', 'bob');
  store.accept('bob', 'ann');
  assert.throws(() => store.request('ann', 'bob'), /friends already/);
  banned.add('cat');
  assert.throws(() => store.request('cat', 'ann'), /cannot add/);
  assert.throws(() => store.request('ann', 'cat'), /No player/);
  // A friend banned later drops out of the list without being deleted.
  banned.add('bob');
  assert.equal(store.view('ann').friends.length, 0);
  banned.delete('bob');
  assert.equal(store.view('ann').friends.length, 1);
});

test('friends: outgoing requests are capped; a flooded inbox keeps the newest', () => {
  const { store } = setup();
  for (let i = 0; i < MAX_OUTGOING; i++) store.request('ann', `p${i}`, i);
  assert.throws(() => store.request('ann', 'one-more'), /too many requests/);
  for (let i = 0; i < MAX_INCOMING + 5; i++) store.request(`fan${i}`, 'star', 1000 + i);
  const inbox = store.view('star').incoming;
  assert.equal(inbox.length, MAX_INCOMING);
  assert.equal(inbox[0].id, `fan${MAX_INCOMING + 4}`, 'newest first');
  assert.ok(!inbox.some(r => r.id === 'fan0'), 'the oldest dropped off');
});

test('friends: a friend sees online first, the game, and a table code only when joinable', () => {
  const { store, presence } = setup();
  for (const f of ['zed', 'amy', 'kim', 'lou']) { store.request('me', f); store.accept(f, 'me'); }
  presence.set('zed', { online: true, game: 'cards', code: 'OPEN1' });
  presence.set('kim', { online: true, game: 'monopoly', code: 'PRIV9' });
  presence.set('lou', { online: true });
  const rows = store.view('me').friends;
  assert.deepEqual(rows.map(r => r.id), ['kim', 'lou', 'zed', 'amy'], 'online first, then by name');
  assert.deepEqual(rows.find(r => r.id === 'zed')!.where, { game: 'cards', code: 'OPEN1' });
  assert.deepEqual(rows.find(r => r.id === 'kim')!.where, { game: 'monopoly' }, 'a private table: the game, no code');
  assert.equal(rows.find(r => r.id === 'lou')!.where, undefined);
  assert.equal(rows.find(r => r.id === 'amy')!.online, false);
});

test('friends: saved and loaded back', async () => {
  const deps: FriendsDeps = { account: () => ({ name: 'X', avatar: '🎩' }), banned: () => false, presence: () => ({ online: false }), joinable: () => false };
  const a = new FriendStore(deps, 'friends-test.json');
  a.request('ann', 'bob');
  a.accept('bob', 'ann');
  a.request('ann', 'cat');
  await new Promise(r => setTimeout(r, 1_100));
  const b = new FriendStore(deps, 'friends-test.json');
  b.load();
  assert.ok(b.areFriends('bob', 'ann'));
  assert.equal(b.status('cat', 'ann'), 'received');
});
