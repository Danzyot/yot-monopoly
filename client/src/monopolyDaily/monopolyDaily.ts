// The Monopoly Daily Challenge on the client: today's game and leaderboard
// (GET /api/monopoly/daily), the days before (/history) and playing it
// (room:daily over the socket: the server decides official or practice).
// Sharing and the countdown are the Cards daily's (../cards/daily.ts).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { call } from '../net.ts';
import type { MonopolyDailyDay, MonopolyDailyInfo } from '../../../shared/monopolyDaily.ts';

export { shareDaily, untilNext } from '../cards/daily.ts';

/** Today's daily, or one past `date`; reloads when `key` changes (a sign-in). Nothing is asked for while `enabled` is false. */
export function useMonopolyDaily(date: string | null, key: unknown, enabled = true) {
  const [info, setInfo] = useState<MonopolyDailyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api<MonopolyDailyInfo>(`/api/monopoly/daily${date ? `?date=${date}` : ''}`)
      .then(r => { if (live) { setInfo(r); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [date, key, tick, enabled]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { info, error, reload };
}

/** The days before today (only fetched when the leaderboard is opened). */
export function useMonopolyDailyHistory(open: boolean, key: unknown): MonopolyDailyDay[] {
  const [days, setDays] = useState<MonopolyDailyDay[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ days: MonopolyDailyDay[] }>('/api/monopoly/daily/history?days=14').then(r => { if (live) setDays(r.days); }).catch(() => {});
    return () => { live = false; };
  }, [open, key]);
  return days;
}

/** Start (or go back to) today's game: { code, practice, resumed }. */
export function playMonopolyDaily() {
  return call<{ code: string; practice: boolean; resumed: boolean }>('room:daily');
}

/** The share link: the Monopoly page, opened at the daily. */
export const monopolyDailyUrl = () => `${location.origin}/monopoly#daily`;
