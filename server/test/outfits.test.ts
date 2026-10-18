import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, Room, type RoomHooks } from '../src/rooms.ts';
import { OUTFIT_ITEMS, OUTFIT_SLOTS, parseOutfit, sanitizeOutfit } from '../../shared/outfits.ts';

const hooks = (): RoomHooks => ({ onChange() {}, onEvent(_r: Room, _t: string) {}, onFinished() {} });
const m = (id: string) => ({ id, name: id, avatar: '🙂' });

test('outfits: catalogue covers every slot with unique ids', () => {
  assert.equal(new Set(OUTFIT_ITEMS.map(i => i.id)).size, OUTFIT_ITEMS.length);
  for (const s of OUTFIT_SLOTS) assert.ok(OUTFIT_ITEMS.some(i => i.slot === s.id), `${s.id} has items`);
});

test('outfits: picks are validated against the known items of each slot', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b'));
  assert.deepEqual(r.seat('a')!.outfit, {}, 'a new seat wears nothing');

  r.pickOutfit('a', { head: 'cap', eyes: 'shades', neck: 'chain', body: 'hoodie' });
  assert.deepEqual(r.view().seats.find(s => s.id === 'a')!.outfit, { head: 'cap', eyes: 'shades', neck: 'chain', body: 'hoodie' });
  r.pickOutfit('b', { head: 'cap' });
  assert.equal(r.seat('b')!.outfit!.head, 'cap', 'two players may wear the same item');

  assert.throws(() => r.pickOutfit('a', { head: 'jetpack' }), /Unknown outfit item/);
  assert.throws(() => r.pickOutfit('a', { head: 'hoodie' }), /Unknown outfit item/, 'an item only fits its own slot');
  assert.throws(() => r.pickOutfit('a', { feet: 'cap' }), /Unknown outfit slot/);
  assert.throws(() => r.pickOutfit('a', 'cap'), /Unknown outfit/);
  assert.throws(() => r.pickOutfit('a', ['cap']), /Unknown outfit/);
  assert.throws(() => r.pickOutfit('a', { head: { toString: () => 'cap' } }), /Unknown outfit item/);
  assert.throws(() => r.pickOutfit('nobody', { head: 'cap' }), /not seated/);
  assert.equal(r.seat('a')!.outfit!.head, 'cap', 'a refused pick changes nothing');

  r.pickOutfit('a', { head: null, eyes: '' });
  assert.deepEqual(r.seat('a')!.outfit, {}, 'null or empty clears a slot');

  r.pickOutfit('a', { head: 'crown', body: 'suit' });
  r.start('a', false);
  assert.deepEqual(r.game!.view().players.find(p => p.id === 'a')!.outfit, { head: 'crown', body: 'suit' }, 'the game carries it');
  assert.throws(() => r.pickOutfit('a', { head: 'cap' }), /started|lobby/i, 'no changes mid-game');
  r.dispose();
});

test('outfits: kept across snapshot / restore, stale items dropped', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b'));
  r.pickOutfit('a', { head: 'tophat', neck: 'bowtie' });
  r.start('a', false);
  const snap = JSON.parse(JSON.stringify(reg.snapshot()));
  r.dispose();
  // An item that no longer exists (or never did) must not survive a restore.
  snap[0].seats[1].outfit = { head: 'gone', body: 'jersey', wings: 'big' };

  const reg2 = new Registry(hooks(), 1e9);
  assert.equal(reg2.restore(snap), 1);
  const r2 = reg2.get(r.code)!;
  assert.deepEqual(r2.seat('a')!.outfit, { head: 'tophat', neck: 'bowtie' });
  assert.deepEqual(r2.seat('b')!.outfit, { body: 'jersey' });
  assert.deepEqual(r2.game!.view().players.find(p => p.id === 'a')!.outfit, { head: 'tophat', neck: 'bowtie' });
  r2.dispose();
});

test('outfits: bots dress themselves from the catalogue', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a'));
  for (let i = 0; i < 5; i++) r.addBot('a', false);
  for (const s of r.view().seats) assert.deepEqual(sanitizeOutfit(s.outfit), s.outfit);
  assert.deepEqual(parseOutfit({ head: 'cap' }), { ok: true, outfit: { head: 'cap' } });
  r.dispose();
});
