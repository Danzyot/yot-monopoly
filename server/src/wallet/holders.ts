// Verified Chog Genesis holders: every linked wallet's holdings, read from
// the chain at most once per ten minutes (one in-flight read per wallet) and
// kept in wallets.json. A player may force a re-check, but only every half
// minute, so nobody can hammer the RPC through us.
import { CHOG_CONTRACT, MONAD_CHAIN_ID, MONAD_RPC_URL, enumerateHoldings, httpRpc, type JsonRpc } from './chain.ts';
import { getHoldings, setHoldings, walletsOf, type WalletHoldings, type WalletLink } from './store.ts';

export const HOLDINGS_TTL_MS = 10 * 60_000;
export const REFRESH_COOLDOWN_MS = 30_000;
/** The public RPC caps eth_getLogs at 100 blocks, so the log scan is a last resort over the recent past only. */
const MAX_LOG_BLOCKS = Number(process.env.CHOG_LOG_SCAN_BLOCKS) || 20_000;

let rpc: JsonRpc | null = null;
let clock = () => Date.now();

/** Test hook: a fake chain and a fake clock. */
export function configureHolders(o: { rpc?: JsonRpc | null; now?: () => number }): void {
  if (o.rpc !== undefined) rpc = o.rpc;
  if (o.now) clock = o.now;
}

function chain(): JsonRpc {
  return rpc ??= httpRpc(process.env.CHOG_RPC_URL?.trim() || MONAD_RPC_URL);
}

export interface WalletStatus extends WalletHoldings {
  address: string;
  linkedAt: number;
  /** Set when the last read failed; the holdings shown are the previous ones (or empty). */
  error?: string;
}

const inflight = new Map<string, Promise<WalletStatus>>();

/** The wallet's holdings: cached when fresh, else read from the chain. */
export function verifyWallet(link: WalletLink, force = false): Promise<WalletStatus> {
  const k = link.address.toLowerCase();
  const cached = getHoldings(k);
  if (cached && !force && clock() - cached.checkedAt < HOLDINGS_TTL_MS) return Promise.resolve({ ...cached, address: link.address, linkedAt: link.linkedAt });
  let p = inflight.get(k);
  if (!p) {
    p = (async () => {
      try {
        const h = await enumerateHoldings(chain(), link.address, { maxLogBlocks: MAX_LOG_BLOCKS });
        const row: WalletHoldings = { balance: h.balance, tokenIds: h.tokenIds, checkedAt: clock(), method: h.method, partial: h.partial };
        setHoldings(k, row);
        return { ...row, address: link.address, linkedAt: link.linkedAt };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Could not read holdings of ${link.address}:`, msg);
        const prev: WalletHoldings = cached ?? { balance: 0, tokenIds: [], checkedAt: 0, method: 'none', partial: false };
        return { ...prev, address: link.address, linkedAt: link.linkedAt, error: 'Could not reach the Monad RPC — try again in a moment' };
      } finally {
        inflight.delete(k);
      }
    })();
    inflight.set(k, p);
  }
  return p;
}

const lastRefresh = new Map<string, number>();

/** Whether this account may force a re-check now; records it when it may. */
export function takeRefresh(userId: string): boolean {
  const now = clock();
  const last = lastRefresh.get(userId) ?? 0;
  if (now - last < REFRESH_COOLDOWN_MS) return false;
  if (lastRefresh.size > 20_000) lastRefresh.clear();
  lastRefresh.set(userId, now);
  return true;
}

export interface HolderStatus {
  wallets: WalletStatus[];
  holder: boolean;
  /** Every Chog across the account's wallets, ascending. */
  chogs: number[];
  contract: string;
  chainId: number;
  /** False when a forced re-check was asked for too soon and the cache was used instead. */
  refreshed: boolean;
}

/** Everything the wallet page shows. `refresh` re-reads the chain, cooldown permitting. */
export async function holderStatus(userId: string, refresh = false): Promise<HolderStatus> {
  const force = refresh && takeRefresh(userId);
  const wallets = await Promise.all(walletsOf(userId).map(l => verifyWallet(l, force)));
  const chogs = [...new Set(wallets.flatMap(w => w.tokenIds))].sort((a, b) => a - b);
  return {
    wallets,
    holder: wallets.some(w => w.balance > 0),
    chogs,
    contract: CHOG_CONTRACT,
    chainId: MONAD_CHAIN_ID,
    refreshed: !refresh || force,
  };
}

/** From the cache only, for callers that must not wait on the chain (seat gating and the like). */
export function isChogHolder(userId: string): boolean {
  return walletsOf(userId).some(l => (getHoldings(l.address)?.balance ?? 0) > 0);
}
