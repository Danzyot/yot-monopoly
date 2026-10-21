// The Poker Daily on the client: the day's leaderboard and your status
// (GET /api/poker/daily), the days before, and a run (play, answer, leave).
// Every hand is dealt and graded on the server; this only shows them.
import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from '../../api.ts';
import type { PokerDailyDay, PokerDailyInfo, PokerDailyProfile, PokerReveal, PokerRunView } from '../../../../shared/poker/daily.ts';

/** Today's Poker Daily (or a past `date`); reloads when `key` changes (a sign-in). */
export function usePokerDaily(date: string | null, key: unknown, enabled = true) {
  const [info, setInfo] = useState<PokerDailyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api<PokerDailyInfo>(`/api/poker/daily${date ? `?date=${date}` : ''}`)
      .then(r => { if (live) { setInfo(r); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [date, key, tick, enabled]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { info, error, reload };
}

export function usePokerDailyHistory(open: boolean, key: unknown): PokerDailyDay[] {
  const [days, setDays] = useState<PokerDailyDay[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ days: PokerDailyDay[] }>('/api/poker/daily/history?days=14').then(r => { if (live) setDays(r.days); }).catch(() => {});
    return () => { live = false; };
  }, [open, key]);
  return days;
}

/** Start or carry on: the official run, or (once it is over) practice. */
export function playPokerDaily(opts: { practice?: boolean; fresh?: boolean } = {}): Promise<PokerRunView> {
  return api<PokerRunView>('/api/poker/daily/play', { method: 'POST', json: opts });
}

export function answerPokerDaily(run: string, index: number, choice: string): Promise<{ reveal: PokerReveal; view: PokerRunView }> {
  return api('/api/poker/daily/answer', { method: 'POST', json: { run, index, choice } });
}

/** Leave a run. Sent with keepalive, so it still goes when the page is on its way out. */
export function leavePokerDaily(run: string): Promise<unknown> {
  const token = getToken();
  return fetch('/api/poker/daily/leave', {
    method: 'POST', keepalive: true,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ run }),
  }).catch(() => {});
}

export function usePokerDailyProfile(id: string): PokerDailyProfile | null {
  const [p, setP] = useState<PokerDailyProfile | null>(null);
  useEffect(() => {
    let live = true;
    setP(null);
    api<{ profile: PokerDailyProfile | null }>(`/api/players/${encodeURIComponent(id)}/poker-daily`)
      .then(r => { if (live) setP(r.profile); }).catch(() => {});
    return () => { live = false; };
  }, [id]);
  return p;
}

/** "+2.4" / "−1.3" big blinds. */
export function evText(ev: number): string {
  const v = Math.round(ev * 10) / 10;
  return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0';
}

export const pctText = (x: number) => `${Math.round(x * 100)}%`;

/** The share link: the poker puzzle itself. */
export const pokerDailyUrl = () => `${location.origin}/poker/daily`;
