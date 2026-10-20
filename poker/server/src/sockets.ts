import type { Server, Socket } from 'socket.io';
import type { ChatMsg, PlayerProfile } from '../../shared/types.ts';
import { noteGame, noteSeen, playerRows } from './audit.ts';
import { chatEnabled } from './chatrules.ts';
import { verifyToken } from './auth.ts';
import { banMessage, findBan } from './bans.ts';
import { isOn } from './features.ts';
import { discordEnabled, guildMembership } from './discord.ts';
import { Table } from './engine/table.ts';
import { sanitizeTheme } from './graphics.ts';
import { playerConnected, playerDisconnected } from './presence.ts';
import { isInfraPeer, normalisePeer } from './net.ts';
import { noteIpSample } from './ipdebug.ts';
import { type DirectorAction, mayDirect, PLAYER_SETTINGS, playerScheduledStart } from './hosting.ts';
import { registry } from './registry.ts';
import { Tournament } from './tournament/tournament.ts';

interface SocketData {
  profile: PlayerProfile | null;
}

type IO = Server;
type Sock = Socket<Record<string, (...args: never[]) => void>, Record<string, (...args: unknown[]) => void>, Record<string, never>, SocketData>;

const tableRoom = (id: string) => `table:${id}`;
const tourneyRoom = (id: string) => `tourney:${id}`;
const tablesRoom = (id: string) => `tables:${id}`;
const LOBBY = 'lobby';

// Who may reverse a turn or move chips at a table. Both are powers that
// rewrite the game, so the rule is deliberately narrow and lives here on its
// own where it can be tested: the table's own host, or the site operator.
// Tournament tables carry no hostId, so there the operator flag is the only
// way in — a player at one must never qualify by default. Nor does the host
// of a player-hosted table: a host who can move chips at their own table can
// pay themselves.
export function mayRunTable(
  hostId: string | null,
  me: { id: string; isAdmin?: boolean },
  playerHosted = false,
): boolean {
  if (me.isAdmin === true) return true;
  return !playerHosted && hostId !== null && hostId === me.id;
}

// ---------- abuse limits ----------
// Per-address connection caps, split by whether the socket has signed in.
//
// A single hard cap is wrong for a large community: mobile carriers put
// thousands of users behind one address, so a strict limit would lock out
// real players who did nothing but open the site on 4G. But an anonymous
// flood is exactly what a cheap denial-of-service looks like, and it costs
// the attacker nothing.
//
// So the two are treated differently. Signing in with Discord is the work an
// attacker will not do at scale, and it buys a far higher ceiling. Both are
// env-tunable, because the right number depends on the audience — raise
// CHOG_MAX_SOCKETS_PER_IP if a shared network ever gets squeezed.
const num = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
};
const MAX_ANON_PER_IP = num('CHOG_MAX_ANON_SOCKETS_PER_IP', 12);
const MAX_AUTHED_PER_IP = num('CHOG_MAX_SOCKETS_PER_IP', 250);
const socketsPerIp = new Map<string, number>();

// Per-socket event budget. A player at a table generates a handful of events
// a second at the very most — a raise, a chat line, a reaction. This is set
// well above that, and a socket that keeps blowing through it is dropped
// rather than merely ignored, so the flood costs the sender its connection.
const EVENT_BUDGET = 40;      // events per window
const EVENT_WINDOW_MS = 2_000;
const STRIKES_BEFORE_DROP = 3;

// Held so a ban landing mid-game can reach the connections that are already
// open, instead of waiting for the banned player's next action.
let liveIo: IO | null = null;

// Cut off everyone a ban now matches. Called right after a ban is stored.
export function disconnectBanned(): number {
  if (!liveIo) return 0;
  let cut = 0;
  for (const sock of liveIo.sockets.sockets.values()) {
    const d = sock.data as SocketData & { ip?: string | null };
    const p = d.profile;
    const b = findBan({ id: p?.id ?? null, discordId: p?.discord?.id ?? null, ip: d.ip ?? null });
    if (!b) continue;
    sock.emit('toast', { kind: 'error', text: banMessage(b) });
    sock.emit('banned', { reason: b.reason || null });
    setTimeout(() => sock.disconnect(true), 250);
    cut += 1;
  }
  return cut;
}

// Is the thing we are directly talking to a proxy on our own network? Only
// then is X-Forwarded-For worth anything: a public peer means the connection
// reached us directly and the header is unverified client input.
// Recognising our own plumbing lives in net.ts so the audit can share it
// without importing this module, which imports the audit in turn.
//
// 100.64.0.0/10 is the range that matters: carrier-grade NAT, what Railway's
// proxy talks to us from. It was missing, so the proxy looked like a member of
// the public, X-Forwarded-For was discarded as untrustworthy, and the proxy's
// own address went into the audit — collapsing every player onto one row and,
// here, onto one bucket of the per-address connection cap.
export { normalisePeer, isInfraPeer } from './net.ts';
export const isLocalPeer = isInfraPeer;

