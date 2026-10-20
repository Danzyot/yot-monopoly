import type { ChatMsg, LobbyView, TableReaction, TournamentConfig } from '../../shared/types.ts';
import { announceChannelId, announceWinners, type AnnounceTarget, type WinnerRow } from './discord.ts';
import { Table } from './engine/table.ts';
import { noteAction, recordHandResult } from './audit.ts';
import { addRecord } from './store.ts';
import { Tournament, type TournamentSnap } from './tournament/tournament.ts';

// Emitter contract implemented by the socket layer.
export interface Emitter {
  broadcastTable: (table: Table) => void;
  tableChat: (table: Table, msg: ChatMsg) => void;
  tableEvent: (table: Table, text: string) => void;
  tableReaction: (table: Table, r: TableReaction) => void;
  broadcastTourney: (t: Tournament) => void;
  tourneyChat: (t: Tournament, msg: ChatMsg) => void;
  assigned: (t: Tournament, playerId: string, tableId: string) => void;
  tourneyFinished: (t: Tournament) => void;
  tourneyEliminated: (t: Tournament, player: {
    id: string; name: string; avatar: string; place: number; prize: number | null;
  }) => void;
  lobbyChanged: () => void;
}

// Central in-memory registry of all live games.
export class Registry {
  tournaments = new Map<string, Tournament>();
  emitter: Emitter | null = null;

  private get e(): Emitter {
    if (!this.emitter) throw new Error('emitter not attached');
    return this.emitter;
  }

  restoreTournament(snap: TournamentSnap): Tournament {
    const t = Tournament.restore(snap, this.tournamentCallbacks());
    this.tournaments.set(t.id, t);
    // Give players a moment to reconnect, then pick the clock back up —
    // unless the host had deliberately paused before the restart.
    if (snap.state === 'running' || snap.state === 'break') {
      setTimeout(() => {
        try { if (t.state === 'paused') t.resume(); } catch { /* host already resumed */ }
      }, 20_000);
    }
    return t;
  }

  private tournamentCallbacks() {
    return {
      broadcastTable: (tb: Table) => this.e.broadcastTable(tb),
      tableChat: (tb: Table, m: ChatMsg) => this.e.tableChat(tb, m),
      tableEvent: (tb: Table, m: string) => this.e.tableEvent(tb, m),
      tableAudit: (tb: Table, e: Parameters<NonNullable<Table['cb']['audit']>>[1]) => {
        if (e.kind === 'handEnd') {
          recordHandResult(tb, e.contenders, {
            contenders: e.contenders, board: e.board,
            tableName: e.tableName, handNumber: e.handNumber,
          });
          return;
        }
        noteAction({
          ts: Date.now(), tableId: tb.id, tableName: tb.name, handNumber: e.handNumber,
          playerId: e.playerId, playerName: e.playerName,
          action: e.action, amount: e.amount, pot: e.pot,
        });
      },
      tableReaction: (tb: Table, r: TableReaction) => this.e.tableReaction(tb, r),
      broadcastTourney: (tt: Tournament) => this.e.broadcastTourney(tt),
      tourneyChat: (tt: Tournament, m: ChatMsg) => this.e.tourneyChat(tt, m),
      assigned: (tt: Tournament, pid: string, tid: string) => this.e.assigned(tt, pid, tid),
      lobbyChanged: () => this.e.lobbyChanged(),
      finished: (tt: Tournament) => {
        this.persistTournamentRecord(tt);
        this.announceTournamentWinners(tt);
        this.e.tourneyFinished(tt);
      },
      eliminated: (tt: Tournament, p: { id: string; name: string; avatar: string; place: number | null; prize: number | null }) => {
        if (p.place === null) return;
        this.e.tourneyEliminated(tt, {
          id: p.id, name: p.name, avatar: p.avatar, place: p.place, prize: p.prize,
        });
      },
    };
  }

  createTournament(
    config: TournamentConfig,
    host: { id: string; name: string },
    scheduledStart?: number | null,
    discordWebhookUrl?: string | null,
  ): Tournament {
    const t = new Tournament(config, host, this.tournamentCallbacks(), scheduledStart);
    // Results of a player-hosted event never go to Discord (see announceTarget).
    t.discordWebhookUrl = config.playerHosted ? null : discordWebhookUrl ?? null;
    this.tournaments.set(t.id, t);
    this.e.lobbyChanged();
    return t;
  }

  private persistTournamentRecord(t: Tournament) {
    const results = [...t.players.values()]
      .filter(p => p.place !== null)
      .sort((a, b) => (a.place ?? 999) - (b.place ?? 999))
      .map(p => ({
        playerId: p.id, name: p.name, avatar: p.avatar,
        place: p.place!, prize: p.prize ?? 0, entries: p.entries,
        discordTag: p.discord?.username ?? null,
        discordVerified: p.discordVerified,
      }));
    addRecord({
      id: t.id,
      name: t.config.name,
      finishedAt: Date.now(),
      entrants: t.players.size,
      totalEntries: t.totalEntries,
      buyIn: t.config.buyIn,
      prizePool: t.prizePool,
      structure: t.config.structure,
      results,
    });
  }

