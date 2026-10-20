// Hosting rights: who may host tournaments, the approved-hosts list on the
// data volume, and the signed question poker asks the hub.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';

// Storage, the secret and operator identity are read at import time.
const SECRET = 'hub-and-poker-share-this';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-hosting-'));
process.env.APP_SECRET = SECRET;
process.env.ADMIN_DISCORD_IDS = '111111';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const hosting = await import('../src/hosting.ts');
const { hostingRoutes, canHostMessage, HOSTING_MAX_SKEW_MS } = await import('../src/routes/hosting.ts');
const { adminRoutes } = await import('../src/routes/admin.ts');
const { authRoutes } = await import('../src/routes/auth.ts');
const store = await import('../src/wallet/store.ts');
const { eventsForGame } = await import('../src/eventlog.ts');

const ADMIN = 'dc_111111';
const HOLDER = 'dc_222222';
const APPROVED = 'dc_333333';
const NOBODY = 'dc_444444';
const WALLET = '0x00000000000000000000000000000000000000c1';

// A wallet holding one Chog, read just now (so nothing re-reads the chain).
store.linkWallet(WALLET, HOLDER);
store.setHoldings(WALLET, { balance: 1, tokenIds: [7], checkedAt: Date.now(), method: 'enumerable', partial: false });

const profile = (id: string, name: string) => ({ id, name, avatar: '🎩', provider: 'discord' as const, discord: { id: id.slice(3), username: name.toLowerCase() } });
const opToken = signToken(profile(ADMIN, 'Op'));
const playerToken = signToken(profile(NOBODY, 'Rando'));

// ---- canHost --------------------------------------------------------------------

test('canHost: operators, holders and approved hosts may; nobody else', () => {
  hosting.approveHost(APPROVED, 'Approved', 'Op');
  assert.equal(hosting.hostingReason(ADMIN), 'admin');
  assert.equal(hosting.hostingReason(HOLDER), 'holder');
  assert.equal(hosting.hostingReason(APPROVED), 'approved');
  assert.equal(hosting.hostingReason(NOBODY), null);
  assert.equal(hosting.hostingReason(''), null);
  assert.equal(hosting.canHost(ADMIN), true);
  assert.equal(hosting.canHost(HOLDER), true);
  assert.equal(hosting.canHost(APPROVED), true);
  assert.equal(hosting.canHost(NOBODY), false);
  hosting.revokeHost(APPROVED);
});

test('canHost: a holder who sells (balance 0) is no longer a host', () => {
  store.setHoldings(WALLET, { balance: 0, tokenIds: [], checkedAt: Date.now(), method: 'enumerable', partial: false });
  assert.equal(hosting.canHost(HOLDER), false);
  store.setHoldings(WALLET, { balance: 1, tokenIds: [7], checkedAt: Date.now(), method: 'enumerable', partial: false });
  assert.equal(hosting.canHost(HOLDER), true);
});

test('canHost: the operator list is read live, and production with none fails closed', () => {
  const prev = { ids: process.env.ADMIN_DISCORD_IDS, env: process.env.NODE_ENV };
  try {
    process.env.ADMIN_DISCORD_IDS = '444444';
    assert.equal(hosting.hostingReason(NOBODY), 'admin');
    assert.equal(hosting.hostingReason(ADMIN), null);
    process.env.ADMIN_DISCORD_IDS = '';
    process.env.NODE_ENV = 'production';
    assert.equal(hosting.canHost(NOBODY), false, 'no operators configured in production: nobody is one');
    assert.equal(hosting.canHost('demo_x'), false);
  } finally {
    process.env.ADMIN_DISCORD_IDS = prev.ids;
    if (prev.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.env;
  }
});

// ---- the approved list on disk -----------------------------------------------------

test('approved hosts persist in hosts.json and survive a reload', () => {
  const file = join(process.env.DATA_DIR!, 'hosts.json');
  const row = hosting.approveHost('555555', 'Bare Id', 'Op', 1_000);
  assert.equal(row.id, 'dc_555555', 'a bare Discord id becomes a profile id');
  assert.ok(existsSync(file));
  hosting.resetHostsForTest();
  assert.equal(hosting.isApprovedHost('dc_555555'), false, 'memory forgotten');
  hosting.loadHosts();
  assert.equal(hosting.isApprovedHost('dc_555555'), true, 'read back from disk');
  assert.equal(hosting.listApprovedHosts().find(h => h.id === 'dc_555555')?.addedBy, 'Op');

  // Approving twice keeps one row.
  hosting.approveHost('dc_555555', 'Renamed', 'Op');
  assert.equal(hosting.listApprovedHosts().filter(h => h.id === 'dc_555555').length, 1);

  assert.equal(hosting.revokeHost('dc_555555'), true);
  assert.equal(hosting.revokeHost('dc_555555'), false, 'already gone');
  hosting.loadHosts();
  assert.equal(hosting.isApprovedHost('dc_555555'), false, 'removal persisted');
});

test('junk in hosts.json and in the id box is refused', () => {
  writeFileSync(join(process.env.DATA_DIR!, 'hosts.json'), JSON.stringify({
    hosts: [{ id: 'dc_666666', name: 'Ok', addedBy: 'Op', addedAt: 1 }, { id: '../etc' }, { id: 5 }, null],
  }));
  hosting.loadHosts();
  assert.deepEqual(hosting.listApprovedHosts().map(h => h.id), ['dc_666666']);
  for (const bad of ['', 'abc', 'dc_', 'dc_12ab', '<script>', '1234']) {
    assert.throws(() => hosting.approveHost(bad, '', 'Op'), /not a Discord id/, bad);
  }
  hosting.revokeHost('dc_666666');
});

// ---- over HTTP ------------------------------------------------------------------

const PORT = 8670;
const BASE = `http://127.0.0.1:${PORT}`;
let server: Server;
let clock = Date.now();

const sockets = {
  registry: { rooms: new Map(), get: () => undefined, delete: () => false, roomsOf: () => [] },
  broadcast() {}, connectedCount: () => 0, online: () => [],
} as unknown as Parameters<typeof adminRoutes>[0];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes());
  app.use('/api/admin', adminRoutes(sockets, () => 0));
  app.use('/api/hosting', hostingRoutes(() => clock));
  await new Promise<void>(r => { server = app.listen(PORT, '127.0.0.1', () => r()); });
});
after(() => server.close());

