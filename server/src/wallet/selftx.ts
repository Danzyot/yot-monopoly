// Linking a wallet without connecting it to the site: the player sends an
// exact, odd amount of MON from the wallet to that same wallet, and pastes
// the transaction hash. Only the key's owner can send from an address, so a
// mined, plain self-transfer of this challenge's amount, after the challenge
// was issued, proves control as well as a signature does. The MON comes
// straight back; the player only pays gas.
//
// One pending challenge per account, kept in selftx.json with the hashes
// already spent, so a restart in the middle of the half hour loses nothing.
// Chain reads go through holders.ts's injectable RPC and clock.
import { randomInt } from 'node:crypto';
import { formatEther, toHex } from 'viem';
import { readJson, writeJson } from '../jsonstore.ts';
import { MONAD_CHAIN_ID } from './chain.ts';
import { chainRpc, holdersNow } from './holders.ts';
import { normalizeAddress, walletOwner } from './store.ts';

const FILE = 'selftx.json';
export const SELFTX_TTL_MS = 30 * 60_000;
/** 0.0001 MON, plus a random six-digit tail so every pending amount is different. */
export const BASE_WEI = 10n ** 14n;
/**
 * The tail's unit: 10^6 wei puts the six random digits at the 7th–12th
 * decimal (0.000100123456 MON), which every wallet app takes; a tail in
 * single wei would need all 18 decimals typed, and several wallets round that.
 */
export const DUST_UNIT_WEI = 10n ** 6n;
/** New challenges per account per window (handing back the pending one is free). */
export const MAX_CHALLENGES = 5;
export const CHALLENGE_WINDOW_MS = 15 * 60_000;
/** Pasted hashes per challenge before it has to be started again. */
export const MAX_ATTEMPTS = 12;
/** "Check automatically" reads the chain at most this often per account. */
export const AUTO_COOLDOWN_MS = 10_000;
/** Transactions from the wallet the automatic check will look through per challenge. */
const MAX_AUTO_TXS = 8;
/** A spent hash is remembered this long; anything older predates every live challenge's floor anyway. */
const USED_TTL_MS = 24 * 60 * 60_000;
const MAX_PENDING = 10_000;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export interface SelfTxChallenge {
  owner: string;
  /** Checksummed. */
  address: string;
  /** Decimal string: JSON has no bigint. */
  amountWei: string;
  /** The head when issued; the transfer must be mined in this block or later. */
  floorBlock: number;
  /** The wallet's transaction count before the floor block, where the automatic check starts. */
  startNonce: number;
  /** The next nonce the automatic check has yet to look at. */
  scanNonce: number;
  issuedAt: number;
  expiresAt: number;
  attempts: number;
}

/** What the page shows. */
export interface ChallengeView {
  address: string;
  amountWei: string;
  /** The exact amount in MON, every digit. */
  amountMon: string;
  floorBlock: number;
  issuedAt: number;
  expiresAt: number;
  chainId: number;
  /** EIP-681 link: wallet apps that understand it open a send to yourself with the amount filled in. */
  paymentUri: string;
}

/** The chain could not be asked: a 503, not the player's fault. */
export class ChainUnavailable extends Error {
  constructor(message = 'Could not reach the Monad RPC — try again in a moment') {
    super(message);
    this.name = 'ChainUnavailable';
  }
}

interface Data {
  challenges: Record<string, SelfTxChallenge>;
  /** Lowercase hash → when it was spent. */
  used: Record<string, { at: number; owner: string }>;
}

let data: Data = { challenges: {}, used: {} };
let loaded = false;
const issued = new Map<string, number[]>();
const lastAuto = new Map<string, number>();

function ready() {
  if (loaded) return;
  const raw = readJson<Partial<Data>>(FILE, {});
  data = {
    challenges: raw.challenges && typeof raw.challenges === 'object' ? raw.challenges : {},
    used: raw.used && typeof raw.used === 'object' ? raw.used : {},
  };
  loaded = true;
}

function save() {
  try { writeJson(FILE, data); } catch (e) { console.error(`Could not save ${FILE}:`, e); }
}

