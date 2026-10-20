// Server-to-server: may this player host? Poker asks before letting a
// non-operator create a table or tournament. Mounted at /api/hosting.
//
// The question is signed, not open: anyone could otherwise walk Discord ids
// through it and list every Chog holder. The caller sends
//   X-Chog-Timestamp: <ms since epoch>
//   X-Chog-Signature: base64url(HMAC-SHA256(secret, "svc:hosting:can-host:<id>:<timestamp>"))
// with the shared token secret (hub APP_SECRET = poker CHOG_SECRET). A
// timestamp more than a minute off is refused, so a captured request cannot
// be replayed later; within that minute it can only repeat the same answer.
import express from 'express';
import { sameMac, serviceMac } from '../auth.ts';
import { hostingReason, refreshHoldingsInBackground } from '../hosting.ts';

export const HOSTING_MAX_SKEW_MS = 60_000;

/** What gets signed, without the `svc:` prefix serviceMac adds. Poker builds the same string. */
export function canHostMessage(id: string, ts: number | string): string {
  return `hosting:can-host:${id}:${ts}`;
}

export function hostingRoutes(now: () => number = Date.now): express.Router {
  const r = express.Router();

  r.get('/can-host', (req, res) => {
    const id = String(req.query.id ?? '');
    const tsRaw = String(req.get('x-chog-timestamp') ?? '');
    const sig = String(req.get('x-chog-signature') ?? '');
    if (!id || id.length > 64 || !/^\d{10,16}$/.test(tsRaw) || !sig || sig.length > 128) {
      res.status(401).json({ error: 'Signed request required' });
      return;
    }
    if (!sameMac(sig, serviceMac(canHostMessage(id, tsRaw)))) {
      res.status(401).json({ error: 'Bad signature — are APP_SECRET (hub) and CHOG_SECRET (poker) the same?' });
      return;
    }
    if (Math.abs(now() - Number(tsRaw)) > HOSTING_MAX_SKEW_MS) {
      res.status(401).json({ error: 'Stale request — check both servers\' clocks' });
      return;
    }
    const reason = hostingReason(id);
    refreshHoldingsInBackground(id);
    res.json({ canHost: reason !== null, reason });
  });

  return r;
}
