// /tournaments: every Monopoly and Cards tournament, live first, then upcoming,
// then the latest finished; one tab per game (?game=cards). Hosts get the
// "Host a tournament" button; everyone else is told who may host.
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { TOURNEY_GAMES, PRIZE_DISCLAIMER, tournamentUrl, type TournamentGame, type TournamentSummary } from '../../../shared/tournaments.ts';
import { useTournamentList } from './net.ts';
import { GAME_ICON, StatusChip, countdown, fmtWhen, gameName, useNow } from './bits.tsx';
import './tournaments.css';

function Card({ t, now }: { t: TournamentSummary; now: number }) {
  return (
    <li>
      <Link className={`tn-card ${t.status}`} to={tournamentUrl(t.id)}>
        <span className="tn-card-icon" aria-hidden>{GAME_ICON[t.game]}</span>
        <span className="tn-card-main">
          <span className="tn-card-top">
            <b className="tn-card-name">{t.name}</b>
            <StatusChip status={t.status} paused={t.paused} />
            {t.official && <em className="tag tn-official">Official</em>}
          </span>
          {t.prize && <span className="tn-prize small"><span aria-hidden>🎁</span> {t.prize}</span>}
          <span className="muted small">
            {gameName(t.game)} · hosted by {t.hostName} · {t.entrants}{t.status === 'registering' ? `/${t.maxPlayers}` : ''} players
            {t.status === 'registering' && (t.startAt ? ` · starts ${fmtWhen(t.startAt)} (in ${countdown(t.startAt - now)})` : ' · starts when the host is ready')}
            {t.status === 'running' && t.round && ` · round ${t.round}`}
            {t.status === 'finished' && t.finishedAt && ` · ${fmtWhen(t.finishedAt)}`}
          </span>
          {t.champion && <span className="tn-champ small"><span aria-hidden>🏆</span> {t.champion.name}</span>}
        </span>
        <span className="tn-card-go" aria-hidden>›</span>
      </Link>
    </li>
  );
}

function Section({ title, items, now, empty }: { title: string; items: TournamentSummary[]; now: number; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section className="panel tn-section">
      <h2>{title} <span className="lb-count">{items.length}</span></h2>
      {items.length ? <ul className="tn-cards">{items.map(t => <Card key={t.id} t={t} now={now} />)}</ul> : <p className="muted">{empty}</p>}
    </section>
  );
}

export default function TournamentsPage() {
  const { profile, openSignIn } = useAuth();
  const [params, setParams] = useSearchParams();
  const game = TOURNEY_GAMES.find(g => g === params.get('game')) ?? null;
  const { list, me } = useTournamentList();
  const now = useNow();

  useEffect(() => {
    document.title = `Tournaments · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);

  const pick = (g: TournamentGame | null) => setParams(g ? { game: g } : {}, { replace: true });
  const shown = (list ?? []).filter(t => !game || t.game === game);
  const live = shown.filter(t => t.status === 'running');
  const upcoming = shown.filter(t => t.status === 'registering');
  const done = shown.filter(t => t.status === 'finished' || t.status === 'cancelled');

  return (
    <div className="page tn-page">
      <header className="tn-head">
        <div className="tn-head-text">
          <h1 className="lb-title"><span aria-hidden>🏟️</span> Tournaments</h1>
          <p className="muted">Register, get seated at a table, finish near the top to go through. The last table standing crowns the champion.</p>
        </div>
        <div className="tn-head-actions">
          {me?.canHost
            ? <Link className="btn primary" to={`/tournaments/new${game ? `?game=${game}` : ''}`}>＋ Host a tournament</Link>
            : !profile && <button className="btn primary" onClick={openSignIn}>Sign in to play</button>}
        </div>
      </header>
      <div className="tabs tn-tabs" role="tablist" aria-label="Game">
        <button role="tab" aria-selected={!game} className={!game ? 'on' : ''} onClick={() => pick(null)}>All games</button>
        {TOURNEY_GAMES.map(g => (
          <button key={g} role="tab" aria-selected={game === g} className={game === g ? 'on' : ''} onClick={() => pick(g)}>
            <span aria-hidden>{GAME_ICON[g]}</span> {gameName(g)}
          </button>
        ))}
      </div>
      {profile && me && !me.canHost && (
        <p className="muted small tn-hostnote">
          Hosting is for Chog Genesis holders and approved hosts. <Link to="/wallet">Link your wallet</Link> if you hold a Chog.
        </p>
      )}

      {!list && <div className="lb-skeleton" aria-busy="true"><div className="sk sk-row" /><div className="sk sk-row" /></div>}
      {list && (
        <>
          <Section title="Live now" items={live} now={now} />
          <Section title="Upcoming" items={upcoming} now={now} empty={live.length ? undefined : 'Nothing scheduled right now.'} />
          <Section title="Finished" items={done} now={now} />
        </>
      )}
      <p className="muted small tn-disclaimer">{PRIZE_DISCLAIMER}</p>
    </div>
  );
}