// How many proxies sit in front of this server, each of which appends one
// entry to X-Forwarded-For. Railway alone is one. Put Cloudflare in front and
// it becomes two — and if this is not raised to match, the address read back
// is Cloudflare's rather than the player's, which would ban the proxy instead
// of the person, collapse every visitor into one address for the per-IP cap,
// and file the whole room as alt accounts of each other.
// How much conversation a joining or reconnecting client is given back.
// Matches the window the client keeps, so re-subscribing restores the panel
// rather than truncating it.
const CHAT_BACKLOG = 300;

export function trustedProxyHops(): number {
  // Default 2: every deployment sits behind the custom-domain edge in front
  // of Railway, and the first live event proved 1 records the edge instead of
  // the player. Direct railway.app access still resolves correctly at 2 —
  // a short chain falls through to the proxy's own statement of the caller.
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.min(5, Math.max(1, Math.trunc(raw)));
}

// The address to hold a player to, from the right-hand end of the chain.
//
// X-Forwarded-For is appended to by each proxy, so the right-hand end is what
// our own infrastructure observed and the left-hand end is whatever the client
// typed. Reading [0] meant the address was chosen by the visitor: an IP ban was
// one header away from useless, the per-address socket cap could be side-
// stepped by rotating the value, and the audit recorded whatever they felt like
// claiming. Counting back by the number of hops we own lands on the entry
// written by the outermost proxy we trust — the one nobody outside can forge.
//
// Two guards: the header is only worth anything when the peer is one of our
// own proxies (a public peer means nothing is in front of us and the header is
// just typed input), and a chain shorter than the configured hop count means
// the configuration is wrong, so it falls back to the peer address, which is
// observed rather than claimed and therefore never a lie.
// Internal hops are stripped by recognising them, however many there are —
// their number is not something we are told, and adding a custom domain
// silently added one. Public-addressed proxies are then stepped back over by
// count. Spoof resistance: a proxy appends, so whatever a visitor types sits
// at the left and everything right of it was observed by us; a chain shorter
// than the configuration claims resolves to the peer, because a
// misconfiguration must never resolve to a value the visitor chose.
export function clientIp(
  header: string | string[] | undefined,
  peer: string | null,
  extra?: Record<string, string | string[] | undefined>,
): string | null {
  const fallback = normalisePeer(peer);
  if (!isInfraPeer(peer)) return fallback;

  const chain = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',').map(x => normalisePeer(x)).filter((x): x is string => !!x);

  let end = chain.length - 1;
  while (end >= 0 && isInfraPeer(chain[end])) end -= 1;

  if (end >= 0) {
    const idx = end - (trustedProxyHops() - 1);
    if (idx >= 0) return chain[idx];
    // Shorter than configured: never resolve to a value the visitor chose;
    // fall through to what the proxy itself states, then the observed peer.
  }

  for (const name of ['x-envoy-external-address', 'cf-connecting-ip', 'x-real-ip']) {
    const v = extra?.[name];
    const one = normalisePeer(Array.isArray(v) ? v[0] : v ?? null);
    if (one && !isInfraPeer(one)) return one;
  }

  return fallback;
}

