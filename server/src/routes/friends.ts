// Friends over HTTP and the socket (../friends.ts holds the rules):
//   GET  /api/friends              your friends (online, which game, a joinable table), requests both ways
//   GET  /api/friends/status/:id   how you stand with one player (the profile's button)
//   POST /api/friends/request {id} ask, or accept at once if they asked you
//   POST /api/friends/accept {id}
//   POST /api/friends/remove {id}  unfriend, decline or cancel
//   socket friends:invite {id}     from your table: the friend gets friends:invited with its code
// Whenever a list changes, both people's tabs hear friends:changed and fetch it again.
import express from 'express';
import type { Server, Socket } from 'socket.io';
import { getAccount } from '../connections.ts';
import { FriendError, FriendStore, type FriendGame } from '../friends.ts';
import { authed, fail, rateLimit } from '../http.ts';
import { playerBanned } from '../playerCard.ts';
import type { Registry } from '../rooms.ts';
import type { CardsRegistry } from '../cards/rooms.ts';
import type { PlayerProfile } from '../../../shared/types.ts';

/** One invite per friend per this long, from the same player. */
export const INVITE_EVERY_MS = 20_000;

interface PresenceData { profile?: PlayerProfile | null; room?: string | null; cardsRoom?: string | null }

export interface FriendsDepsLive {
  monopoly: Pick<Registry, 'get'>;
  cards: Pick<CardsRegistry, 'get'>;
}

export function mountFriends(
  app: express.Express, io: Server, d: FriendsDepsLive, file: string | null = 'friends.json',
): { store: FriendStore; changed: (...ids: string[]) => void } {
  const socketsOf = (id: string): Socket[] =>
    [...io.sockets.sockets.values()].filter(s => (s.data as PresenceData).profile?.id === id);

  const store = new FriendStore({
    account: id => {
      const a = getAccount(id);
      return a ? { name: a.name, avatar: a.avatar } : null;
    },
    banned: playerBanned,
    presence: id => {
      const mine = socketsOf(id);
      if (!mine.length) return { online: false };
      for (const s of mine) {
        const data = s.data as PresenceData;
        if (data.room && d.monopoly.get(data.room)) return { online: true, game: 'monopoly', code: data.room };
        if (data.cardsRoom && d.cards.get(data.cardsRoom)) return { online: true, game: 'cards', code: data.cardsRoom };
      }
      return { online: true };
    },
    joinable: (game, code) => {
      if (game === 'monopoly') {
        const r = d.monopoly.get(code);
        return !!r && !r.private && r.status === 'lobby' && !r.requirements && r.seats.length < r.rules.maxPlayers;
      }
      const r = d.cards.get(code);
      return !!r && !r.private && r.status === 'lobby' && !r.tournament && !r.daily && r.seats.length < r.maxPlayers;
    },
  }, file);
  store.load();

  const changed = (...ids: string[]) => {
    for (const id of ids) for (const s of socketsOf(id)) s.emit('friends:changed');
  };

  const r = express.Router();
  r.use(rateLimit(120, 60_000));
  const me = (req: express.Request, res: express.Response): PlayerProfile | null => {
    const p = authed(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return null; }
    if (playerBanned(p.id)) { res.status(403).json({ error: 'You cannot use friends' }); return null; }
    return p;
  };
  const other = (req: express.Request) => String(req.body?.id ?? '').slice(0, 64);
  const handle = (res: express.Response, f: () => unknown) => {
    try { res.json(f()); } catch (e) { fail(res, e, e instanceof FriendError ? 400 : 500); }
  };

  r.get('/', (req, res) => {
    const p = me(req, res);
    if (p) res.json(store.view(p.id));
  });
  r.get('/status/:id', (req, res) => {
    const p = me(req, res);
    if (p) res.json({ status: store.status(p.id, String(req.params.id)) });
  });
  r.post('/request', rateLimit(30, 60 * 60_000), (req, res) => {
    const p = me(req, res);
    if (p) handle(res, () => { const id = other(req); const status = store.request(p.id, id); changed(p.id, id); return { status }; });
  });
  r.post('/accept', (req, res) => {
    const p = me(req, res);
    if (p) handle(res, () => { const id = other(req); store.accept(p.id, id); changed(p.id, id); return { status: 'friends' }; });
  });
  r.post('/remove', (req, res) => {
    const p = me(req, res);
    if (p) handle(res, () => { const id = other(req); const removed = store.remove(p.id, id); if (removed) changed(p.id, id); return { removed }; });
  });
  app.use('/api/friends', r);

  // Invites: from the table you are at, to a friend who is online.
  const lastInvite = new Map<string, number>();
  io.on('connection', socket => {
    socket.on('friends:invite', (payload: unknown, ack?: (r: unknown) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const data = socket.data as PresenceData;
      const p = data.profile;
      const to = String((payload as { id?: unknown } | null)?.id ?? '').slice(0, 64);
      if (!p) return reply({ ok: false, error: 'Sign in first' });
      if (playerBanned(p.id) || !store.areFriends(p.id, to)) return reply({ ok: false, error: 'You can only invite friends' });
      let game: FriendGame | null = null;
      let code: string | null = null;
      if (data.room && d.monopoly.get(data.room)?.seats.some(s => s.id === p.id)) { game = 'monopoly'; code = data.room; }
      else if (data.cardsRoom && d.cards.get(data.cardsRoom)?.seats.some(s => s.id === p.id)) { game = 'cards'; code = data.cardsRoom; }
      if (!game || !code) return reply({ ok: false, error: 'Sit at a table first' });
      const key = `${p.id}|${to}`;
      const now = Date.now();
      if (now - (lastInvite.get(key) ?? 0) < INVITE_EVERY_MS) return reply({ ok: false, error: 'You just invited them — give them a moment' });
      const targets = socketsOf(to);
      if (!targets.length) return reply({ ok: false, error: 'They are not online right now' });
      if (lastInvite.size > 20_000) lastInvite.clear();
      lastInvite.set(key, now);
      for (const s of targets) s.emit('friends:invited', { from: { id: p.id, name: p.name, avatar: p.avatar }, game, code });
      reply({ ok: true });
    });
  });
  return { store, changed };
}
