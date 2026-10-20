// The base looks at card tables, as in Monopoly (outfits.test.ts): each seat
// carries an outfit (shared/outfits.ts) and a colour, picked in the lobby,
// checked on the server, kept through the match, a snapshot and a restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-cards-outfits-'));
process.env.DEMO_MODE = '1';

const { CardsRegistry, CardsRoom } = await import('../src/cards/rooms.ts');
const { CARDS_SEAT_COLORS } = await import('../../shared/cards/room.ts');
const { OUTFIT_ITEMS, OUTFIT_SLOTS, defaultOutfit } = await import('../../shared/outfits.ts');
const { SEASON_CHARACTERS } = await import('../../shared/season.ts');
type Hooks = ConstructorParameters<typeof CardsRegistry>[0];

const m = (id: string) => ({ id, name: id, avatar: '🙂' });
const hooks = (holds?: (user: string, token: number) => boolean): Hooks => ({
  onChange() {}, onEvent() {}, onFinished() {}, ...(holds && { holdsChog: holds }),
});
function table(holds?: (user: string, token: number) => boolean) {
  const reg = new CardsRegistry(hooks(holds), 1e9);
  const r = reg.create('alice');
  return { reg, r, done: () => { for (const code of [...reg.rooms.keys()]) reg.delete(code); } };
}
/** A shared item that fits no character's signature (anyone may wear it). */
const shared = (slot: string) => OUTFIT_ITEMS.find(i => i.slot === slot && !i.only)!.id;
/** Someone else's signature item: never the season's character's own. */
const signature = OUTFIT_ITEMS.find(i => i.only && !SEASON_CHARACTERS.includes(i.only))!;

test('cards outfits: a new seat wears its character’s default, and every view carries it', () => {
  const { r, done } = table();
  try {
    r.join(m('alice'));
    const s = r.seat('alice')!;
    assert.deepEqual(s.outfit, defaultOutfit(s.character));
    assert.deepEqual(r.view('alice').seats[0].outfit, s.outfit);
    assert.deepEqual(r.view().seats[0].outfit, s.outfit, 'spectators see it too');
  } finally {
    done();
  }
});

test('cards outfits: picks are checked like Monopoly’s, one item per slot', () => {
  const { r, done } = table();
  try {
    r.join(m('alice'));
    r.join(m('bob'));
    const look = { head: shared('head'), eyes: shared('eyes'), neck: shared('neck'), body: shared('body') };
    r.pickOutfit('alice', look);
    assert.deepEqual(r.seat('alice')!.outfit, look);
    r.pickOutfit('bob', look);
    assert.deepEqual(r.seat('bob')!.outfit, look, 'two players may wear the same thing');
    r.pickOutfit('alice', { head: null, eyes: '' });
    assert.deepEqual(r.seat('alice')!.outfit, {}, 'null or empty clears a slot');

    assert.throws(() => r.pickOutfit('alice', { hat: 'cap' }), /Unknown outfit slot/);
    assert.throws(() => r.pickOutfit('alice', { head: 'not-an-item' }), /Unknown outfit item/);
    assert.throws(() => r.pickOutfit('alice', { head: shared('body') }), /Unknown outfit item/, 'an item in the wrong slot');
    assert.throws(() => r.pickOutfit('alice', { [signature.slot]: signature.id }), /another character/);
    assert.throws(() => r.pickOutfit('alice', 'cap'), /Unknown outfit/);
    assert.throws(() => r.pickOutfit('alice', ['cap']), /Unknown outfit/);
    assert.throws(() => r.pickOutfit('carol', { head: shared('head') }), /not seated/);
    assert.deepEqual(r.seat('alice')!.outfit, {}, 'a refused pick changes nothing');
    for (const slot of OUTFIT_SLOTS) assert.ok(OUTFIT_ITEMS.some(i => i.slot === slot.id && !i.only), `${slot.id} has items`);

    r.start('alice', false);
    assert.throws(() => r.pickOutfit('alice', { head: shared('head') }), /already started/, 'the lobby only');
  } finally {
    done();
  }
});

test('cards colours: seat colours only, one seat each', () => {
  const { r, done } = table();
  try {
    r.join(m('alice'));
    r.join(m('bob'));
    assert.notEqual(r.seat('alice')!.color, r.seat('bob')!.color, 'everyone sits down in a colour of their own');
    const free = CARDS_SEAT_COLORS.find(c => !r.seats.some(s => s.color === c))!;
    r.pickColor('alice', free);
    assert.equal(r.seat('alice')!.color, free);
    assert.throws(() => r.pickColor('bob', free), /taken/);
    assert.throws(() => r.pickColor('bob', '#123456'), /Unknown colour/);
    assert.throws(() => r.pickColor('bob', 7), /Unknown colour/);
  } finally {
    done();
  }
});

