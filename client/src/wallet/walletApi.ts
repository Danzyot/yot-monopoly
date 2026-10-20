// The wallet API as the client sees it, plus the whole link flow. The last
// status is kept here so the header badge and the wallet page agree, and so
// anyone (the character picker, say) can ask for a fresh read with
// refreshHolderStatus().
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { getProvider, requestAccount, signMessage, switchToMonad, walletError } from './eth.ts';

export const CHOG_CONTRACT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';

export interface WalletRow {
  address: string;
  linkedAt: number;
  balance: number;
  tokenIds: number[];
  checkedAt: number;
  method: 'none' | 'enumerable' | 'queryable' | 'logs';
  partial: boolean;
  error?: string;
}

export interface WalletStatus {
  wallets: WalletRow[];
  holder: boolean;
  chogs: number[];
  contract: string;
  chainId: number;
  refreshed: boolean;
}

export const openSeaUrl = (tokenId: number, contract = CHOG_CONTRACT) => `https://opensea.io/item/monad/${contract}/${tokenId}`;

let last: WalletStatus | null = null;
const listeners = new Set<(s: WalletStatus | null) => void>();

function publish(s: WalletStatus | null) {
  last = s;
  listeners.forEach(f => f(s));
}

/** The linked wallets and their Chogs. `refresh` asks the server to re-read the chain. */
export async function fetchWalletStatus(refresh = false): Promise<WalletStatus> {
  const s = await api<WalletStatus>(`/api/wallet/me${refresh ? '?refresh=1' : ''}`);
  publish(s);
  return s;
}

/** For the character picker and friends: re-verify holdings (the server rate-limits this). */
export const refreshHolderStatus = () => fetchWalletStatus(true);

/** Forget what we knew (sign-out). */
export function clearWalletStatus() {
  publish(null);
}

export function useWalletStatus(): WalletStatus | null {
  const [s, set] = useState(last);
  useEffect(() => {
    listeners.add(set);
    return () => { listeners.delete(set); };
  }, []);
  return s;
}

export type LinkStep = 'connect' | 'network' | 'sign' | 'verify';

/**
 * Connect → switch to Monad → sign the challenge → link on the server.
 * `onStep` is told where it is, for the button label.
 */
export async function linkWalletFlow(onStep: (s: LinkStep) => void): Promise<WalletStatus & { wallet: WalletRow }> {
  const p = getProvider();
  if (!p) throw new Error('No wallet extension found in this browser');
  let address: string;
  try {
    onStep('connect');
    address = await requestAccount(p);
    onStep('network');
    await switchToMonad(p);
  } catch (e) { throw walletError(e); }

  const c = await api<{ nonce: string; message: string }>('/api/wallet/nonce');
  let signature: string;
  try {
    onStep('sign');
    signature = await signMessage(p, address, c.message);
  } catch (e) { throw walletError(e); }

  onStep('verify');
  const r = await api<WalletStatus & { wallet: WalletRow }>('/api/wallet/link', { method: 'POST', json: { address, signature, nonce: c.nonce } });
  publish(r);
  return r;
}

export async function unlinkWallet(address: string): Promise<WalletStatus> {
  await api('/api/wallet/unlink', { method: 'POST', json: { address } });
  return fetchWalletStatus();
}

// ---- No wallet connection: verify with a self-transfer ----

export interface SelfTxChallenge {
  /** Checksummed: send from this address to this same address. */
  address: string;
  amountWei: string;
  /** The exact amount, every digit. */
  amountMon: string;
  floorBlock: number;
  issuedAt: number;
  expiresAt: number;
  chainId: number;
  /** EIP-681: opens a send to yourself, amount filled in, in wallet apps that know it. */
  paymentUri: string;
}

export type LinkResult = WalletStatus & { wallet: WalletRow };

/** The pending challenge, if one is open (it survives a reload for half an hour). */
export const fetchSelfTx = () => api<{ challenge: SelfTxChallenge | null }>('/api/wallet/selftx').then(r => r.challenge);

/** A challenge for this wallet: the exact amount to send to itself. */
export const startSelfTx = (address: string) =>
  api<{ challenge: SelfTxChallenge }>('/api/wallet/selftx/challenge', { method: 'POST', json: { address } }).then(r => r.challenge);

export const cancelSelfTx = () => api('/api/wallet/selftx/cancel', { method: 'POST' });

/** A pasted hash, or an explorer link with one in it; null when there is none. */
export function txHashFrom(text: string): string | null {
  return text.match(/0x[0-9a-fA-F]{64}/)?.[0] ?? null;
}

/** Checks the transaction and links the wallet. */
export async function verifySelfTx(txHash: string): Promise<LinkResult> {
  const r = await api<LinkResult>('/api/wallet/selftx/verify', { method: 'POST', json: { txHash } });
  publish(r);
  return r;
}

export type AutoCheck = { found: false; retryAt?: number; hint?: string } | (LinkResult & { found: true; txHash: string });

/** Asks the server to look for the transfer itself (it throttles this). */
export async function autoCheckSelfTx(): Promise<AutoCheck> {
  const r = await api<AutoCheck>('/api/wallet/selftx/auto', { method: 'POST' });
  if (r.found) publish(r);
  return r;
}
