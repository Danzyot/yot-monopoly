// Tournaments over the shared socket (../sockets.ts sets socket.data.profile
// in its io.use): every event is `tourney:*`. A page following one event
// joins `tourney:<id>`; the list page joins `tourney:lobby`. The tournament
// (manager.ts) is built here with both games' adapters, restored from the
// data volume, and driven once a second.

import type { Server, Socket } from 'socket.io';
import { banMessage, findBan } from '../bans.ts';
import { announceChannelId, postToChannel } from '../discord.ts';
import { isOn } from '../features.ts';
import { cardsAdapter, monopolyAdapter } from './adapters.ts';
import { TournamentManager, TournamentError, type Requester } from './manager.ts';
import type { Tournament } from './engine.ts';
import type { SocketLayer } from '../sockets.ts';
import type { CardsSocketLayer } from '../cards/sockets.ts';
import { RoomError } from '../rooms.ts';
import { CardsRoomError } from '../cards/rooms.ts';
import { GAMES } from '../../../shared/brand.ts';
import { isChogTokenId } from '../../../shared/chogs/traits.ts';
import type { PlayerProfile } from '../../../shared/types.ts';
import type { TournamentSeated } from '../../../shared/tournaments.ts';

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

interface TourneySocketData {
  profile: PlayerProfile | null;
  ip: string | null;
  tourneyTokens?: number;
  tourneyRefilledAt?: number;
}

const ACTIONS_PER_SEC = 4;
const ACTION_BURST = 12;
const channel = (id: string) => `tourney:${id}`;

export interface TournamentLayer {
  manager: TournamentManager;
}

