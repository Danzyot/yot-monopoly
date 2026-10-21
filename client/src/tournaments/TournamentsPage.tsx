// /tournaments: every Cards tournament, live first, then upcoming (open for
// registration, and the recurring schedules' next events not created yet),
// then the latest finished. Operators get the "Host a tournament" button and
// the Schedules section; everyone else registers for the events they run.
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { BRAND } from '../../../shared/brand.ts';
import { modeLabel } from '../../../shared/cards/rules.ts';
import { PRIZE_NOTE, tournamentUrl, type TournamentSummary } from '../../../shared/tournaments.ts';
import type { ScheduledEvent } from '../../../shared/tournamentSchedules.ts';
import { useTournamentList } from './net.ts';
import { GAME_ICON, StatusChip, countdown, fmtWhen, gameName, useNow } from './bits.tsx';
import Schedules from './Schedules.tsx';
import './tournaments.css';

/** The big "starts in" on an upcoming card. */
function Countdown({ at, now, label = 'Starts in' }: { at: number; now: number; label?: string }) {
  return (
    <span className="tn-count" aria-label={`${label} ${countdown(at - now)}`}>
      <small>{label}</small>
      <b>{countdown(at - now)}</b>
    </span>
  );
}

/** A recurring schedule's next event, before it is created: registration is not open yet. */
function ScheduledCard({ e, now }: { e: ScheduledEvent; now: number }) {
  return (
    <li>
      <div className="tn-card scheduled">
        <span className="tn-card-icon" aria-hidden>🗓️</span>
        <span className="tn-card-main">
          <span className="tn-card-top">
            <b className="tn-card-name">{e.name}</b>
            <span className="tn-status scheduled">Scheduled</span>
          </span>
          {e.prize && <span className="tn-prize small"><span aria-hidden>🎁</span> {e.prize}</span>}
          <span className="muted small">
            {gameName('cards')} · {modeLabel(e.cardsMode)}{e.maxPlayers ? ` · up to ${e.maxPlayers} players` : ''} · starts {fmtWhen(e.start)}
          </span>
          <span className="small tn-opens">
            {e.opensAt > now ? <>Registration opens {fmtWhen(e.opensAt)} (in {countdown(e.opensAt - now)})</> : 'Registration opens any moment'}
          </span>
        </span>
        <Countdown at={e.start} now={now} />
      </div>
    </li>
  );
}

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
            {gameName(t.game)}{t.cardsMode === 'chaos' ? ` · ${modeLabel(t.cardsMode)}` : ''} · {t.scheduleId ? 'recurring' : `hosted by ${t.hostName}`} · {t.entrants}{t.status === 'registering' && t.maxPlayers ? `/${t.maxPlayers}` : ''} players
            {t.status === 'registering' && (t.startAt ? ` · starts ${fmtWhen(t.startAt)}` : ' · starts when the host is ready')}
            {t.status === 'running' && t.round && ` · round ${t.round}`}
            {t.status === 'finished' && t.finishedAt && ` · ${fmtWhen(t.finishedAt)}`}
          </span>
          {t.champion && <span className="tn-champ small"><span aria-hidden>🏆</span> {t.champion.name}</span>}
        </span>
        {t.status === 'registering' && t.startAt
          ? <Countdown at={t.startAt} now={now} />
          : <span className="tn-card-go" aria-hidden>›</span>}
      </Link>
    </li>
  );
}

function Section({ title, items, now, empty, scheduled = [] }: {
  title: string; items: TournamentSummary[]; now: number; empty?: string; scheduled?: ScheduledEvent[];
}) {
  const count = items.length + scheduled.length;
  if (!count && !empty) return null;
  // Open events and scheduled ones together, soonest first (an open event with no set start goes first).
  const rows = [
    ...items.map(t => ({ at: t.startAt ?? 0, key: t.id, el: <Card key={t.id} t={t} now={now} /> })),
    ...scheduled.map(e => ({ at: e.start, key: `s-${e.scheduleId}`, el: <ScheduledCard key={`s-${e.scheduleId}`} e={e} now={now} /> })),
  ].sort((a, b) => a.at - b.at);
  return (
    <section className="panel tn-section">
      <h2>{title} <span className="lb-count">{count}</span></h2>
      {count ? <ul className="tn-cards">{rows.map(r => r.el)}</ul> : <p className="muted">{empty}</p>}
    </section>
  );
}

export default function TournamentsPage() {
  const { profile, openSignIn } = useAuth();
  const { list, scheduled, me } = useTournamentList();
  const now = useNow();
  const { hash } = useLocation();

  useEffect(() => {
    document.title = `Tournaments · ${BRAND.name}`;
    return () => { document.title = BRAND.name; };
  }, []);
  // /tournaments#schedules (from the create form): there once the section is drawn.
  useEffect(() => {
    if (hash === '#schedules' && me?.isAdmin) document.getElementById('schedules')?.scrollIntoView({ block: 'start' });
  }, [hash, me?.isAdmin]);

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
          <Section title="Upcoming" items={upcoming} scheduled={scheduled} now={now} empty={live.length ? undefined : 'Nothing scheduled right now — check back soon.'} />
          {me?.isAdmin && <Schedules />}
          <Section title="Finished" items={done} now={now} />
        </>
      )}
      <p className="muted small tn-disclaimer">{PRIZE_NOTE}</p>
    </div>
  );
}
