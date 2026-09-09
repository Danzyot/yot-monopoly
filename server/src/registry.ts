import type { ChatMsg, LobbyView, TableReaction, TournamentConfig } from '../../shared/types.ts';
import { announceChannelId, announceWinners, type WinnerRow } from './discord.ts';
import { Table } from './engine/table.ts';
import { noteAction, recordHandResult } from './audit.ts';
import { addCashRecord, addRecord } from './store.ts';
import { Tournament, type TournamentSnap } from './tournament/tournament.ts';

// Serialized cash-table state for restart recovery.
export interface CashTableSnap {
  id: string; name: string; sb: number; bb: number; ante: number;
  maxSeats: number; minBuy: number; maxBuy: number;
  hostId: string | null; hostName: string;
  actionTimeMs: number; timebankMs: number; rabbitHunting: boolean;
  theme?: import('../../shared/types.ts').TableTheme | null;
  buttonSeat: number; handNumber: number;
  seats: {
    idx: number; player: { id: string; name: string; avatar: string };
    stack: number; sittingOut: boolean; timebankMs: number; buyInTotal: number;
  }[];
  history?: ReturnType<Table['snapshotHistory']>;
}

// Emitter contract implemented by the socket layer.
export interface Emitter {
  broadcastTable: (table: Table) => void;
  tableChat: (table: Table, msg: ChatMsg) => void;
  tableEvent: (table: Table, text: string) => void;
  tableReaction: (table: Table, r: TableReaction) => void;
  // A cash player has run out of chips — told only to them.
  cashBust: (table: Table, info: import('./engine/table.ts').CashBustInfo) => void;
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
  cashTables = new Map<string, Table>();
  tournaments = new Map<string, Tournament>();
  private hostNames = new Map<string, string>(); // tableId -> host name
  emitter: Emitter | null = null;

  private get e(): Emitter {
    if (!this.emitter) throw new Error('emitter not attached');
    return this.emitter;
  }

  private cashCallbacks() {
    return {
      broadcast: (t: Table) => this.e.broadcastTable(t),
      chat: (t: Table, m: ChatMsg) => this.e.tableChat(t, m),
      event: (t: Table, m: string) => this.e.tableEvent(t, m),
      audit: (t: Table, e: Parameters<NonNullable<Table['cb']['audit']>>[1]) => {
        if (e.kind === 'handEnd') {
          recordHandResult(t, e.contenders, {
            contenders: e.contenders, board: e.board,
            tableName: e.tableName, handNumber: e.handNumber,
          });
          return;
        }
        noteAction({
          ts: Date.now(), tableId: t.id, tableName: t.name, handNumber: e.handNumber,
          playerId: e.playerId, playerName: e.playerName,
          action: e.action, amount: e.amount, pot: e.pot,
        });
      },
      reaction: (t: Table, r: TableReaction) => this.e.tableReaction(t, r),
      onHandEnd: () => this.e.lobbyChanged(),
      cashBust: (t: Table, info: import('./engine/table.ts').CashBustInfo) => this.e.cashBust(t, info),
    };
  }

  createCashTable(
    opts: {
      name: string; sb: number; bb: number; minBuy: number; maxBuy: number; maxSeats: number;
      ante?: number; rabbitHunting?: boolean; actionSeconds?: number; timebankSeconds?: number;
      // A cash game may run a rising blind schedule like a tournament's.
      levels?: import('../../shared/types.ts').CustomBlindLevel[] | null;
      displayMode?: 'chips' | 'bb';
      theme?: import('../../shared/types.ts').TableTheme | null;
    },
    host: { id: string; name: string },
  ): Table {
    const table = new Table({
      name: opts.name,
      mode: 'cash',
      sb: opts.sb,
      bb: opts.bb,
      ante: opts.ante ?? 0,
      maxSeats: opts.maxSeats,
      cash: { minBuy: opts.minBuy, maxBuy: opts.maxBuy },
      hostId: host.id,
      rabbitHunting: opts.rabbitHunting,
      actionTimeMs: (opts.actionSeconds ?? 22) * 1000,
      timebankMs: Math.max(0, opts.timebankSeconds ?? 0) * 1000,
      levels: opts.levels ?? null,
      displayMode: opts.displayMode ?? 'chips',
      theme: opts.theme ?? null,
    }, this.cashCallbacks());
    this.cashTables.set(table.id, table);
    this.hostNames.set(table.id, host.name);
    this.e.lobbyChanged();
    return table;
  }

