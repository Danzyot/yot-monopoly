// Music routes: the operator's library API plus the two public routes every
// player's music widget reads. Mounted on the app (not a sub-router) because
// it spans /api/admin/music and the public /music/* paths.
import express from 'express';
import { isOn } from '../features.ts';
import { adminLog, fail, requireAdmin } from '../http.ts';
import {
  MAX_SONG_BYTES, addSong, getSong, listPlaylists, listSongs, loadSongs, manifestRows,
  removeSong, renamePlaylist, songFilePath, updateSong,
} from '../music.ts';

// Name and playlist ride in the query string or in headers, because the body
// is the raw audio. Headers are URI-encoded by the client so non-ASCII titles
// survive (header values are Latin-1 only).
function param(req: express.Request, query: string, header: string): string {
  const q = req.query[query];
  if (typeof q === 'string' && q) return q;
  const h = req.get(header);
  if (!h) return '';
  try { return decodeURIComponent(h); } catch { return h; }
}

export function mountMusic(app: express.Express): void {
  loadSongs();

  app.get('/api/admin/music', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ songs: listSongs(), playlists: listPlaylists(), maxBytes: MAX_SONG_BYTES });
  });

  // The raw parser lives on this route only: everywhere else the 64 kB JSON
  // limit stays in force. It runs by hand so its failures (too large, upload
  // cut off) come back as JSON the dashboard can show, not an HTML error page.
  const rawBody = express.raw({ type: () => true, limit: MAX_SONG_BYTES });
  app.post('/api/admin/music', (req, res) => {
    // Check the operator first so strangers cannot make us buffer 40 MB.
    const by = requireAdmin(req, res);
    if (!by) return;
    rawBody(req, res, (err?: unknown) => {
      if (err) {
        const type = (err as { type?: string }).type;
        res.status(413).json({
          error: type === 'entity.too.large'
            ? `File too large (max ${Math.round(MAX_SONG_BYTES / 1048576)} MB)`
            : 'The upload was interrupted before it finished — try again',
        });
        return;
      }
      try {
        const row = addSong(
          param(req, 'name', 'x-song-name'),
          param(req, 'playlist', 'x-playlist'),
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
        );
        adminLog(by, `uploaded song "${row.name}" to playlist "${row.playlist}" (${Math.round(row.size / 1024)} kB)`);
        res.json({ song: row });
      } catch (e) { fail(res, e); }
    });
  });

  // Registered before the /:id routes, which would otherwise take
  // "playlists" for a song id.
  app.get('/api/admin/music/playlists', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ playlists: listPlaylists() });
  });

  app.patch('/api/admin/music/playlists', (req, res) => {
    const by = requireAdmin(req, res);
    if (!by) return;
    try {
      const from = String(req.body?.from ?? '');
      const to = String(req.body?.to ?? '');
      const moved = renamePlaylist(from, to);
      if (moved) adminLog(by, `renamed playlist "${from.trim()}" to "${to.trim()}" (${moved} songs)`);
      res.json({ moved, playlists: listPlaylists() });
    } catch (e) { fail(res, e); }
  });

  app.patch('/api/admin/music/:id', (req, res) => {
    const by = requireAdmin(req, res);
    if (!by) return;
    const before = getSong(String(req.params.id));
    if (!before) { res.status(404).json({ error: 'No such song' }); return; }
    const was = { name: before.name, playlist: before.playlist };
    try {
      const row = updateSong(before.id, {
        name: typeof req.body?.name === 'string' ? req.body.name : undefined,
        playlist: typeof req.body?.playlist === 'string' ? req.body.playlist : undefined,
      })!;
      const changes: string[] = [];
      if (row.name !== was.name) changes.push(`renamed "${was.name}" to "${row.name}"`);
      if (row.playlist !== was.playlist) changes.push(`moved "${row.name}" from "${was.playlist}" to "${row.playlist}"`);
      if (changes.length) adminLog(by, `music: ${changes.join('; ')}`);
      res.json({ song: row });
    } catch (e) { fail(res, e, 500); }
  });

  app.delete('/api/admin/music/:id', (req, res) => {
    const by = requireAdmin(req, res);
    if (!by) return;
    try {
      const row = removeSong(String(req.params.id));
      if (!row) { res.status(404).json({ error: 'No such song' }); return; }
      adminLog(by, `deleted song "${row.name}" from playlist "${row.playlist}"`);
      res.json({ ok: true });
    } catch (e) { fail(res, e, 500); }
  });

  // Public: what the player can play. Empty when the operator switched music
  // off, so the widget has nothing to offer (it hides itself anyway).
  app.get('/music/manifest.json', (_req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(isOn('music') ? manifestRows() : []);
  });

  // Public: the audio itself. sendFile answers Range requests, so seeking and
  // Safari's range-only media loading both work.
  app.get('/music/lib/:file', (req, res) => {
    const full = isOn('music') ? songFilePath(String(req.params.file)) : null;
    if (!full) { res.status(404).end(); return; }
    // Filenames are random and never reused, so the bytes behind one never change.
    res.sendFile(full, { maxAge: '7d', immutable: true });
  });
}
