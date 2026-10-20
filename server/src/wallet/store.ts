// Which wallet belongs to which account, and what each wallet was last seen
// holding. One small JSON file on the data volume (wallets.json): a wallet
// links to one account, an account may link several wallets.
import { getAddress, isAddress } from 'viem';
import { readJson, writeJson } from '../jsonstore.ts';

const FILE = 'wallets.json';
export const MAX_WALLETS_PER_ACCOUNT = 10;

export interface WalletLink {
  /** Checksummed. */
  address: string;
  /** Profile id. */
  owner: string;
  linkedAt: number;
}

export interface WalletHoldings {
  balance: number;
  tokenIds: number[];
  checkedAt: number;
  method: 'none' | 'enumerable' | 'queryable' | 'logs';
  partial: boolean;
}

interface Data {
  links: WalletLink[];
  /** Keyed by lowercase address. */
  holdings: Record<string, WalletHoldings>;
}

let data: Data = { links: [], holdings: {} };
let loaded = false;

const key = (address: string) => address.toLowerCase();

export function loadWallets(): void {
  const raw = readJson<Partial<Data>>(FILE, {});
  data = {
    links: Array.isArray(raw.links)
      ? raw.links.filter(l => l && typeof l.owner === 'string' && isAddress(String(l.address)))
        .map(l => ({ address: getAddress(String(l.address)), owner: l.owner, linkedAt: Number(l.linkedAt) || 0 }))
      : [],
    holdings: raw.holdings && typeof raw.holdings === 'object' ? raw.holdings : {},
  };
  loaded = true;
}

function ready() {
  if (!loaded) loadWallets();
}

function save() {
  writeJson(FILE, data);
}

/** Normalises or throws with a message the page can show. */
export function normalizeAddress(address: unknown): string {
  if (typeof address !== 'string' || !isAddress(address)) throw new Error('That is not a wallet address');
  return getAddress(address);
}

export function walletOwner(address: string): string | null {
  ready();
  const k = key(address);
  return data.links.find(l => key(l.address) === k)?.owner ?? null;
}

export function walletsOf(owner: string): WalletLink[] {
  ready();
  return data.links.filter(l => l.owner === owner);
}

/** Every link on record (the hosting list shows who holds). */
export function allLinks(): WalletLink[] {
  ready();
  return [...data.links];
}

/** Links, or returns the existing link when this account already has it. */
export function linkWallet(address: string, owner: string, now = Date.now()): WalletLink {
  ready();
  const addr = normalizeAddress(address);
  const k = key(addr);
  const existing = data.links.find(l => key(l.address) === k);
  if (existing) {
    if (existing.owner !== owner) throw new Error('That wallet is already linked to another account. Unlink it there first.');
    return existing;
  }
  if (walletsOf(owner).length >= MAX_WALLETS_PER_ACCOUNT) {
    throw new Error(`You can link up to ${MAX_WALLETS_PER_ACCOUNT} wallets — unlink one first`);
  }
  const link: WalletLink = { address: addr, owner, linkedAt: now };
  data.links.push(link);
  save();
  return link;
}

/** True when something was removed. Only the owner may unlink. */
export function unlinkWallet(address: string, owner: string): boolean {
  ready();
  const k = key(address);
  const before = data.links.length;
  data.links = data.links.filter(l => !(key(l.address) === k && l.owner === owner));
  if (data.links.length === before) return false;
  delete data.holdings[k];
  save();
  return true;
}

export function getHoldings(address: string): WalletHoldings | null {
  ready();
  return data.holdings[key(address)] ?? null;
}

export function setHoldings(address: string, h: WalletHoldings): void {
  ready();
  data.holdings[key(address)] = h;
  save();
}

/** Test hook: forget everything in memory (the file is left alone). */
export function resetWalletsForTest(): void {
  data = { links: [], holdings: {} };
  loaded = true;
}
