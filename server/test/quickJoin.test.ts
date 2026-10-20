// "Play now" on the home page: which table a quick player is sent to
// (quickJoin.ts), and rooms:quickJoin / cards:quickJoin end to end.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-quickjoin-'));
process.env.DEMO_MODE = '1';

const { pickQuickTable, QUICK_BOTS } = await import('../src/quickJoin.ts');
type QuickTable = import('../src/quickJoin.ts').QuickTable;

const human = (id: string, connected = true) => ({ id, isBot: false, connected });
const bot = (id: string) => ({ id, isBot: true, connected: true });
const t = (code: string, seats: QuickTable['seats'], extra: Partial<QuickTable> = {}): QuickTable => ({
  code, private: false, status: 'lobby', seats, maxPlayers: 6, createdAt: 1_000, restricted: false, ...extra,
});

test('quick join: the open public lobby nearest to filling up', () => {
  const tables = [
    t('ROOMY', [human('a'), bot('b1')]),
    t('ALMOST', [human('c'), human('d'), bot('b2'), bot('b3'), bot('b4')]),
    t('FULL', [human('e'), bot('b5'), bot('b6'), bot('b7'), bot('b8'), bot('b9')]),
  ];
  assert.equal(pickQuickTable(tables, 'me')?.code, 'ALMOST');
});

test('quick join: ties go to more people, then the older table', () => {
  const bots = t('BOTS', [human('a'), bot('b1'), bot('b2')], { createdAt: 1 });
  const people = t('PEOPLE', [human('c'), human('d'), bot('b3')], { createdAt: 5 });
  const older = t('OLDER', [human('e'), human('f'), bot('b4')], { createdAt: 2 });
  assert.equal(pickQuickTable([bots, people, older], 'me')?.code, 'OLDER');
  assert.equal(pickQuickTable([bots, people], 'me')?.code, 'PEOPLE');
});

test('quick join: never private, gated, started, empty or barred tables', () => {
  const tables = [
    t('PRIV', [human('a')], { private: true }),
    t('GATED', [human('b')], { restricted: true }),
    t('PLAYING', [human('c')], { status: 'playing' }),
    t('DONE', [human('d')], { status: 'finished' }),
    t('AWAY', [human('e', false), bot('b1')]),
    t('KICKED', [human('f')]),
  ];
  assert.equal(pickQuickTable(tables, 'me', x => x.code === 'KICKED'), null);
});

test('quick join: a public lobby you already sit at comes first', () => {
  const mine = t('MINE', [human('me'), bot('b1')]);
  const fuller = t('FULLER', [human('a'), human('b'), human('c'), bot('b2'), bot('b3')]);
  assert.equal(pickQuickTable([fuller, mine], 'me')?.code, 'MINE');
  // ...unless it is private: that is not a quick game.
  assert.equal(pickQuickTable([fuller, { ...mine, private: true }], 'me')?.code, 'FULLER');
});

// ---- end to end over sockets ----

const { Server } = await import('socket.io');
const { io: connect } = await import('socket.io-client');
const { attachSockets } = await import('../src/sockets.ts');
const { attachCardsSockets } = await import('../src/cards/sockets.ts');
const { makeDemoProfile, signToken } = await import('../src/auth.ts');
type Reply = { ok: boolean; error?: string; code?: string; created?: boolean };

let http: HttpServer;
let mono: ReturnType<typeof attachSockets>;
let cards: ReturnType<typeof attachCardsSockets>;
let url = '';
const open: { close(): void }[] = [];
before(async () => {
  http = createServer();
  const io = new Server(http);
  mono = attachSockets(io);
  cards = attachCardsSockets(io, { taken: code => !!mono.registry.get(code) });
  mono.registry.taken = code => !!cards.registry.get(code);
  http.listen(0);
  await new Promise(r => http.once('listening', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
after(() => {
  for (const c of open) c.close();
  for (const code of [...mono.registry.rooms.keys()]) mono.registry.delete(code);
  for (const code of [...cards.registry.rooms.keys()]) cards.registry.delete(code);
  http.close();
});

async function client(name: string | null) {
  const profile = name ? makeDemoProfile(name) : null;
  const c = connect(url, { auth: { token: profile ? signToken(profile) : '' }, transports: ['websocket'], reconnection: false });
  open.push(c);
  await new Promise(r => c.once('hello', r));
  const call = (event: string, payload?: unknown) => new Promise<Reply>(r => c.emit(event, payload, r));
  return { c, call, id: profile?.id ?? '' };
}

test('rooms:quickJoin: opens a table with bots, then fills it; private tables are passed over', async () => {
  const guest = await client(null);
  assert.deepEqual(await guest.call('rooms:quickJoin'), { ok: false, error: 'Sign in first' });

  const ann = await client('Ann');
  const first = await ann.call('rooms:quickJoin');
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  const room = mono.registry.get(first.code!)!;
  assert.equal(room.status, 'lobby');
  assert.equal(room.hostId, ann.id);
  assert.equal(room.seats.filter(s => s.isBot).length, QUICK_BOTS.monopoly);
  assert.ok(room.seat(ann.id)?.connected);

  // Asking again lands at the same table, not a new one.
  assert.deepEqual(await ann.call('rooms:quickJoin'), { ok: true, code: first.code, created: false });

  const ben = await client('Ben');
  assert.deepEqual(await ben.call('rooms:quickJoin'), { ok: true, code: first.code, created: false });
  assert.ok(room.seat(ben.id), 'Ben has a seat');

  // A private table is never a quick game: the next player gets one of their own.
  assert.equal((await ann.call('room:configure', { private: true })).ok, true);
  const cat = await client('Cat');
  const third = await cat.call('rooms:quickJoin');
  assert.equal(third.created, true);
  assert.notEqual(third.code, first.code);

  // The next quick player fills the open public table.
  assert.equal((await cat.call('room:addBot')).ok, true);
  const dan = await client('Dan');
  assert.deepEqual(await dan.call('rooms:quickJoin'), { ok: true, code: third.code, created: false });
});

test('cards:quickJoin: the same for card tables, which are kept apart from Monopoly rooms', async () => {
  const eve = await client('Eve');
  const first = await eve.call('cards:quickJoin');
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(mono.registry.get(first.code!), undefined);
  const table = cards.registry.get(first.code!)!;
  assert.equal(table.seats.filter(s => s.isBot).length, QUICK_BOTS.cards);

  const fay = await client('Fay');
  assert.deepEqual(await fay.call('cards:quickJoin'), { ok: true, code: first.code, created: false });
  assert.ok(table.seat(fay.id));

  // Started tables are not joined: the next player opens a new one.
  assert.equal((await eve.call('cards:start')).ok, true);
  const gus = await client('Gus');
  const next = await gus.call('cards:quickJoin');
  assert.equal(next.created, true);
  assert.notEqual(next.code, first.code);
});
