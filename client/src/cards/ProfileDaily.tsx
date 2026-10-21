// The Cards Daily Challenge on a public profile: the streak (and the best),
// official days played and won, and the best result ever with where it placed.
import { Link } from 'react-router-dom';
import { dailyOutcome, type CardsDailyProfile } from '../../../shared/cards/daily.ts';
import './daily.css';

export default function ProfileDaily({ d }: { d: CardsDailyProfile }) {
  const s = d.streaks;
  const b = d.best;
  return (
    <section className="panel pf-daily" aria-labelledby="pf-daily-title">
      <h2 id="pf-daily-title" className="lb-h2"><span aria-hidden>📅</span> Daily Challenge</h2>
      <div className="pf-stats">
        <div className="pf-stat fire" title={s.winStreak ? `${s.winStreak} won in a row` : undefined}>
          <span className="pf-stat-icon" aria-hidden>🔥</span><b>{s.streak}</b><span>Day streak</span>
        </div>
        <div className="pf-stat"><span className="pf-stat-icon" aria-hidden>🏅</span><b>{s.best}</b><span>Best streak</span></div>
        <div className="pf-stat"><span className="pf-stat-icon" aria-hidden>📅</span><b>{d.played}</b><span>Days played</span></div>
        <div className="pf-stat win"><span className="pf-stat-icon" aria-hidden>🏆</span><b>{d.wins}</b><span>Days won</span></div>
      </div>
      {b && (
        <p className="pf-daily-best small">
          <span className="muted">Best result: </span>
          <b>Daily #{b.number}</b> — {dailyOutcome(b)}{b.won ? ` (+${b.points})` : ''}, <b>#{b.rank}</b> of {b.of}
          {' · '}<Link to="/cards#daily">Play today’s</Link>
        </p>
      )}
    </section>
  );
}
