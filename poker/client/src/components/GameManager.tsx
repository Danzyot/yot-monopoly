// Operator control over games that already exist: end one that is running,
// drop one that should never have been made, and read back what finished.
//
// Deleting a finished game is the only way to free its name, so the archive
// is not just a record — it is where name collisions get resolved.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CashRecord, TournamentRecord } from '../../../shared/types';
import { api } from '../api';
import { chips } from '../format';
import { ordinal } from '../format';
import { useToast } from '../toast';
import Avatar from './Avatar';
import DmDialog, { type DmTarget } from './DmDialog';

type Kind = 'cash' | 'tournament';

function when(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function lasted(from: number, to: number): string {
  const mins = Math.max(0, Math.round((to - from) / 60_000));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function LiveGames() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.liveGames>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(() => {
    api.liveGames().then(setData).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 8_000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Ending a game in front of live players, or deleting one outright, is not
  // something to do on a mis-tap.
  const run = async (kind: Kind, id: string, name: string, action: 'stop' | 'delete') => {
    const msg = action === 'stop'
      ? `End "${name}" now? Players at the table will be shown the result.`
      : `Delete "${name}"? It is removed from the site entirely.`;
    if (!window.confirm(msg)) return;
    setBusy(id);
    try {
      if (action === 'stop') await api.stopGame(kind, id);
      else await api.deleteGame(kind, id);
      toast('success', action === 'stop' ? `Ended ${name}` : `Deleted ${name}`);
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <p className="tag">Loading…</p>;
  const nothing = data.tournaments.length === 0 && data.cashTables.length === 0;
  if (nothing) return <div className="empty-note">No games on the server right now.</div>;
  const byPlayers = data.tournaments.filter(t => t.playerHosted && t.state !== 'finished' && t.state !== 'cancelled').length
    + data.cashTables.filter(t => t.playerHosted && !t.closed).length;

  return (
    <div className="panel game-admin">
      {byPlayers > 0 && (
        <p className="tag" style={{ margin: '0 0 8px' }}>
          {byPlayers} live game{byPlayers === 1 ? '' : 's'} opened by player hosts (Chog holders and approved hosts) — marked below. Open one to pause it, or end it here.
        </p>
      )}
      {data.tournaments.map(t => (
        <div key={t.id} className="game-admin-row">
          <span className={`state-badge state-${t.state}`}>{t.state}</span>
          <Link className="ga-name" to={`/t/${t.id}`}>{t.name}</Link>
          {t.playerHosted && <span className="req-pill host-pill" title="Made by a player host">Hosted by {t.hostName}</span>}
          <span className="ga-meta">
            {t.players} entrant{t.players === 1 ? '' : 's'}
            {t.state !== 'registering' && ` · ${t.alive} left · level ${t.level}`}
          </span>
          <span className="ga-when">{when(t.createdAt)}</span>
          {t.state !== 'finished' && t.state !== 'cancelled' && (
            <button className="btn btn-sm" disabled={busy === t.id}
              onClick={() => void run('tournament', t.id, t.name, 'stop')}>
              {t.state === 'registering' ? 'Cancel' : 'End now'}
            </button>
          )}
          <button className="btn btn-sm btn-danger" disabled={busy === t.id}
            onClick={() => void run('tournament', t.id, t.name, 'delete')}>
            Delete
          </button>
        </div>
      ))}
      {data.cashTables.map(t => (
        <div key={t.id} className="game-admin-row">
          <span className={`state-badge state-${t.closed ? 'cancelled' : 'running'}`}>
            {t.closed ? 'closed' : 'cash'}
          </span>
          <Link className="ga-name" to={`/table/${t.id}`}>{t.name}</Link>
          {t.playerHosted && <span className="req-pill host-pill" title="Opened by a player host">Hosted by {t.hostName}</span>}
          <span className="ga-meta">
            {t.sb}/{t.bb} · {t.players}/{t.maxSeats} seated · {t.hands} hand{t.hands === 1 ? '' : 's'}
          </span>
          <span className="ga-when">{when(t.createdAt)}</span>
          {!t.closed && (
            <button className="btn btn-sm" disabled={busy === t.id}
              onClick={() => void run('cash', t.id, t.name, 'stop')}>
              Close
            </button>
          )}
          <button className="btn btn-sm btn-danger" disabled={busy === t.id}
            onClick={() => void run('cash', t.id, t.name, 'delete')}>
            Delete
          </button>
        </div>
      ))}
    </div>
  );
}

function TournamentDetail({ rec }: { rec: TournamentRecord }) {
  // DMing a winner is most often done after the fact, from the record — the
  // live page is long gone by the time prizes get handed out.
  const [dm, setDm] = useState<DmTarget | null>(null);
  return (
    <div className="ga-detail">
      <div className="ga-detail-meta">
        {rec.entrants} entrant{rec.entrants === 1 ? '' : 's'}
        {rec.totalEntries !== rec.entrants && ` (${rec.totalEntries} entries)`}
        {' · '}{rec.structure}{' · finished '}{when(rec.finishedAt)}
      </div>
      <div className="ga-detail-rows">
        {rec.results.slice(0, 12).map(r => (
          <div key={`${r.playerId}-${r.place}`} className="ga-detail-row">
            <span className="gad-place">{ordinal(r.place)}</span>
            <Avatar value={r.avatar} size={16} />
            <span className="gad-name">{r.name}</span>
            {r.discordTag && <span className="discord-badge verified">@{r.discordTag}</span>}
            {r.prize > 0 && <span className="gad-prize">{chips(r.prize)}</span>}
            <button
              className="btn btn-sm" title={`DM ${r.name}`}
              onClick={() => setDm({
                playerId: r.playerId, name: r.name, place: r.place,
                tournamentName: rec.name, prizeText: null,
              })}
            >DM</button>
          </div>
        ))}
        {rec.results.length > 12 && (
          <div className="ga-detail-row tag">…and {rec.results.length - 12} more</div>
        )}
      </div>
      {dm && <DmDialog target={dm} onClose={() => setDm(null)} />}
    </div>
  );
}

function CashDetail({ rec }: { rec: CashRecord }) {
  return (
    <div className="ga-detail">
      <div className="ga-detail-meta">
        {rec.sb}/{rec.bb} · {rec.hands} hand{rec.hands === 1 ? '' : 's'} · ran {lasted(rec.openedAt, rec.closedAt)}
        {' · closed '}{when(rec.closedAt)}
      </div>
      <div className="ga-detail-rows">
        {rec.ledger.map(l => (
          <div key={l.playerId} className="ga-detail-row">
            <Avatar value={l.avatar} size={16} />
            <span className="gad-name">{l.name}</span>
            <span className="gad-buyin">in {chips(l.buyIn)}</span>
            <span className="gad-buyin">out {chips(l.cashOut ?? l.stack ?? 0)}</span>
            <span className={`gad-net ${l.net >= 0 ? 'up' : 'down'}`}>
              {l.net >= 0 ? '+' : ''}{chips(l.net)}
            </span>
          </div>
        ))}
        {rec.ledger.length === 0 && <div className="ga-detail-row tag">Nobody sat down.</div>}
      </div>
    </div>
  );
}

export function PastGames() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.archive>> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const refresh = useCallback(() => { api.archive().then(setData).catch(() => {}); }, []);
  useEffect(refresh, [refresh]);

  const del = async (kind: Kind, id: string, name: string) => {
    if (!window.confirm(
      `Delete the record for "${name}"?\n\nIt disappears from the leaderboard and its `
      + 'name becomes free for a new game. This cannot be undone.',
    )) return;
    setBusy(id);
    try {
      await api.deleteArchived(kind, id);
      toast('success', `Deleted ${name} — the name is free again`);
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <p className="tag">Loading…</p>;
  if (data.tournaments.length === 0 && data.cash.length === 0) {
    return <div className="empty-note">Nothing has finished yet.</div>;
  }

  const rows: { kind: Kind; id: string; name: string; ts: number; sub: string; body: React.ReactNode }[] = [
    ...data.tournaments.map(r => ({
      kind: 'tournament' as const, id: r.id, name: r.name, ts: r.finishedAt,
      sub: `${r.entrants} entrants · won by ${r.results.find(x => x.place === 1)?.name ?? '—'}`,
      body: <TournamentDetail rec={r} />,
    })),
    ...data.cash.map(r => ({
      kind: 'cash' as const, id: r.id, name: r.name, ts: r.closedAt,
      sub: `cash ${r.sb}/${r.bb} · ${r.ledger.length} player${r.ledger.length === 1 ? '' : 's'}`,
      body: <CashDetail rec={r} />,
    })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div className="panel game-admin">
      {rows.map(r => (
        <div key={`${r.kind}-${r.id}`}>
          <div className="game-admin-row">
            <span className={`state-badge state-${r.kind === 'cash' ? 'cancelled' : 'finished'}`}>
              {r.kind === 'cash' ? 'cash' : 'MTT'}
            </span>
            <button className="ga-name as-link" onClick={() => setOpen(o => (o === r.id ? null : r.id))}>
              {r.name}
            </button>
            <span className="ga-meta">{r.sub}</span>
            <span className="ga-when">{when(r.ts)}</span>
            <button className="btn btn-sm" onClick={() => setOpen(o => (o === r.id ? null : r.id))}>
              {open === r.id ? 'Hide' : 'Details'}
            </button>
            <button className="btn btn-sm btn-danger" disabled={busy === r.id}
              onClick={() => void del(r.kind, r.id, r.name)}>
              Delete
            </button>
          </div>
          {open === r.id && r.body}
        </div>
      ))}
    </div>
  );
}
