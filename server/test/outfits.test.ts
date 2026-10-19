import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, Room, type RoomHooks } from '../src/rooms.ts';
import {
  OUTFIT_ITEMS, OUTFIT_SLOTS, defaultOutfit, outfitForCharacter, parseOutfit, randomOutfit, sanitizeOutfit,
} from '../../shared/outfits.ts';
import { CHARACTERS } from '../../shared/characters.ts';
import { CHOG_SEASON } from '../../shared/season.ts';

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
  // (In the Chog season both are already the base Chog, which has no clothes of its own.)
  if (!CHOG_SEASON) {
    r.pickCharacter('a', 'spiky');
    r.pickCharacter('b', 'robot');
  }
  assert.deepEqual(r.seat('a')!.outfit, {}, 'a plain character wears nothing of its own');

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

test('outfits: signature items belong to one character and are what it wears by default', () => {
  const sig = OUTFIT_ITEMS.filter(i => i.only);
  assert.deepEqual(sig.map(i => i.id).sort(), ['cuban_chain', 'wawa_tee']);
  for (const i of sig) assert.ok(CHARACTERS.includes(i.only!) && i.node, `${i.id} names its character and garment`);
  assert.deepEqual(defaultOutfit('snacky'), { neck: 'cuban_chain', body: 'wawa_tee' });
  // Yot's collar and belt are part of him, not a garment: he wears nothing by default.
  assert.deepEqual(defaultOutfit('starer'), {});
  assert.deepEqual(defaultOutfit('robot'), {});

  // Parsing with a character refuses another character's own clothes.
  assert.deepEqual(parseOutfit({ body: 'wawa_tee' }, 'snacky'), { ok: true, outfit: { body: 'wawa_tee' } });
  assert.deepEqual(parseOutfit({ body: 'wawa_tee' }, 'starer'), { ok: false, error: 'That item belongs to another character' });
  assert.deepEqual(sanitizeOutfit({ body: 'wawa_tee', head: 'cap' }, 'starer'), { head: 'cap' });
  assert.deepEqual(sanitizeOutfit({ body: 'yot_tee', head: 'cap' }), { head: 'cap' }, 'a retired item is dropped');
  // Carried over to another character: foreign signatures off, empty slots take the new one's.
  assert.deepEqual(outfitForCharacter({ head: 'cap', neck: 'cuban_chain', body: 'wawa_tee' }, 'starer'), { head: 'cap' });
  assert.deepEqual(outfitForCharacter({ body: 'hoodie' }, 'snacky'), { neck: 'cuban_chain', body: 'hoodie' });
  // Bots keep their signature items on.
  for (let k = 0; k < 20; k++) {
    const o = randomOutfit(n => Math.floor(Math.random() * n), 'snacky');
    assert.equal(o.body, 'wawa_tee');
    assert.equal(o.neck, 'cuban_chain');
    assert.ok(!Object.values(randomOutfit(n => Math.floor(Math.random() * n), 'robot')).some(id => id && OUTFIT_ITEMS.find(i => i.id === id)!.only));
  }
});

// Needs CJ WAWA, Yot and Robo, who rest during the Chog season.
test('outfits: seats wear their character\'s own clothes, and only that character can pick them', { skip: CHOG_SEASON && 'Chog season: only Chog is on offer' }, () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b'));
  const a = r.seat('a')!, b = r.seat('b')!;
  assert.equal(a.character, 'snacky');
  assert.deepEqual(a.outfit, { neck: 'cuban_chain', body: 'wawa_tee' }, 'a new seat wears its character\'s own look');
  assert.deepEqual(b.outfit, defaultOutfit(b.character));

  r.pickOutfit('a', { body: 'hoodie' });
  assert.deepEqual(a.outfit, { body: 'hoodie' }, 'another item (or none) replaces the signature one');
  r.pickOutfit('a', { body: 'wawa_tee', neck: 'cuban_chain' });
  assert.throws(() => r.pickOutfit('a', { body: 'yot_tee' }), /Unknown outfit item/);
  assert.deepEqual(a.outfit, { body: 'wawa_tee', neck: 'cuban_chain' }, 'a refused pick changes nothing');

  // Switching character swaps the signature clothes.
  r.pickCharacter('a', 'robot');
  assert.deepEqual(a.outfit, {});
  r.pickOutfit('a', { head: 'cap' });
  r.pickCharacter('a', 'snacky');
  assert.deepEqual(a.outfit, { head: 'cap', neck: 'cuban_chain', body: 'wawa_tee' });
  r.pickCharacter('b', 'robot');
  r.pickCharacter('a', 'starer');
  assert.deepEqual(a.outfit, { head: 'cap' });
  assert.throws(() => r.pickOutfit('a', { neck: 'cuban_chain' }), /another character/);

  // Bots wear theirs.
  r.addBot('a', false);
  const bot = r.seats.find(s => s.isBot)!;
  for (const [slot, id] of Object.entries(defaultOutfit(bot.character))) assert.equal(bot.outfit![slot as 'body'], id);

  // A restore drops signature items the seat's character can't wear.
  r.start('a', false);
  const snap = JSON.parse(JSON.stringify(reg.snapshot()));
  r.dispose();
  const seat = snap[0].seats.find((s: { id: string }) => s.id === 'a');
  seat.outfit = { body: 'wawa_tee', head: 'cap' };
  const reg2 = new Registry(hooks(), 1e9);
  reg2.restore(snap);
  assert.deepEqual(reg2.get(r.code)!.seat('a')!.outfit, { head: 'cap' });
  reg2.get(r.code)!.dispose();
});