  // Where a finished tournament's results are posted, or null for nowhere.
  // Per-tournament webhook wins; otherwise the shared bot + announce channel.
  // Player-hosted events are never announced: the channel speaks for the
  // operators, and a host's prizes are not Chog Games' to promise.
  announceTarget(t: Tournament): AnnounceTarget | null {
    if (t.config.playerHosted) return null;
    if (!t.discordWebhookUrl && !announceChannelId()) return null;
    return { webhookUrl: t.discordWebhookUrl, channelId: announceChannelId() };
  }

  private announceTournamentWinners(t: Tournament) {
    const target = this.announceTarget(t);
    if (!target) return;
    const paid = t.getPayouts().length;
    const winners: WinnerRow[] = [...t.players.values()]
      .filter(p => p.place !== null && p.place <= Math.max(3, Math.min(paid, 10)))
      .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
      .map(p => ({
        place: p.place!,
        name: p.name,
        prize: p.prize ?? 0,
        discordId: p.discord?.id ?? null,
        discordTag: p.discord?.username ?? null,
        discordVerified: p.discordVerified,
      }));
    void announceWinners(
      target,
      t.config.name, t.players.size, t.config.prizeText, winners,
    );
  }

  // ---------- operator lifecycle: stop, archive, delete ----------

  // Shut a live game down without discarding it: players see the result, and
  // the name stays taken until the record is deleted from the archive.
  stopGame(id: string): void {
    const t = this.tournaments.get(id);
    if (!t) throw new Error('no such tournament');
    if (t.state === 'finished' || t.state === 'cancelled') throw new Error('tournament is already over');
    // A tournament with play behind it is ended properly so everyone gets a
    // place; one that never started is simply cancelled.
    if (t.state === 'registering') t.cancel();
    else t.endNow();
    this.e.lobbyChanged();
  }

  // Drop a game from the live registry entirely. Anything still running is
  // stopped first, so this can never strand players at a table nobody owns.
  deleteGame(id: string): void {
    const t = this.tournaments.get(id);
    if (!t) throw new Error('no such tournament');
    if (t.state !== 'finished' && t.state !== 'cancelled') t.cancel();
    t.dispose();
    this.tournaments.delete(id);
    this.e.lobbyChanged();
  }

  // Remove a player from everywhere they are currently playing. Used when a
  // ban lands mid-tournament: the ban stops them coming back, this takes the
  // seat they are sitting in right now.
  ejectPlayer(playerId: string): { tournaments: number } {
    let tournaments = 0;
    for (const t of this.tournaments.values()) {
      if (t.state === 'finished' || t.state === 'cancelled') continue;
      if (!t.players.has(playerId)) continue;
      try { t.kick(playerId); tournaments += 1; } catch { /* already gone */ }
    }
    if (tournaments) this.e.lobbyChanged();
    return { tournaments };
  }

  // Remove a player from one game only. A ban scoped to a tournament should
  // cost them that tournament, not their seat at every other table.
  ejectFromGame(gameId: string, playerId: string): { tournaments: number } {
    const t = this.tournaments.get(gameId);
    if (!t || t.state === 'finished' || t.state === 'cancelled' || !t.players.has(playerId)) {
      return { tournaments: 0 };
    }
    try { t.kick(playerId); } catch { return { tournaments: 0 }; }
    this.e.lobbyChanged();
    return { tournaments: 1 };
  }

  // Every name still spoken for on the server. `over` separates a game that
  // is still running from one that has ended but has not been cleared out —
  // they need different advice when a name collides.
  liveNames(): { name: string; over: boolean }[] {
    return [...this.tournaments.values()].map(t => ({
      name: t.config.name,
      over: t.state === 'finished' || t.state === 'cancelled',
    }));
  }

  findTable(id: string): Table | null {
    for (const t of this.tournaments.values()) {
      const table = t.tables.get(id);
      if (table) return table;
    }
    return null;
  }

  lobbyView(online: number): LobbyView {
    const tournaments = [...this.tournaments.values()]
      .filter(t => t.state !== 'cancelled')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50)
      .map(t => ({
        id: t.id,
        name: t.config.name,
        state: t.state,
        players: t.players.size,
        maxPlayers: t.config.maxPlayers ?? null,
        buyIn: t.config.buyIn,
        prizePool: t.prizePool,
        level: t.level.level,
        startingStack: t.config.startingStack,
        structure: t.config.structure,
        hostName: t.hostName,
        playerHosted: !!t.config.playerHosted,
        scheduledStart: t.scheduledStart,
        createdAt: t.createdAt,
        hasSocialReq: !!t.config.social,
        topPlayers: t.state === 'finished'
          ? t.standings()
            .filter(s => s.place !== null && s.place <= 3)
            .sort((a, b) => (a.place ?? 9) - (b.place ?? 9))
            .map(s => ({ name: s.name, avatar: s.avatar, ...(s.chog ? { chog: s.chog } : {}), stack: 0, place: s.place, prize: s.prize }))
          : t.state === 'registering'
            ? []
            : t.standings().slice(0, 3)
              .filter(s => !s.busted)
              .map(s => ({ name: s.name, avatar: s.avatar, ...(s.chog ? { chog: s.chog } : {}), stack: s.stack, place: null, prize: null })),
      }));
    return { tournaments, online };
  }
}

export const registry = new Registry();
