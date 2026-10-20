// Linking a wallet by a self-transfer of an exact amount, against a fake Monad.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-selftx-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { encodeAbiParameters, getAddress, keccak256, toHex } = await import('viem');
const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
const { signToken } = await import('../src/auth.ts');
const { walletRoutes } = await import('../src/routes/wallet.ts');
const { RpcError } = await import('../src/wallet/chain.ts');
const holders = await import('../src/wallet/holders.ts');
const store = await import('../src/wallet/store.ts');
const selftx = await import('../src/wallet/selftx.ts');

// ---- a fake Monad: blocks of plain transactions, plus the Chog contract's two reads ----

interface Tx {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  input?: string;
  chainId?: number | null;
  block: number;
  nonce: number;
  status?: 0 | 1;
}

const SEL = { balanceOf: '70a08231', tokensOfOwner: '8462151c' };

function fakeMonad() {
  const s = {
    head: 1_000,
    txs: [] as Tx[],
    /** Nonce each address had before block 0. */
    base: {} as Record<string, number>,
    code: {} as Record<string, string>,
    chogs: {} as Record<string, number[]>,
    down: false,
    calls: [] as string[],
  };
  const k = (a: string) => a.toLowerCase();
  const count = (addr: string, b: number) => (s.base[k(addr)] ?? 0) + s.txs.filter(t => k(t.from) === k(addr) && t.block <= b).length;
  const rpcTx = (t: Tx) => ({
    hash: t.hash, from: k(t.from), to: t.to && k(t.to), value: toHex(t.value), input: t.input ?? '0x',
    nonce: toHex(t.nonce), blockNumber: toHex(t.block), type: '0x2',
    ...(t.chainId === null ? {} : { chainId: toHex(t.chainId ?? 143) }),
  });
  const rpc = async (method: string, params: unknown[]) => {
    s.calls.push(method);
    if (s.down) throw new RpcError('fetch failed');
    const blockArg = (v: unknown) => (v === 'latest' ? s.head : Number(v));
    switch (method) {
      case 'eth_blockNumber': return toHex(s.head);
      case 'eth_getCode': return s.code[k(params[0] as string)] ?? '0x';
      case 'eth_getTransactionCount': return toHex(count(params[0] as string, blockArg(params[1])));
      case 'eth_getTransactionByHash': {
        const t = s.txs.find(x => x.hash === k(params[0] as string));
        return t ? rpcTx(t) : null;
      }
      case 'eth_getTransactionReceipt': {
        const t = s.txs.find(x => x.hash === k(params[0] as string));
        return t ? { status: t.status === 0 ? '0x0' : '0x1', from: k(t.from), to: t.to && k(t.to), blockNumber: toHex(t.block), contractAddress: null } : null;
      }
      case 'eth_getBlockByNumber': {
        const b = Number(params[0]);
        return { number: toHex(b), transactions: s.txs.filter(t => t.block === b).map(rpcTx) };
      }
      case 'eth_call': {
        const { data } = params[0] as { data: string };
        const owner = getAddress(`0x${data.slice(10 + 24, 10 + 64)}`);
        const ids = s.chogs[k(owner)] ?? [];
        if (data.slice(2, 10) === SEL.balanceOf) return encodeAbiParameters([{ type: 'uint256' }], [BigInt(ids.length)]);
        if (data.slice(2, 10) === SEL.tokensOfOwner) return encodeAbiParameters([{ type: 'uint256[]' }], [ids.map(BigInt)]);
        throw new RpcError('execution reverted', 3, '0x');
      }
    }
    throw new RpcError(`unsupported ${method}`);
  };
  let seq = 0;
  /** Mines a transaction in a new block past the head (or in `block`) and returns its hash. */
  const send = (t: Omit<Tx, 'hash' | 'block' | 'nonce'> & { block?: number }) => {
    const block = t.block ?? ++s.head;
    if (block > s.head) s.head = block;
    const nonce = count(t.from, Number.MAX_SAFE_INTEGER);
    const hash = keccak256(toHex(`tx${++seq}`));
    s.txs.push({ ...t, block, nonce, hash });
    return hash;
  };
  return { s, rpc, send };
}

const monad = fakeMonad();
const alice = privateKeyToAccount(generatePrivateKey()).address;
const bob = privateKeyToAccount(generatePrivateKey()).address;
const carol = privateKeyToAccount(generatePrivateKey()).address;
const safe = privateKeyToAccount(generatePrivateKey()).address;
monad.s.chogs[alice.toLowerCase()] = [7, 1969];
monad.s.base[alice.toLowerCase()] = 41;
monad.s.code[safe.toLowerCase()] = '0x6080604052';

