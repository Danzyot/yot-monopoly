import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry, TournamentRecord } from '../../../shared/types';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import { chips, timeAgo, ordinal } from '../format';

export default function Leaderboard() {
  const { profile } = useAuth();
  const [data, setData] = useState<{ leaderboard: LeaderboardEntry[]; recent: TournamentRecord[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <h2>Leaderboard</h2>
        <div className="spacer" />
        {/* /lobby is operator-only and bounces players — send everyone home. */}
        <Link className="btn btn-ghost btn-sm" to="/">← Home</Link>
      </div>

      {error && <div className="empty-note">Could not load the leaderboard.</div>}
      {!data && !error && <div className="empty-note">Loading…</div>}

      {data && (
        <div className="tourney-grid">
          <div className="panel" style={{ overflowX: 'auto' }}>
            <h3>All-time rankings</h3>
            {data.leaderboard.length === 0 ? (
              <p style={{ color: 'var(--text-faint)' }}>
                No finished tournaments yet — rankings appear after the first one completes.
              </p>
            ) : (
              <table className="standings-table">
                <thead>
                  <tr>
                    <th>#</th><th>Player</th><th>Points</th><th>Wins</th>
                    <th>Cashes</th><th>Winnings</th><th>Played</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaderboard.map((e, i) => (
                    <tr key={e.playerId} className={e.playerId === profile?.id ? 'me' : ''}>
                      <td className="rank">{i + 1}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Avatar value={e.avatar} size={18} chog={e.chog} /> {e.name}
                          {e.discordTag && <span className="discord-badge verified">@{e.discordTag}</span>}
                        </span>
                      </td>
                      <td><strong>{e.points}</strong></td>
                      <td>{e.wins}</td>
                      <td>{e.cashes}</td>
                      <td>{chips(e.winnings)}</td>
                      <td>{e.tournaments}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginTop: 12 }}>
              Points: 100 · 70 · 50 · 40 · 32 for the top five, 22 through 9th,
              10 inside the top 15%, 2 for playing.
            </p>
          </div>

          <div className="panel">
            <h3>Recent tournaments</h3>
            {data.recent.length === 0 ? (
              <p style={{ color: 'var(--text-faint)' }}>Nothing finished yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.recent.map(r => (
                  <div key={`${r.id}-${r.finishedAt}`} className="table-link-row" style={{ alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <strong>{r.name}</strong>
                      <span style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}>
                        {r.totalEntries} entries · {chips(r.prizePool)} pool · {timeAgo(r.finishedAt)}
                      </span>
                      <span style={{ fontSize: '0.84rem' }}>
                        {[...r.results].sort((a, b) => a.place - b.place).slice(0, 3).map(w => (
                          <span key={w.playerId} style={{ marginRight: 10 }}>
                            {['🥇', '🥈', '🥉'][w.place - 1] ?? ordinal(w.place)} {w.name}
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