export function attachTournaments(io: Server, games: { monopoly: SocketLayer; cards: CardsSocketLayer }, opts: { tickMs?: number } = {}): TournamentLayer {
  // Coalesced like the rooms': everything that changes an event in one tick goes out once.
  const pending = new Set<Tournament>();
  let listQueued = false;
  const flush = () => {
    const ts = [...pending];
    pending.clear();
    for (const t of ts) io.to(channel(t.id)).emit('tourney:state', manager.view(t));
    if (listQueued) {
      listQueued = false;
      io.to('tourney:lobby').emit('tourney:list', manager.list());
    }
  };
  const changed = (t: Tournament) => {
    if (!pending.size && !listQueued) setImmediate(flush);
    pending.add(t);
    listQueued = true;
  };

  const announce = (title: string, description: string) => {
    const ch = announceChannelId();
    if (ch && isOn('announceResults')) void postToChannel(ch, { title, description });
  };

  const manager: TournamentManager = new TournamentManager({
    monopoly: monopolyAdapter(games.monopoly.registry, r => games.monopoly.broadcast(r)),
    cards: cardsAdapter(games.cards.registry, r => games.cards.broadcast(r), code => !!games.monopoly.registry.get(code)),
  }, {
    onChange: changed,
    onSeated: (t, table, round) => {
      const msg: TournamentSeated = { id: t.id, name: t.d.name, game: t.d.game, code: table.code!, round: round.n };
      for (const s of io.sockets.sockets.values()) {
        const id = (s.data as TourneySocketData).profile?.id;
        if (id && table.players.includes(id)) s.emit('tourney:seated', msg);
      }
    },
    // Only operators' events go to the announcement channel; a player's event is theirs to promote.
    onCreated: t => {
      if (!t.d.official) return;
      const when = t.d.settings.startAt ? `<t:${Math.floor(t.d.settings.startAt / 1000)}:F>` : 'when the host starts it';
      announce(`🏟️ New ${GAMES[t.d.game].name} tournament: ${t.d.name}`,
        `Registration is open — up to ${t.d.settings.maxPlayers} players, starting ${when}.${t.d.prize ? `\nPrize: ${t.d.prize}` : ''}`);
    },
    onFinished: t => {
      if (!t.d.official) return;
      const medals = ['🥇', '🥈', '🥉'];
      const lines = t.d.places.slice(0, 3).map((id, i) => `${medals[i]} ${t.entrant(id)?.name ?? '?'}`);
      announce(`🏆 ${t.entrant(t.d.places[0])?.name ?? '?'} wins ${t.d.name}!`,
        `${lines.join('\n')}\n\n${GAMES[t.d.game].name} · ${t.d.entrants.length} players · ${t.d.rounds.length} rounds`);
    },
  }, { tickMs: opts.tickMs ?? 1_000 });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as TourneySocketData;
    data.tourneyTokens = ACTION_BURST;
    data.tourneyRefilledAt = Date.now();

    const who = (): Requester => {
      const p = data.profile;
      if (!p) throw new TournamentError('Sign in first');
      return { id: p.id, name: p.name, avatar: p.avatar, isAdmin: !!p.isAdmin };
    };

    const on = <T>(event: string, fn: (payload: T) => Record<string, unknown> | void, limited = true) => {
      socket.on(event, (payload: T, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => {};
        if (limited && !take(data)) return reply({ ok: false, error: 'Slow down' });
        if (!plain(payload)) return reply({ ok: false, error: 'Bad request' });
        try {
          const extra = fn((payload ?? {}) as T) ?? {};
          flush();
          reply({ ok: true, ...extra });
        } catch (e) {
          flush();
          if (e instanceof TournamentError || e instanceof RoomError || e instanceof CardsRoomError) reply({ ok: false, error: e.message });
          else {
            console.error(`[tourney socket] ${event} failed`, e);
            reply({ ok: false, error: 'Server error' });
          }
        }
      });
    };

    on<{ subscribe?: boolean }>('tourney:list', p => {
      if (p.subscribe) socket.join('tourney:lobby');
      return { tournaments: manager.list(), me: manager.me(data.profile) };
    }, false);

    on<{ id: string }>('tourney:sub', p => {
      const t = manager.require(p.id);
      socket.join(channel(t.id));
      return { tournament: manager.view(t), me: manager.me(data.profile) };
    }, false);

    on<{ id: string }>('tourney:unsub', p => { socket.leave(channel(String(p.id ?? ''))); }, false);

    on<unknown>('tourney:create', p => {
      const t = manager.create(who(), p);
      return { id: t.id };
    });

    // `chogToken`: the Chog they would like to play as (checked against their wallet when seated).
    on<{ id: string; chogToken?: unknown }>('tourney:register', p => {
      const { isAdmin: _a, ...me } = who();
      const ban = findBan({ id: me.id, discordId: data.profile?.discord?.id, ip: data.ip });
      if (ban) throw new TournamentError(banMessage(ban));
      manager.register(p.id, { ...me, ...(isChogTokenId(p.chogToken) ? { chogToken: p.chogToken } : {}) });
    });

    on<{ id: string }>('tourney:unregister', p => { manager.unregister(p.id, who().id); });
    on<{ id: string }>('tourney:start', p => { manager.start(p.id, who()); });
    on<{ id: string }>('tourney:pause', p => { manager.pause(p.id, who()); });
    on<{ id: string }>('tourney:resume', p => { manager.resume(p.id, who()); });
    on<{ id: string; reason?: string }>('tourney:cancel', p => { manager.cancel(p.id, who(), p.reason); });
    on<{ id: string; prize: string }>('tourney:prize', p => { manager.setPrize(p.id, who(), p.prize); });
    on<{ id: string; playerId: string }>('tourney:remove', p => { manager.remove(p.id, who(), p.playerId); });
  });

  return { manager };
}

function plain(p: unknown): boolean {
  if (p === undefined || p === null) return true;
  if (typeof p !== 'object' || Array.isArray(p)) return false;
  const proto = Object.getPrototypeOf(p);
  return proto === Object.prototype || proto === null;
}

function take(d: TourneySocketData): boolean {
  const now = Date.now();
  d.tourneyTokens = Math.min(ACTION_BURST, (d.tourneyTokens ?? ACTION_BURST) + ((now - (d.tourneyRefilledAt ?? now)) / 1000) * ACTIONS_PER_SEC);
  d.tourneyRefilledAt = now;
  if (d.tourneyTokens < 1) return false;
  d.tourneyTokens -= 1;
  return true;
}
