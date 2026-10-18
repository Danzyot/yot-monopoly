import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Storage and operator identity are read at import time.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-adminrooms-'));
process.env.DEMO_MODE = '1';
process.env.ADMIN_DISCORD_IDS = '999';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const { adminRoutes } = await import('../src/routes/admin.ts');
const { eventsForGame } = await import('../src/eventlog.ts');
const { Room } = await import('../src/rooms.ts');

const hooks = { onChange() {}, onEvent() {}, onFinished() {} };
const room = new Room('ROOMB', 'host', hooks);
room.join({ id: 'host', name: 'Host', avatar: '🎩' });
const rooms = new Map([[room.code, room]]);
const sockets = {
  registry: { rooms, get: (c: string) => rooms.get(c), delete: (c: string) => rooms.delete(c) },
  broadcast() {}, connectedCount: () => 0, online: () => [],
} as unknown as Parameters<typeof adminRoutes>[0];

const op = signToken({ id: 'dc_999', name: 'Op', avatar: '🎩', provider: 'discord', discord: { id: '999', username: 'op' } });

let server: Server;
let base = '';
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes(sockets, () => 0));
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = (p: string) => fetch(`${base}/api/admin${p}`, { headers: { Authorization: `Bearer ${op}` } });
const post = (p: string, body: unknown) => fetch(`${base}/api/admin${p}`, {
  method: 'POST', headers: { Authorization: `Bearer ${op}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('rooms list carries map id, phase and debt fields for the dashboard', async () => {
  const res = await get('/rooms');
  assert.equal(res.status, 200);
  const [r] = await res.json() as Record<string, unknown>[];
  assert.equal(r.code, 'ROOMB');
  assert.equal(r.mapId, 'classic');
  assert.equal(r.phase, null);        // lobby: no game yet
  assert.equal(r.debts, 0);
  assert.equal(r.debtDeadline, null);
  assert.equal(typeof r.map, 'string');
});

test('mute reasons reach the operator log', async () => {
  const res = await post('/mutes', { id: 'demo_m', name: 'M', minutes: 30, reason: 'Spamming the lobby' });
  assert.equal(res.status, 200);
  const line = eventsForGame('admin').map(e => e.text).find(t => t.includes('muted demo_m'));
  assert.ok(line, 'mute logged');
  assert.match(line!, /for 30 min: Spamming the lobby$/);
});
