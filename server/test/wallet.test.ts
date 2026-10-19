import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-wallet-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { encodeAbiParameters, getAddress, toHex } = await import('viem');
const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
const { signToken } = await import('../src/auth.ts');
const { walletRoutes } = await import('../src/routes/wallet.ts');
const nonces = await import('../src/wallet/nonce.ts');
const { CHOG_CONTRACT, RpcError, enumerateHoldings } = await import('../src/wallet/chain.ts');
const holders = await import('../src/wallet/holders.ts');
const store = await import('../src/wallet/store.ts');

// ---- a fake Monad ---------------------------------------------------------------

const SEL = { balanceOf: '70a08231', ownerOf: '6352211e', supportsInterface: '01ffc9a7', tokenOfOwnerByIndex: '2f745c59', tokensOfOwner: '8462151c' };
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicAddr = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, '0')}`;
const uint = (n: number | bigint) => encodeAbiParameters([{ type: 'uint256' }], [BigInt(n)]);

interface Transfer { block: number; from: string; to: string; id: number }
interface ChainOpts {
  /** Current owner by token id. */
  owners: Record<number, string>;
  enumerable?: boolean;
  /** ERC721A's tokensOfOwner. */
  queryable?: boolean;
  transfers?: Transfer[];
  latest?: number;
  /** Widest eth_getLogs span the RPC takes, like the public Monad RPC's 100. */
  logLimit?: number;
}

function fakeChain(o: ChainOpts) {
  const calls: { method: string; params: unknown[] }[] = [];
  const owned = (addr: string) => Object.entries(o.owners).filter(([, a]) => a.toLowerCase() === addr.toLowerCase()).map(([id]) => Number(id)).sort((a, b) => a - b);
  const revert = () => new RpcError('execution reverted', 3, '0x');
  const rpc = async (method: string, params: unknown[]) => {
    calls.push({ method, params });
    if (method === 'eth_blockNumber') return toHex(o.latest ?? 1000);
    if (method === 'eth_call') {
      const { to, data } = params[0] as { to: string; data: string };
      assert.equal(to.toLowerCase(), CHOG_CONTRACT);
      const sel = data.slice(2, 10);
      const word = (i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
      const addrArg = (i: number) => getAddress(`0x${word(i).slice(24)}`);
      switch (sel) {
        case SEL.balanceOf: return uint(owned(addrArg(0)).length);
        case SEL.ownerOf: {
          const owner = o.owners[Number(BigInt(`0x${word(0)}`))];
          if (!owner) throw revert();
          return encodeAbiParameters([{ type: 'address' }], [getAddress(owner)]);
        }
        case SEL.supportsInterface: return encodeAbiParameters([{ type: 'bool' }], [word(0).startsWith('780e9d63') ? !!o.enumerable : word(0).startsWith('80ac58cd')]);
        case SEL.tokenOfOwnerByIndex: {
          if (!o.enumerable) throw revert();
          const ids = owned(addrArg(0));
          const i = Number(BigInt(`0x${word(1)}`));
          if (i >= ids.length) throw revert();
          return uint(ids[i]);
        }
        case SEL.tokensOfOwner:
          if (!o.queryable) throw revert();
          return encodeAbiParameters([{ type: 'uint256[]' }], [owned(addrArg(0)).map(BigInt)]);
        default: throw new RpcError(`unknown selector ${sel}`);
      }
    }
    if (method === 'eth_getLogs') {
      const f = params[0] as { fromBlock: string; toBlock: string; topics: (string | null)[] };
      const from = Number(f.fromBlock), to = Number(f.toBlock);
      const limit = o.logLimit ?? 100;
      if (to - from + 1 > limit) throw new RpcError(`eth_getLogs is limited to a ${limit} range`, -32614);
      assert.equal(f.topics[0], TRANSFER);
      return (o.transfers ?? [])
        .filter(t => t.block >= from && t.block <= to && (!f.topics[2] || topicAddr(t.to) === f.topics[2]))
        .map(t => ({ blockNumber: toHex(t.block), topics: [TRANSFER, topicAddr(t.from), topicAddr(t.to), uint(t.id)] }));
    }
    throw new RpcError(`unsupported ${method}`);
  };
  return { rpc, calls, count: (m: string) => calls.filter(c => c.method === m).length };
}

const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
const other = '0x000000000000000000000000000000000000dEaD';

// ---- nonces ------------------------------------------------------------------------

test('nonce: single use, ten-minute life, bound to the account', () => {
  const t = 1_700_000_000_000;
  const c = nonces.issueNonce({ id: 'u1', name: 'Pleb' }, t);
  assert.match(c.message, /link this wallet to your account Pleb/);
  assert.match(c.message, new RegExp(`Nonce: ${c.nonce}`));
  assert.equal(c.expiresAt, t + nonces.NONCE_TTL_MS);
  assert.equal(nonces.consumeNonce('u2', c.nonce, t + 1), null, 'someone else cannot spend it');
  assert.equal(nonces.consumeNonce('u1', 'wrong', t + 1), null, 'naming another nonce spends and fails');
  assert.equal(nonces.consumeNonce('u1', c.nonce, t + 1), null, 'gone after one attempt');

  const c2 = nonces.issueNonce({ id: 'u1', name: 'Pleb' }, t);
  assert.equal(nonces.consumeNonce('u1', c2.nonce, t + nonces.NONCE_TTL_MS), null, 'expired on the dot');
  const c3 = nonces.issueNonce({ id: 'u1', name: 'Pleb' }, t);
  nonces.issueNonce({ id: 'u1', name: 'Pleb' }, t);
  assert.equal(nonces.consumeNonce('u1', c3.nonce, t + 1), null, 'a newer challenge replaces the old one');
  const c5 = nonces.issueNonce({ id: 'u1', name: 'Pleb' }, t);
  assert.equal(nonces.consumeNonce('u1', undefined, t + 1)?.nonce, c5.nonce, 'without a nonce, the pending one is used');
  assert.equal(nonces.consumeNonce('u1', undefined, t + 1), null);
});

// ---- holder enumeration against the fake chain ---------------------------------------

test('holdings: zero balance asks nothing more', async () => {
  const chain = fakeChain({ owners: { 1: other } });
  const h = await enumerateHoldings(chain.rpc, alice.address);
  assert.deepEqual(h, { balance: 0, tokenIds: [], method: 'none', partial: false });
  assert.equal(chain.count('eth_call'), 1);
});

test('holdings: ERC-721 Enumerable walks tokenOfOwnerByIndex', async () => {
  const chain = fakeChain({ owners: { 1969: alice.address, 5: alice.address, 9: alice.address, 2: other }, enumerable: true });
  const h = await enumerateHoldings(chain.rpc, alice.address);
  assert.equal(h.method, 'enumerable');
  assert.deepEqual(h.tokenIds, [5, 9, 1969]);
  assert.equal(h.partial, false);
  assert.equal(chain.count('eth_getLogs'), 0);
});

test('holdings: ERC721A tokensOfOwner when there is no Enumerable', async () => {
  const chain = fakeChain({ owners: { 7: alice.address, 3: alice.address }, queryable: true });
  const h = await enumerateHoldings(chain.rpc, alice.address);
  assert.equal(h.method, 'queryable');
  assert.deepEqual(h.tokenIds, [3, 7]);
  assert.equal(chain.count('eth_getLogs'), 0);
});

test('holdings: Transfer-log scan shrinks to the RPC range limit and confirms with ownerOf', async () => {
  const chain = fakeChain({
    owners: { 7: alice.address, 3: alice.address, 12: other },
    latest: 5_000,
    logLimit: 100,
    transfers: [
      { block: 4_990, from: other, to: alice.address, id: 7 },
      { block: 4_200, from: other, to: alice.address, id: 12 }, // later sent on: ownerOf says so
      { block: 4_150, from: alice.address, to: other, id: 12 },
      { block: 3_050, from: other, to: alice.address, id: 3 },
      { block: 2_000, from: other, to: bob.address, id: 99 }, // someone else's
    ],
  });
  const h = await enumerateHoldings(chain.rpc, alice.address, { logChunk: 2_000, maxLogBlocks: 4_000 });
  assert.equal(h.method, 'logs');
  assert.deepEqual(h.tokenIds, [3, 7]);
  assert.equal(h.partial, false);
  const spans = chain.calls.filter(c => c.method === 'eth_getLogs').map(c => {
    const f = c.params[0] as { fromBlock: string; toBlock: string };
    return Number(f.toBlock) - Number(f.fromBlock) + 1;
  });
  assert.equal(spans[0], 2_000, 'first try is the configured chunk');
  assert.ok(spans.slice(1).every(s => s <= 100), `after the error every span fits the limit: ${spans.join(',')}`);
  assert.ok(h.scannedBlocks! >= 5_000 - 3_050 + 1 && h.scannedBlocks! < 4_000, 'stopped once everything was found');
  assert.equal(chain.count('eth_call'), 3 + 3, 'balanceOf, supportsInterface, tokensOfOwner, then one ownerOf per candidate');
});

test('holdings: the log scan reports partial when the budget runs out first', async () => {
  const chain = fakeChain({
    owners: { 7: alice.address, 3: alice.address },
    latest: 5_000,
    transfers: [
      { block: 4_990, from: other, to: alice.address, id: 7 },
      { block: 100, from: other, to: alice.address, id: 3 }, // beyond the window
    ],
  });
  const h = await enumerateHoldings(chain.rpc, alice.address, { logChunk: 100, maxLogBlocks: 500 });
  assert.equal(h.method, 'logs');
  assert.deepEqual(h.tokenIds, [7]);
  assert.equal(h.partial, true);
  assert.equal(h.scannedBlocks, 500);
});

// ---- the routes ----------------------------------------------------------------------

let server: Server;
let base = '';
const tokenA = signToken({ id: 'demo_a', name: 'Alice', avatar: '🎩', provider: 'demo' });
const tokenB = signToken({ id: 'demo_b', name: 'Bob', avatar: '🎩', provider: 'demo' });
let now = 1_700_000_000_000;
const chain = fakeChain({ owners: { 42: alice.address, 1: alice.address }, queryable: true });

before(async () => {
  holders.configureHolders({ rpc: chain.rpc, now: () => now });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/wallet', walletRoutes());
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function req(method: string, path: string, token: string | null, body?: unknown) {
  const res = await fetch(`${base}/api/wallet${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json() as any };
}

