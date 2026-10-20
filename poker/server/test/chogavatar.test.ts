// "Your Chog": a holder's NFT as their seat avatar.
//
// The pick is ours, the holding is the hub's to confirm. These tests stand in
// for the hub (a fake fetcher, and once a real signed HTTP round trip) and
// check the four promises: a Chog is shown only once the hub has confirmed it,
// the answer is cached and re-asked when it expires, a Chog that has left the
// wallet is dropped, and a hub that does not answer costs the avatar, never
// the game.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ChogBadge } from '../../shared/types.ts';

const SECRET = 'shared-hub-poker-secret';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-avatar-'));
process.env.CHOG_SECRET = SECRET;
process.env.DEMO_MODE = '1';

const chogs = await import('../src/chogs.ts');
const { signHubLink } = await import('../src/hubLink.ts');
const { Table } = await import('../src/engine/table.ts');
const { signToken } = await import('../src/auth.ts');
const { mountChogs } = await import('../src/chogroutes.ts');
const { default: express } = await import('express');

const AQUA: ChogBadge = { chogToken: 2, aura: '#5ad8ee', legendary: false };
const ONE_OF_ONE: ChogBadge = { chogToken: 77, aura: null, legendary: true };

// ---- a fake hub and a fake clock ---------------------------------------------
let now = 1_000_000;
let wallet: Record<string, ChogBadge[]> = {};
let hubDown = false;
let complete = true;
let calls = 0;
const flush = () => new Promise(r => setImmediate(r));

beforeEach(() => {
  now = 1_000_000;
  wallet = {};
  hubDown = false;
  complete = true;
  calls = 0;
  chogs.configureChogs({
    reset: true,
    now: () => now,
    enabled: () => true,
    fetch: async id => {
      calls += 1;
      if (hubDown) return null;
      return { chogs: wallet[id] ?? [], complete };
    },
  });
});

/** Pick a Chog the way the picker does: through the hub, then stored. */
async function pick(id: string, token: number) {
  const h = await chogs.heldChogs(id);
  assert.ok(h.chogs.some(c => c.chogToken === token), 'the hub confirms it first');
  chogs.choosePick(id, token);
}

test('no pick, no Chog — and nobody asks the hub on their behalf', () => {
  assert.equal(chogs.chogBadge('dc_plain'), null);
  assert.deepEqual(chogs.chogField('dc_plain'), {});
  const row = chogs.withChog({ id: 'dc_plain', name: 'Plain', avatar: '🙂' });
  assert.equal('chog' in row, false, 'the view row carries no chog key at all');
  assert.equal(calls, 0);
});

test('the view carries chogToken only once the hub has confirmed it', async () => {
  wallet.dc_a = [AQUA];
  await pick('dc_a', 2);
  assert.deepEqual(chogs.chogBadge('dc_a'), AQUA);

  // Somebody else's pick that the hub never confirmed shows nothing.
  chogs.choosePick('dc_b', 5);
  assert.equal(chogs.chogBadge('dc_b'), null, 'unconfirmed: nothing yet');
  await flush();
  assert.equal(chogs.chogBadge('dc_b'), null, 'the hub says they do not hold it');
  assert.equal(chogs.pickOf('dc_b'), null, 'and the pick is dropped');
});

test('the answer is cached for ten minutes, then re-asked', async () => {
  wallet.dc_a = [AQUA, ONE_OF_ONE];
  await pick('dc_a', 77);
  const after1 = calls;
  for (let i = 0; i < 50; i++) assert.equal(chogs.chogBadge('dc_a')?.chogToken, 77);
  assert.equal(calls, after1, 'fifty views, no extra hub calls');

  now += chogs.CHOG_TTL_MS - 1;
  chogs.chogBadge('dc_a');
  assert.equal(calls, after1, 'still fresh');

  now += 2;
  const shown = chogs.chogBadge('dc_a');
  assert.equal(shown?.legendary, true, 'the last answer stands while the re-check runs');
  await flush();
  assert.equal(calls, after1 + 1, 'exactly one re-check');
});

test('sold: the next check drops the pick and tells the tables', async () => {
  wallet.dc_a = [AQUA];
  await pick('dc_a', 2);
  const changed: string[] = [];
  const off = chogs.onChogChange(id => changed.push(id));
  try {
    wallet.dc_a = [];
    now += chogs.CHOG_TTL_MS + 1;
    chogs.chogBadge('dc_a');
    await flush();
    assert.equal(chogs.chogBadge('dc_a'), null);
    assert.equal(chogs.pickOf('dc_a'), null, 'dropped, not just hidden');
    assert.deepEqual(changed, ['dc_a'], 'listeners re-push the views');
  } finally {
    off();
  }
});

