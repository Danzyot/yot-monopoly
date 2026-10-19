// Link a wallet to the signed-in account by signing a message (no gas), and
// see which Chog Genesis tokens the linked wallets hold. Mounted at /api/wallet.
import express from 'express';
import { verifyMessage } from 'viem';
import { authed, fail, rateLimit } from '../http.ts';
import { consumeNonce, issueNonce } from '../wallet/nonce.ts';
import { holderStatus, takeRefresh, verifyWallet } from '../wallet/holders.ts';
import { linkWallet, normalizeAddress, unlinkWallet, walletOwner, walletsOf } from '../wallet/store.ts';
import type { PlayerProfile } from '../../../shared/types.ts';

const SIGNATURE = /^0x[0-9a-fA-F]{130}$/;

function requireUser(req: express.Request, res: express.Response): PlayerProfile | null {
  const p = authed(req);
  if (!p) res.status(401).json({ error: 'Sign in first' });
  return p;
}

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
      const link = linkWallet(address, p.id);
      // A fresh read, and it counts as the player's re-check for the cooldown.
      takeRefresh(p.id);
      const wallet = await verifyWallet(link, true);
      const status = await holderStatus(p.id);
      res.json({ wallet, ...status });
    } catch (e) { fail(res, e); }
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
