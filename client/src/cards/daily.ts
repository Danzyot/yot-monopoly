// The Cards Daily Challenge on the client: today's table and leaderboard
// (GET /api/cards/daily), the days before (/history), playing it (cards:daily
// over the socket: the server decides official or practice) and the share.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { toast } from '../toast.tsx';
import { cardsCall, chogPref } from './net.ts';
import type { CardsDailyDay, CardsDailyInfo } from '../../../shared/cards/daily.ts';

/** Today's daily, or one past `date`; reloads when `key` changes (a sign-in). Nothing is asked for while `enabled` is false. */
export function useCardsDaily(date: string | null, key: unknown, enabled = true) {
  const [info, setInfo] = useState<CardsDailyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api<CardsDailyInfo>(`/api/cards/daily${date ? `?date=${date}` : ''}`)
      .then(r => { if (live) { setInfo(r); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [date, key, tick, enabled]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { info, error, reload };
}

/** The days before today (only fetched when the leaderboard is opened). */
export function useCardsDailyHistory(open: boolean, key: unknown): CardsDailyDay[] {
  const [days, setDays] = useState<CardsDailyDay[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ days: CardsDailyDay[] }>('/api/cards/daily/history?days=14').then(r => { if (live) setDays(r.days); }).catch(() => {});
    return () => { live = false; };
  }, [open, key]);
  return days;
}

/** Deal (or go back to) today's daily: { code, practice, resumed }. */
export function playCardsDaily() {
  return cardsCall<{ code: string; practice: boolean; resumed: boolean }>('cards:daily', chogPref());
}

/** Copy the share text (Wordle style); the phone's share sheet when there is no clipboard. */
export async function shareDaily(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Result copied — paste it anywhere');
    return;
  } catch { /* no clipboard (an insecure page, a refusal): try the share sheet */ }
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch { /* dismissed */ return; }
  toast('Could not copy — select the text and copy it yourself');
}

/** "4h 12m" until the next deal. */
export function untilNext(endsAt: number, now = Date.now()): string {
  const m = Math.max(0, Math.ceil((endsAt - now) / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
