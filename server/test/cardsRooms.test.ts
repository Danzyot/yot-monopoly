// Card tables: the room lifecycle, bot and reaction timers for every seat,
// autopilot for players who drop or time out, snapshots, and the socket layer
// sending each player their own hand only.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

// Storage and sign-in mode are read at import time.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-cards-rooms-'));
process.env.DEMO_MODE = '1';

const { CardsRegistry, CardsRoom, CARDS_AUTOPILOT_GRACE_MS } = await import('../src/cards/rooms.ts');
const { saveCardsIfDirty, restoreCardsLive, CARDS_LIVE_FILE } = await import('../src/cards/persist.ts');
const { seeded, setHand, setTop, specs } = await import('./cardsHelpers.ts');
type Room = InstanceType<typeof CardsRoom>;

const m = (id: string, name = id.toUpperCase()) => ({ id, name, avatar: '🙂' });

/** A registry on a scripted clock with mocked setTimeout: advance() moves both. */
function harness() {
  let clock = 1_000_000;
  const now = () => clock;
  mock.timers.enable({ apis: ['setTimeout'] });
  const events: string[] = [];
  let finished = 0;
  const reg = new CardsRegistry({
    onChange() {}, onEvent(_r, t) { events.push(t); }, onFinished() { finished++; },
  }, 1e9, { now, rng: seeded(7) });
  return {
    reg, now, events,
    finished: () => finished,
    advance(ms: number) {
      for (let left = ms; left > 0;) {
        const step = Math.min(20, left);
        clock += step;
        mock.timers.tick(step);
        left -= step;
      }
    },
    done() {
      for (const code of [...reg.rooms.keys()]) reg.delete(code);
      mock.timers.reset();
    },
  };
}

/**
 * Set the table up: `current` to play, these hands, this top card, and no
 * turn timer unless asked. Re-arms the room's timers for the new position.
 */
function arrange(room: Room, current: string, hands: Record<string, string[]>, top = 'r3') {
  const g = room.game!;
  g.currentIdx = g.players.findIndex(p => p.id === current);
  g.phase = 'play';
  g.pending = null;
  g.direction = 1;
  g.oneCard = {};
  g.turn++;
  for (const [id, h] of Object.entries(hands)) setHand(g, id, h);
  setTop(g, top);
  // (the engine starts a step's clock when it settles: this position never did)
  g.turnEndsAt = g.rules.turnSeconds ? g.clock() + g.rules.turnSeconds * 1000 : null;
  // Any change re-plans every seat: reconnecting someone is the cheapest.
  const human = room.seats.find(s => !s.isBot && s.connected);
  if (human) room.setConnected(human.id, true);
}

test('lobby: seats, host, rules, bots, kicks and the start', () => {
  const h = harness();
  try {
    const r = h.reg.create('a');
    r.join(m('a', 'Alice'));
    r.join(m('b', 'Bob'));
    r.join(m('c', 'Alice'));
    assert.equal(r.seat('c')!.name, 'Alice 2', 'names stay apart');
    assert.equal(r.rules.match, 'single', 'a table starts as one quick round');

    assert.throws(() => r.configure('b', false, { rules: { stacking: true } }), /host/);
    r.configure('a', false, { rules: { stacking: true, stackMixed: true, turnSeconds: 3, targetScore: 9e9, match: 'points' } });
    assert.equal(r.rules.stacking, true);
    assert.equal(r.rules.turnSeconds, 10, 'normalised: a few seconds is no time at all');
    assert.equal(r.rules.targetScore, 5000, 'clamped');
    r.configure('a', false, { rules: { stacking: false } });
    assert.equal(r.rules.stackMixed, false, 'mixed stacking goes with stacking');

    r.addBot('a', false, 'hard');
    assert.equal(r.seats.at(-1)!.level, 'hard');
    r.setBotLevel('a', false, r.seats.at(-1)!.id, 'easy');
    assert.equal(r.seats.at(-1)!.level, 'easy');
    assert.throws(() => r.addBot('b', false), /host/);
    r.configure('a', false, { maxPlayers: 3 });
    assert.equal(r.seats.length, 3, 'the bot made room; people are never removed');
    assert.throws(() => r.join(m('d')), /full/);

    r.kick('a', 'c', false);
    assert.equal(r.seat('c'), undefined);
    assert.throws(() => r.join(m('c')), /removed/);
    assert.ok(r.wasKicked('c'));

    assert.throws(() => r.pickCharacter('b', r.seat('a')!.character), /taken/);
    r.pickColor('b', '#c9e265');
    assert.equal(r.seat('b')!.color, '#c9e265');

    r.leave('a');
    assert.equal(r.hostId, 'b', 'the host leaving hands the table on');
    r.join(m('a', 'Alice'));
    r.start('b', false);
    assert.equal(r.status, 'playing');
    assert.equal(r.game!.players.length, 2);
    assert.throws(() => r.join(m('zed')), /started/);
    assert.doesNotThrow(() => r.join(m('a', 'Alice')), 'reclaiming a seat is always fine');
  } finally {
    h.done();
  }
});