export function attachSockets(io: IO) {
  liveIo = io;
  // The registry pushes state changes through this emitter.
  registry.emitter = {
    broadcastTable: (table: Table) => {
      pushTableState(io, table);
      // Keep the spectate overview in step with table activity.
      if (table.tournamentId) pushTablesOverview(io, table.tournamentId);
    },
    tableChat: (table, msg) => io.to(tableRoom(table.id)).emit('table:chat', msg),
    tableEvent: (table, text) => io.to(tableRoom(table.id)).emit('table:event', { kind: 'log', text, ts: Date.now() }),
    tableReaction: (table, r) => io.to(tableRoom(table.id)).emit('table:reaction', r),
    // Their own business, not the table's: sent to that player's sockets only.
    cashBust: (_table, info) => {
      for (const [, sock] of io.sockets.sockets) {
        if ((sock.data as SocketData).profile?.id === info.playerId) {
          sock.emit('table:cashBust', info);
        }
      }
    },
    broadcastTourney: (t: Tournament) => pushTourneyState(io, t),
    tourneyChat: (t, msg: ChatMsg) => io.to(tourneyRoom(t.id)).emit('tourney:chat', msg),
    assigned: (t, playerId, tableId) => {
      for (const [, sock] of io.sockets.sockets) {
        if ((sock.data as SocketData).profile?.id === playerId) {
          sock.emit('tourney:assigned', { tableId });
        }
      }
    },
    tourneyEliminated: (t, player) => {
      // Only the busted player themselves gets the popup.
      const payload = {
        tournamentId: t.id,
        tournamentName: t.config.name,
        name: player.name,
        avatar: player.avatar,
        place: player.place,
        prize: player.prize,
        entrants: t.players.size,
        prizeText: t.config.prizeText,
      };
      for (const [, sock] of io.sockets.sockets) {
        if ((sock.data as SocketData).profile?.id === player.id) {
          sock.emit('tourney:eliminated', payload);
        }
      }
    },
    tourneyFinished: (t: Tournament) => {
      const places = [...t.players.values()]
        .filter(p => p.place !== null && p.place <= 3)
        .sort((a, b) => (a.place ?? 9) - (b.place ?? 9))
        .map(p => ({ playerId: p.id, place: p.place!, name: p.name, avatar: p.avatar }));
      const payload = {
        tournamentId: t.id,
        name: t.config.name,
        entrants: t.players.size,
        prizeText: t.config.prizeText,
        places,
      };
      // Reach viewers in the lobby room and at every table of this tournament.
      io.to(tourneyRoom(t.id)).emit('tourney:finished', payload);
      for (const table of t.tables.values()) {
        io.to(tableRoom(table.id)).except(tourneyRoom(t.id)).emit('tourney:finished', payload);
      }
    },
    lobbyChanged: () => pushLobby(io),
  };

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    (socket.data as SocketData).profile = verifyToken(token);
    next();
  });

  // Broadcast fresh state to every table a player sits at (presence changes).
  const broadcastPlayerTables = (playerId: string) => {
    const tables: Table[] = [...registry.cashTables.values()];
    for (const t of registry.tournaments.values()) tables.push(...t.tables.values());
    for (const table of tables) {
      if (!table.closed && table.playerSeat(playerId) !== null) pushTableState(io, table);
    }
  };

  io.on('connection', (socket: Sock) => {
    const profile = () => (socket.data as SocketData).profile;
    const pid = profile()?.id;
    const ip = clientIp(
      socket.handshake.headers['x-forwarded-for'],
      socket.handshake.address || null,
      socket.handshake.headers,
    );
    (socket.data as SocketData & { ip?: string | null }).ip = ip;
    // Keep the raw chain for this connection so the operator can read what
    // the proxies actually sent, instead of inferring it from the result.
    noteIpSample(
      socket.handshake.headers,
      socket.handshake.address || null,
      ip,
      profile()?.name ?? null,
    );

    // One address may not hoard connections.
    const ipKey = ip ?? 'unknown';
    const openForIp = (socketsPerIp.get(ipKey) ?? 0) + 1;
    socketsPerIp.set(ipKey, openForIp);
    socket.on('disconnect', () => {
      const left = (socketsPerIp.get(ipKey) ?? 1) - 1;
      if (left <= 0) socketsPerIp.delete(ipKey);
      else socketsPerIp.set(ipKey, left);
    });
    const cap = pid ? MAX_AUTHED_PER_IP : MAX_ANON_PER_IP;
    if (openForIp > cap) {
      // Logged, not silent: if a real shared network ever hits this, the
      // operator needs to see it in the logs rather than field a bug report
      // about the site "not loading" for one office.
      console.warn(
        `Socket cap hit for ${ipKey} (${openForIp} open, cap ${cap}, ${pid ? 'signed in' : 'anonymous'})`,
      );
      socket.emit('toast', {
        kind: 'error',
        text: pid
          ? 'Too many connections from your network — close a tab and try again'
          : 'Too many connections from your network — sign in to continue',
      });
      socket.disconnect(true);
      return;
    }

    // Event budget, as per-socket middleware rather than an onAny listener:
    // onAny only watches, and the handler would run anyway. This one refuses
    // the packet, which is the whole point.
    let spent = 0;
    let windowEndsAt = Date.now() + EVENT_WINDOW_MS;
    let strikes = 0;
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now > windowEndsAt) {
        // A window that stayed inside the budget clears the record; one that
        // did not leaves the strike standing. Resetting unconditionally here
        // meant strikes could never accumulate and a flood ran forever.
        if (spent <= EVENT_BUDGET) strikes = 0;
        spent = 0;
        windowEndsAt = now + EVENT_WINDOW_MS;
      }
      spent += 1;
      if (spent <= EVENT_BUDGET) { next(); return; }
      if (spent === EVENT_BUDGET + 1) strikes += 1;
      if (strikes >= STRIKES_BEFORE_DROP) {
        socket.emit('toast', { kind: 'error', text: 'Disconnected for flooding the server' });
        socket.disconnect(true);
        return;
      }
      // Drop the packet. No error back: telling a flooder exactly where the
      // line is only teaches them to sit just under it.
      next(new Error('rate limited'));
    });
    if (pid) {
      playerConnected(pid);
      broadcastPlayerTables(pid);
      // Audit trail: who connected, from which address, and from which
      // browser. The browser is the part an alt cannot change by moving to a
      // hotspot. Both values are client-supplied and treated as opaque
      // tokens: validated to a fixed shape, never trusted to mean anything
      // beyond "these two connections said the same thing".
      const auth = (socket.handshake.auth ?? {}) as { device?: unknown; print?: unknown };
      const device = typeof auth.device === 'string' && /^[0-9a-f]{32}$/.test(auth.device) ? auth.device : null;
      const print = typeof auth.print === 'string' && /^[0-9a-f]{8}$/.test(auth.print) ? auth.print : null;
      noteSeen(profile()!, ip, { device, print });
    }
    // A banned account — or any account from a banned address — is turned
    // away at the door rather than later, at whichever action it tries.
    const banOf = () => {
      const p = profile();
      return findBan({ id: p?.id ?? null, discordId: p?.discord?.id ?? null, ip });
    };
    {
      const b = banOf();
      if (b) {
        socket.emit('toast', { kind: 'error', text: banMessage(b) });
        socket.emit('banned', { reason: b.reason || null });
        setTimeout(() => socket.disconnect(true), 250);
      }
    }
    // Lifetime bans are handled by requireAuth. This is the narrower question:
    // is this player barred from THIS game? Called wherever someone gets into
    // one — registering, re-entering, or taking a seat.
    const assertMayJoin = (gameId: string) => {
      const p = profile();
      const b = findBan(
        { id: p?.id ?? null, discordId: p?.discord?.id ?? null, ip },
        gameId,
      );
      if (b) throw new Error(banMessage(b));
    };

    const requireAuth = (): PlayerProfile => {
      const p = profile();
      if (!p) throw new Error('Sign in to play');
      // Every action funnels through here, so registering (late or not),
      // sitting down and re-joining are all covered by this one check.
      const b = banOf();
      if (b) throw new Error(banMessage(b));
      return p;
    };
    // A refusal and a bug are different things and must not read the same.
    //
    // Refusals ("Table not found", "seat taken") are written for the player and
    // go out as they are. A TypeError is the server tripping over its own feet
    // on a payload it did not expect — fuzzing every event turned up 89 of
    // them, each shipping an internal message like "Cannot read properties of
    // null (reading 'tableId')" straight to whoever sent the payload. Those
    // tell an attacker about the shape of the code and tell a player nothing,
    // so they are logged here and answered with something plain.
    const isBug = (e: unknown) =>
      e instanceof TypeError || e instanceof RangeError || e instanceof ReferenceError
      || e instanceof SyntaxError;

    const fail = (e: unknown, event = 'socket') => {
      if (isBug(e)) {
        console.error(`Bad payload on ${event}:`, e);
        socket.emit('toast', { kind: 'error', text: 'That did not work — try again.' });
        return;
      }
      socket.emit('toast', { kind: 'error', text: e instanceof Error ? e.message : 'Something went wrong' });
    };

    const wrap = (fn: (...args: any[]) => void) => (...args: any[]) => {
      try { fn(...args); } catch (e) { fail(e); }
    };
    const wrapAsync = (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => {
      fn(...args).catch(fail);
    };

    // Latency probe — deliberately does no work beyond the ack.
    socket.on('net:ping', (cb: (t: number) => void) => {
      if (typeof cb === 'function') cb(Date.now());
    });

    // ---- lobby ----
    socket.on('lobby:sub', wrap(() => {
      socket.join(LOBBY);
      socket.emit('lobby:state', registry.lobbyView(io.engine.clientsCount));
    }));
    socket.on('lobby:unsub', wrap(() => socket.leave(LOBBY)));

    // ---- tables ----
    socket.on('table:join', wrap((tableId: string) => {
      const table = registry.findTable(tableId);
      if (!table) {
        // Dead or mistyped link: tell the client instead of leaving it on
        // "Connecting…" forever. (A table mid-break re-resolves via the
        // assignment event that follows, which overrides this.)
        socket.emit('table:missing', tableId);
        return;
      }
      socket.join(tableRoom(tableId));
      const p = profile();
      if (p && table.playerSeat(p.id) === null) table.spectators.add(socket.id);
      // Send current state + chat and session-log backlog.
      socket.emit('table:state', table.view(p?.id ?? null));
      for (const m of table.chatLog.slice(-CHAT_BACKLOG)) socket.emit('table:chat', m);
      for (const e of table.eventLog.slice(-200)) {
        socket.emit('table:event', { kind: 'log', text: e.text, ts: e.ts });
      }
    }));

    // Hand history for the replayer (ack callback; hole cards redacted per viewer).
    socket.on('table:history', wrap((tableId: string, cb: (hands: unknown[]) => void) => {
      if (typeof cb !== 'function') return;
      // The replayer is what reads hand history. With it switched off there
      // is nothing to serve, and hole cards should not leave the server for a
      // feature nobody is using.
      if (!isOn('replay')) { cb([]); return; }
      const table = registry.findTable(tableId);
      cb(table ? table.historyView(profile()?.id ?? null) : []);
    }));

    socket.on('table:leave', wrap((tableId: string) => {
      socket.leave(tableRoom(tableId));
      const table = registry.findTable(tableId);
      if (table) table.spectators.delete(socket.id);
    }));

    socket.on('table:sit', wrap((p: { tableId: string; seat: number; buyIn?: number }) => {
      const me = requireAuth();
      const table = registry.findTable(p.tableId);
      if (!table) throw new Error('Table not found');
      // A tournament ban follows the player to its tables, so check both the
      // table and the event it belongs to.
      assertMayJoin(table.id);
      if (table.tournamentId) assertMayJoin(table.tournamentId);
      if (table.mode === 'tournament') throw new Error('Tournament seats are assigned automatically');
      const cash = table.cash!;
      const buyIn = Math.floor(p.buyIn ?? cash.minBuy);
      if (buyIn < cash.minBuy || buyIn > cash.maxBuy) {
        throw new Error(`Buy-in must be between ${cash.minBuy} and ${cash.maxBuy}`);
      }
      table.sit(p.seat, { id: me.id, name: me.name, avatar: me.avatar }, buyIn);
      table.spectators.delete(socket.id);
    }));

    socket.on('table:stand', wrap((tableId: string) => {
      const me = requireAuth();
      const table = registry.findTable(tableId);
      if (!table) throw new Error('Table not found');
      if (table.mode === 'tournament') throw new Error('You cannot leave a tournament table with chips');
      table.stand(me.id);
      registry.emitter?.lobbyChanged();
    }));

    socket.on('table:action', wrap((p: { tableId: string; type: any; amount?: number }) => {
      const me = requireAuth();
      const table = registry.findTable(p.tableId);
      // Table already broken by balancing — the assignment event resyncs the client.
      if (!table) return;
      try {
        table.applyAction(me.id, p.type, p.amount !== undefined ? Math.floor(p.amount) : undefined);
      } catch (e) {
        // Stale actions happen legitimately (a click lands just after a
        // timeout auto-fold, a table move, a new bet, or the hand ending).
        // Resync the client silently — an error toast would just be noise.
        const msg = e instanceof Error ? e.message : '';
        const stale = ['not your turn', 'no hand in progress', 'hand finished', 'no action pending',
          'cannot check', 'cannot raise', 'raise below minimum', 'not seated'].includes(msg)
          || msg.startsWith('unknown action');
        if (stale) {
          socket.emit('table:state', table.view(me.id));
          return;
        }
        throw e;
      }
    }));

    socket.on('table:chatSend', wrap((p: { tableId: string; text: string; replyTo?: string }) => {
      if (!chatEnabled()) throw new Error('Chat is turned off right now');
      if (!isOn('chat')) throw new Error('Chat is switched off');
      const me = requireAuth();
      const table = registry.findTable(p.tableId);
      if (!table) throw new Error('Table not found');
      table.userMsg({ id: me.id, name: me.name, avatar: me.avatar }, p.text, p.replyTo);
    }));

    socket.on('table:sitout', wrap((p: { tableId: string; out: boolean }) => {
      const me = requireAuth();
      const table = registry.findTable(p.tableId);
      if (!table) throw new Error('Table not found');
      table.setSitOut(me.id, !!p.out);
    }));

    socket.on('table:topup', wrap((p: { tableId: string; amount: number }) => {
      const me = requireAuth();
      const table = registry.findTable(p.tableId);
      if (!table) throw new Error('Table not found');
      table.topUp(me.id, Math.floor(p.amount));
    }));

    // Animated emoji reaction — broadcast to everyone watching the table.
    socket.on('table:react', wrap((p: { tableId: string; emoji: string }) => {
      const me = requireAuth();
      const table = registry.findTable(String(p.tableId));
      if (!table) throw new Error('Table not found');
      table.react(me.id, me.name, String(p.emoji ?? ''));
    }));

    socket.on('table:rabbit', wrap((tableId: string) => {
      if (!isOn('rabbitHunting')) throw new Error('Rabbit hunting is switched off');
      requireAuth();
      registry.findTable(tableId)?.showRabbit();
    }));

    socket.on('table:settings', wrap((p: { tableId: string } & Record<string, unknown>) => {
      const me = requireAuth();
      const table = registry.cashTables.get(String(p.tableId));
      if (!table) throw new Error('Table not found');
      if (!mayDirect(table, me, 'settings')) {
        throw new Error(table.playerHosted && table.hostId === me.id
          ? 'Only an operator can change a table\'s settings — you can close it'
          : 'Only the table host can do that');
      }
      // Themes come off the wire — pin them to known presets and safe urls.
      if ('theme' in p) p.theme = sanitizeTheme(p.theme);
      table.updateCashSettings(p as Parameters<typeof table.updateCashSettings>[0]);
    }));

    socket.on('table:close', wrap((tableId: string) => {
      const me = requireAuth();
      const table = registry.cashTables.get(String(tableId));
      if (!table) throw new Error('Table not found');
      if (table.hostId !== me.id && !me.isAdmin) throw new Error('Only the table host can do that');
      table.closeByHost();
      // File it before the live object is forgotten — the operator still
      // needs the ledger after the table is gone.
      registry.archiveCashTable(table);
      pushLobby(io);
    }));

    socket.on('table:reveal', wrap((p: { tableId: string; which: 'first' | 'second' | 'both' }) => {
      const me = requireAuth();
      const table = registry.findTable(p.tableId);
      if (!table) return;
      if (!['first', 'second', 'both'].includes(p.which)) return;
      try {
        table.applyReveal(me.id, p.which);
      } catch {
        // Reveal window closed (next hand started) — just resync quietly.
        socket.emit('table:state', table.view(me.id));
      }
    }));

    // ---- tournaments ----
    const getT = (id: string): Tournament => {
      const t = registry.tournaments.get(id);
      if (!t) throw new Error('Tournament not found');
      return t;
    };

    socket.on('tourney:sub', wrap((id: string) => {
      // Subscribing to an id with no live game is not an error: the event may
      // simply be over, and the page falls back to its saved results. Erroring
      // here just threw a "Tournament not found" toast over those results.
      const t = registry.tournaments.get(id);
      if (!t) return;
      socket.join(tourneyRoom(id));
      const p = profile();
      if (p) noteGame(p.id, id);
      socket.emit('tourney:state', t.view(p?.id ?? null, !!p?.discord));
      // The client merges on message id, so replaying generously is free —
      // and necessary: forty was short enough that any reconnect left the
      // panel showing a stub of the conversation instead of the conversation.
      for (const m of t.chatLog.slice(-CHAT_BACKLOG)) socket.emit('tourney:chat', m);
    }));
    socket.on('tourney:unsub', wrap((id: string) => socket.leave(tourneyRoom(id))));

    // All-tables spectate overview.
    socket.on('tourney:tablesSub', wrap((id: string) => {
      const t = getT(id);
      socket.join(tablesRoom(id));
      socket.emit('tourney:tables', t.tablesView());
    }));
    socket.on('tourney:tablesUnsub', wrap((id: string) => socket.leave(tablesRoom(id))));

    // Refresh Discord membership + role verification against a tournament's guild.
    const refreshDiscordVerification = async (t: Tournament, me: PlayerProfile): Promise<boolean> => {
      const social = t.config.social;
      const guildId = social?.discordGuildId;
      if (!me.discord || !guildId || !discordEnabled()) return false;
      const info = await guildMembership(me.discord.id, guildId);
      const patch: { discordVerified: boolean; discordJoined?: boolean; discordRoleOk?: boolean } = {
        discordVerified: info.member,
      };
      if (info.member) patch.discordJoined = true;
      if (social?.discordRoleId) {
        patch.discordRoleOk = info.member && info.roleIds.includes(social.discordRoleId);
      }
      t.confirmSocial(me.id, patch);
      return info.member;
    };

    socket.on('tourney:confirmSocial', wrapAsync(async (p: { id: string; x?: boolean; ig?: boolean; discordJoined?: boolean }) => {
      const me = requireAuth();
      const t = getT(p.id);
      const patch: { x?: boolean; ig?: boolean; discordJoined?: boolean } = {};
      if (p.x !== undefined) patch.x = !!p.x;
      if (p.ig !== undefined) patch.ig = !!p.ig;
      if (p.discordJoined !== undefined) patch.discordJoined = !!p.discordJoined;
      t.confirmSocial(me.id, patch);
      await refreshDiscordVerification(t, me);
      socket.emit('tourney:state', t.view(me.id, !!me.discord));
    }));

    socket.on('tourney:register', wrapAsync(async (id: string) => {
      const me = requireAuth();
      // Covers late registration too — it is the same door.
      assertMayJoin(String(id));
      const t = getT(id);
      // Refresh Discord verification right before the gate check.
      const discordVerified = await refreshDiscordVerification(t, me);
      t.assertRequirementsMet(me, discordEnabled());
      t.register({
        id: me.id, name: me.name, avatar: me.avatar,
        discord: me.discord ?? null, discordVerified,
      });
    }));
    socket.on('tourney:unregister', wrap((id: string) => {
      const me = requireAuth();
      getT(id).unregister(me.id);
    }));

    socket.on('tourney:reenter', wrap((id: string) => {
      const me = requireAuth();
      assertMayJoin(String(id));
      getT(id).reenter(me.id);
    }));

    // The tournament director: an operator, or the event's host. A player
    // host's own event gets the short list in hosting.ts (start, pause,
    // resume, cancel, prizes, start time); the rest is for operators.
    const requireHost = (t: Tournament, action: DirectorAction): PlayerProfile => {
      const me = requireAuth();
      const event = { hostId: t.hostId, playerHosted: !!t.config.playerHosted };
      if (mayDirect(event, me, action)) return me;
      if (event.playerHosted && t.hostId === me.id) throw new Error('Only an operator can do that on a player-hosted event');
      throw new Error('Only the tournament director can do that');
    };
    socket.on('tourney:approve', wrap((p: { id: string; playerId: string }) => {
      const t = getT(p.id); requireHost(t, 'approve'); t.approve(String(p.playerId));
    }));
    socket.on('tourney:approveAll', wrap((id: string) => {
      const t = getT(id); requireHost(t, 'approve'); t.approveAll();
    }));
    // ---------- operator interventions at a table ----------
    const requireTableHost = (table: Table): PlayerProfile => {
      const me = requireAuth();
      if (!mayRunTable(table.hostId, me, table.playerHosted)) throw new Error('Only the host can do that');
      return me;
    };

    socket.on('table:reverseTurn', wrap((tableId: string) => {
      const table = registry.findTable(String(tableId));
      if (!table) throw new Error('Table not found');
      requireTableHost(table);
      const who = table.reverseTurn();
      socket.emit('toast', { kind: 'success', text: `Turn reversed — back to ${who}` });
      pushTableState(io, table);
    }));

    socket.on('table:setStack', wrap((p: { tableId: string; playerId: string; stack: number }) => {
      const table = registry.findTable(String(p.tableId));
      if (!table) throw new Error('Table not found');
      const me = requireTableHost(table);
      const r = table.setStack(String(p.playerId), Number(p.stack), me.name);
      socket.emit('toast', { kind: 'success', text: `${r.name}: ${r.from} → ${r.to}` });
      pushTableState(io, table);
      pushLobby(io);
    }));

    socket.on('tourney:kick', wrap((p: { id: string; playerId: string }) => {
      const t = getT(p.id); requireHost(t, 'kick'); t.kick(String(p.playerId));
    }));

    socket.on('tourney:settings', wrap((p: { id: string } & Record<string, unknown>) => {
      const t = getT(p.id);
      const me = requireAuth();
      const event = { hostId: t.hostId, playerHosted: !!t.config.playerHosted };
      if (!mayDirect(event, me, 'settings')) {
        // A player host may change the prize line and the start time, and
        // nothing else: the rest of the form is an operator's.
        const keys = Object.keys(p).filter(k => k !== 'id');
        const allowed = keys.length > 0 && keys.every(k => {
          const action = PLAYER_SETTINGS.get(k);
          return !!action && mayDirect(event, me, action);
        });
        if (!allowed) requireHost(t, 'settings'); // throws, with the reason
        if (typeof p.scheduledStart === 'number') playerScheduledStart(p.scheduledStart);
      }
      if ('theme' in p) p.theme = sanitizeTheme(p.theme);
      t.updateSettings(p as Parameters<typeof t.updateSettings>[0]);
    }));

    socket.on('tourney:start', wrap((id: string) => { const t = getT(id); requireHost(t, 'start'); t.start(); }));
    socket.on('tourney:pause', wrap((id: string) => { const t = getT(id); requireHost(t, 'pause'); t.pause(); }));
    socket.on('tourney:resume', wrap((id: string) => { const t = getT(id); requireHost(t, 'resume'); t.resume(); }));
    socket.on('tourney:cancel', wrap((id: string) => { const t = getT(id); requireHost(t, 'cancel'); t.cancel(); }));
    // Put one specific player back — a correction, not a re-entry. Host only.
    socket.on('tourney:reinstate', wrap((p: { id: string; playerId: string; stack?: number }) => {
      const t = getT(String(p.id));
      requireHost(t, 'reinstate');
      t.reinstate(String(p.playerId), typeof p.stack === 'number' ? p.stack : undefined);
    }));
    // The director's override: seat anyone, at any time, with any stack.
    // Deliberately bypasses late registration, the field cap and re-entry
    // limits — it exists for the moments when those rules are the problem.
    socket.on('tourney:seatPlayer', wrap((p: {
      id: string; playerId: string; name?: string; avatar?: string; stack?: number;
    }) => {
      const t = getT(String(p.id));
      requireHost(t, 'seat');
      const r = t.directorSeat({
        id: String(p.playerId),
        name: String(p.name ?? ''),
        avatar: String(p.avatar ?? '🙂'),
      }, typeof p.stack === 'number' ? p.stack : undefined);
      const verb = r.action === 'reinstated' ? 'put back in'
        : r.action === 'added' ? 'added' : 'seated';
      socket.emit('toast', { kind: 'success', text: `${r.name} ${verb} with ${r.stack} chips` });
    }));

    // Who the director can pick from. Host only: it lists every name the site
    // has seen, which is not a roster anyone else should be able to pull.
    socket.on('tourney:people', wrap((id: string, cb: (rows: unknown[]) => void) => {
      if (typeof cb !== 'function') return;
      const t = getT(String(id));
      requireHost(t, 'people');
      const known = playerRows()
        .slice(0, 400)
        .map(r => ({ id: r.id, name: r.name, avatar: r.avatar }));
      cb(t.directorPeople(known));
    }));

    // Claiming the seat a registration holds. This is what actually puts a
    // player at a table — registering only reserves their place in the field.
    socket.on('tourney:join', wrap((id: string) => {
      const me = requireAuth();
      const t = getT(String(id));
      const tableId = t.joinTable(me.id);
      socket.emit('tourney:assigned', { tableId });
    }));

    socket.on('tourney:endNow', wrap((id: string) => { const t = getT(id); requireHost(t, 'endNow'); t.endNow(); }));

    socket.on('tourney:chatSend', wrap((p: { id: string; text: string; replyTo?: string }) => {
      if (!chatEnabled()) throw new Error('Chat is turned off right now');
      if (!isOn('chat')) throw new Error('Chat is switched off');
      const me = requireAuth();
      getT(p.id).userChat({ id: me.id, name: me.name, avatar: me.avatar }, p.text, p.replyTo);
    }));

    socket.on('disconnect', () => {
      for (const t of registry.cashTables.values()) t.spectators.delete(socket.id);
      for (const tt of registry.tournaments.values()) {
        for (const t of tt.tables.values()) t.spectators.delete(socket.id);
      }
      if (pid) {
        playerDisconnected(pid);
        broadcastPlayerTables(pid);
      }
    });
  });

  // Periodic lobby refresh for online counter.
  setInterval(() => pushLobby(io), 15_000);
}

