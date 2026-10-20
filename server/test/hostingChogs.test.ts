// GET /api/hosting/chogs: Chog Poker asks which Chogs a player holds, signed
// with the secret the two services share. Only a fresh, correctly signed
// request gets an answer.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const SECRET = 'shared-hub-poker-secret';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-hostchogs-'));
process.env.APP_SECRET = SECRET;

const { default: express } = await import('express');
const { mountHostingChogs, hubChog } = await import('../src/routes/hostingChogs.ts');
const { HUB_LINK_MAX_SKEW_MS, signHubLink, verifyHubLink } = await import('../src/hubLink.ts');
const store = await import('../src/wallet/store.ts');
const holders = await import('../src/wallet/holders.ts');

const WALLET = '0x00000000000000000000000000000000000000a1';
const PLAYER = 'dc_1234567890';
let server: Server;
let base = '';

before(async () => {
  store.resetWalletsForTest();
  // No chain in this test: a cached reading taken just now is what the endpoint serves.
  holders.configureHolders({ rpc: async () => { throw new Error('no chain in this test'); } });
  store.linkWallet(WALLET, PLAYER);
  // 7 has no aura; 2 has Aqua Aura; a Legendary is looked up below.
  store.setHoldings(WALLET, { balance: 2, tokenIds: [2, 7], checkedAt: Date.now(), method: 'enumerable', partial: false });
  const app = express();
  mountHostingChogs(app);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const url = (id: string, ts: number, sig: string) =>
  `${base}/api/hosting/chogs?id=${encodeURIComponent(id)}&ts=${ts}&sig=${sig}`;

test('a correctly signed, fresh request gets the held Chogs with aura and legendary', async () => {
  const ts = Date.now();
  const res = await fetch(url(PLAYER, ts, signHubLink(PLAYER, ts, SECRET)));
  assert.equal(res.status, 200);
  const body = await res.json() as { id: string; chogs: { chogToken: number; aura: string | null; legendary: boolean }[]; complete: boolean };
  assert.equal(body.id, PLAYER);
  assert.equal(body.complete, true);
  assert.deepEqual(body.chogs.map(c => c.chogToken), [2, 7]);
  assert.equal(body.chogs[0].aura, '#5ad8ee');
  assert.equal(body.chogs[1].aura, null);
  assert.equal(body.chogs[0].legendary, false);
});

test('a bad signature is refused', async () => {
  const ts = Date.now();
  const wrongKey = await fetch(url(PLAYER, ts, signHubLink(PLAYER, ts, 'some-other-secret')));
  assert.equal(wrongKey.status, 401);
  // A signature for someone else does not open this player's holdings.
  const otherId = await fetch(url(PLAYER, ts, signHubLink('dc_999', ts, SECRET)));
  assert.equal(otherId.status, 401);
  const junk = await fetch(url(PLAYER, ts, 'nothex'));
  assert.equal(junk.status, 400);
});

test('a stale (or far-future) timestamp is refused even with a good signature', async () => {
  const old = Date.now() - HUB_LINK_MAX_SKEW_MS - 5_000;
  const res = await fetch(url(PLAYER, old, signHubLink(PLAYER, old, SECRET)));
  assert.equal(res.status, 401);
  assert.match((await res.json() as { error: string }).error, /Stale/);
  const future = Date.now() + HUB_LINK_MAX_SKEW_MS + 5_000;
  assert.equal((await fetch(url(PLAYER, future, signHubLink(PLAYER, future, SECRET)))).status, 401);
});

test('without APP_SECRET nothing is shared, so every request is refused', () => {
  const saved = process.env.APP_SECRET;
  delete process.env.APP_SECRET;
  try {
    const ts = Date.now();
    const r = verifyHubLink({ id: PLAYER, ts: String(ts), sig: signHubLink(PLAYER, ts, SECRET) });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 503);
  } finally {
    process.env.APP_SECRET = saved;
  }
});

test('a player with no wallet holds nothing', async () => {
  const ts = Date.now();
  const res = await fetch(url('dc_nobody', ts, signHubLink('dc_nobody', ts, SECRET)));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json() as { chogs: unknown[] }).chogs, []);
});

test('the ten 1:1s are flagged legendary', () => {
  const legendary = Array.from({ length: 1969 }, (_, i) => hubChog(i + 1)).filter(c => c?.legendary);
  assert.equal(legendary.length, 10);
  assert.equal(hubChog(99999), null);
});
