// The wallet extension in the browser, spoken to directly over EIP-1193
// (MetaMask, Rabby, Coinbase Wallet, Brave… anything that injects
// window.ethereum). No wallet SDK: three JSON-RPC calls are all linking needs.

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  /** Some extensions stack every injected wallet here. */
  providers?: Eip1193Provider[];
}

export const MONAD_CHAIN = {
  chainId: '0x8f', // 143
  chainName: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: ['https://rpc.monad.xyz'],
} as const;

export const WALLET_DOWNLOADS = [
  { name: 'MetaMask', url: 'https://metamask.io/download/' },
  { name: 'Rabby', url: 'https://rabby.io/' },
];

export function getProvider(): Eip1193Provider | null {
  const eth = (window as { ethereum?: Eip1193Provider }).ethereum;
  if (!eth) return null;
  return eth.providers?.[0] ?? eth;
}

export function walletName(p: Eip1193Provider | null): string {
  if (!p) return 'wallet';
  if (p.isRabby) return 'Rabby';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return 'wallet';
}

/** Wallet errors as a sentence the page can show. */
export function walletError(e: unknown): Error {
  const code = (e as { code?: number } | null)?.code;
  const msg = e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e);
  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(msg)) return new Error('Cancelled in the wallet');
  if (code === -32002 || /already pending/i.test(msg)) return new Error('Your wallet is already asking you something — open it and finish that first');
  return new Error(msg || 'The wallet refused');
}

export async function requestAccount(p: Eip1193Provider): Promise<string> {
  const accounts = await p.request({ method: 'eth_requestAccounts' }) as string[] | undefined;
  const a = accounts?.[0];
  if (!a) throw new Error('No account was unlocked in the wallet');
  return a;
}

/** Switches the wallet to Monad, adding the network when the wallet does not know it yet. */
export async function switchToMonad(p: Eip1193Provider): Promise<void> {
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MONAD_CHAIN.chainId }] });
  } catch (e) {
    const code = (e as { code?: number } | null)?.code;
    const msg = String((e as { message?: string } | null)?.message ?? '');
    // 4902: unknown chain. MetaMask mobile wraps it in a -32603; others just say so.
    if (code === 4902 || code === -32603 || /unrecognized|not (been )?added|4902/i.test(msg)) {
      await p.request({ method: 'wallet_addEthereumChain', params: [MONAD_CHAIN] });
      return;
    }
    throw e;
  }
}

const utf8Hex = (s: string) => `0x${Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')}`;

/** personal_sign over the message; the wallet shows the text and signs for free. */
export async function signMessage(p: Eip1193Provider, address: string, message: string): Promise<string> {
  const sig = await p.request({ method: 'personal_sign', params: [utf8Hex(message), address] });
  if (typeof sig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('The wallet returned no signature');
  return sig;
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
