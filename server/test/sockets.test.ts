// The socket layer end to end (a real Socket.IO server and client) and who
// counts as an operator.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

// Storage and sign-in mode are read at import time.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-sockets-'));
process.env.DEMO_MODE = '1';

const { Server } = await import('socket.io');
const { io: connect } = await import('socket.io-client');
const { attachSockets, plainPayload } = await import('../src/sockets.ts');
const { makeDemoProfile, signToken, withAdminFlag } = await import('../src/auth.ts');

type Reply = { ok: boolean; error?: string; [k: string]: unknown };

let http: HttpServer;
let layer: ReturnType<typeof attachSockets>;
let url = '';
before(async () => {
  http = createServer();
  const io = new Server(http);
  layer = attachSockets(io);
  http.listen(0);
  await new Promise(r => http.once('listening', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
after(() => {
  for (const code of [...layer.registry.rooms.keys()]) layer.registry.delete(code);
  http.close();
});

async function client(name: string) {
  const profile = makeDemoProfile(name);
  const c = connect(url, { auth: { token: signToken(profile) }, transports: ['websocket'], reconnection: false });
  await new Promise(r => c.once('hello', r));
  const call = (event: string, payload?: unknown) => new Promise<Reply>(r => c.emit(event, payload, r));
  return { c, call, id: profile.id };
}

test('the socket layer only accepts plain-object payloads', async () => {
  assert.equal(plainPayload(undefined), true);
  assert.equal(plainPayload(null), true);
  assert.equal(plainPayload({ type: 'roll' }), true);
  assert.equal(plainPayload(JSON.parse('{"__proto__": {"x": 1}}')), true, 'parsed JSON is a plain object');
  for (const p of ['roll', 5, true, [{ type: 'roll' }], Buffer.from('x'), new Date(), () => 1]) {
    assert.equal(plainPayload(p), false, String(p));
  }

  const a = await client('Payload');
  const { code } = await a.call('room:create') as Reply & { code: string };
  assert.ok(code);
  for (const bad of ['roll', 42, [{ type: 'roll' }], Buffer.from('{"type":"roll"}')]) {
    const res = await a.call('game:action', bad);
    assert.deepEqual(res, { ok: false, error: 'Bad request' }, String(bad));
  }
  assert.deepEqual(await a.call('room:configure', ['rules']), { ok: false, error: 'Bad request' });
  assert.equal((await a.call('room:addBot')).ok, true, 'no payload at all is fine');
  a.c.close();
});

test('room:away keeps the seat but marks it disconnected; opening the room again reconnects', async () => {
  const a = await client('Alice');
  const { code } = await a.call('room:create') as Reply & { code: string };
  const room = layer.registry.get(code)!;
  assert.equal((await a.call('room:addBot')).ok, true);
  assert.equal((await a.call('room:start')).ok, true);
  assert.equal(room.seat(a.id)!.connected, true);

  // A late message about some other room changes nothing.
  assert.equal((await a.call('room:away', { code: 'ZZZZZ' })).ok, true);
  assert.equal(room.seat(a.id)!.connected, true);

  assert.equal((await a.call('room:away', { code: code.toLowerCase() })).ok, true);
  const seat = room.seat(a.id)!;
  assert.equal(seat.connected, false, 'away: autopilot will cover the seat after the grace');
  assert.ok(seat.disconnectedAt !== null);
  assert.equal(room.game!.player(a.id).bankrupt, false, 'not a forfeit');
  assert.deepEqual(await a.call('game:action', { type: 'roll' }), { ok: false, error: 'Join a room first' });

  assert.equal((await a.call('room:join', { code })).ok, true);
  assert.equal(room.seat(a.id)!.connected, true, 'back at the table');
  room.dispose();
  a.c.close();
});

test('no ADMIN_DISCORD_IDS: everyone is an operator in dev, nobody in production', () => {
  const saved = { env: process.env.NODE_ENV, ids: process.env.ADMIN_DISCORD_IDS };
  const p = { id: 'dc_1', name: 'X', avatar: '', provider: 'discord' as const, discord: { id: '1', username: 'x' } };
  try {
    delete process.env.ADMIN_DISCORD_IDS;
    process.env.NODE_ENV = 'development';
    assert.equal(withAdminFlag(p).isAdmin, true);
    process.env.NODE_ENV = 'production';
    assert.equal(withAdminFlag(p).isAdmin, false, 'fails closed');
    process.env.ADMIN_DISCORD_IDS = '1';
    assert.equal(withAdminFlag(p).isAdmin, true, 'listed operators still are');
    assert.equal(withAdminFlag({ ...p, discord: { id: '2', username: 'y' } }).isAdmin, false);
  } finally {
    if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
    if (saved.ids === undefined) delete process.env.ADMIN_DISCORD_IDS; else process.env.ADMIN_DISCORD_IDS = saved.ids;
  }
});
