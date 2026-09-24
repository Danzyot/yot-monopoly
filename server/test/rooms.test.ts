import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, Room, sanitizeRules, type RoomHooks } from '../src/rooms.ts';

const hooks = (): RoomHooks & { events: string[]; finished: number } => {
  const h = {
    events: [] as string[], finished: 0,
    onChange() {}, onEvent(_r: Room, t: string) { h.events.push(t); }, onFinished() { h.finished++; },
  };
  return h;
};
const m = (id: string, name = id) => ({ id, name, avatar: '🙂' });

test('rooms: many at once, unique codes, lobby rules', () => {
  const reg = new Registry(hooks(), 1e9);
  const a = reg.create('host-a');
  const b = reg.create('host-b');
  assert.notEqual(a.code, b.code);
  assert.equal(reg.get(a.code.toLowerCase()), a);

  a.join(m('host-a', 'Alice'));
  a.join(m('bob', 'Bob'));
  assert.throws(() => a.start('bob', false), /host/);
  assert.doesNotThrow(() => a.configure('bob', true, { mapId: 'speed' }), 'operators can configure any room');
  assert.equal(a.mapId, 'speed');
  assert.equal(a.rules.startingCash, 1200, 'map brings its starting cash');
  assert.throws(() => a.pickCharacter('bob', a.seat('host-a')!.character), /taken/);
  a.configure('host-a', false, { themeId: 'chog' });
  assert.equal(a.rules.freeParkingPot, true, 'edition brings its house rules');
  a.configure('host-a', false, { rules: { maxPlayers: 3 } });
  a.addBot('host-a', false);
  assert.throws(() => a.addBot('host-a', false), /full/);
  assert.throws(() => a.join(m('carol')), /full/);

  a.start('host-a', false);
  assert.equal(a.status, 'playing');
  assert.equal(a.view().game!.players.length, 3);
  assert.equal(a.view().game!.mapId, 'speed');
  assert.throws(() => a.join(m('dave')), /started/);
  assert.doesNotThrow(() => a.join(m('bob')), 'rejoining a seat is always allowed');
  a.dispose();
  b.dispose();
});

test('host leaving the lobby hands the room on; kicks are logged', () => {
  const h = hooks();
  const reg = new Registry(h, 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b')); r.join(m('c'));
  r.kick('a', 'c', false);
  assert.equal(r.seat('c'), undefined);
  assert.ok(h.events.some(e => e.includes('removed')));
  r.leave('a');
  assert.equal(r.hostId, 'b');
  r.dispose();
});

test('snapshot / restore keeps a game mid-play', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b'));
  r.start('a', false);
  const g = r.game!;
  const cur = g.current.id;
  r.act(cur, { type: 'roll' });
  const snap = JSON.parse(JSON.stringify(reg.snapshot()));
  r.dispose();

  const reg2 = new Registry(hooks(), 1e9);
  assert.equal(reg2.restore(snap), 1);
  const r2 = reg2.get(r.code)!;
  assert.equal(r2.status, 'playing');
  assert.deepEqual(r2.game!.view().players.map(p => p.position), g.view().players.map(p => p.position));
  assert.equal(r2.game!.current.id, cur);
  assert.equal(r2.seat('a')!.connected, false, 'humans come back as disconnected until they reconnect');
  r2.dispose();
});

test('restoring a pre-characters snapshot maps old tokens onto characters', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b'));
  r.start('a', false);
  const snap = JSON.parse(JSON.stringify(reg.snapshot()));
  r.dispose();
  // Rewrite it the way the old code stored it: `token`, no `character`.
  const legacy = (x: Record<string, unknown>, token: string) => { delete x.character; x.token = token; };
  legacy(snap[0].seats[0], 'car'); legacy(snap[0].seats[1], 'duck');
  for (const p of snap[0].game.players) legacy(p, p.id === 'a' ? 'car' : 'duck');

  const reg2 = new Registry(hooks(), 1e9);
  assert.equal(reg2.restore(snap), 1);
  const r2 = reg2.get(r.code)!;
  assert.deepEqual(r2.view().seats.map(s => s.character).sort(), ['alien', 'spiky']);
  assert.equal(r2.game!.view().players.find(p => p.id === 'a')!.character, 'spiky');
  assert.ok(!('token' in r2.view().seats[0]), 'the legacy field is dropped');
  r2.dispose();
});

test('rules are clamped', () => {
  const r = sanitizeRules({ startingCash: -5, maxPlayers: 99, auctions: false });
  assert.equal(r.startingCash, 100);
  assert.equal(r.maxPlayers, 8);
  assert.equal(r.auctions, false);
});
