// /tournaments: every Cards tournament, live first, then upcoming, then the
// latest finished. Operators get the "Host a tournament" button; everyone
// else registers for the events they run.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { PRIZE_NOTE, tournamentUrl, type TournamentSummary } from '../../../shared/tournaments.ts';
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
          </span>
          {t.prize && <span className="tn-prize small"><span aria-hidden>🎁</span> {t.prize}</span>}
          <span className="muted small">
            {gameName(t.game)} · hosted by {t.hostName} · {t.entrants}{t.status === 'registering' && t.maxPlayers ? `/${t.maxPlayers}` : ''} players
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
  const { list, me } = useTournamentList();
  const now = useNow();

  useEffect(() => {
    document.title = `Tournaments · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);

  const all = list ?? [];
  const live = all.filter(t => t.status === 'running');
  const upcoming = all.filter(t => t.status === 'registering');
  const done = all.filter(t => t.status === 'finished' || t.status === 'cancelled');

  return (
    <div className="page tn-page">
      <header className="tn-head">
        <div className="tn-head-text">
          <h1 className="lb-title"><span aria-hidden>🏟️</span> {gameName('cards')} tournaments</h1>
          <p className="muted">Register, get seated at a table, finish near the top to go through. The last table standing crowns the champion.</p>
        </div>
        <div className="tn-head-actions">
          {me?.isAdmin
            ? <Link className="btn primary" to="/tournaments/new">＋ Host a tournament</Link>
            : !profile && <button className="btn primary" onClick={openSignIn}>Sign in to play</button>}
        </div>
      </header>

      {!list && <div className="lb-skeleton" aria-busy="true"><div className="sk sk-row" /><div className="sk sk-row" /></div>}
      {list && (
        <>
          <Section title="Live now" items={live} now={now} />
          <Section title="Upcoming" items={upcoming} now={now} empty={live.length ? undefined : 'Nothing scheduled right now — check back soon.'} />
          <Section title="Finished" items={done} now={now} />
        </>
      )}
      <p className="muted small tn-disclaimer">{PRIZE_NOTE}</p>
    </div>
  );
}
