// Content overrides (dashboard → Content). GET is public: every client merges
// the overrides into its theme resolution at start-up. Saving and resetting
// are for operators only, and each change goes in the operator log.
import express from 'express';
import { getContent, describeItem, loadContent, resetContent, setContent } from '../content.ts';
import { adminLog, fail, rateLimit, requireAdmin } from '../http.ts';

export function mountContent(app: express.Express): void {
  loadContent();

  app.get('/api/content', (_req, res) => {
    res.json({ overrides: getContent() });
  });

  app.put('/api/admin/content', rateLimit(120, 60_000), (req, res) => {
    const op = requireAdmin(req, res);
    if (!op) return;
    try {
      const body = (req.body ?? {}) as { item?: unknown; text?: unknown };
      const r = setContent(body.item, body.text);
      adminLog(op, r.text === null ? `content: reset ${describeItem(r.item)}` : `content: ${describeItem(r.item)} = “${r.text}”`);
      res.json({ overrides: r.overrides });
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/admin/content', rateLimit(30, 60_000), (req, res) => {
    const op = requireAdmin(req, res);
    if (!op) return;
    try {
      const kind = ((req.body ?? {}) as { kind?: unknown }).kind;
      const overrides = resetContent(kind);
      adminLog(op, `content: reset ${typeof kind === 'string' ? `all ${kind} overrides` : 'everything'}`);
      res.json({ overrides });
    } catch (e) { fail(res, e); }
  });
}
