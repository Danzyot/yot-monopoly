// What every game's daily shares (the Cards Daily, the Poker Daily, the
// Monopoly Daily and the /daily page that shows all three): the UTC day, its
// number, and day streaks. The dates and numbers are the Cards Daily's
// (shared/cards/daily.ts), so "Daily #12" is the same day in every game.

export { addDays, dailyDate, dailyNumber, dayIndex, isDailyDate, nextDailyAt } from './cards/daily.ts';
import { dayIndex } from './cards/daily.ts';

/**
 * Streaks from the days something happened: the run of consecutive days that
 * reaches today (or yesterday: today is not over yet), and the longest run.
 */
export function dayStreak(dates: Iterable<string>, today: string): { current: number; best: number } {
  const days = new Set([...dates].map(dayIndex).filter(Number.isFinite));
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0, run = 0, prev = NaN;
  for (const d of sorted) {
    run = d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const t = dayIndex(today);
  let current = 0;
  let d = days.has(t) ? t : t - 1;
  while (days.has(d)) { current++; d--; }
  return { current, best };
}
