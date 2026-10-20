// The "Your Chog" picker's two endpoints. The rules live in chogs.ts.
import type express from 'express';
import { verifyToken } from './auth.ts';
import { choosePick, chogsEnabled, heldChogs, isChogToken, pickOf, takeChogRefresh } from './chogs.ts';
import { hubUrl } from './hub.ts';

function me(req: express.Request) {
  const header = req.headers.authorization;
  return verifyToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
}

export function mountChogs(app: express.Express): void {
  // { enabled, artBase, pick, chogs, reachable }. ?refresh=1 re-asks the hub,
  // at most every half minute per player.
  app.get('/api/chogs', async (req, res) => {
    const p = me(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return; }
    if (!chogsEnabled()) {
      res.json({ enabled: false, artBase: null, pick: null, chogs: [], reachable: false });
      return;
    }
    const force = req.query.refresh === '1' && takeChogRefresh(p.id);
    const h = await heldChogs(p.id, force);
    res.json({ enabled: true, artBase: hubUrl(), pick: pickOf(p.id), chogs: h.chogs, reachable: h.ok });
  });

  // { chogToken: number | null }. Only a Chog the hub says this player holds.
  app.post('/api/chogs/pick', async (req, res) => {
    const p = me(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return; }
    const raw = (req.body ?? {}).chogToken;
    if (raw === null || raw === undefined) {
      choosePick(p.id, null);
      res.json({ pick: null, chog: null });
      return;
    }
    if (!isChogToken(raw)) { res.status(400).json({ error: 'That is not a Chog' }); return; }
    if (!chogsEnabled()) { res.status(503).json({ error: 'Chog avatars are not set up on this room' }); return; }
    const h = await heldChogs(p.id);
    if (!h.ok) { res.status(503).json({ error: 'Could not reach Chog Games to check your Chogs — try again in a moment' }); return; }
    const chog = h.chogs.find(c => c.chogToken === raw);
    if (!chog) { res.status(403).json({ error: `Chog #${raw} is not in your linked wallets` }); return; }
    choosePick(p.id, raw);
    res.json({ pick: raw, chog });
  });
}
