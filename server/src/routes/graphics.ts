// Graphics library routes.
//
//   operators:  GET/POST /api/admin/graphics, PATCH/DELETE /api/admin/graphics/:id
//   public:     GET /api/graphics          (what hosts pick from in the lobby)
//               GET /graphics/lib/:file    (the images themselves)
//
// Mounted in one call from index.ts, before the SPA fallback and the /api 404.
import express from 'express';
import {
  MAX_GRAPHIC_BYTES, addGraphic, graphicFilePath, graphicUrl, listGraphics, removeGraphic, renameGraphic,
} from '../graphics.ts';
import { adminLog, fail, requireAdmin } from '../http.ts';
import type { SocketLayer } from '../sockets.ts';

export function mountGraphics(app: express.Express, sockets: SocketLayer): void {
  // The global JSON parser only claims application/json, so an image body
  // reaches this raw parser untouched. The limit is enforced while streaming,
  // so an oversized upload is cut off rather than buffered whole.
  const rawImage = express.raw({ type: () => true, limit: MAX_GRAPHIC_BYTES });

  app.get('/api/admin/graphics', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(listGraphics().map(g => ({ ...g, url: graphicUrl(g) })));
  });

  app.post('/api/admin/graphics', (req, res) => {
    // Check who is asking before reading 8 MB from them.
    const who = requireAdmin(req, res);
    if (!who) return;
    rawImage(req, res, (err?: unknown) => {
      if (err) {
        const tooBig = (err as { type?: string }).type === 'entity.too.large';
        res.status(413).json({
          error: tooBig ? `Image too large (max ${MAX_GRAPHIC_BYTES / 1048576} MB)` : 'The upload was interrupted — try again',
        });
        return;
      }
      try {
        const row = addGraphic(String(req.query.name ?? ''), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), who.name);
        adminLog(who, `uploaded image "${row.name}" (${row.file}, ${Math.round(row.size / 1024)} KB)`);
        res.json({ ...row, url: graphicUrl(row) });
      } catch (e) { fail(res, e); }
    });
  });

  app.patch('/api/admin/graphics/:id', (req, res) => {
    const who = requireAdmin(req, res);
    if (!who) return;
    try {
      const row = renameGraphic(String(req.params.id), String(req.body?.name ?? ''));
      adminLog(who, `renamed image ${row.file} to "${row.name}"`);
      res.json({ ...row, url: graphicUrl(row) });
    } catch (e) { fail(res, e); }
  });

  app.delete('/api/admin/graphics/:id', (req, res) => {
    const who = requireAdmin(req, res);
    if (!who) return;
    try {
      const row = removeGraphic(String(req.params.id));
      if (!row) { res.status(404).json({ error: 'No such image' }); return; }
      // Rooms pointing at it fall back to their edition's look now, rather
      // than every viewer requesting a file that 404s.
      const url = graphicUrl(row);
      let rooms = 0;
      for (const room of sockets.registry.rooms.values()) {
        if (room.style.boardLogoUrl !== url && room.style.backgroundUrl !== url) continue;
        room.style = {
          ...room.style,
          boardLogoUrl: room.style.boardLogoUrl === url ? null : room.style.boardLogoUrl,
          backgroundUrl: room.style.backgroundUrl === url ? null : room.style.backgroundUrl,
        };
        sockets.broadcast(room);
        rooms++;
      }
      adminLog(who, `deleted image "${row.name}" (${row.file})${rooms ? `, cleared from ${rooms} room(s)` : ''}`);
      res.json({ ok: true, rooms });
    } catch (e) { fail(res, e, 500); }
  });

  // Public list for the lobby's Table style picker. Names and URLs only.
  app.get('/api/graphics', (_req, res) => {
    res.json(listGraphics().map(g => ({ id: g.id, name: g.name, url: graphicUrl(g) })));
  });

  // File names are random and never reused, so the bytes behind a URL never
  // change: cache them for a year.
  app.get('/graphics/lib/:file', (req, res) => {
    const full = graphicFilePath(String(req.params.file));
    if (!full) { res.status(404).end(); return; }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Only this site embeds them; other origins may not hot-link the library.
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.sendFile(full);
  });
}