/** What poker sends: an HMAC of the id and the time with the shared secret. */
function signed(id: string, ts: number, secret = SECRET) {
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(`svc:${canHostMessage(id, ts)}`).digest('base64url');
  return fetch(`${BASE}/api/hosting/can-host?id=${encodeURIComponent(id)}`, {
    headers: { 'x-chog-timestamp': String(ts), 'x-chog-signature': sig },
  });
}

test('can-host: a correctly signed request gets the answer and the reason', async () => {
  clock = Date.now();
  hosting.approveHost(APPROVED, 'Approved', 'Op');
  for (const [id, reason] of [[ADMIN, 'admin'], [HOLDER, 'holder'], [APPROVED, 'approved'], [NOBODY, null]] as const) {
    const r = await signed(id, clock);
    assert.equal(r.status, 200, id);
    assert.deepEqual(await r.json(), { canHost: reason !== null, reason }, id);
  }
  hosting.revokeHost(APPROVED);
});

test('can-host: a bad signature, a different secret or no signature is refused', async () => {
  clock = Date.now();
  assert.equal((await signed(HOLDER, clock, 'not-the-shared-secret')).status, 401);
  const plain = await fetch(`${BASE}/api/hosting/can-host?id=${HOLDER}`);
  assert.equal(plain.status, 401, 'unsigned: cannot be used to list holders');
  assert.deepEqual(Object.keys(await plain.json() as object), ['error'], 'and says nothing about the id');
  // A signature for one id does not answer for another.
  const sig = createHmac('sha256', SECRET).update(`svc:${canHostMessage(NOBODY, clock)}`).digest('base64url');
  const swapped = await fetch(`${BASE}/api/hosting/can-host?id=${HOLDER}`, { headers: { 'x-chog-timestamp': String(clock), 'x-chog-signature': sig } });
  assert.equal(swapped.status, 401);
  // A session token's MAC is not a request signature (different prefix).
  const tokenSig = createHmac('sha256', SECRET).update(canHostMessage(HOLDER, clock)).digest('base64url');
  const asToken = await fetch(`${BASE}/api/hosting/can-host?id=${HOLDER}`, { headers: { 'x-chog-timestamp': String(clock), 'x-chog-signature': tokenSig } });
  assert.equal(asToken.status, 401);
});

test('can-host: a stale or future timestamp is refused even when signed', async () => {
  clock = Date.now();
  const stale = await signed(HOLDER, clock - HOSTING_MAX_SKEW_MS - 1_000);
  assert.equal(stale.status, 401);
  assert.match((await stale.json() as { error: string }).error, /Stale/);
  assert.equal((await signed(HOLDER, clock + HOSTING_MAX_SKEW_MS + 1_000)).status, 401);
  assert.equal((await signed(HOLDER, clock - HOSTING_MAX_SKEW_MS + 5_000)).status, 200, 'inside the window is fine');
});

test('/api/auth/me tells the client whether this player can host', async () => {
  const me = async (token: string) => (await (await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { canHost: boolean };
  assert.equal((await me(opToken)).canHost, true);
  assert.equal((await me(signToken(profile(HOLDER, 'Holder')))).canHost, true);
  assert.equal((await me(playerToken)).canHost, false);
});

test('dashboard: operators add and remove hosts by Discord id; each change is logged', async () => {
  const call = (method: string, path: string, token: string, body?: unknown) => fetch(`${BASE}/api/admin${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal((await call('POST', '/hosts', playerToken, { id: '777777' })).status, 403, 'players cannot approve themselves');
  assert.equal((await call('GET', '/hosts', playerToken)).status, 403);

  const added = await call('POST', '/hosts', opToken, { id: '777777', name: 'Seven' });
  assert.equal(added.status, 200);
  assert.equal((await added.json() as { id: string }).id, 'dc_777777');
  assert.equal(hosting.canHost('dc_777777'), true);
  assert.equal((await call('POST', '/hosts', opToken, { id: 'nope' })).status, 400);

  const list = await (await call('GET', '/hosts', opToken)).json() as {
    approved: { id: string; name: string; holder: boolean }[]; holders: { id: string; chogs: number }[];
  };
  assert.deepEqual(list.approved.map(h => [h.id, h.name, h.holder]), [['dc_777777', 'Seven', false]]);
  assert.deepEqual(list.holders.map(h => [h.id, h.chogs]), [[HOLDER, 1]], 'holders are shown as hosts by holding');

  assert.deepEqual(await (await call('DELETE', '/hosts/dc_777777', opToken)).json(), { ok: true });
  assert.equal(hosting.canHost('dc_777777'), false);

  const log = eventsForGame('admin').map(e => e.text).join('\n');
  assert.match(log, /approved Seven \(dc_777777\) as a host/);
  assert.match(log, /removed .*dc_777777.* from the approved hosts/);
  assert.ok(JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'hosts.json'), 'utf8')).hosts.length === 0);
});