async function challenge(token: string) {
  const r = await req('GET', '/nonce', token);
  assert.equal(r.status, 200);
  return r.body as { nonce: string; message: string };
}

test('routes: everything needs a signed-in player', async () => {
  assert.equal((await req('GET', '/nonce', null)).status, 401);
  assert.equal((await req('GET', '/me', null)).status, 401);
  assert.equal((await req('POST', '/link', null, {})).status, 401);
  assert.equal((await req('POST', '/unlink', null, {})).status, 401);
});

test('routes: a valid signature links the wallet and reads its Chogs', async () => {
  const c = await challenge(tokenA);
  assert.match(c.message, /account Alice/);
  const signature = await alice.signMessage({ message: c.message });
  const r = await req('POST', '/link', tokenA, { address: alice.address, signature, nonce: c.nonce });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.wallet.address, alice.address);
  assert.deepEqual(r.body.wallet.tokenIds, [1, 42]);
  assert.equal(r.body.holder, true);
  assert.deepEqual(r.body.chogs, [1, 42]);

  const me = await req('GET', '/me', tokenA);
  assert.equal(me.body.wallets.length, 1);
  assert.equal(me.body.wallets[0].method, 'queryable');
  assert.equal(me.body.contract, CHOG_CONTRACT);
  assert.equal(me.body.chainId, 143);
  assert.ok(holders.isChogHolder('demo_a'));
  assert.ok(!holders.isChogHolder('demo_b'));
});

