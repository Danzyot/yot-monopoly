// Chog Genesis holdings straight from Monad's JSON-RPC: balanceOf, then the
// cheapest enumeration the contract offers (ERC-721 Enumerable's
// tokenOfOwnerByIndex, or ERC721A's tokensOfOwner), and failing both a
// bounded scan of Transfer logs, each candidate confirmed with ownerOf. No
// metadata is fetched: token ids are all the site needs, and IPFS is slow.
//
// Everything goes through one injectable `JsonRpc` function so tests can
// stand in a fake chain; httpRpc() is the real one.
import { decodeFunctionResult, encodeFunctionData, getAddress, isAddress, parseAbi, toHex, type Hex } from 'viem';

export const CHOG_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763' as const;
export const MONAD_CHAIN_ID = 143;
export const MONAD_RPC_URL = 'https://rpc.monad.xyz';
/** Chog Genesis is 1,969 tokens, so the id space is small; anything past this is a decode bug. */
const MAX_TOKEN_ID = 1_000_000;

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC721_ENUMERABLE_ID = '0x780e9d63';

export type JsonRpc = (method: string, params: unknown[]) => Promise<unknown>;

export class RpcError extends Error {
  constructor(message: string, public code?: number, public data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

/** The real thing: JSON-RPC over HTTPS with a timeout, errors surfaced as RpcError. */
export function httpRpc(url = MONAD_RPC_URL, fetchImpl: typeof fetch = fetch, timeoutMs = 15_000): JsonRpc {
  let id = 0;
  return async (method, params) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new RpcError(`RPC ${method}: HTTP ${res.status}`);
    const body = await res.json() as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
    if (body.error) throw new RpcError(body.error.message ?? `RPC ${method} failed`, body.error.code, body.error.data);
    return body.result;
  };
}

const ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokensOfOwner(address owner) view returns (uint256[])',
]);

type Fn = 'balanceOf' | 'ownerOf' | 'supportsInterface' | 'tokenOfOwnerByIndex' | 'tokensOfOwner';

async function call(rpc: JsonRpc, contract: Hex, functionName: Fn, args: unknown[]): Promise<unknown> {
  const data = encodeFunctionData({ abi: ABI, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
  const out = await rpc('eth_call', [{ to: contract, data }, 'latest']);
  if (typeof out !== 'string' || !out.startsWith('0x') || out.length < 66) throw new RpcError(`${functionName}: empty result`);
  return decodeFunctionResult({ abi: ABI, functionName, data: out as Hex } as Parameters<typeof decodeFunctionResult>[0]);
}

function tokenId(v: unknown): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_TOKEN_ID) throw new RpcError(`Unexpected token id ${String(v)}`);
  return n;
}

/** Runs f over items, at most n at a time, keeping order. */
async function mapLimit<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export interface EnumerateOptions {
  contract?: Hex;
  /** How far back from the head the log scan may walk, in blocks. */
  maxLogBlocks?: number;
  /** First eth_getLogs span to try; shrinks to whatever the RPC says its limit is. */
  logChunk?: number;
  /** Parallel eth_calls. */
  concurrency?: number;
}

export interface Holdings {
  balance: number;
  tokenIds: number[];
  /** How the ids were found. 'none' when the balance is zero. */
  method: 'none' | 'enumerable' | 'queryable' | 'logs';
  /** True when the balance says there are more tokens than could be enumerated. */
  partial: boolean;
  /** Blocks walked by the log scan, when it ran. */
  scannedBlocks?: number;
}

export async function balanceOf(rpc: JsonRpc, address: string, contract: Hex = CHOG_CONTRACT): Promise<number> {
  return Number(await call(rpc, contract, 'balanceOf', [getAddress(address)]));
}