  // ---------- crash-safe persistence ----------
  cashSnapshot(t: Table): CashTableSnap {
    return {
      id: t.id, name: t.name, sb: t.sb, bb: t.bb, ante: t.ante,
      maxSeats: t.maxSeats,
      minBuy: t.cash?.minBuy ?? 0, maxBuy: t.cash?.maxBuy ?? 0,
      hostId: t.hostId, hostName: this.hostNames.get(t.id) ?? '—',
      actionTimeMs: t.actionTimeMs, timebankMs: t.timebankMs, rabbitHunting: t.rabbitHunting,
      theme: t.theme,
      buttonSeat: t.buttonSeat, handNumber: t.handNumber,
      seats: t.snapshotSeats(),
      history: t.snapshotHistory(),
    };
  }

  restoreCashTable(snap: CashTableSnap): Table {
    const table = new Table({
      id: snap.id,
      name: snap.name,
      mode: 'cash',
      sb: snap.sb,
      bb: snap.bb,
      ante: snap.ante,
      maxSeats: snap.maxSeats,
      cash: { minBuy: snap.minBuy, maxBuy: snap.maxBuy },
      hostId: snap.hostId ?? undefined,
      rabbitHunting: snap.rabbitHunting,
      actionTimeMs: snap.actionTimeMs,
      timebankMs: snap.timebankMs ?? 0,
      theme: snap.theme ?? null,
    }, this.cashCallbacks());
    table.buttonSeat = snap.buttonSeat;
    table.handNumber = snap.handNumber;
    table.restoreHistory(snap.history);
    for (const seat of snap.seats) {
      table.seats[seat.idx] = {
        player: { ...seat.player },
        stack: seat.stack,
        sittingOut: seat.sittingOut,
        buyInTotal: seat.buyInTotal,
        timebankMs: seat.timebankMs,
        missedTurns: 0,
        ghostHands: 0,
      };
    }
    this.cashTables.set(table.id, table);
    this.hostNames.set(table.id, snap.hostName);
    table.scheduleStart();
    return table;
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
    t.discordWebhookUrl = discordWebhookUrl ?? null;
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

  private announceTournamentWinners(t: Tournament) {
    // Per-tournament webhook wins; otherwise the shared bot + announce channel.
    if (!t.discordWebhookUrl && !announceChannelId()) return;
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
      { webhookUrl: t.discordWebhookUrl, channelId: announceChannelId() },
      t.config.name, t.players.size, t.config.prizeText, winners,
    );
  }

  // ---------- operator lifecycle: stop, archive, delete ----------

  // Filing a closed cash table into the archive. Called on every close so the
  // record exists whether the host clicked the button or an admin did.
  archiveCashTable(t: Table): void {
    if (t.mode !== 'cash') return;
    addCashRecord({
      id: t.id,
      name: t.name,
      hostName: this.hostNames.get(t.id) ?? '—',
      openedAt: t.createdAt,
      closedAt: Date.now(),
      sb: t.sb, bb: t.bb,
      hands: t.handNumber,
      ledger: t.ledger(),
    });
  }

