// Recurring tournaments: an operator's standing order such as "Monday Night
// Cup, every Monday 20:00 UTC, Chog Chaos", from which the server creates
// each event a set time ahead (the lead time), so players can register in
// advance. Every created event is an ordinary admin tournament; the scheduler
// is server/src/tournament/schedules.ts, the admin section and the public
// "Upcoming" list are client/src/tournaments/.
//
// Times are UTC: a weekday and a minute past UTC midnight, so there is no
// daylight saving to trip over. Pages show the viewer's own time beside it.

import type { CardsGameMode } from './cards/rules.ts';
import type { TournamentSettings } from './tournaments.ts';

export const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** UTC weekdays, as Date#getUTCDay numbers them (0 = Sunday). */
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
/** The order the pages list them in: the week starting on Monday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Leaves room for " #9999" in a tournament name (TOURNEY_NAME_MAX). */
export const SCHEDULE_NAME_MAX = 40;
/** Where the number goes in a name pattern; without it, " #n" is added at the end. */
export const SCHEDULE_NUMBER_TOKEN = '{n}';
export const MAX_SCHEDULES = 30;
/** Lead times on offer (minutes before the start that the event is created and opens for registration). */
export const SCHEDULE_LEAD_MINUTES = [30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080];
export const SCHEDULE_DEFAULT_LEAD_MINUTES = 1440;
/** The log of what a schedule did (created, skipped), newest first, is this long. */
export const SCHEDULE_LOG_MAX = 12;

/** A schedule's tournament settings: everything but the start, which the schedule sets. */
export type ScheduleSettings = Omit<TournamentSettings, 'startAt'>;

/** What tourney:sched:save takes (with `id` to edit one). Everything is checked on the server. */
export interface TournamentScheduleInput {
  id?: string;
  /** "Monday Night Cup" (becomes "Monday Night Cup #3"), or with {n} where the number goes. */
  name: string;
  /** UTC weekdays, 0 = Sunday. */
  days: number[];
  /** Minutes past UTC midnight (20:00 UTC = 1200). */
  minute: number;
  prize?: string;
  settings?: Partial<ScheduleSettings>;
  leadMinutes: number;
  enabled?: boolean;
  /** The number the next event gets. */
  nextNumber?: number;
}

export type ScheduleLogKind = 'created' | 'skipped' | 'missed';

export interface ScheduleLogEntry {
  /** When it happened (server clock). */
  at: number;
  /** The occurrence's start. */
  slot: number;
  kind: ScheduleLogKind;
  /** The event created (created). */
  tournamentId?: string;
  name?: string;
  /** Why it was skipped. */
  note?: string;
}

export interface ScheduleOccurrence {
  /** Start time (ms, UTC). */
  start: number;
  /** When the event is created and registration opens. */
  opensAt: number;
  /** The number it gets, and its full name. */
  n: number;
  name: string;
}

/** A schedule as operators see it (tourney:sched:list). */
export interface TournamentScheduleView {
  id: string;
  name: string;
  days: number[];
  minute: number;
  prize: string;
  settings: ScheduleSettings;
  leadMinutes: number;
  enabled: boolean;
  nextNumber: number;
  createdAt: number;
  updatedAt: number;
  createdBy: { id: string; name: string };
  /** Every start at or before this has been dealt with (an edit's preview counts from here). */
  handledUntil: number;
  /** The next occurrences not yet created (none while paused). */
  next: ScheduleOccurrence[];
  /** Its latest event that is still upcoming or running. */
  current: { id: string; name: string; status: 'registering' | 'running'; startAt: number | null } | null;
  /** Due to be created, but held back while its previous event is still running. */
  waiting: boolean;
  log: ScheduleLogEntry[];
}

/** A scheduled event that registration has not opened for yet (everyone sees these under "Upcoming"). */
export interface ScheduledEvent {
  scheduleId: string;
  name: string;
  start: number;
  opensAt: number;
  prize: string;
  cardsMode: CardsGameMode;
  maxPlayers: number | null;
}

/** The soonest event players can look forward to (the Cards page and hub chip; GET /api/tournaments/next). */
export interface NextTournament {
  name: string;
  start: number;
  /** Its page once created; the list before that. */
  href: string;
  /** Registration is open now. */
  open: boolean;
}

const validDay = (d: number) => Number.isInteger(d) && d >= 0 && d <= 6;
export const validMinute = (m: number) => Number.isInteger(m) && m >= 0 && m < 24 * 60;

/**
 * The next `count` starts strictly after `after`: on one of `days` (UTC
 * weekdays) at `minute` past UTC midnight. Plain UTC arithmetic, so a week is
 * always seven 24-hour days and Sunday wraps round to the next week.
 */
export function nextOccurrences(days: readonly number[], minute: number, after: number, count = 3): number[] {
  const set = new Set(days.filter(validDay));
  if (!set.size || !validMinute(minute) || count <= 0) return [];
  const out: number[] = [];
  let day = Math.floor(after / DAY_MS) * DAY_MS;
  // One day more than `count` weeks always holds `count` of them.
  for (let i = 0; out.length < count && i <= 7 * count + 1; i++, day += DAY_MS) {
    const at = day + minute * MINUTE_MS;
    if (at > after && set.has(new Date(day).getUTCDay())) out.push(at);
  }
  return out;
}

/** The latest start at or before `at` (null when there are no days). */
export function lastOccurrence(days: readonly number[], minute: number, at: number): number | null {
  const set = new Set(days.filter(validDay));
  if (!set.size || !validMinute(minute)) return null;
  let day = Math.floor(at / DAY_MS) * DAY_MS;
  for (let i = 0; i <= 8; i++, day -= DAY_MS) {
    const start = day + minute * MINUTE_MS;
    if (start <= at && set.has(new Date(day).getUTCDay())) return start;
  }
  return null;
}

/** "Monday Night Cup" + 3 → "Monday Night Cup #3"; "Cup {n}: Chaos" + 3 → "Cup 3: Chaos". */
export function scheduleName(pattern: string, n: number): string {
  return pattern.includes(SCHEDULE_NUMBER_TOKEN) ? pattern.split(SCHEDULE_NUMBER_TOKEN).join(String(n)) : `${pattern} #${n}`;
}

/** "20:00" for 1200. */
export function fmtUtcMinute(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** "Mondays", "Mon, Wed, Fri", "Every day", "Weekdays". */
export function fmtDays(days: readonly number[]): string {
  const set = new Set(days.filter(validDay));
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  const list = WEEK_ORDER.filter(d => set.has(d));
  if (list.length === 1) return `${WEEKDAYS_LONG[list[0]]}s`;
  return list.map(d => WEEKDAYS[d]).join(', ');
}

/** "30 min", "6 h", "2 days", "1 week". */
export function fmtLead(minutes: number): string {
  if (minutes % 10080 === 0) return `${minutes / 10080} week${minutes === 10080 ? '' : 's'}`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}
