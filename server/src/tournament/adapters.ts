// The two games behind the tournament engine. Each opens real rooms through
// its own registry (../rooms.ts, ../cards/rooms.ts), so a tournament table is
// an ordinary table everyone already knows: the same lobby, reconnects,
// autopilot for players who drop, results recorded by the usual hooks. What
// makes it a tournament table is its lock (TableLock): assigned seats only,
// and the tournament as its host.

import type { Registry, Room } from '../rooms.ts';
import type { CardsRegistry, CardsRoom } from '../cards/rooms.ts';
import { cardsStandings } from '../cards/stats.ts';
import type { TableLock } from '../../../shared/tournaments.ts';
import type { Member, TournamentData } from './engine.ts';
import type { GameAdapter } from './manager.ts';

/** Monopoly ends a timed game itself, at the end of the turn under way: give that turn a few minutes. */
const MONOPOLY_GRACE_MS = 3 * 60_000;

/** The calls both room classes share, so one adapter body serves both games. */
type AnyRoom = Room | CardsRoom;

function tableOps<R extends AnyRoom>(get: (code: string) => R | undefined, broadcast: (r: R) => void) {
  const with_ = (code: string, fn: (r: R) => void) => {
    const r = get(code);
    if (!r) return;
    fn(r);
    broadcast(r);
  };
  return {
    attach(code: string, lock: TableLock): boolean {
      const r = get(code);
      if (!r) return false;
      r.tournament = lock;
      r.hostId = lock.hostId;
      broadcast(r);
      return true;
    },
    present(code: string): string[] | null {
      const r = get(code);
      return r ? r.seats.filter(s => !s.isBot && s.connected).map(s => s.id) : null;
    },
    isPaused(code: string): boolean | null {
      const r = get(code);
      if (!r || r.status !== 'playing' || !r.game || r.game.phase === 'over') return null;
      return !!r.game.paused;
    },
    setPaused(code: string, paused: boolean, by: string) {
      with_(code, r => {
        if (paused) r.pause(r.hostId, true, by);
        else r.resume(r.hostId, true, by);
      });
    },
    remove(code: string, playerId: string) {
      with_(code, r => r.remove(playerId));
    },
    close(code: string, reason: string) {
      with_(code, r => { if (r.status !== 'finished') r.end(reason); });
    },
  };
}

/** Seat everyone (marked away until they open the table) behind the lock. */
function seatAll(r: AnyRoom, lock: TableLock, players: Member[], join: (p: Member) => void) {
  r.tournament = lock;
  for (const p of players) {
    join(p);
    r.setConnected(p.id, false);
  }
}

export function monopolyAdapter(reg: Registry, broadcast: (r: Room) => void): GameAdapter {
  const get = (code: string) => reg.get(code);
  return {
    graceMs: MONOPOLY_GRACE_MS,
    ...tableOps(get, broadcast),
    open(lock: TableLock, players: Member[], t: TournamentData): string {
      const r = reg.create(lock.hostId, true);
      try {
        const seats = Math.max(players.length, t.settings.botsFill ? t.settings.tableSize : 0);
        r.tournament = lock;
        // The game's own time limit (net worth decides) is the round's.
        r.configure(lock.hostId, true, {
          mapId: t.settings.mapId, private: true,
          rules: { maxPlayers: seats, timeLimitMin: t.settings.roundMinutes },
        });
        seatAll(r, lock, players, pl => {
          r.join(pl);
          // Their own Chog, through the room's usual wallet check; the season's Chog if that fails.
          if (pl.chogToken !== undefined) {
            try { r.pickCharacter(pl.id, 'chog', pl.chogToken); } catch { /* not theirs (any more) */ }
          }
        });
      } catch (e) {
        reg.delete(r.code);
        throw e;
      }
      broadcast(r);
      return r.code;
    },
    begin(code: string, drop: string[], bots: number): boolean {
      const r = get(code);
      if (!r || r.status !== 'lobby') return false;
      for (const id of drop) r.remove(id);
      for (let i = 0; i < bots && r.seats.length < r.rules.maxPlayers; i++) r.addBot(r.hostId, true);
      if (r.seats.length < 2) return false;
      r.start(r.hostId, true);
      broadcast(r);
      return true;
    },
    result(code: string) {
      const r = get(code);
      if (!r) return 'gone';
      if (r.status !== 'finished') return null;
      if (!r.game) return 'gone';
      return { order: r.game.standings().map(s => s.id), byTime: r.game.timeUp };
    },
    timeUp(code: string) {
      const r = get(code);
      if (r?.status !== 'playing' || !r.game || r.game.phase === 'over') return;
      r.abandon('the tournament round is out of time');
      broadcast(r);
    },
  };
}

export function cardsAdapter(reg: CardsRegistry, broadcast: (r: CardsRoom) => void, taken: (code: string) => boolean = () => false): GameAdapter {
  const get = (code: string) => reg.get(code);
  return {
    graceMs: 0,
    ...tableOps(get, broadcast),
    open(lock: TableLock, players: Member[], t: TournamentData): string {
      const r = reg.create(lock.hostId, true, taken);
      try {
        r.tournament = lock;
        r.configure(lock.hostId, true, {
          maxPlayers: Math.max(players.length, t.settings.botsFill ? t.settings.tableSize : 0), private: true,
          rules: { match: t.settings.cardsMatch, targetScore: t.settings.cardsTarget },
        });
        // join() seats their own Chog only when the wallet check (holdsChog) passes.
        seatAll(r, lock, players, pl => r.join(pl, pl.chogToken));
      } catch (e) {
        reg.delete(r.code);
        throw e;
      }
      broadcast(r);
      return r.code;
    },
    begin(code: string, drop: string[], bots: number): boolean {
      const r = get(code);
      if (!r || r.status !== 'lobby') return false;
      for (const id of drop) r.remove(id);
      for (let i = 0; i < bots && r.seats.length < r.maxPlayers; i++) r.addBot(r.hostId, true);
      if (r.seats.length < 2) return false;
      r.start(r.hostId, true);
      broadcast(r);
      return true;
    },
    result(code: string) {
      const r = get(code);
      if (!r) return 'gone';
      if (r.status !== 'finished') return null;
      if (!r.game) return 'gone';
      // An operator stop or the idle sweep ends a match without a winner: the standings still rank it.
      return { order: cardsStandings(r.game).map(p => p.id), byTime: false };
    },
    timeUp(code: string) {
      const r = get(code);
      if (r?.status !== 'playing' || !r.game || r.game.phase === 'over') return;
      r.timeUp();
      broadcast(r);
    },
  };
}
