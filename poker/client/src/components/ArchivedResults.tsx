import { Link } from 'react-router-dom';
import type { TournamentRecord } from '../../../shared/types';
import Avatar from './Avatar';
import { IconTrophy } from './icons';
import { chips, ordinal } from '../format';

// A tournament link opened after the game is gone. Instead of "not found",
// the event's permanent record: podium, every finishing place, and prizes —
// the same picture players saw the moment it ended.
export default function ArchivedResults({ record }: { record: TournamentRecord }) {
  const podium = record.results
    .filter(r => r.place <= 3)
    .sort((a, b) => a.place - b.place);
  const order = [podium[1], podium[0], podium[2]].filter(Boolean); // 2nd, 1st, 3rd
  const clsFor = (place: number) => (place === 1 ? 'first' : place === 2 ? 'second' : 'third');
  const when = new Date(record.finishedAt);

  return (
    <main className="page">
      <div className="page-head">
        <h2><IconTrophy size={22} /> {record.name}</h2>
        <span className="state-badge state-finished">Finished</span>
        <span className="elapsed-pill">
          {when.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
          {' · '}
          {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div className="spacer" />
        <Link className="btn btn-ghost btn-sm" to="/leaderboard">All-time leaderboard</Link>
      </div>

      <div className="big-status">
        This tournament is over — here is how it finished.
      </div>

      {order.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>Final Results</h3>
          <div className="podium">
            {order.map(p => (
              <div key={p.playerId} className={`podium-col ${clsFor(p.place)}`}>
                <span className="p-avatar"><Avatar value={p.avatar} size={36} /></span>
                <span className="p-name">{p.name}</span>
                <span className="p-place">{ordinal(p.place)}</span>
                {p.prize > 0 && <span className="p-prize">{chips(p.prize)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tourney-grid">
        <div className="panel" style={{ overflowX: 'auto' }}>
          <h3>Every place</h3>
          <table className="standings-table">
            <thead>
              <tr><th>#</th><th>Player</th><th>Discord</th><th>Entries</th><th>Prize</th></tr>
            </thead>
            <tbody>
              {record.results.map(r => (
                <tr key={`${r.playerId}-${r.place}`}>
                  <td className="rank">{ordinal(r.place)}</td>
                  <td>
                    <span className="tp-name">
                      <Avatar value={r.avatar} size={18} /> {r.name}
                    </span>
                  </td>
                  <td>
                    {r.discordTag
                      ? <span className="discord-badge verified">@{r.discordTag}</span>
                      : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                  </td>
                  <td>{r.entries}</td>
                  <td>{r.prize > 0 ? chips(r.prize) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h3>Tournament info</h3>
          <div className="info-grid">
            <div className="info-cell"><span className="k">Players</span><span className="v">{record.entrants}</span></div>
            <div className="info-cell"><span className="k">Total entries</span><span className="v">{record.totalEntries}</span></div>
            <div className="info-cell"><span className="k">Structure</span><span className="v">{record.structure}</span></div>
          </div>
        </div>
      </div>
    </main>
  );
}