test('views: your own hand only; spectators see none', () => {
  const h = harness();
  try {
    const r = h.reg.create('a');
    r.join(m('a'));
    r.join(m('b'));
    r.addBot('a', false);
    r.start('a', false);
    const va = r.view('a').game!;
    const vb = r.view('b').game!;
    const spec = r.view().game!;
    assert.equal(va.you!.id, 'a');
    assert.equal(va.you!.hand.length, 7);
    assert.equal(spec.you, null);
    const ids = new Set(va.you!.hand.map(c => c.id));
    assert.ok(vb.you!.hand.every(c => !ids.has(c.id)));
    assert.deepEqual(va.players.map(p => p.id), vb.players.map(p => p.id), 'everyone sees the same seat order');
    assert.equal(va.current, vb.current);
    assert.ok(!JSON.stringify(spec).includes('"hand"'), 'no hand anywhere in a spectator view');
  } finally {
    h.done();
  }
});

test('a reaction timer: a bot catches a player who forgot "Last card!" (every seat plans its own move)', () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.addBot('h', false, 'hard');
    r.addBot('h', false, 'hard');
    r.configure('h', false, { rules: { turnSeconds: 0 } });
    r.start('h', false);
    h.advance(4_000); // the deal plays out
    const g = r.game!;
    const [b1, b2] = r.seats.filter(s => s.isBot).map(s => s.id);
    // Seat order h, then b1, b2 (h goes now; whoever is next plays after).
    arrange(r, 'h', { h: ['r5', 'b6'], [b1]: ['g1', 'g2', 'g4'], [b2]: ['g1', 'g2', 'g4'] });
    const card = g.player('h').hand.find(c => c.color === 'red')!;
    r.act('h', { type: 'play', card: card.id });
    assert.equal(g.player('h').hand.length, 1);
    assert.ok(g.view().oneCard.some(o => o.player === 'h' && o.catchable), 'forgot to call');
    // Both bots have a move planned at once: the reaction is not starved by the turn.
    assert.deepEqual(new Set(r.pendingTimers().seats), new Set([b1, b2]));

    h.advance(900);
    assert.equal(g.player('h').hand.length, 1, 'nobody catches inside the grace');
    h.advance(2_500);
    assert.ok(h.events.some(e => /caught H without a "Last card!" call/.test(e)), h.events.join('\n'));
    assert.ok(g.player('h').hand.length >= 3, 'caught: draw 2');
  } finally {
    h.done();
  }
});

test('a call in time is safe: nobody catches it', () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.addBot('h', false, 'hard');
    r.configure('h', false, { rules: { turnSeconds: 0 } });
    r.start('h', false);
    h.advance(4_000);
    const b = r.seats.find(s => s.isBot)!.id;
    arrange(r, 'h', { h: ['r5', 'b6'], [b]: ['g1', 'g2', 'g4'] });
    const g = r.game!;
    r.act('h', { type: 'play', card: g.player('h').hand.find(c => c.color === 'red')!.id, callLastCard: true });
    h.advance(3_000);
    assert.ok(!h.events.some(e => /caught/.test(e)));
    assert.equal(specs(g, 'h').length, 1);
  } finally {
    h.done();
  }
});

