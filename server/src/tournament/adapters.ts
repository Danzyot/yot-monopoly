// The game behind the tournament engine: Cards. It opens real rooms through
// its own registry (../cards/rooms.ts), so a tournament table is an ordinary
// table everyone already knows: the same lobby, reconnects, autopilot for
// players who drop, results recorded by the usual hooks. What makes it a
// tournament table is its lock (TableLock): assigned seats only, and the
// tournament as its host.

import type { CardsRegistry, CardsRoom } from '../cards/rooms.ts';
import { cardsStandings } from '../cards/stats.ts';
import type { TableLock } from '../../../shared/tournaments.ts';
import type { Member, TournamentData } from './engine.ts';
import type { GameAdapter } from './manager.ts';

export function cardsAdapter(reg: CardsRegistry, broadcast: (r: CardsRoom) => void, taken: (code: string) => boolean = () => false): GameAdapter {
  const get = (code: string) => reg.get(code);
  const with_ = (code: string, fn: (r: CardsRoom) => void) => {
    const r = get(code);
    if (!r) return;
    fn(r);
    broadcast(r);
  };
  return {
    graceMs: 0,
    open(lock: TableLock, players: Member[], t: TournamentData): string {
      const r = reg.create(lock.hostId, true, taken);
      try {
        r.tournament = lock;
        r.configure(lock.hostId, true, {
          maxPlayers: Math.max(players.length, t.settings.botsFill ? t.settings.tableSize : 0), private: true,
          // The mode first: a new mode brings its own house rules (CardsRoom.configure).
          rules: { mode: t.settings.cardsMode ?? 'classic', match: t.settings.cardsMatch, targetScore: t.settings.cardsTarget },
        });
        // Everyone is seated but away until they open the table. join() seats
        // their own Chog only when the wallet check (holdsChog) passes.
        for (const pl of players) {
          r.join(pl, pl.chogToken);
          r.setConnected(pl.id, false);
        }
      } catch (e) {
        reg.delete(r.code);
        throw e;
      }
      broadcast(r);
      return r.code;
    },
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
