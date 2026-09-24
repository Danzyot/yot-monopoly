// Operator game controls: pause/resume and "fix game" corrections on a live
// table. Registered on the admin router (routes/admin.ts) after its
// operators-only guard. Every change is written to the operator log (who did
// it) and to the room's own log; the engine also tells the players in-game.
import type express from 'express';
import { adminLog, fail } from '../http.ts';
import type { Room } from '../rooms.ts';
import type { SocketLayer } from '../sockets.ts';
import { isOwnable } from '../../../shared/board.ts';
import type { PlayerProfile } from '../../../shared/types.ts';

/** What the dashboard's Fix panel shows for one running game. */
export interface AdminGameState {
  phase: string;
  current: string;
  paused: { by: string; at: number } | null;
  housesLeft: number;
  hotelsLeft: number;
  players: {
    id: string; name: string; cash: number; inJail: boolean; jailCards: number; debt: number;
    bankrupt: boolean; afk: boolean; autopilot: boolean;
  }[];
  deeds: { space: number; name: string; group: string | null; owner: string | null; houses: number; mortgaged: boolean }[];
}

export function adminGameRoutes(r: express.Router, sockets: SocketLayer): void {
  const { registry } = sockets;
  const who = (res: express.Response) => res.locals.admin as PlayerProfile;
  const roomOf = (req: express.Request, res: express.Response): Room | null => {
    const room = registry.get(String(req.params.code));
    if (!room) { res.status(404).json({ error: 'No such room' }); return null; }
    return room;
  };

  r.get('/rooms/:code/game', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const g = room.game;
    if (!g) { res.status(409).json({ error: 'No game in that room yet' }); return; }
    const state: AdminGameState = {
      phase: g.phase,
      current: g.current.id,
      paused: g.paused,
      housesLeft: g.housesLeft,
      hotelsLeft: g.hotelsLeft,
      players: g.players.map(p => ({
        id: p.id, name: p.name, cash: p.cash, inJail: p.inJail, jailCards: p.jailCards.length,
        debt: g.debtOf(p.id), bankrupt: p.bankrupt, afk: !!p.afk, autopilot: !!room.seat(p.id)?.autopilot,
      })),
      deeds: g.spaces.flatMap((s, i) => isOwnable(s) ? [{
        space: i, name: s.name, group: s.group ?? null, owner: g.owned[i]?.owner ?? null,
        houses: g.owned[i]?.houses ?? 0, mortgaged: !!g.owned[i]?.mortgaged,
      }] : []),
    };
    res.json(state);
  });

  r.post('/rooms/:code/pause', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const paused = req.body?.paused !== false;
    const by = who(res);
    try {
      if (paused) room.pause(by.id, true, `${by.name} (operator)`);
      else room.resume(by.id, true, `${by.name} (operator)`);
      sockets.broadcast(room);
      adminLog(by, `${paused ? 'paused' : 'resumed'} the game in ${room.code}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });

  r.post('/rooms/:code/fix', (req, res) => {
    const room = roomOf(req, res);
    if (!room) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const g = room.game;
    const by = who(res);
    try {
      if (!g) throw new Error('No game in that room yet');
      const id = String(b.id ?? '');
      const name = () => g.player(id).name;
      let what: string;
      let fix: () => void;
      switch (b.kind) {
        case 'cash': {
          const cash = Number(b.cash);
          what = `set ${name()}'s cash to ${cash}`;
          fix = () => g.adminSetCash(id, cash);
          break;
        }
        case 'property': {
          const space = Number(b.space);
          const to = b.to === null || b.to === '' || b.to === undefined ? null : String(b.to);
          what = `moved ${g.spaces[space]?.name ?? `space ${space}`} to ${to ? g.player(to).name : 'the bank'}`;
          fix = () => g.adminMoveProperty(space, to);
          break;
        }
        case 'jailCard': {
          const give = b.give !== false;
          what = `${give ? 'gave' : 'took'} a Get Out of Jail Free card ${give ? 'to' : 'from'} ${name()}`;
          fix = () => g.adminJailCard(id, give);
          break;
        }
        case 'clearDebt':
          what = `cleared ${name()}'s debt of ${g.debtOf(id)}`;
          fix = () => g.adminClearDebt(id);
          break;
        case 'jail': {
          const jail = b.jail !== false;
          what = `${jail ? 'sent' : 'released'} ${name()} ${jail ? 'to' : 'from'} jail`;
          fix = () => g.adminJail(id, jail);
          break;
        }
        default:
          throw new Error('Unknown fix');
      }
      room.adminFix(fix, what, by.name);
      sockets.broadcast(room);
      adminLog(by, `fixed game ${room.code}: ${what}`);
      res.json({ ok: true });
    } catch (e) { fail(res, e); }
  });
}