function pushLobby(io: IO) {
  io.to(LOBBY).emit('lobby:state', registry.lobbyView(io.engine.clientsCount));
}

// Personalized state per connected socket in the room (hole cards redacted).
//
// A single action can trigger several broadcasts in the same tick (the action
// itself, the street log, the next player's clock). At one table that is
// nothing; across 56 running tables it is the dominant cost, since every push
// rebuilds a view per seated player. Coalescing on a short trailing edge
// collapses those bursts into one push without being perceptible.
const tablePushTimers = new Map<string, NodeJS.Timeout>();
const TABLE_PUSH_MS = 40;

function pushTableState(io: IO, table: Table) {
  if (tablePushTimers.has(table.id)) return;
  tablePushTimers.set(table.id, setTimeout(() => {
    tablePushTimers.delete(table.id);
    const room = io.sockets.adapter.rooms.get(tableRoom(table.id));
    if (!room) return;
    // One full build, then a cheap per-viewer patch (own cards + my* fields).
    const base = table.view(null);
    for (const sid of room) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      const pid = (sock.data as SocketData).profile?.id ?? null;
      sock.emit('table:state', table.personalize(base, pid));
    }
  }, TABLE_PUSH_MS));
}

// Tournament broadcasts are throttled: with hundreds of subscribers each
// broadcast is O(subscribers), and bursts (mass registration, multi-table
// hand ends) would otherwise stack them. Trailing-edge coalescing keeps
// every subscriber within ~300ms of live without the bursts.
const tourneyPushTimers = new Map<string, NodeJS.Timeout>();
const TOURNEY_PUSH_MS = 300;

