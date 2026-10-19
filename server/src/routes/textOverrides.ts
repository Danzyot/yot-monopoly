// GET is public so every visitor sees the edits; PUT is for operators only
// (with ADMIN_DISCORD_IDS unset that is every signed-in account outside
// production) and only exists while DEMO_MODE=1.
import express from 'express';
import { demoMode } from '../auth.ts';
import { fail, rateLimit, requireAdmin } from '../http.ts';
import { getTextOverrides, loadTextOverrides, setTextOverride } from '../textOverrides.ts';

export function mountTextOverrides(app: express.Express): void {
  loadTextOverrides();

  app.get('/api/text-overrides', (_req, res) => {
    res.json({ overrides: getTextOverrides() });
  });

  app.put('/api/text-overrides', rateLimit(30, 60_000), (req, res) => {
    if (!demoMode()) { res.status(404).json({ error: 'Not found' }); return; }
    // Overrides rewrite the site for every visitor, so only operators may save them.
    if (!requireAdmin(req, res)) return;
    try {
      const body = (req.body ?? {}) as { original?: unknown; text?: unknown };
      res.json({ overrides: setTextOverride(body.original, body.text) });
    } catch (e) { fail(res, e); }
  });
}