test('an incomplete answer (a wallet the chain did not answer for) hides but keeps the pick', async () => {
  wallet.dc_a = [AQUA];
  await pick('dc_a', 2);
  wallet.dc_a = [];
  complete = false;
  now += chogs.CHOG_TTL_MS + 1;
  await chogs.refreshHeld('dc_a');
  assert.equal(chogs.chogBadge('dc_a'), null);
  assert.equal(chogs.pickOf('dc_a'), 2, 'kept: not knowing is not the same as sold');
});

test('hub down: no avatar, the pick waits, and it comes back with the hub', async () => {
  wallet.dc_a = [AQUA];
  await pick('dc_a', 2);
  hubDown = true;
  now += chogs.CHOG_TTL_MS + 1;
  await chogs.refreshHeld('dc_a');
  assert.equal(chogs.chogBadge('dc_a'), null, 'unknown shows nothing');
  assert.equal(chogs.pickOf('dc_a'), 2);
  const during = calls;
  chogs.chogBadge('dc_a');
  assert.equal(calls, during, 'a down hub is not hammered');

  hubDown = false;
  now += chogs.CHOG_RETRY_MS + 1;
  chogs.chogBadge('dc_a');
  await flush();
  assert.deepEqual(chogs.chogBadge('dc_a'), AQUA, 'back with the hub');
});

test('hub down mid-game: the table plays on and the seat simply shows no Chog', async () => {
  wallet.dc_a = [AQUA];
  await pick('dc_a', 2);
  const t = new Table({
    name: 'Chogs', mode: 'cash', sb: 5, bb: 10, maxSeats: 6, cash: { minBuy: 200, maxBuy: 2000 },
  }, { broadcast: () => {}, chat: () => {}, event: () => {} } as never);
  try {
    t.sit(0, { id: 'dc_a', name: 'Ana', avatar: '🙂' }, 1000);
    t.sit(1, { id: 'dc_b', name: 'Bo', avatar: '🙂' }, 1000);
    let seat = t.view(null).seats.find(s => s.player?.id === 'dc_a')!;
    assert.equal(seat.player?.chog?.chogToken, 2, 'shown while confirmed');
    assert.equal(t.view(null).seats.find(s => s.player?.id === 'dc_b')!.player!.chog, undefined);

    // The hub goes away — and even throws.
    chogs.configureChogs({ fetch: async () => { calls += 1; throw new Error('ECONNREFUSED'); } });
    now += chogs.CHOG_TTL_MS + 1;
    t.view(null);
    await flush();
    seat = t.view(null).seats.find(s => s.player?.id === 'dc_a')!;
    assert.equal(seat.player?.chog, undefined, 'no Chog while the hub is unreachable');

    if (!t.hand) t.startHand();
    assert.ok(t.hand, 'a hand is dealt');
    const before = t.hand!.actionSeat();
    const actor = t.seats[before!]!.player.id;
    t.applyAction(actor, 'fold');
    assert.notEqual(t.hand?.actionSeat() ?? null, before, 'and the action moves on');
  } finally {
    t.close();
  }
});

test('chat lines and standings carry the confirmed Chog', async () => {
  wallet.dc_a = [ONE_OF_ONE];
  await pick('dc_a', 77);
  const row = chogs.withChog({ id: 'dc_a', name: 'Ana', avatar: '🙂' });
  assert.deepEqual(row.chog, ONE_OF_ONE);
  assert.deepEqual(chogs.chogField('dc_a'), { chog: ONE_OF_ONE });
});

test('what the hub sends is checked before it reaches a page', () => {
  const clean = chogs.cleanHubChogs({
    chogs: [
      { chogToken: 2, aura: '#5AD8EE', legendary: false },
      { chogToken: 2, aura: '#000000', legendary: false }, // duplicate
      { chogToken: 0, aura: null, legendary: false }, // not a token
      { chogToken: 3, aura: 'red;background:url(x)', legendary: 'yes' },
      'junk',
    ],
  });
  assert.deepEqual(clean, {
    complete: true,
    chogs: [{ chogToken: 2, aura: '#5ad8ee', legendary: false }, { chogToken: 3, aura: null, legendary: false }],
  });
  assert.equal(chogs.cleanHubChogs({ error: 'Bad signature' }), null);
  assert.equal(chogs.cleanHubChogs(null), null);
});

