// GET is public so every visitor sees the edits; PUT is for signed-in players
// and only exists while DEMO_MODE=1.
import express from 'express';
import { demoMode } from '../auth.ts';
import { authed, fail, rateLimit } from '../http.ts';
import { findBan, banMessage } from '../bans.ts';
import { getTextOverrides, loadTextOverrides, setTextOverride } from '../textOverrides.ts';

export function mountTextOverrides(app: express.Express): void {
  loadTextOverrides();

  app.get('/api/text-overrides', (_req, res) => {
    res.json({ overrides: getTextOverrides() });
  });

  app.put('/api/text-overrides', rateLimit(30, 60_000), (req, res) => {
    if (!demoMode()) { res.status(404).json({ error: 'Not found' }); return; }
    const p = authed(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return; }
    const ban = findBan({ id: p.id, discordId: p.discord?.id, ip: req.ip });
    if (ban) { res.status(403).json({ error: banMessage(ban) }); return; }
    try {
      const body = (req.body ?? {}) as { original?: unknown; text?: unknown };
      res.json({ overrides: setTextOverride(body.original, body.text) });
    } catch (e) { fail(res, e); }
  });
}
