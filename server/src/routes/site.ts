// The site's info pages (/terms, /privacy, /fair-play: public to read,
// operators edit them from Dashboard → Pages) and the client's crash reports
// (the app's error screen posts one; they land in the event log under
// "client-errors", where Dashboard → Logs shows them).
import express from 'express';
import { isLegalSlug } from '../../../shared/legal.ts';
import { logGameEvent } from '../eventlog.ts';
import { adminLog, authed, fail, rateLimit, requireAdmin } from '../http.ts';
import { getLegal, loadLegal, resetLegal, setLegal } from '../legal.ts';

/** One line of text, control characters out, cut to `max`. */
function line(raw: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '';
}

/** A crash report as one log line, or null when there is nothing in it. */
export function clientErrorLine(body: unknown, who: string | null): string | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const message = line(b.message, 300);
  if (!message) return null;
  const path = line(b.path, 120);
  const where = line(b.where, 200);
  const ua = line(b.ua, 160);
  return [`${message}`, path && `at ${path}`, where && `in ${where}`, who && `by ${who}`, ua && `(${ua})`].filter(Boolean).join(' · ');
}

export function mountSite(app: express.Express): void {
  loadLegal();

  app.get('/api/pages/:slug', (req, res) => {
    if (!isLegalSlug(req.params.slug)) { res.status(404).json({ error: 'No such page' }); return; }
    res.json({ page: getLegal(req.params.slug) });
  });

  app.put('/api/admin/pages/:slug', rateLimit(30, 60_000), (req, res) => {
    const op = requireAdmin(req, res);
    if (!op) return;
    try {
      const body = (req.body ?? {}) as { title?: unknown; body?: unknown };
      const page = setLegal(req.params.slug, body.title, body.body);
      adminLog(op, `pages: edited /${page.slug}`);
      res.json({ page });
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/admin/pages/:slug', rateLimit(30, 60_000), (req, res) => {
    const op = requireAdmin(req, res);
    if (!op) return;
    try {
      const page = resetLegal(req.params.slug);
      adminLog(op, `pages: reset /${page.slug} to the default`);
      res.json({ page });
    } catch (e) { fail(res, e); }
  });

  // A handful a minute per address is plenty for real crashes and keeps a
  // broken page in a loop from filling the log.
  app.post('/api/client-error', rateLimit(5, 60_000), (req, res) => {
    const who = authed(req);
    const text = clientErrorLine(req.body, who ? `${who.name} (${who.id})` : null);
    if (text) logGameEvent('client-errors', 'Client errors', text);
    res.status(204).end();
  });
}
