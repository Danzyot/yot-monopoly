// Operator API. Every route checks the caller is an operator, and every
// change is written to the durable "admin" log with who did it.
import express from 'express';
import { addBan, listBans, removeBan, type BanKind, type BanScope } from '../bans.ts';
import { listMutes, setMute } from '../chat.ts';
import { forgetAccount, getAccount, searchAccounts, sharedIpGroups } from '../connections.ts';
import { botEnabled, postVerifyMessage, sendDirectMessage } from '../discord.ts';
import { eventsForGame, loggedGames } from '../eventlog.ts';
import { getFeatures, setFeatures } from '../features.ts';
import { adminLog, fail, requireAdmin } from '../http.ts';
import { lastSnapshotAge } from '../persist.ts';
import type { SocketLayer } from '../sockets.ts';
import { recentResults } from '../stats.ts';
import { getMap } from '../../../shared/maps.ts';
import { getTheme } from '../../../shared/themes.ts';
import type { Features } from '../../../shared/types.ts';
import { DATA_DIR } from '../paths.ts';
import { existsSync } from 'node:fs';

export function adminRoutes(sockets: SocketLayer, loopLag: () => number): express.Router {
  const r = express.Router();
  const { registry } = sockets;

  // Everything below is operators-only.
  r.use((req, res, next) => {
    const p = requireAdmin(req, res);
    if (!p) return;
    res.locals.admin = p;
    next();
  });
  const who = (res: express.Response) => res.locals.admin;

  r.get('/overview', (_req, res) => {
    const mem = process.memoryUsage();
    const rooms = [...registry.rooms.values()];
    res.json({
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / 1048576),
      heapMb: Math.round(mem.heapUsed / 1048576),
      loopLagMs: loopLag(),
      sockets: sockets.connectedCount(),
      rooms: rooms.length,
      playing: rooms.filter(x => x.status === 'playing').length,
      players: rooms.reduce((a, x) => a + x.seats.filter(s => !s.isBot && s.connected).length, 0),
      dataDir: DATA_DIR,
      persistentDisk: !!process.env.DATA_DIR && existsSync(DATA_DIR),
      lastSnapshotAgeMs: lastSnapshotAge(),
      discordBot: botEnabled(),
    });
  });

  // ---- rooms ----
  r.get('/rooms', (_req, res) => {
    res.json([...registry.rooms.values()].map(x => ({
      code: x.code,
      status: x.status,
      map: getMap(x.mapId).name,
      edition: getTheme(x.themeId).name,
      private: x.private,
      hostId: x.hostId,
      hostName: x.hostName(),
      createdAt: x.createdAt,
      startedAt: x.startedAt,
      turn: x.game?.turnNumber ?? 0,
      spectators: x.spectators,
      seats: x.seats.map(s => ({
        id: s.id, name: s.name, isBot: s.isBot, connected: s.connected, color: s.color,
        cash: x.game?.players.find(p => p.id === s.id)?.cash ?? null,
        bankrupt: x.game?.players.find(p => p.id === s.id)?.bankrupt ?? false,
      })),
    })).sort((a, b) => b.createdAt - a.createdAt));
  });

  r.post('/rooms/:code/end', (req, res) => {
    const room = registry.get(req.params.code);
    if (!room) { res.status(404).json({ error: 'No such room' }); return; }
    const reason = String(req.body?.reason ?? '').slice(0, 200) || 'no reason given';
    room.end(reason);
    sockets.broadcast(room);
    adminLog(who(res), `ended room ${room.code}: ${reason}`);
    res.json({ ok: true });
  });

  r.delete('/rooms/:code', (req, res) => {
    const room = registry.get(req.params.code);
    if (!room) { res.status(404).json({ error: 'No such room' }); return; }
    room.end('room closed');
    sockets.broadcast(room);
    registry.delete(room.code);
    adminLog(who(res), `closed room ${room.code}`);
    res.json({ ok: true });
  });

  r.post('/rooms/:code/kick', (req, res) => {
    const room = registry.get(req.params.code);
    if (!room) { res.status(404).json({ error: 'No such room' }); return; }
    const id = String(req.body?.id ?? '');
    const seat = room.seat(id);
    if (!seat) { res.status(404).json({ error: 'Not in that room' }); return; }
    try {
      room.remove(id);
      sockets.broadcast(room);
      adminLog(who(res), `removed ${seat.name} (${id}) from ${room.code}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  r.get('/online', (_req, res) => res.json(sockets.online()));

  // ---- accounts / audit ----
  r.get('/accounts', (req, res) => res.json(searchAccounts(String(req.query.q ?? ''))));

  r.get('/accounts/:id', (req, res) => {
    const acc = getAccount(req.params.id);
    if (!acc) { res.status(404).json({ error: 'Unknown account' }); return; }
    const ips = new Set(Object.keys(acc.ips));
    res.json({
      account: acc,
      bans: listBans().filter(b => b.value === acc.id || b.value === acc.discordId || (b.kind === 'ip' && ips.has(b.value))),
      rooms: registry.roomsOf(acc.id).map(x => ({ code: x.code, status: x.status })),
      // Other accounts that have used any of the same addresses.
      linked: sharedIpGroups().filter(g => ips.has(g.ip)).flatMap(g => g.accounts).filter(a => a.id !== acc.id)
        .filter((a, i, all) => all.findIndex(b => b.id === a.id) === i),
    });
  });

  r.delete('/accounts/:id', (req, res) => {
    const ok = forgetAccount(req.params.id);
    if (ok) adminLog(who(res), `erased audit history of ${req.params.id}`);
    res.json({ ok });
  });

  r.get('/alts', (_req, res) => res.json(sharedIpGroups().slice(0, 300)));

  // ---- bans ----
  r.get('/bans', (_req, res) => res.json(listBans()));

  r.post('/bans', (req, res) => {
    try {
      const b = req.body ?? {};
      const kind: BanKind = b.kind === 'ip' ? 'ip' : 'player';
      const scope: BanScope = b.scope === 'room' ? 'room' : 'lifetime';
      const hours = Number(b.durationHours);
      const ban = addBan({
        kind, scope,
        value: String(b.value ?? ''),
        gameId: scope === 'room' ? String(b.gameId ?? '').toUpperCase() : null,
        gameName: scope === 'room' ? String(b.gameId ?? '').toUpperCase() : '',
        name: String(b.name ?? ''),
        reason: String(b.reason ?? ''),
        by: who(res).name,
        expiresAt: Number.isFinite(hours) && hours > 0 ? Date.now() + hours * 3_600_000 : null,
      });
      const hit = sockets.enforceBan(ban);
      adminLog(who(res), `banned ${ban.kind} ${ban.value}${ban.name ? ` (${ban.name})` : ''} — ${ban.scope}${ban.gameId ? ` ${ban.gameId}` : ''}`
        + `${ban.expiresAt ? ` until ${new Date(ban.expiresAt).toISOString()}` : ''}${ban.reason ? `: ${ban.reason}` : ''}`);
      res.json({ ban, disconnected: hit });
    } catch (e) { fail(res, e); }
  });

  r.delete('/bans', (req, res) => {
    const b = req.body ?? {};
    const kind: BanKind = b.kind === 'ip' ? 'ip' : 'player';
    const scope: BanScope = b.scope === 'room' ? 'room' : 'lifetime';
    const ok = removeBan(kind, String(b.value ?? ''), scope, scope === 'room' ? String(b.gameId ?? '') : null);
    if (ok) adminLog(who(res), `lifted ${scope} ${kind} ban on ${b.value}`);
    res.json({ ok });
  });

  // ---- chat moderation ----
  r.get('/mutes', (_req, res) => res.json(listMutes()));

  r.post('/mutes', (req, res) => {
    const id = String(req.body?.id ?? '');
    if (!id) { res.status(400).json({ error: 'Who?' }); return; }
    const minutes = req.body?.minutes === null ? null : Number(req.body?.minutes ?? 60);
    setMute(id, String(req.body?.name ?? id), minutes, who(res).name);
    adminLog(who(res), minutes === 0 ? `unmuted ${id}` : `muted ${id} ${minutes ? `for ${minutes} min` : 'indefinitely'}`);
    res.json({ ok: true });
  });

  // ---- logs ----
  r.get('/events', (_req, res) => res.json(loggedGames()));
  r.get('/events/:code', (req, res) => res.json(eventsForGame(req.params.code).slice(-5_000)));
  r.get('/results', (_req, res) => res.json(recentResults(100)));

  // ---- features ----
  r.get('/features', (_req, res) => res.json(getFeatures()));
  r.put('/features', (req, res) => {
    try {
      const before = getFeatures();
      const next = setFeatures((req.body ?? {}) as Partial<Features>);
      const changed = (Object.keys(next) as (keyof Features)[]).filter(k => next[k] !== before[k]);
      if (changed.length) adminLog(who(res), `features: ${changed.map(k => `${k}=${next[k] ? 'on' : 'off'}`).join(', ')}`);
      res.json(next);
    } catch (e) { fail(res, e, 500); }
  });

  // ---- Discord ----
  r.post('/discord/verify-panel', async (req, res) => {
    try {
      const channel = String(req.body?.channelId ?? process.env.DISCORD_VERIFY_CHANNEL_ID ?? '').trim();
      if (!channel) throw new Error('Which channel? Set DISCORD_VERIFY_CHANNEL_ID or pass channelId');
      await postVerifyMessage(channel, process.env.PUBLIC_URL?.trim() || null);
      adminLog(who(res), `posted the Verify panel in channel ${channel}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  r.post('/dm', async (req, res) => {
    try {
      const to = String(req.body?.discordId ?? '');
      await sendDirectMessage(to, String(req.body?.text ?? ''));
      adminLog(who(res), `sent a Discord DM to ${to}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  return r;
}