test('cards outfits: an NFT Chog keeps the base pick for later, and the season decides the character', () => {
  const { r, done } = table((user, token) => user === 'alice' && token === 420);
  try {
    r.join(m('alice'));
    const look = { head: shared('head'), neck: shared('neck') };
    r.pickOutfit('alice', look);
    r.pickCharacter('alice', 'chog', 420);
    assert.equal(r.seat('alice')!.chogToken, 420);
    // A token Chog wears its own traits (the client draws no items on it); the pick is kept for the base Chog.
    assert.deepEqual(r.seat('alice')!.outfit, look);
    r.pickCharacter('alice', 'chog');
    assert.equal(r.seat('alice')!.chogToken, undefined);
    assert.deepEqual(r.seat('alice')!.outfit, look);
    const resting = ['chog', 'snacky', 'spiky'].find(c => !SEASON_CHARACTERS.includes(c as never));
    if (resting) assert.throws(() => r.pickCharacter('alice', resting), /not available/, 'the season’s rules apply');
  } finally {
    done();
  }
});

test('cards outfits: bots dress up from the shared items', () => {
  const { r, done } = table();
  try {
    r.join(m('alice'));
    for (let i = 0; i < 5; i++) r.addBot('alice', false);
    for (const b of r.seats.filter(s => s.isBot)) {
      for (const [slot, id] of Object.entries(b.outfit)) {
        const item = OUTFIT_ITEMS.find(i => i.id === id);
        assert.ok(item && item.slot === slot && (!item.only || item.only === b.character), `${b.name}: ${slot}=${id}`);
      }
    }
  } finally {
    done();
  }
});

test('cards outfits and colours survive a snapshot, and a bad one is cleaned up on restore', () => {
  const { r, done } = table();
  try {
    r.join(m('alice'));
    r.join(m('bob'));
    r.join(m('carol'));
    const look = { head: shared('head'), body: shared('body') };
    r.pickOutfit('alice', look);
    r.pickColor('bob', CARDS_SEAT_COLORS[5]);
    r.start('alice', false);
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    const back = CardsRoom.restore(snap, hooks());
    try {
      assert.deepEqual(back.seat('alice')!.outfit, look, 'the match keeps its looks');
      assert.equal(back.seat('bob')!.color, CARDS_SEAT_COLORS[5]);
      assert.deepEqual(back.view('bob').seats.map(s => s.outfit), r.view('bob').seats.map(s => s.outfit));
    } finally {
      back.dispose();
    }

    // Hand-edited or older: unknown items, someone else's signature, no outfit at all, bad and doubled colours.
    snap.seats[0].outfit = { head: 'jetpack', [signature.slot]: signature.id, neck: shared('neck'), tail: 'x' };
    delete snap.seats[1].outfit;
    snap.seats[1].color = 'purple';
    snap.seats[2].color = snap.seats[0].color;
    const fixed = CardsRoom.restore(snap, hooks());
    try {
      assert.deepEqual(fixed.seat('alice')!.outfit, { neck: shared('neck') }, 'only what this character may wear');
      assert.deepEqual(fixed.seat('bob')!.outfit, {}, 'none at all is fine');
      const colours = fixed.seats.map(s => s.color);
      assert.ok(colours.every(c => CARDS_SEAT_COLORS.includes(c)), 'seat colours only');
      assert.equal(new Set(colours).size, colours.length, 'one seat each');
      assert.equal(fixed.seat('alice')!.color, snap.seats[0].color, 'the first holder keeps a doubled colour');
    } finally {
      fixed.dispose();
    }
  } finally {
    done();
  }
});

test('cards:seat over the socket takes an outfit and a colour, and refuses bad ones', async () => {
  const { Server } = await import('socket.io');
  const { io: connect } = await import('socket.io-client');
  const { attachSockets } = await import('../src/sockets.ts');
  const { attachCardsSockets } = await import('../src/cards/sockets.ts');
  const { makeDemoProfile, signToken } = await import('../src/auth.ts');
  type Reply = { ok: boolean; error?: string; [k: string]: unknown };
  const http = createServer();
  const io = new Server(http);
  attachSockets(io);
  const cards = attachCardsSockets(io);
  http.listen(0);
  await new Promise(r => http.once('listening', r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const profile = makeDemoProfile('Dress');
  const c = connect(url, { auth: { token: signToken(profile) }, transports: ['websocket'], reconnection: false });
  try {
    await new Promise(r => c.once('hello', r));
    const call = (event: string, payload?: unknown) => new Promise<Reply>(r => c.emit(event, payload, r));
    const { code } = await call('cards:create') as Reply & { code: string };
    const look = { head: shared('head'), eyes: shared('eyes') };
    assert.equal((await call('cards:seat', { outfit: look, color: CARDS_SEAT_COLORS[3] })).ok, true);
    const seat = cards.registry.get(code)!.seat(profile.id)!;
    assert.deepEqual(seat.outfit, look);
    assert.equal(seat.color, CARDS_SEAT_COLORS[3]);
    assert.deepEqual(await call('cards:seat', { outfit: { head: 'jetpack' } }), { ok: false, error: 'Unknown outfit item' });
    assert.deepEqual(await call('cards:seat', { color: '#000000' }), { ok: false, error: 'Unknown colour' });
    assert.deepEqual(cards.registry.get(code)!.seat(profile.id)!.outfit, look);
  } finally {
    c.close();
    for (const code of [...cards.registry.rooms.keys()]) cards.registry.delete(code);
    io.close();
    http.close();
  }
});