// The overview covers every table at once, so it is coalesced harder than the
// per-table pushes — spectators do not need frame-accurate updates.
const tablesPushTimers = new Map<string, NodeJS.Timeout>();
const TABLES_PUSH_MS = 600;

function pushTablesOverview(io: IO, tournamentId: string) {
  const room = io.sockets.adapter.rooms.get(tablesRoom(tournamentId));
  if (!room || room.size === 0) return; // nobody is watching — skip the work
  if (tablesPushTimers.has(tournamentId)) return;
  tablesPushTimers.set(tournamentId, setTimeout(() => {
    tablesPushTimers.delete(tournamentId);
    const t = registry.tournaments.get(tournamentId);
    if (!t) return;
    io.to(tablesRoom(tournamentId)).emit('tourney:tables', t.tablesView());
  }, TABLES_PUSH_MS));
}

function pushTourneyState(io: IO, t: Tournament) {
  if (tourneyPushTimers.has(t.id)) return; // push already scheduled
  tourneyPushTimers.set(t.id, setTimeout(() => {
    tourneyPushTimers.delete(t.id);
    const room = io.sockets.adapter.rooms.get(tourneyRoom(t.id));
    if (!room) return;
    // Compute the expensive shared parts (standings) once for all viewers.
    const shared = t.standings();
    for (const sid of room) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock) continue;
      const p = (sock.data as SocketData).profile;
      sock.emit('tourney:state', t.view(p?.id ?? null, !!p?.discord, shared));
    }
  }, TOURNEY_PUSH_MS));
}
