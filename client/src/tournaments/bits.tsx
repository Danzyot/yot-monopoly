// Small pieces the tournament pages share: names, icons, times.
import { useEffect, useState } from 'react';
import { GAMES } from '../../../shared/brand.ts';
import type { TournamentGame, TournamentStatus } from '../../../shared/tournaments.ts';

export const GAME_ICON: Record<TournamentGame, string> = { monopoly: '🎩', cards: '🃏' };
export const gameName = (g: TournamentGame) => GAMES[g].name;

export const STATUS_LABEL: Record<TournamentStatus, string> = {
  registering: 'Registration open', running: 'Live', finished: 'Finished', cancelled: 'Cancelled',
};

export function StatusChip({ status, paused }: { status: TournamentStatus; paused?: boolean }) {
  return <span className={`tn-status ${status}${paused ? ' paused' : ''}`}>{paused ? 'Paused' : STATUS_LABEL[status]}</span>;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export const MEDALS = ['🥇', '🥈', '🥉'];

/** "Fri 24 Oct, 20:00" in the viewer's own time zone. */
export function fmtWhen(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ts);
}

/** "4:05", "1h 02m" or "2d 3h" until `ms` from now. */
export function countdown(ms: number): string {
  if (ms <= 0) return 'any moment';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Re-renders every second (countdowns), on the server's clock when `skew` is given. */
export function useNow(skew = 0): number {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    setNow(Date.now() + skew);
    const iv = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => clearInterval(iv);
  }, [skew]);
  return now;
}
