// The Monopoly Daily Challenge on a public profile, beside the Cards one: the
// streak (and the best), official days played and won, and the best result
// ever with where it placed.
import { Link } from 'react-router-dom';
import { getMap } from '../../../shared/maps.ts';
import { GAMES } from '../../../shared/brand.ts';
import { monopolyDailyOutcome, type MonopolyDailyProfile } from '../../../shared/monopolyDaily.ts';
import '../cards/daily.css';

export default function ProfileMonopolyDaily({ d }: { d: MonopolyDailyProfile }) {
  const s = d.streaks;
  const b = d.best;
  return (
    <section className="panel pf-daily" aria-labelledby="pf-mdaily-title">
      <h2 id="pf-mdaily-title" className="lb-h2"><span aria-hidden>📅</span> {GAMES.monopoly.name} Daily Challenge</h2>
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
          <b>Daily #{b.number}</b> on {getMap(b.mapId).name} — {monopolyDailyOutcome(b)}, <b>#{b.rank}</b> of {b.of}
          {' · '}<Link to={`${GAMES.monopoly.path}#daily`}>Play today’s</Link>
        </p>
      )}
    </section>
  );
}
