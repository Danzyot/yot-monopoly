// Link a wallet to the signed-in account by signing a message (no gas), or
// without connecting it at all by a self-transfer of an exact amount (/selftx),
// and see which Chog Genesis tokens the linked wallets hold. Mounted at /api/wallet.
import express from 'express';
import { verifyMessage } from 'viem';
import { authed, fail, rateLimit } from '../http.ts';
import { consumeNonce, issueNonce } from '../wallet/nonce.ts';
import { holderStatus, takeRefresh, verifyWallet } from '../wallet/holders.ts';
import { getHoldings } from '../wallet/store.ts';
import {
  ChainUnavailable, autoFindSelfTx, cancelSelfTx, checkSelfTx, completeSelfTx, issueSelfTx, pendingSelfTx, view,
} from '../wallet/selftx.ts';
import { linkWallet, normalizeAddress, unlinkWallet, walletOwner, walletsOf } from '../wallet/store.ts';
import type { PlayerProfile } from '../../../shared/types.ts';

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

function requireUser(req: express.Request, res: express.Response): PlayerProfile | null {
  const p = authed(req);
  if (!p) res.status(401).json({ error: 'Sign in first' });
  return p;
}

/**
 * The one way a wallet gets linked, whichever proof brought it: the same
 * one-account-per-wallet rule (linkWallet throws when another account has it),
 * the same holdings read.
 */
async function finishLink(p: PlayerProfile, address: string) {
  const link = linkWallet(address, p.id);
  // A fresh read for a wallet we have never seen; re-linking a known one counts as a re-check,
  // so it cannot be used to read the chain faster than the cooldown allows.
  const force = takeRefresh(p.id) || !getHoldings(address);
  const wallet = await verifyWallet(link, force);
  const status = await holderStatus(p.id);
  return { wallet, ...status };
}

const failChain = (res: express.Response, e: unknown) => fail(res, e, e instanceof ChainUnavailable ? 503 : 400);

export function walletRoutes(): express.Router {
  const r = express.Router();
  // On top of the general /api limit: chain reads are the expensive part.
  r.use(rateLimit(60, 60_000));

  r.get('/nonce', (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    const c = issueNonce({ id: p.id, name: p.name });
    res.json({ nonce: c.nonce, message: c.message, expiresAt: c.expiresAt });
  });

  r.post('/link', async (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    try {
      const address = normalizeAddress(req.body?.address);
      const signature = String(req.body?.signature ?? '');
      if (!SIGNATURE.test(signature)) throw new Error('That is not a wallet signature');
      const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : undefined;
      const c = consumeNonce(p.id, nonce);
      if (!c) throw new Error('That link request expired — press Connect again');
      const ok = await verifyMessage({ address: address as `0x${string}`, message: c.message, signature: signature as `0x${string}` });
      if (!ok) throw new Error('The signature does not match that wallet');
      res.json(await finishLink(p, address));
    } catch (e) { fail(res, e); }
  });

  // ---- No wallet connection: a self-transfer of an exact amount ----
  // GET: the pending challenge (null when none). POST /challenge {address}:
  // issue one. POST /verify {txHash}: check it and link. POST /auto: look for
  // the transfer without a hash (throttled). POST /cancel: drop the challenge.
  r.get('/selftx', (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    const c = pendingSelfTx(p.id);
    res.json({ challenge: c ? view(c) : null });
  });

  r.post('/selftx/challenge', async (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    try {
      res.json({ challenge: view(await issueSelfTx(p.id, req.body?.address)) });
    } catch (e) { failChain(res, e); }
  });

  r.post('/selftx/cancel', (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    cancelSelfTx(p.id);
    res.json({ ok: true });
  });

  const linkBySelfTx = async (p: PlayerProfile, hash: string) => {
    const address = await checkSelfTx(p.id, hash);
    const out = await finishLink(p, address);
    completeSelfTx(p.id, hash);
    return out;
  };

  r.post('/selftx/verify', async (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    try {
      res.json(await linkBySelfTx(p, req.body?.txHash));
    } catch (e) { failChain(res, e); }
  });

  r.post('/selftx/auto', async (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    try {
      const found = await autoFindSelfTx(p.id);
      if (!found.hash) { res.json({ found: false, retryAt: found.retryAt, hint: found.hint }); return; }
      res.json({ found: true, txHash: found.hash, ...await linkBySelfTx(p, found.hash) });
    } catch (e) { failChain(res, e); }
  });

  r.post('/unlink', (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    try {
      const address = normalizeAddress(req.body?.address);
      if (walletOwner(address) !== p.id) { res.status(404).json({ error: 'That wallet is not linked to your account' }); return; }
      unlinkWallet(address, p.id);
      res.json({ ok: true, wallets: walletsOf(p.id) });
    } catch (e) { fail(res, e); }
  });

  // ?refresh=1 re-reads the chain (every 30 s at most); otherwise a reading
  // under ten minutes old is served as is.
  r.get('/me', async (req, res) => {
    const p = requireUser(req, res);
    if (!p) return;
    try {
      res.json(await holderStatus(p.id, req.query.refresh === '1'));
    } catch (e) { fail(res, e, 500); }
  });

  return r;
}
