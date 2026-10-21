// The Poker Daily's card on /poker: what it is, your status today (play, carry
// on, or your score to share), your streak and today's top three.
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.tsx';
import { shareDaily, untilNext } from '../../cards/daily.ts';
import { formatTime, pokerShareText } from '../../../../shared/poker/daily.ts';
import { pokerDailyUrl, usePokerDaily } from './pokerDaily.ts';
import { Grid, POKER_DAILY_BLURB, PokerBoard } from './PokerDaily.tsx';
import './pokerDaily.css';

export default function DailyPokerCard() {
  const { profile } = useAuth();
  const { info, error } = usePokerDaily(null, profile?.id);
  if (error && !info) return null;
  if (!info) return <section className="panel pd-card-home pd-loading" aria-busy="true" />;
  const you = info.you;
  const streak = you?.streaks.streak ?? 0;
  const r = you?.result;
  return (
    <section className="panel pd-card-home" id="daily" aria-labelledby="pd-home-title">
      <div className="pd-home-head">
        <span className="pd-home-cards" aria-hidden>
          <span className="pd-card sm"><b>A</b><i>♠</i></span>
          <span className="pd-card sm red"><b>K</b><i>♥</i></span>
        </span>
        <div className="pd-home-titles">
          <h2 id="pd-home-title">Daily Hands <span className="pd-num">#{info.number}</span></h2>
          <p className="muted small">{POKER_DAILY_BLURB} New hands in {untilNext(info.endsAt)}.</p>
        </div>
        {streak > 0 && <span className="pd-streak-badge" title={`Best: ${you!.streaks.best}`}>🔥<b>{streak}</b></span>}
      </div>
      {r ? (
        <div className="pd-home-result">
          <span className="pd-home-score"><b>{r.points}</b>/100</span>
          <span className="grow"><Grid grid={r.grid} /><span className="muted small"> {formatTime(r.timeMs)}{you?.rank ? ` · #${you.rank} of ${info.players}` : ''}</span></span>
        </div>
      ) : null}
      <div className="pd-actions">
        {you?.status === 'done' && r ? (
          <>
            <button type="button" className="btn primary" onClick={() => void shareDaily(pokerShareText({ date: info.date, result: r, streak, url: pokerDailyUrl() }))}>📋 Share</button>
            <Link className="btn ghost" to="/poker/daily">See your hands</Link>
          </>
        ) : you?.status === 'playing' ? (
          <Link className="btn primary" to="/poker/daily">▶ Carry on (hand {you.answered + 1})</Link>
        ) : (
          <Link className="btn primary" to="/poker/daily">▶ {profile ? 'Play today’s hands' : 'Play'}</Link>
        )}
      </div>
      {info.leaders.length > 0 && <PokerBoard rows={info.leaders.slice(0, 3)} me={profile?.id} empty="" />}
    </section>
  );
}
