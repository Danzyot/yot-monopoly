// "Next tournament": the soonest Cards tournament to look forward to (open
// for registration, or a recurring schedule's next one), for the Cards page
// and the hub's Cards card. Small on purpose: one fetch of
// /api/tournaments/next, refreshed every few minutes, no socket.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import type { NextTournament } from '../../../shared/tournamentSchedules.ts';

const REFRESH_MS = 5 * 60_000;

/** "2d 3h", "4h 05m", "12 min", "now". */
function until(ms: number): string {
  if (ms <= 60_000) return 'now';
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${m} min`;
}

export function useNextTournament(): { next: NextTournament | null; now: number } {
  const [next, setNext] = useState<NextTournament | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ next: NextTournament | null }>('/api/tournaments/next').then(r => { if (alive) setNext(r.next); }).catch(() => {});
    load();
    const refresh = setInterval(load, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; clearInterval(refresh); clearInterval(clock); };
  }, []);
  // Gone by: drop it until the next refresh brings the one after.
  return { next: next && next.start > now - 60_000 ? next : null, now };
}

/** The chip on the Cards page. */
export function NextTournamentChip() {
  const { next, now } = useNextTournament();
  if (!next) return null;
  return (
    <Link className="tn-next-chip" to={next.href}>
      <span aria-hidden>🏆</span>
      <span><small>Next tournament</small> <b>{next.name}</b></span>
      <span className="tn-next-when">{next.open ? 'Register · ' : ''}in {until(next.start - now)}</span>
    </Link>
  );
}

/** The hub's Cards card: its "Tournaments" link, saying when the next one is. */
export function NextTournamentLink() {
  const { next, now } = useNextTournament();
  return <Link to={next?.href ?? '/tournaments'}>{next ? `Next tournament in ${until(next.start - now)}` : 'Tournaments'}</Link>;
}