test('disconnect: the seat waits out the grace, then autopilot plays for it (no risks, no catches)', () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.join(m('x'));
    r.addBot('h', false);
    r.configure('h', false, { rules: { turnSeconds: 0 } });
    r.start('h', false);
    h.advance(4_000);
    const g = r.game!;
    const b = r.seats.find(s => s.isBot)!.id;
    arrange(r, 'h', { h: ['r5', 'b6', 'b7'], x: ['g1', 'g2'], [b]: ['g1', 'g2', 'g4'] });
    r.setConnected('h', false);
    h.advance(CARDS_AUTOPILOT_GRACE_MS - 1_000);
    assert.equal(g.current.id, 'h', 'still their turn during the grace');
    assert.equal(r.automated(r.seat('h')!), null);
    h.advance(4_000);
    assert.equal(r.automated(r.seat('h')!), 'autopilot');
    assert.notEqual(g.current.id, 'h', 'autopilot made the move');
    assert.ok(g.log.some(l => l.who === 'h' && /plays Red 5/.test(l.text)), g.log.map(l => l.text).join('\n'));
    // Back at the table: the seat is theirs again.
    r.join(m('h'));
    r.setConnected('h', true);
    assert.equal(r.automated(r.seat('h')!), null);
  } finally {
    h.done();
  }
});

test('timing out twice marks a player away; autopilot covers them until "I\'m back"', () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.addBot('h', false);
    r.configure('h', false, { rules: { turnSeconds: 10 } });
    r.start('h', false);
    h.advance(4_000);
    const g = r.game!;
    const b = r.seats.find(s => s.isBot)!.id;
    arrange(r, 'h', { h: ['y1', 'y2', 'y4', 'y5', 'y6'], [b]: ['b1', 'b2', 'b4', 'b5', 'b6', 'b8'] }, 'g9');
    // Nobody can follow green: each turn is a draw (and a pass) until someone can.
    for (let i = 0; i < 40 && !g.player('h').afk; i++) h.advance(2_000);
    assert.ok(g.player('h').afk, g.log.map(l => l.text).join('\n'));
    assert.equal(r.automated(r.seat('h')!), 'autopilot');
    r.back('h');
    assert.ok(!g.player('h').afk);
    assert.equal(r.automated(r.seat('h')!), null);
    assert.ok(h.events.some(e => /H is back/.test(e)));
  } finally {
    h.done();
  }
});

test('a full bot match runs to the end on its own and is recorded as finished', () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.addBot('h', false, 'hard');
    r.addBot('h', false, 'easy');
    r.configure('h', false, { rules: { turnSeconds: 0 } });
    r.start('h', false);
    r.setAutopilot('h', 'h', true, false);
    for (let i = 0; i < 2_000 && r.status === 'playing'; i++) h.advance(1_000);
    assert.equal(r.status, 'finished');
    assert.equal(r.game!.phase, 'over');
    assert.equal(h.finished(), 1);
    r.rematch('h', false, () => true);
    assert.equal(r.status, 'lobby');
    assert.equal(r.seats.length, 3);
  } finally {
    h.done();
  }
});

test('snapshot / restore keeps a match mid-play; players come back disconnected; files round-trip', async () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.join(m('x'));
    r.addBot('h', false);
    r.configure('h', false, { rules: { turnSeconds: 0, sevenZero: true } });
    r.start('h', false);
    h.advance(4_000);
    const g = r.game!;
    const before = { cur: g.current.id, hands: g.players.map(p => p.hand.map(c => c.id)), top: g.top!.id, rules: g.rules };

    const snap = JSON.parse(JSON.stringify(h.reg.snapshot()));
    const reg2 = new CardsRegistry({ onChange() {}, onEvent() {}, onFinished() {} }, 1e9, { now: h.now });
    assert.equal(reg2.restore(snap), 1);
    const r2 = reg2.get(r.code)!;
    assert.equal(r2.status, 'playing');
    assert.equal(r2.game!.current.id, before.cur);
    assert.deepEqual(r2.game!.players.map(p => p.hand.map(c => c.id)), before.hands);
    assert.equal(r2.game!.top!.id, before.top);
    assert.deepEqual(r2.game!.rules, before.rules);
    assert.equal(r2.seat('h')!.connected, false, 'humans come back disconnected until they reconnect');
    assert.equal(r2.seat(r.seats.find(s => s.isBot)!.id)!.connected, true);
    assert.equal(r2.view('x').game!.you!.hand.length, g.player('x').hand.length);
    for (const code of [...reg2.rooms.keys()]) reg2.delete(code);

    // Through the data directory, as the server does it.
    assert.equal(await saveCardsIfDirty(h.reg), true);
    assert.equal(await saveCardsIfDirty(h.reg), false, 'nothing changed: nothing written');
    const onDisk = JSON.parse(readFileSync(join(process.env.DATA_DIR!, CARDS_LIVE_FILE), 'utf8'));
    assert.equal(onDisk.length, 1);
    const reg3 = new CardsRegistry({ onChange() {}, onEvent() {}, onFinished() {} }, 1e9, { now: h.now });
    assert.equal(restoreCardsLive(reg3), 1);
    assert.equal(reg3.get(r.code)!.game!.current.id, before.cur);
    for (const code of [...reg3.rooms.keys()]) reg3.delete(code);
  } finally {
    h.done();
  }
});