function sweep(now: number) {
  for (const [k, c] of Object.entries(data.challenges)) if (now >= c.expiresAt) delete data.challenges[k];
  for (const [k, u] of Object.entries(data.used)) if (now - u.at > USED_TTL_MS) delete data.used[k];
  if (issued.size > 20_000) issued.clear();
  if (lastAuto.size > 20_000) lastAuto.clear();
}

/** Any failure to talk to the chain, as one clear message. */
async function ask<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.error('Self-transfer check: RPC failed:', e instanceof Error ? e.message : e);
    throw new ChainUnavailable();
  }
}

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(BigInt(v)) : NaN);
const lower = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : '');

export function view(c: SelfTxChallenge): ChallengeView {
  return {
    address: c.address,
    amountWei: c.amountWei,
    amountMon: formatEther(BigInt(c.amountWei)),
    floorBlock: c.floorBlock,
    issuedAt: c.issuedAt,
    expiresAt: c.expiresAt,
    chainId: MONAD_CHAIN_ID,
    paymentUri: `ethereum:${c.address}@${MONAD_CHAIN_ID}?value=${c.amountWei}`,
  };
}

/** The account's live challenge, if any. */
export function pendingSelfTx(owner: string): SelfTxChallenge | null {
  ready();
  const c = data.challenges[owner];
  if (!c) return null;
  if (holdersNow() >= c.expiresAt) {
    delete data.challenges[owner];
    save();
    return null;
  }
  return c;
}

export function cancelSelfTx(owner: string): void {
  ready();
  if (!data.challenges[owner]) return;
  delete data.challenges[owner];
  save();
}

function freshAmount(): bigint {
  const live = new Set(Object.values(data.challenges).map(c => c.amountWei));
  for (;;) {
    const a = BASE_WEI + BigInt(randomInt(100_000, 1_000_000)) * DUST_UNIT_WEI;
    if (!live.has(a.toString())) return a;
  }
}

/**
 * A challenge for this account and wallet. Asking again for the same wallet
 * hands back the pending one (so a reload loses nothing); a different wallet
 * replaces it, within the per-account limit.
 */
export async function issueSelfTx(owner: string, address: unknown): Promise<SelfTxChallenge> {
  ready();
  const addr = normalizeAddress(address);
  const held = walletOwner(addr);
  if (held === owner) throw new Error('That wallet is already linked to your account');
  if (held) throw new Error('That wallet is already linked to another account. Unlink it there first.');

  const now = holdersNow();
  const current = pendingSelfTx(owner);
  if (current && current.address === addr) return current;

  const recent = (issued.get(owner) ?? []).filter(t => now - t < CHALLENGE_WINDOW_MS);
  if (recent.length >= MAX_CHALLENGES) {
    const wait = Math.ceil((recent[0] + CHALLENGE_WINDOW_MS - now) / 60_000);
    throw new Error(`Too many new challenges — try again in ${wait} minute${wait === 1 ? '' : 's'}`);
  }

  const rpc = chainRpc();
  const { head, code, startNonce } = await ask(async () => {
    const head = num(await rpc('eth_blockNumber', []));
    const [code, nonce] = await Promise.all([
      rpc('eth_getCode', [addr, 'latest']),
      rpc('eth_getTransactionCount', [addr, toHex(Math.max(0, head - 1))]),
    ]);
    if (!Number.isSafeInteger(head) || head <= 0) throw new Error(`bad block number ${String(head)}`);
    return { head, code: lower(code), startNonce: num(nonce) };
  });
  // A contract wallet (a Safe, say) cannot sign a transaction of its own; an
  // EIP-7702 delegated account still has its key, so that one may.
  if (code && code !== '0x' && !code.startsWith('0xef0100')) {
    throw new Error('That address is a smart-contract wallet, which cannot send its own transaction — link it with Connect wallet instead');
  }

  sweep(now);
  if (Object.keys(data.challenges).length >= MAX_PENDING) throw new Error('Too many pending checks right now — try again in a few minutes');
  recent.push(now);
  issued.set(owner, recent);
  const c: SelfTxChallenge = {
    owner, address: addr, amountWei: freshAmount().toString(),
    floorBlock: head, startNonce: Number.isSafeInteger(startNonce) ? startNonce : 0, scanNonce: 0,
    issuedAt: now, expiresAt: now + SELFTX_TTL_MS, attempts: 0,
  };
  c.scanNonce = c.startNonce;
  data.challenges[owner] = c;
  save();
  return c;
}