let server: Server;
let base = '';
let now = 1_800_000_000_000;
const token = (id: string) => signToken({ id, name: id, avatar: '🎩', provider: 'demo' });

before(async () => {
  holders.configureHolders({ rpc: monad.rpc, now: () => now });
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/wallet', walletRoutes());
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function req(method: string, path: string, tok: string | null, body?: unknown) {
  const res = await fetch(`${base}/api/wallet${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json() as any };
}

async function challenge(tok: string, address: string) {
  const r = await req('POST', '/selftx/challenge', tok, { address });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.challenge as { address: string; amountWei: string; amountMon: string; floorBlock: number; expiresAt: number; chainId: number; paymentUri: string };
}

const verify = (tok: string, txHash: string) => req('POST', '/selftx/verify', tok, { txHash });

// ---- challenges ----------------------------------------------------------------------

test('selftx: every route needs a signed-in player', async () => {
  assert.equal((await req('GET', '/selftx', null)).status, 401);
  assert.equal((await req('POST', '/selftx/challenge', null, { address: alice })).status, 401);
  assert.equal((await req('POST', '/selftx/verify', null, { txHash: '0x' })).status, 401);
  assert.equal((await req('POST', '/selftx/auto', null)).status, 401);
});

test('selftx: a challenge is an odd exact amount, half an hour, floored at the head', async () => {
  const tok = token('u_shape');
  assert.equal((await req('POST', '/selftx/challenge', tok, { address: 'nope' })).status, 400);
  const c = await challenge(tok, alice.toLowerCase());
  assert.equal(c.address, alice, 'checksummed');
  const wei = BigInt(c.amountWei);
  assert.ok(wei > selftx.BASE_WEI && wei < selftx.BASE_WEI + 1_000_000n * selftx.DUST_UNIT_WEI);
  assert.equal((wei - selftx.BASE_WEI) % selftx.DUST_UNIT_WEI, 0n);
  assert.match(c.amountMon, /^0\.0001\d{8}$/, c.amountMon);
  assert.equal(c.expiresAt, now + selftx.SELFTX_TTL_MS);
  assert.equal(c.floorBlock, monad.s.head);
  assert.equal(c.chainId, 143);
  assert.equal(c.paymentUri, `ethereum:${alice}@143?value=${c.amountWei}`);

  const again = await challenge(tok, alice);
  assert.equal(again.amountWei, c.amountWei, 'asking again for the same wallet hands back the pending one');
  assert.equal((await req('GET', '/selftx', tok)).body.challenge.amountWei, c.amountWei);

  const other = await challenge(token('u_shape2'), alice);
  assert.notEqual(other.amountWei, c.amountWei, 'every pending amount differs');

  await req('POST', '/selftx/cancel', tok);
  assert.equal((await req('GET', '/selftx', tok)).body.challenge, null);
  await req('POST', '/selftx/cancel', token('u_shape2'));
});

test('selftx: a smart-contract wallet is turned away up front', async () => {
  const r = await req('POST', '/selftx/challenge', token('u_safe'), { address: safe });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /smart-contract wallet/);
});

test('selftx: new challenges are rate-limited per account', async () => {
  const tok = token('u_rate');
  const addrs = Array.from({ length: selftx.MAX_CHALLENGES + 1 }, () => privateKeyToAccount(generatePrivateKey()).address);
  for (const a of addrs.slice(0, selftx.MAX_CHALLENGES)) await challenge(tok, a);
  const r = await req('POST', '/selftx/challenge', tok, { address: addrs[selftx.MAX_CHALLENGES] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Too many new challenges/);
  assert.equal((await challenge(tok, addrs[selftx.MAX_CHALLENGES - 1])).address, addrs[selftx.MAX_CHALLENGES - 1], 'the pending one is still handed back');
  now += selftx.CHALLENGE_WINDOW_MS;
  await challenge(tok, addrs[selftx.MAX_CHALLENGES]);
  await req('POST', '/selftx/cancel', tok);
});

// ---- verifying a pasted hash ---------------------------------------------------------------

test('selftx: wrong amount, wrong from/to, failed, wrong chain, calldata, too old: all refused', async () => {
  const tok = token('u_bad');
  const old = monad.send({ from: carol, to: carol, value: 0n }); // mined before the challenge
  const c = await challenge(tok, carol);
  const amount = BigInt(c.amountWei);
  // The very amount, but sent before the challenge (a tx of the right value mined below the floor).
  const tooOld = monad.send({ from: carol, to: carol, value: amount, block: c.floorBlock - 1 });
  const cases: [string, string, RegExp][] = [
    ['wrong amount', monad.send({ from: carol, to: carol, value: amount + 1n }), /not exactly 0\.0001/],
    ['round amount', monad.send({ from: carol, to: carol, value: selftx.BASE_WEI }), /not exactly/],
    ['to someone else', monad.send({ from: carol, to: bob, value: amount }), /same address/],
    ['from someone else', monad.send({ from: bob, to: carol, value: amount }), /not sent from/],
    ['failed receipt', monad.send({ from: carol, to: carol, value: amount, status: 0 }), /failed/],
    ['other chain', monad.send({ from: carol, to: carol, value: amount, chainId: 1 }), /not on Monad/],
    ['no chain id', monad.send({ from: carol, to: carol, value: amount, chainId: null }), /not on Monad/],
    ['contract call', monad.send({ from: carol, to: carol, value: amount, input: '0xdeadbeef' }), /calls a contract/],
    ['contract creation', monad.send({ from: carol, to: null, value: amount }), /same address/],
    ['too old', tooOld, /older than this challenge/],
    ['before the challenge', old, /not exactly|older/],
  ];
  for (const [what, hash, why] of cases) {
    const r = await verify(tok, hash);
    assert.equal(r.status, 400, what);
    assert.match(r.body.error, why, `${what}: ${r.body.error}`);
  }
  let r = await verify(tok, '0x1234');
  assert.match(r.body.error, /not a transaction hash/);
  r = await verify(tok, keccak256('0x99'));
  assert.match(r.body.error, /does not know that transaction/);
  assert.equal(store.walletOwner(carol), null, 'nothing was linked');
  assert.ok((await req('GET', '/selftx', tok)).body.challenge, 'a wrong paste does not spend the challenge');
});

test('selftx: too many wrong pastes end the challenge', async () => {
  const tok = token('u_bad');
  await req('POST', '/selftx/cancel', tok);
  const c = await challenge(tok, carol);
  const wrong = monad.send({ from: carol, to: carol, value: BigInt(c.amountWei) + 2n });
  for (let i = 0; i < selftx.MAX_ATTEMPTS; i++) assert.match((await verify(tok, wrong)).body.error, /not exactly/);
  assert.match((await verify(tok, wrong)).body.error, /Too many tries/);
  assert.equal((await req('GET', '/selftx', tok)).body.challenge, null);
});

test('selftx: a valid self-transfer links the wallet exactly like signing does', async () => {
  const tok = token('u_alice');
  const c = await challenge(tok, alice);
  const hash = monad.send({ from: alice, to: alice, value: BigInt(c.amountWei) });
  const r = await verify(tok, hash.toUpperCase().replace('0X', '0x'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.wallet.address, alice);
  assert.deepEqual(r.body.wallet.tokenIds, [7, 1969]);
  assert.equal(r.body.holder, true);
  assert.deepEqual(r.body.chogs, [7, 1969]);
  assert.equal(store.walletOwner(alice), 'u_alice');
  assert.ok(holders.isChogHolder('u_alice'));
  assert.ok(holders.holdsChog('u_alice', 1969));
  assert.equal((await req('GET', '/selftx', tok)).body.challenge, null, 'the challenge is spent');

  // Replays: the same hash never counts again, for anyone.
  let again = await verify(tok, hash);
  assert.equal(again.status, 400);
  assert.match(again.body.error, /No self-transfer check is pending/);
  await req('POST', '/unlink', tok, { address: alice });
  await challenge(tok, alice);
  again = await verify(tok, hash);
  assert.match(again.body.error, /already used/);
  await req('POST', '/selftx/cancel', tok);
  await challenge(token('u_mallory'), alice);
  again = await verify(token('u_mallory'), hash);
  assert.match(again.body.error, /already used/);
  // Relink to u_alice for the next test.
  await req('POST', '/selftx/cancel', token('u_mallory'));
  const c3 = await challenge(tok, alice);
  assert.equal((await verify(tok, monad.send({ from: alice, to: alice, value: BigInt(c3.amountWei) }))).status, 200);
});

test('selftx: one wallet, one account', async () => {
  // Already linked elsewhere: refused before anyone sends anything.
  let r = await req('POST', '/selftx/challenge', token('u_bob'), { address: alice });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already linked to another account/);
  r = await req('POST', '/selftx/challenge', token('u_alice'), { address: alice });
  assert.match(r.body.error, /already linked to your account/);

  // Linked elsewhere while a challenge was pending: the transfer still cannot take it.
  const c = await challenge(token('u_bob'), bob);
  store.linkWallet(bob, 'u_someone_else');
  const hash = monad.send({ from: bob, to: bob, value: BigInt(c.amountWei) });
  r = await verify(token('u_bob'), hash);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /already linked to another account/);
  assert.equal(store.walletOwner(bob), 'u_someone_else');
  store.unlinkWallet(bob, 'u_someone_else');
  r = await verify(token('u_bob'), hash);
  assert.equal(r.status, 200, 'freed again, the same transfer may finish the link');
  assert.equal(store.walletOwner(bob), 'u_bob');
});

test('selftx: an expired challenge is refused', async () => {
  const tok = token('u_late');
  const late = privateKeyToAccount(generatePrivateKey()).address;
  const c = await challenge(tok, late);
  const hash = monad.send({ from: late, to: late, value: BigInt(c.amountWei) });
  now += selftx.SELFTX_TTL_MS;
  const r = await verify(tok, hash);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /expired/);
  assert.equal(store.walletOwner(late), null);
});

test('selftx: an RPC outage is a clear 503, and the challenge survives it', async () => {
  const tok = token('u_down');
  const who = privateKeyToAccount(generatePrivateKey()).address;
  const c = await challenge(tok, who);
  const hash = monad.send({ from: who, to: who, value: BigInt(c.amountWei) });
  monad.s.down = true;
  try {
    let r = await verify(tok, hash);
    assert.equal(r.status, 503);
    assert.match(r.body.error, /Could not reach the Monad RPC/);
    r = await req('POST', '/selftx/challenge', tok, { address: privateKeyToAccount(generatePrivateKey()).address });
    assert.equal(r.status, 503);
  } finally {
    monad.s.down = false;
  }
  assert.equal((await verify(tok, hash)).status, 200);
});

// ---- "Check automatically" -----------------------------------------------------------------

test('selftx auto: finds the transfer from the nonce, cheaply and throttled', async () => {
  const tok = token('u_auto');
  const who = privateKeyToAccount(generatePrivateKey()).address;
  monad.s.base[who.toLowerCase()] = 3;
  monad.send({ from: who, to: bob, value: 5n }); // history before the challenge
  monad.s.head += 50;
  const c = await challenge(tok, who);

  let r = await req('POST', '/selftx/auto', tok);
  assert.equal(r.status, 200);
  assert.equal(r.body.found, false);
  r = await req('POST', '/selftx/auto', tok);
  assert.ok(r.body.retryAt > now, 'asked again too soon');

  // Some unrelated sends, a wrong-amount self-transfer, then the real one, spread over thousands of blocks.
  monad.s.head += 1_500;
  monad.send({ from: who, to: carol, value: 1n });
  monad.s.head += 2_000;
  monad.send({ from: who, to: who, value: BigInt(c.amountWei) - 1n });
  now += selftx.AUTO_COOLDOWN_MS;
  monad.s.calls.length = 0;
  r = await req('POST', '/selftx/auto', tok);
  assert.equal(r.body.found, false);
  assert.match(r.body.hint, /Found a transfer to yourself.*not exactly/);
  assert.ok(monad.s.calls.length < 40, `bounded: ${monad.s.calls.length} calls`);
  assert.ok(!monad.s.calls.some(m => m === 'eth_getLogs'));

  monad.s.head += 700;
  const hash = monad.send({ from: who, to: who, value: BigInt(c.amountWei) });
  monad.s.head += 10;
  now += selftx.AUTO_COOLDOWN_MS;
  monad.s.calls.length = 0;
  r = await req('POST', '/selftx/auto', tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.found, true);
  assert.equal(r.body.txHash, hash);
  assert.equal(r.body.wallet.address, who);
  assert.equal(store.walletOwner(who), 'u_auto');
  assert.equal(monad.s.calls.filter(m => m === 'eth_getBlockByNumber').length, 1, 'read exactly one block');

  const used = await req('POST', '/selftx/challenge', tok, { address: who });
  assert.match(used.body.error, /already linked to your account/);
});

test('selftx: challenges and spent hashes survive a restart', async () => {
  const tok = token('u_restart');
  const who = privateKeyToAccount(generatePrivateKey()).address;
  const c = await challenge(tok, who);
  selftx.resetSelfTxForTest();
  // resetSelfTxForTest leaves `loaded` set; simulate a fresh process by reading the file back.
  const { readJson } = await import('../src/jsonstore.ts');
  const disk = readJson<{ challenges: Record<string, { amountWei: string }>; used: Record<string, unknown> }>('selftx.json', { challenges: {}, used: {} });
  assert.equal(disk.challenges.u_restart.amountWei, c.amountWei);
  assert.ok(Object.keys(disk.used).length >= 3, 'spent hashes are on disk');
});
