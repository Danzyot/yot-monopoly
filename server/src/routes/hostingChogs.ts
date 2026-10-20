// GET /api/hosting/chogs?id=<playerId>&ts=<ms>&sig=<hex> — which Chogs a
// player's linked wallets hold, for Chog Poker's seat avatars. Server to
// server only, signed with the shared secret (hubLink.ts). Each Chog comes with
// the two traits poker draws, so poker needs no copy of shared/chogs:
//   { id, chogs: [{ chogToken, aura: '#rrggbb' | null, legendary }], complete }
// `complete` is false when a wallet could not be read just now (the chain did
// not answer), so poker knows not to treat a missing Chog as sold.
// The art is this hub's own static /chogs/<id>.webp (client/public/chogs).
import type express from 'express';
import { AURA_MAP, traitsOf } from '../../../shared/chogs/traits.ts';
import { verifyHubLink } from '../hubLink.ts';
import { holderStatus } from '../wallet/holders.ts';

export interface HubChog {
  chogToken: number;
  /** The Aura trait's colour, or null for a Chog without one. */
  aura: string | null;
  /** Tier Legendary: the ten 1:1s. */
  legendary: boolean;
}

export function hubChog(tokenId: number): HubChog | null {
  const t = traitsOf(tokenId);
  if (!t) return null;
  return { chogToken: tokenId, aura: t.Aura ? AURA_MAP[t.Aura]?.color ?? null : null, legendary: t.Tier === 'Legendary' };
}

export function mountHostingChogs(app: express.Express): void {
  app.get('/api/hosting/chogs', async (req, res) => {
    const check = verifyHubLink(req.query as Record<string, unknown>);
    if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }
    try {
      // Holdings no older than ten minutes; a stale wallet is re-read from the chain.
      const status = await holderStatus(check.id);
      const chogs = status.chogs.map(hubChog).filter((c): c is HubChog => c !== null);
      res.json({ id: check.id, chogs, complete: !status.wallets.some(w => w.error) });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