  // Shut a live game down without discarding it: players see the result, and
  // the name stays taken until the record is deleted from the archive.
  stopGame(kind: 'cash' | 'tournament', id: string): void {
    if (kind === 'cash') {
      const t = this.cashTables.get(id);
      if (!t) throw new Error('no such table');
      if (t.closed) throw new Error('table already closed');
      t.closeByHost();
      this.archiveCashTable(t);
      this.e.lobbyChanged();
      return;
    }
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
  deleteGame(kind: 'cash' | 'tournament', id: string): void {
    if (kind === 'cash') {
      const t = this.cashTables.get(id);
      if (!t) throw new Error('no such table');
      if (!t.closed) { t.closeByHost(); this.archiveCashTable(t); }
      t.close();
      this.cashTables.delete(id);
      this.hostNames.delete(id);
      this.e.lobbyChanged();
      return;
    }
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
  ejectPlayer(playerId: string): { tournaments: number; tables: number } {
    let tournaments = 0;
    let tables = 0;
    for (const t of this.tournaments.values()) {
      if (t.state === 'finished' || t.state === 'cancelled') continue;
      if (!t.players.has(playerId)) continue;
      try { t.kick(playerId); tournaments += 1; } catch { /* already gone */ }
    }
    for (const table of this.cashTables.values()) {
      if (table.closed || table.playerSeat(playerId) === null) continue;
      try { table.stand(playerId); tables += 1; } catch { /* mid-hand or already up */ }
    }
    if (tournaments || tables) this.e.lobbyChanged();
    return { tournaments, tables };
  }

  // Remove a player from one game only. A ban scoped to a tournament should
  // cost them that tournament, not their seat at every other table.
  ejectFromGame(gameId: string, playerId: string): { tournaments: number; tables: number } {
    const t = this.tournaments.get(gameId);
    if (t) {
      if (t.state === 'finished' || t.state === 'cancelled' || !t.players.has(playerId)) {
        return { tournaments: 0, tables: 0 };
      }
      try { t.kick(playerId); } catch { return { tournaments: 0, tables: 0 }; }
      this.e.lobbyChanged();
      return { tournaments: 1, tables: 0 };
    }
    const table = this.cashTables.get(gameId);
    if (table && !table.closed && table.playerSeat(playerId) !== null) {
      try { table.stand(playerId); } catch { return { tournaments: 0, tables: 0 }; }
      this.e.lobbyChanged();
      return { tournaments: 0, tables: 1 };
    }
    return { tournaments: 0, tables: 0 };
  }

  // Every name still spoken for on the server. `over` separates a game that
  // is still running from one that has ended but has not been cleared out —
  // they need different advice when a name collides.
  liveNames(): { name: string; over: boolean }[] {
    return [
      ...[...this.tournaments.values()].map(t => ({
        name: t.config.name,
        over: t.state === 'finished' || t.state === 'cancelled',
      })),
      ...[...this.cashTables.values()].map(t => ({ name: t.name, over: t.closed })),
    ];
  }

  findTable(id: string): Table | null {
    const cash = this.cashTables.get(id);
    if (cash) return cash;
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
        maxPlayers: t.config.maxPlayers,
        buyIn: t.config.buyIn,
        prizePool: t.prizePool,
        level: t.level.level,
        startingStack: t.config.startingStack,
        structure: t.config.structure,
        hostName: t.hostName,
        scheduledStart: t.scheduledStart,
        createdAt: t.createdAt,
        hasSocialReq: !!t.config.social,
        topPlayers: t.state === 'finished'
          ? t.standings()
            .filter(s => s.place !== null && s.place <= 3)
            .sort((a, b) => (a.place ?? 9) - (b.place ?? 9))
            .map(s => ({ name: s.name, avatar: s.avatar, stack: 0, place: s.place, prize: s.prize }))
          : t.state === 'registering'
            ? []
            : t.standings().slice(0, 3)
              .filter(s => !s.busted)
              .map(s => ({ name: s.name, avatar: s.avatar, stack: s.stack, place: null, prize: null })),
      }));
    const cashTables = [...this.cashTables.values()]
      .filter(t => !t.closed)
      .sort((a, b) => b.seatedCount() - a.seatedCount())
      .slice(0, 50)
      .map(t => ({
        id: t.id,
        name: t.name,
        sb: t.sb,
        bb: t.bb,
        players: t.seatedCount(),
        maxSeats: t.maxSeats,
        minBuy: t.cash?.minBuy ?? 0,
        maxBuy: t.cash?.maxBuy ?? 0,
        createdAt: 0,
        hostName: this.hostNames.get(t.id) ?? '—',
      }));
    return { tournaments, cashTables, online };
  }
}

export const registry = new Registry();