test('idle sweep: a table nobody is at is ended, then removed', () => {
  const h = harness();
  try {
    const r = h.reg.create('h');
    r.join(m('h'));
    r.addBot('h', false);
    r.start('h', false);
    r.setConnected('h', false);
    h.reg.sweep(h.now() + 31 * 60_000);
    assert.equal(h.reg.get(r.code), undefined, 'ended and gone');
  } finally {
    h.done();
  }
});

// ---- the socket layer ----------------------------------------------------------

const { Server } = await import('socket.io');
const { io: connect } = await import('socket.io-client');
const { attachSockets } = await import('../src/sockets.ts');
const { attachCardsSockets } = await import('../src/cards/sockets.ts');
const { makeDemoProfile, signToken } = await import('../src/auth.ts');
type Reply = { ok: boolean; error?: string; [k: string]: unknown };
type State = import('../../shared/cards/room.ts').CardsRoomView;

let url = '';
async function client(name: string | null) {
  const profile = name ? makeDemoProfile(name) : null;
  const c = connect(url, { auth: { token: profile ? signToken(profile) : '' }, transports: ['websocket'], reconnection: false });
  await new Promise(r => c.once('hello', r));
  let last: State | null = null;
  c.on('cards:state', (s: State) => { last = s; });
  const call = (event: string, payload?: unknown) => new Promise<Reply>(r => c.emit(event, payload, r));
  return { c, call, id: profile?.id ?? '', state: () => last };
}
const settle = () => new Promise(r => setTimeout(r, 120));

test('sockets: create, join by code, bots, start; each player gets their own hand only', async () => {
  const http = createServer();
  const io = new Server(http);
  attachSockets(io);
  const cards = attachCardsSockets(io);
  http.listen(0);
  await new Promise(r => http.once('listening', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const open: { c: { close(): void } }[] = [];
  const track = async (name: string | null) => { const x = await client(name); open.push(x); return x; };
  try {
    const a = await track('Ann');
    const b = await track('Ben');
    const w = await track(null);
    const { code } = await a.call('cards:create') as Reply & { code: string };
    assert.match(code, /^[A-Z2-9]{5}$/);
    assert.equal((await b.call('cards:join', { code: code.toLowerCase() })).spectating, false);
    assert.equal((await w.call('cards:join', { code })).spectating, true, 'not signed in: watching');
    assert.equal((await a.call('cards:addBot', { level: 'hard' })).ok, true);
    assert.equal((await a.call('cards:configure', { rules: { jumpIn: true }, private: true })).ok, true);
    assert.deepEqual(await a.call('cards:act', 'play'), { ok: false, error: 'Bad request' });
    assert.equal((await a.call('cards:start')).ok, true);
    await settle();

    const sa = a.state()!, sb = b.state()!, sw = w.state()!;
    assert.equal(sa.status, 'playing');
    assert.equal(sa.game!.you!.id, a.id);
    assert.equal(sb.game!.you!.id, b.id);
    assert.equal(sw.game!.you, null);
    assert.equal(sa.rules.jumpIn, true);
    const mine = new Set(sa.game!.you!.hand.map(c => c.id));
    assert.ok(sb.game!.you!.hand.every(c => !mine.has(c.id)), 'hands are disjoint');
    assert.deepEqual(sa.game!.players.map(p => p.id), sb.game!.players.map(p => p.id));

    // Acting out of turn is refused with a reason.
    const notMe = sa.game!.current === a.id ? b : a;
    const st = notMe.state()!;
    if (!st.game!.you!.playable.length) {
      const r = await notMe.call('cards:act', { type: 'draw' });
      assert.equal(r.ok, false);
    }
    // Chat reaches everyone at the table.
    const heard = new Promise<{ text: string }>(r => w.c.once('cards:chat', r));
    assert.equal((await a.call('cards:chat', { text: 'good luck' })).ok, true);
    assert.equal((await heard).text, 'good luck');

  } finally {
    for (const x of open) x.c.close();
    for (const code of [...cards.registry.rooms.keys()]) cards.registry.delete(code);
    io.close();
    http.close();
  }
});
