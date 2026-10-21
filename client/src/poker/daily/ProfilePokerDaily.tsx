// The Poker Daily on a public profile: the streak (and the best), days played,
// the average score and the best run. Nothing at all before a first run.
import { Link } from 'react-router-dom';
import { formatTime } from '../../../../shared/poker/daily.ts';
import { usePokerDailyProfile } from './pokerDaily.ts';
import './pokerDaily.css';

export default function ProfilePokerDaily({ id }: { id: string }) {
  const d = usePokerDailyProfile(id);
  if (!d) return null;
  const b = d.best;
  return (
    <section className="panel pf-daily" aria-labelledby="pf-pd-title">
      <h2 id="pf-pd-title" className="lb-h2"><span aria-hidden>♠️</span> Poker Daily</h2>
      <div className="pf-stats">
        <div className="pf-stat fire"><span className="pf-stat-icon" aria-hidden>🔥</span><b>{d.streaks.streak}</b><span>Day streak</span></div>
        <div className="pf-stat"><span className="pf-stat-icon" aria-hidden>🏅</span><b>{d.streaks.best}</b><span>Best streak</span></div>
        <div className="pf-stat"><span className="pf-stat-icon" aria-hidden>📅</span><b>{d.played}</b><span>Days played</span></div>
        <div className="pf-stat win"><span className="pf-stat-icon" aria-hidden>🎯</span><b>{d.average}</b><span>Average /100</span></div>
      </div>
      {b && (
        <p className="pf-daily-best small">
          <span className="muted">Best run: </span>
          <b>Daily #{b.number}</b> — {b.points}/100 in {formatTime(b.timeMs)}, <b>#{b.rank}</b> of {b.of}
          {' · '}<Link to="/poker/daily">Play today’s</Link>
        </p>
      )}
    </section>
  );
}