test('routes: the nonce is spent by the first attempt', async () => {
  const c = await challenge(tokenA);
  const signature = await alice.signMessage({ message: c.message });
  assert.equal((await req('POST', '/link', tokenA, { address: alice.address, signature })).status, 200);
  const again = await req('POST', '/link', tokenA, { address: alice.address, signature });
  assert.equal(again.status, 400);
  assert.match(again.body.error, /expired/);
});

test('routes: a signature over another message, or by another key, is refused', async () => {
  const c = await challenge(tokenB);
  const wrongMessage = await bob.signMessage({ message: `${c.message} ` });
  let r = await req('POST', '/link', tokenB, { address: bob.address, signature: wrongMessage });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /does not match/);

  const c2 = await challenge(tokenB);
  const byAlice = await alice.signMessage({ message: c2.message });
  r = await req('POST', '/link', tokenB, { address: bob.address, signature: byAlice });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /does not match/);

  assert.equal((await req('POST', '/link', tokenB, { address: 'nope', signature: byAlice })).status, 400);
  assert.equal((await req('POST', '/link', tokenB, { address: bob.address, signature: '0x12' })).status, 400);
  assert.equal((await req('GET', '/me', tokenB)).body.wallets.length, 0);
});

test('routes: a wallet linked to another account is refused with a clear message', async () => {
  const c = await challenge(tokenB);
  const signature = await alice.signMessage({ message: c.message });
  const r = await req('POST', '/link', tokenB, { address: alice.address, signature });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already linked to another account/);
});