/** Which tokens of the collection `address` holds right now. */
export async function enumerateHoldings(rpc: JsonRpc, address: string, opts: EnumerateOptions = {}): Promise<Holdings> {
  if (!isAddress(address)) throw new Error('Not an address');
  const owner = getAddress(address);
  const contract = opts.contract ?? CHOG_CONTRACT;
  const concurrency = opts.concurrency ?? 8;

  const balance = await balanceOf(rpc, owner, contract);
  if (balance === 0) return { balance, tokenIds: [], method: 'none', partial: false };

  // 1. ERC-721 Enumerable: one call per token.
  if (await supportsEnumerable(rpc, contract)) {
    const ids = await mapLimit(Array.from({ length: balance }, (_, i) => i), concurrency,
      i => call(rpc, contract, 'tokenOfOwnerByIndex', [owner, BigInt(i)]).then(tokenId));
    return { balance, tokenIds: sortIds(ids), method: 'enumerable', partial: false };
  }

  // 2. ERC721A's tokensOfOwner (ERC721AQueryable): one call for everything.
  const all = await tokensOfOwner(rpc, contract, owner);
  if (all && all.length === balance) return { balance, tokenIds: sortIds(all), method: 'queryable', partial: false };

  // 3. Transfer logs to the wallet, each candidate confirmed with ownerOf.
  const scan = await scanTransferLogs(rpc, contract, owner, balance, opts);
  return { balance, tokenIds: sortIds(scan.ids), method: 'logs', partial: scan.ids.length < balance, scannedBlocks: scan.scanned };
}

async function supportsEnumerable(rpc: JsonRpc, contract: Hex): Promise<boolean> {
  try {
    return (await call(rpc, contract, 'supportsInterface', [ERC721_ENUMERABLE_ID])) === true;
  } catch {
    return false; // no ERC-165 at all
  }
}

async function tokensOfOwner(rpc: JsonRpc, contract: Hex, owner: Hex): Promise<number[] | null> {
  try {
    const out = await call(rpc, contract, 'tokensOfOwner', [owner]);
    return Array.isArray(out) ? out.map(tokenId) : null;
  } catch {
    return null; // not that kind of contract
  }
}

const sortIds = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

/** The block-range cap an RPC names in its error ("limited to a 100 range"), if any. */
function rangeLimitFrom(e: unknown, below: number): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (!/range|block|limit|exceed|too (many|large)/i.test(msg)) return null;
  const nums = (msg.match(/\d+/g) ?? []).map(Number).filter(n => n > 0 && n < below);
  return nums.length ? Math.max(...nums) : null;
}

interface Log { topics?: string[] }

/**
 * Walks Transfer(…, to=owner) logs back from the head in chunks the RPC will
 * take, confirming each token with ownerOf, and stops once every token the
 * balance promises has been found or the block budget is spent. Only
 * transfers *to* the wallet matter: whatever it holds now arrived that way.
 */
async function scanTransferLogs(rpc: JsonRpc, contract: Hex, owner: Hex, balance: number, opts: EnumerateOptions) {
  const latest = Number(await rpc('eth_blockNumber', []));
  const floor = Math.max(0, latest - (opts.maxLogBlocks ?? 20_000) + 1);
  const concurrency = opts.concurrency ?? 8;
  let chunk = Math.max(1, opts.logChunk ?? 2_000);
  const ownerTopic = `0x${owner.slice(2).toLowerCase().padStart(64, '0')}`;
  const seen = new Set<number>();
  const owned = new Set<number>();
  let unverified: number[] = [];
  let to = latest;

  const verify = async () => {
    const batch = unverified;
    unverified = [];
    const owners = await mapLimit(batch, concurrency, async id => {
      try { return await call(rpc, contract, 'ownerOf', [BigInt(id)]); } catch { return null; } // burned since
    });
    batch.forEach((id, i) => { if (typeof owners[i] === 'string' && getAddress(owners[i]) === owner) owned.add(id); });
  };

  while (to >= floor && owned.size < balance) {
    const from = Math.max(floor, to - chunk + 1);
    let logs: unknown;
    try {
      logs = await rpc('eth_getLogs', [{ address: contract, fromBlock: toHex(from), toBlock: toHex(to), topics: [TRANSFER_TOPIC, null, ownerTopic] }]);
    } catch (e) {
      if (chunk === 1) throw e;
      const limit = rangeLimitFrom(e, chunk);
      chunk = limit ?? Math.max(1, Math.floor(chunk / 2));
      continue;
    }
    for (const l of (Array.isArray(logs) ? logs : []) as Log[]) {
      const t = l.topics?.[3];
      if (!t) continue;
      const id = tokenId(BigInt(t));
      if (!seen.has(id)) { seen.add(id); unverified.push(id); }
    }
    if (seen.size >= balance) await verify();
    to = from - 1;
  }
  if (unverified.length) await verify();
  return { ids: [...owned], scanned: latest - Math.max(to, floor - 1) };
}