interface RpcTx {
  hash?: string;
  from?: string;
  to?: string | null;
  value?: string;
  input?: string;
  nonce?: string;
  chainId?: string;
  blockNumber?: string | null;
}

interface RpcReceipt {
  status?: string;
  from?: string;
  to?: string | null;
  blockNumber?: string;
  contractAddress?: string | null;
}

/**
 * Why this transaction does not answer this challenge, or null when it does.
 * Plain value transfers only: signed by the wallet itself (a top-level
 * transaction's `from` is the key that signed it; internal calls from
 * contracts have no hash of their own), sent to the very same address, the
 * exact amount, no calldata, signed for Monad, mined at or after the floor.
 */
export function mismatch(c: SelfTxChallenge, tx: RpcTx, receipt: RpcReceipt | null): string | null {
  const addr = c.address.toLowerCase();
  if (!tx.blockNumber) return 'That transaction has not been mined yet — wait a few seconds and press Verify again';
  if (lower(tx.from) !== addr) return `That transaction was not sent from ${c.address}`;
  if (lower(tx.to) !== addr) return 'That transaction was not sent to the same address — it must go from your wallet to itself';
  if (tx.input && tx.input !== '0x') return 'That transaction calls a contract — send a plain transfer of MON instead';
  if (tx.chainId === undefined || num(tx.chainId) !== MONAD_CHAIN_ID) return `That transaction is not on Monad (chain ${MONAD_CHAIN_ID})`;
  let value: bigint;
  try { value = BigInt(tx.value ?? 'x'); } catch { return 'That transaction has no amount'; }
  if (value !== BigInt(c.amountWei)) return `That transaction sent ${formatEther(value)} MON, not exactly ${formatEther(BigInt(c.amountWei))} MON`;
  if (num(tx.blockNumber) < c.floorBlock) return 'That transaction is older than this challenge — send a new one';
  if (!receipt) return 'That transaction has no receipt yet — wait a few seconds and press Verify again';
  if (receipt.status !== '0x1') return 'That transaction failed on chain';
  if (lower(receipt.from) !== addr || lower(receipt.to) !== addr || receipt.contractAddress) return 'That transaction\'s receipt does not match a self-transfer';
  if (num(receipt.blockNumber) !== num(tx.blockNumber)) return 'That transaction\'s receipt does not match it';
  return null;
}

/**
 * Checks a pasted hash against the account's challenge. Returns the wallet it
 * proves on success; nothing is spent until completeSelfTx(), so a failed
 * link (the wallet taken meanwhile) can be retried. Throws with the reason.
 */
export async function checkSelfTx(owner: string, txHash: unknown): Promise<string> {
  ready();
  if (typeof txHash !== 'string' || !HASH.test(txHash.trim())) throw new Error('That is not a transaction hash (0x followed by 64 hex characters)');
  const hash = txHash.trim().toLowerCase();
  const c = pendingSelfTx(owner);
  if (!c) throw new Error('No self-transfer check is pending (it may have expired) — start again');
  if (data.used[hash]) throw new Error('That transaction was already used to verify a wallet');
  if (++c.attempts > MAX_ATTEMPTS) {
    delete data.challenges[owner];
    save();
    throw new Error('Too many tries for this challenge — start again for a new amount');
  }
  save();

  const rpc = chainRpc();
  const tx = await ask(() => rpc('eth_getTransactionByHash', [hash])) as RpcTx | null;
  if (!tx || typeof tx !== 'object') throw new Error('Monad does not know that transaction yet — if you just sent it, wait a few seconds and try again');
  if (lower(tx.hash) && lower(tx.hash) !== hash) throw new Error('The RPC returned a different transaction');
  // Cheap checks first: a wrong paste should not cost a receipt read.
  const early = mismatch(c, tx, { status: '0x1', from: tx.from, to: tx.to ?? null, blockNumber: tx.blockNumber ?? undefined });
  if (early) throw new Error(early);
  const receipt = await ask(() => rpc('eth_getTransactionReceipt', [hash])) as RpcReceipt | null;
  const why = mismatch(c, tx, receipt);
  if (why) throw new Error(why);
  return c.address;
}

