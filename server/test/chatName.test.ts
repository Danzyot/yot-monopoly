// Chat speaks with the seat's name: two accounts both called "Alice" are
// seated as "Alice" and "Alice 2", and chat must say which one is talking.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-chatname-'));
process.env.DEMO_MODE = '1';

const { Server } = await import('socket.io');
const { io: connect } = await import('socket.io-client');
const { attachSockets } = await import('../src/sockets.ts');
const { makeDemoProfile, signToken } = await import('../src/auth.ts');

type Reply = { ok: boolean; error?: string; [k: string]: unknown };

let http: HttpServer;
let layer: ReturnType<typeof attachSockets>;
let url = '';
before(async () => {
  http = createServer();
  layer = attachSockets(new Server(http));
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
  return { c, call, id: profile.id, profile };
}

test('a lookalike name is seated de-duplicated, and chat uses the seat name', async () => {
  const a = await client('Alice');
  const b = await client('Alice​');
  assert.equal(b.profile.name, 'Alice', 'the zero-width space is gone at sign-in');

  const { code } = await a.call('room:create') as Reply & { code: string };
  assert.equal((await b.call('room:join', { code })).ok, true);
  const room = layer.registry.get(code)!;
  const seatB = room.seat(b.id)!;
  assert.notEqual(seatB.name, room.seat(a.id)!.name, 'two seats never share a name');

  const heard = new Promise<{ id: string; name: string; text: string }>(r => a.c.on('chat', m => { if (m.id === b.id) r(m); }));
  assert.equal((await b.call('chat', { text: 'it was me ‮gg' })).ok, true);
  const msg = await heard;
  assert.equal(msg.name, seatB.name);
  assert.equal(msg.text, 'it was me gg');
  a.c.close();
  b.c.close();
});
