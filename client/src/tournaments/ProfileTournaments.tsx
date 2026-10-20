// A player's tournament record on their profile: titles, podiums, the latest events.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { tournamentUrl, type TournamentResult } from '../../../shared/tournaments.ts';
import { GAME_ICON, MEDALS, gameName, ordinal } from './bits.tsx';
import './tournaments.css';

export default function ProfileTournaments({ id }: { id: string }) {
  const [results, setResults] = useState<TournamentResult[] | null>(null);
  useEffect(() => {
    let live = true;
    api<{ results: TournamentResult[] }>(`/api/tournaments/player/${encodeURIComponent(id)}`)
      .then(r => { if (live) setResults(r.results); })
      .catch(() => { if (live) setResults([]); });
    return () => { live = false; };
  }, [id]);
  if (!results?.length) return null;
  const titles = results.filter(r => r.place === 1).length;
  const podiums = results.filter(r => r.place <= 3).length;
  return (
    <section className="panel tn-profile" aria-labelledby="pf-tourneys">
      <h2 id="pf-tourneys" className="lb-h2">Tournaments <span className="lb-count">{results.length}</span></h2>
      <div className="pf-chips">
        {titles > 0 && <span className="chip chip-win tn-badge">🏆 {titles} {titles === 1 ? 'title' : 'titles'}</span>}
        {podiums > 0 && <span className="chip">🥇🥈🥉 {podiums} on the podium</span>}
      </div>
      <ul className="tn-profile-list">
        {results.map(r => (
          <li key={r.id}>
            <span className="tn-place">{MEDALS[r.place - 1] ?? ordinal(r.place)}</span>
            <Link to={tournamentUrl(r.id)}><b>{r.name}</b></Link>
            <span className="muted small">{GAME_ICON[r.game]} {gameName(r.game)} · {ordinal(r.place)} of {r.of} · {new Date(r.endedAt).toLocaleDateString()}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
