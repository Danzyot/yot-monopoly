// Holders' own Chogs at card tables, as in Monopoly (chogs.test.ts): only a
// verified holder of a Chog Genesis token sits as it, and the token is checked
// again whenever the table comes back to a lobby (reconnect, rematch, restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-cards-chogs-'));

const { CardsRegistry, CardsRoom } = await import('../src/cards/rooms.ts');
type Hooks = ConstructorParameters<typeof CardsRegistry>[0];

const m = (id: string) => ({ id, name: id, avatar: '🙂' });
const hooks = (holds?: (user: string, token: number) => boolean): Hooks => ({
  onChange() {}, onEvent() {}, onFinished() {}, ...(holds && { holdsChog: holds }),
});
/** A registry whose wallets are this map (change it to "sell" a token). */
function table(wallet: Record<string, number[]>) {
  const reg = new CardsRegistry(hooks((user, token) => wallet[user]?.includes(token) ?? false), 1e9);
  const r = reg.create('alice');
  return { reg, r, done: () => { for (const code of [...reg.rooms.keys()]) reg.delete(code); } };
}
const viewed = (r: InstanceType<typeof CardsRoom>, id: string) => r.view(id).seats.find(s => s.id === id)!.chogToken;

test('cards chogs: a held token is kept, from the lobby through the match and a snapshot', () => {
  const wallet: Record<string, number[]> = { alice: [420, 1969] };
  const { r, done } = table(wallet);
  try {
    r.join(m('alice'), 420);
    r.join(m('bob'));
    assert.equal(r.seat('alice')!.character, 'chog');
    assert.equal(r.seat('alice')!.chogToken, 420, 'sat down as the token asked for on join');
    assert.equal(viewed(r, 'alice'), 420, 'the token is in the views clients get');
    assert.equal(r.view().seats.find(s => s.id === 'alice')!.chogToken, 420, 'spectators see it too');

    r.pickCharacter('alice', 'chog', 1969);
    assert.equal(r.seat('alice')!.chogToken, 1969, 'switched to another held token');
    r.setConnected('alice', false);
    r.join(m('alice'), 420);
    assert.equal(r.seat('alice')!.chogToken, 1969, 'a reconnect keeps the pick (the join token is for new seats only)');

    // The base Chog is anyone's; alice's token is not.
    wallet.bob = [1969];
    assert.throws(() => r.pickCharacter('bob', 'chog', 1969), /taken/);
    r.pickCharacter('bob', 'chog');
    assert.equal(r.seat('bob')!.chogToken, undefined);

    r.addBot('alice', false);
    r.start('alice', false);
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    // A match under way keeps its look, even before the wallet store has a fresh reading.
    const back = CardsRoom.restore(snap, hooks(() => false));
    try {
      assert.equal(back.seat('alice')!.chogToken, 1969);
      assert.equal(viewed(back, 'alice'), 1969);
    } finally {
      back.dispose();
    }
    // A lobby comes back with the token while the wallet still holds it.
    const lobby = CardsRoom.restore({ ...snap, status: 'lobby', game: null }, hooks((u, t) => wallet[u]?.includes(t) ?? false));
    try {
      assert.equal(lobby.seat('alice')!.chogToken, 1969);
    } finally {
      lobby.dispose();
    }
  } finally {
    done();
  }
});

test('cards chogs: a token the player does not hold is refused and dropped', () => {
  const wallet: Record<string, number[]> = { alice: [420] };
  const { r, done } = table(wallet);
  try {
    r.join(m('alice'));
    r.join(m('bob'), 420);
    assert.equal(r.seat('bob')!.chogToken, undefined, 'joining as someone else\'s Chog sits down as the base Chog');
    r.join(m('carol'), 1);
    assert.equal(r.seat('carol')!.chogToken, undefined);

    assert.throws(() => r.pickCharacter('bob', 'chog', 420), /not in a wallet linked/);
    assert.throws(() => r.pickCharacter('alice', 'chog', 2), /not in a wallet linked/, 'alice does not hold #2');
    assert.throws(() => r.pickCharacter('alice', 'chog', 0), /Unknown Chog token/);
    assert.throws(() => r.pickCharacter('alice', 'chog', 'one'), /Unknown Chog token/);
    assert.throws(() => r.pickCharacter('alice', 'chog', 99999), /Unknown Chog token/);
    assert.equal(r.seat('alice')!.chogToken, undefined);

    // Sold while in the lobby: the token goes when they reconnect.
    r.pickCharacter('alice', 'chog', 420);
    r.setConnected('alice', false);
    wallet.alice = [];
    r.join(m('alice'));
    assert.equal(r.seat('alice')!.chogToken, undefined, 'dropped on reconnect');
    assert.equal(viewed(r, 'alice'), undefined);

    // A saved lobby: a sold token, a made-up one and a token on a non-Chog all go.
    wallet.alice = [420];
    r.pickCharacter('alice', 'chog', 420);
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    snap.seats.find((s: { id: string }) => s.id === 'bob').chogToken = 99999;
    snap.seats.find((s: { id: string }) => s.id === 'carol').chogToken = 'one';
    const sold = CardsRoom.restore(snap, hooks(() => false));
    try {
      for (const id of ['alice', 'bob', 'carol']) assert.equal(sold.seat(id)!.chogToken, undefined, `${id} is the base Chog after a restore`);
    } finally {
      sold.dispose();
    }

    // Without a verifier in the hooks nobody gets a token, whatever the client says.
    const bare = new CardsRegistry(hooks(), 1e9);
    const b = bare.create('alice');
    try {
      b.join(m('alice'), 420);
      assert.equal(b.seat('alice')!.chogToken, undefined);
      assert.throws(() => b.pickCharacter('alice', 'chog', 420), /not in a wallet linked/);
    } finally {
      bare.delete(b.code);
    }
  } finally {
    done();
  }
});

test('cards chogs: a rematch drops a Chog the wallet sold during the match', () => {
  const wallet: Record<string, number[]> = { alice: [420], bob: [7] };
  const { r, done } = table(wallet);
  try {
    r.join(m('alice'), 420);
    r.join(m('bob'), 7);
    r.start('alice', false);
    r.end('test');
    wallet.alice = []; // sold (or the wallet was unlinked) during the match
    r.rematch('alice', false, () => true);
    assert.equal(r.status, 'lobby');
    assert.equal(r.seat('alice')!.chogToken, undefined, 'back to the base Chog');
    assert.equal(r.seat('bob')!.chogToken, 7, 'a Chog still held stays');
  } finally {
    done();
  }
});