// ---- the real thing: signed HTTP to a hub that checks the signature ---------
// The hub's verifier, as server/src/hubLink.ts at the repo root has it.
function hubVerifies(id: string, ts: number, sig: string): boolean {
  if (Math.abs(Date.now() - ts) > 60_000) return false;
  const expect = createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(`hub-link:${id}:${ts}`).digest();
  const got = Buffer.from(sig, 'hex');
  return got.length === expect.length && timingSafeEqual(got, expect);
}

let hub: Server;
let poker: Server;
let pokerBase = '';
let hubHits = 0;
before(async () => {
  hub = createServer((req, res) => {
    hubHits += 1;
    const u = new URL(req.url ?? '/', 'http://hub');
    const id = u.searchParams.get('id') ?? '';
    if (u.pathname !== '/api/hosting/chogs' || !hubVerifies(id, Number(u.searchParams.get('ts')), u.searchParams.get('sig') ?? '')) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"Bad signature"}');
      return;
    }
    const body = id === 'dc_http' ? [AQUA, ONE_OF_ONE] : [];
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, chogs: body, complete: true }));
  }).listen(0);
  await new Promise(r => hub.once('listening', r));
  process.env.HUB_URL = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;
  const app = express();
  app.use(express.json());
  mountChogs(app);
  poker = app.listen(0);
  await new Promise(r => poker.once('listening', r));
  pokerBase = `http://127.0.0.1:${(poker.address() as AddressInfo).port}`;
});
after(() => { hub?.close(); poker?.close(); });

function realHub() {
  chogs.configureChogs({
    reset: true,
    now: () => Date.now(),
    enabled: () => true,
    // The production fetcher: signed GET to HUB_URL.
    fetch: async id => chogs.cleanHubChogs(await (await import('../src/hubLink.ts')).hubGet('/api/hosting/chogs', id)),
  });
}

const auth = (id: string) => ({
  authorization: `Bearer ${signToken({ id, name: 'Http', avatar: '🙂', provider: 'demo' })}`,
  'content-type': 'application/json',
});

test('the picker lists held Chogs, takes one the hub confirms, refuses one it does not', async () => {
  realHub();
  const list = await fetch(`${pokerBase}/api/chogs`, { headers: auth('dc_http') });
  assert.equal(list.status, 200);
  const body = await list.json() as { enabled: boolean; artBase: string; pick: number | null; chogs: ChogBadge[]; reachable: boolean };
  assert.equal(body.enabled, true);
  assert.equal(body.reachable, true);
  assert.equal(body.artBase, process.env.HUB_URL);
  assert.deepEqual(body.chogs.map(c => c.chogToken), [2, 77]);

  const ok = await fetch(`${pokerBase}/api/chogs/pick`, { method: 'POST', headers: auth('dc_http'), body: JSON.stringify({ chogToken: 77 }) });
  assert.equal(ok.status, 200);
  assert.equal(chogs.chogBadge('dc_http')?.legendary, true);

  const not = await fetch(`${pokerBase}/api/chogs/pick`, { method: 'POST', headers: auth('dc_http'), body: JSON.stringify({ chogToken: 5 }) });
  assert.equal(not.status, 403);
  assert.equal(chogs.pickOf('dc_http'), 77, 'a refused pick changes nothing');

  const none = await fetch(`${pokerBase}/api/chogs/pick`, { method: 'POST', headers: auth('dc_http'), body: JSON.stringify({ chogToken: null }) });
  assert.equal(none.status, 200);
  assert.equal(chogs.chogBadge('dc_http'), null, '"None" clears it');

  assert.equal((await fetch(`${pokerBase}/api/chogs`)).status, 401, 'signed in only');
});

test('a hub that refuses our signature, or is not there, reads as unreachable', async () => {
  realHub();
  process.env.CHOG_SECRET = 'not-the-hub-secret';
  try {
    const h = await chogs.heldChogs('dc_http', true);
    assert.equal(h.ok, false);
    const r = await fetch(`${pokerBase}/api/chogs/pick`, { method: 'POST', headers: auth('dc_http'), body: JSON.stringify({ chogToken: 2 }) });
    // The token above was signed with the old secret, which this process still holds.
    assert.equal(r.status, 503);
  } finally {
    process.env.CHOG_SECRET = SECRET;
  }
  const savedHub = process.env.HUB_URL;
  process.env.HUB_URL = 'http://127.0.0.1:1';
  try {
    const h = await chogs.heldChogs('dc_http', true);
    assert.equal(h.ok, false, 'connection refused is "unknown", not "holds nothing"');
  } finally {
    process.env.HUB_URL = savedHub;
  }
  assert.ok(hubHits > 0);
  // The signer here and the hub's agree on the format.
  const ts = Date.now();
  assert.ok(hubVerifies('dc_x', ts, signHubLink('dc_x', ts, SECRET)));
});
