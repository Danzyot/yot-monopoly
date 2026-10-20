// The strip over a tournament table: which event and round
// this is, how long until it starts or runs out, and the way back.
import { Link } from 'react-router-dom';
import { tournamentUrl, type TournamentTableInfo } from '../../../shared/tournaments.ts';
import { countdown, useNow } from './bits.tsx';
import './tournaments.css';

export default function TournamentBar({ info, status, skew = 0 }: { info: TournamentTableInfo; status: 'lobby' | 'playing' | 'finished'; skew?: number }) {
  const now = useNow(skew);
  return (
    <div className="tn-bar" role="status">
      <span aria-hidden>🏟️</span>
      <span className="tn-bar-text">
        <b>{info.name}</b> · {info.final ? 'Final' : `Round ${info.round}`}
        {status === 'lobby' && (info.startsBy ? ` · starts in ${countdown(info.startsBy - now)} (or when everyone is here)` : ' · seats are assigned')}
        {status === 'playing' && info.endsAt && ` · ${countdown(info.endsAt - now)} left`}
      </span>
      <Link className="btn tiny" to={tournamentUrl(info.id)}>{status === 'finished' ? 'Back to the tournament' : 'Bracket'}</Link>
    </div>
  );
}