/** Spends the hash and the challenge once the wallet is linked. */
export function completeSelfTx(owner: string, txHash: string): void {
  ready();
  data.used[txHash.trim().toLowerCase()] = { at: holdersNow(), owner };
  delete data.challenges[owner];
  save();
}

export interface AutoResult {
  /** A matching transaction's hash, ready for checkSelfTx. */
  hash?: string;
  /** Set when the account asked again too soon: when the next read is allowed. */
  retryAt?: number;
  /** Something the player should know (a transfer of the wrong amount, say). */
  hint?: string;
}

/**
 * "Check automatically": finds the transfer without a pasted hash. Plain
 * JSON-RPC cannot look transactions up by address, and walking every block
 * since the floor (thousands at Monad's pace) would be far too heavy for the
 * public RPC. Instead it watches the wallet's transaction count: unchanged
 * means nothing was sent (one cheap call); once it moves, a binary search on
 * the historical count finds the block holding each new transaction (about a
 * dozen calls), and that one block is read. Looks at MAX_AUTO_TXS
 * transactions per challenge at most, once per AUTO_COOLDOWN_MS per account.
 */
export async function autoFindSelfTx(owner: string): Promise<AutoResult> {
  ready();
  const c = pendingSelfTx(owner);
  if (!c) throw new Error('No self-transfer check is pending (it may have expired) — start again');
  const now = holdersNow();
  const last = lastAuto.get(owner) ?? 0;
  if (now - last < AUTO_COOLDOWN_MS) return { retryAt: last + AUTO_COOLDOWN_MS };
  lastAuto.set(owner, now);

  const rpc = chainRpc();
  const addr = c.address.toLowerCase();
  const stop = c.startNonce + MAX_AUTO_TXS;
  if (c.scanNonce >= stop) return { hint: 'Several transactions went out from this wallet and none matched — paste the hash of your self-transfer instead' };
  return ask(async () => {
    const head = num(await rpc('eth_blockNumber', []));
    const countAt = async (b: number) => num(await rpc('eth_getTransactionCount', [c.address, toHex(b)]));
    const sent = await countAt(head);
    let hint: string | undefined;
    while (c.scanNonce < Math.min(sent, stop)) {
      const n = c.scanNonce;
      // The first block after which the count passes n holds the transaction with nonce n.
      let lo = c.floorBlock, hi = head;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await countAt(mid) > n) hi = mid; else lo = mid + 1;
      }
      const block = await rpc('eth_getBlockByNumber', [toHex(lo), true]) as { transactions?: unknown[] } | null;
      const tx = (block?.transactions ?? []).find((t): t is RpcTx =>
        !!t && typeof t === 'object' && lower((t as RpcTx).from) === addr && num((t as RpcTx).nonce) === n);
      c.scanNonce = n + 1;
      save();
      if (!tx?.hash) continue;
      const why = mismatch(c, tx, { status: '0x1', from: tx.from, to: tx.to ?? null, blockNumber: tx.blockNumber ?? undefined });
      if (!why) return { hash: tx.hash };
      if (lower(tx.to) === addr) hint = `Found a transfer to yourself, but: ${why.replace(/^That transaction /, 'it ')}`;
    }
    return hint ? { hint } : {};
  });
}

/** For tests: drop the in-memory state (the file stays). */
export function resetSelfTxForTest(): void {
  data = { challenges: {}, used: {} };
  loaded = true;
  issued.clear();
  lastAuto.clear();
}

/** For tests: a challenge whose fields are known. */
export function _challengeOf(owner: string): SelfTxChallenge | null {
  ready();
  return data.challenges[owner] ?? null;
}