test('routes: holdings are cached ten minutes, a forced re-check once per half minute', async () => {
  const before = chain.count('eth_call');
  await req('GET', '/me', tokenA);
  await req('GET', '/me', tokenA);
  assert.equal(chain.count('eth_call'), before, 'served from the cache');

  let r = await req('GET', '/me?refresh=1', tokenA);
  assert.equal(r.body.refreshed, false, 'the link itself was a forced read moments ago');
  assert.equal(chain.count('eth_call'), before);

  now += holders.REFRESH_COOLDOWN_MS;
  r = await req('GET', '/me?refresh=1', tokenA);
  assert.equal(r.body.refreshed, true);
  assert.ok(chain.count('eth_call') > before, 'read the chain again');

  const mid = chain.count('eth_call');
  now += holders.HOLDINGS_TTL_MS;
  await req('GET', '/me', tokenA);
  assert.ok(chain.count('eth_call') > mid, 'stale cache is re-read without asking');
});

test('routes: an RPC outage keeps the last reading and says so', async () => {
  holders.configureHolders({ rpc: async () => { throw new RpcError('boom'); } });
  now += holders.HOLDINGS_TTL_MS;
  const r = await req('GET', '/me', tokenA);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.wallets[0].tokenIds, [1, 42]);
  assert.match(r.body.wallets[0].error, /Monad RPC/);
  holders.configureHolders({ rpc: chain.rpc });
});

test('routes: unlink, and the wallet is free for another account', async () => {
  let r = await req('POST', '/unlink', tokenB, { address: alice.address });
  assert.equal(r.status, 404, 'not Bob\'s to unlink');
  r = await req('POST', '/unlink', tokenA, { address: alice.address.toLowerCase() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.wallets, []);
  assert.equal((await req('GET', '/me', tokenA)).body.holder, false);
  assert.equal(store.walletOwner(alice.address), null);

  const c = await challenge(tokenB);
  const signature = await alice.signMessage({ message: c.message });
  r = await req('POST', '/link', tokenB, { address: alice.address, signature });
  assert.equal(r.status, 200);
  assert.equal(store.walletOwner(alice.address), 'demo_b');
});

test('store: links survive a reload from disk', () => {
  store.resetWalletsForTest();
  assert.equal(store.walletOwner(alice.address), null);
  store.loadWallets();
  assert.equal(store.walletOwner(alice.address), 'demo_b');
  assert.deepEqual(store.getHoldings(alice.address)?.tokenIds, [1, 42]);
});

test('holders: seat gating asks the cache for the very token, never the client', () => {
  // Bob's wallet (alice's key, relinked above) was last seen with #1 and #42.
  assert.equal(holders.isChogHolder('demo_b'), true);
  assert.equal(holders.holdsChog('demo_b', 1), true);
  assert.equal(holders.holdsChog('demo_b', 42), true);
  assert.equal(holders.holdsChog('demo_b', 2), false, 'a token the wallet does not hold');
  assert.equal(holders.holdsChog('demo_a', 1), false, 'an account with no linked wallet');
  assert.equal(holders.isChogHolder('demo_a'), false);
});

test('routes: sign-in only ever returns to a path on this site', async () => {
  const { localPath } = await import('../src/routes/auth.ts');
  assert.equal(localPath('/r/ABCDE?x=1'), '/r/ABCDE?x=1');
  assert.equal(localPath('/'), '/');
  for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', '/%5Cevil.com'.replace('%5C', '\\'), 'https://evil.com', 'evil.com', '/\tevil', '', undefined, 42]) {
    assert.equal(localPath(bad), '/', `refused: ${JSON.stringify(bad)}`);
  }
});

test('holders: a reading older than ten minutes is no proof (the Chog may have been sold)', async () => {
  assert.equal(holders.holdsChog('demo_b', 1), true, 'fresh reading');
  const was = now;
  now += holders.HOLDINGS_TTL_MS + 1;
  try {
    assert.equal(holders.holdsChog('demo_b', 1), false, 'stale reading refused, and a fresh read started');
    await new Promise(r => setTimeout(r, 50));
    assert.equal(holders.holdsChog('demo_b', 1), true, 'the background read brought it back');
  } finally {
    now = was;
  }
});
