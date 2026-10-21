// Peak concurrent connections, for the dashboard's Analytics tab. Every few
// minutes the live counts (open sockets, signed-in accounts connected) are
// sampled and folded into one small row per UTC day: the day's highest
// counts and the highest per hour. Only counts are kept, never who; rows
// older than RETENTION_DAYS are dropped. One file on the data volume
// (live-samples.json), written a little after each sample.
import { debouncedWriter, readJson, writeJson } from './jsonstore.ts';
import { DAY_MS, dayKey } from '../../shared/analytics.ts';

export interface SampleDay {
  date: string;
  /** Highest open-socket count sampled that day. */
  sockets: number;
  /** Highest count of distinct signed-in accounts connected. */
  players: number;
  /** Highest socket count per UTC hour (null: no sample in that hour). */
  hours: (number | null)[];
  samples: number;
}

export const SAMPLE_EVERY_MS = 5 * 60_000;
export const SAMPLE_RETENTION_DAYS = 90;

export interface LiveSamplerOptions {
  read(): { sockets: number; players: number };
  now?: () => number;
  file?: string;
  retentionDays?: number;
}

const count = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);

function wellFormed(d: unknown): d is SampleDay {
  const o = d as SampleDay;
  return !!o && typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Array.isArray(o.hours) && o.hours.length === 24;
}

export function createLiveSampler(opts: LiveSamplerOptions) {
  const now = opts.now ?? Date.now;
  const file = opts.file ?? 'live-samples.json';
  const keep = opts.retentionDays ?? SAMPLE_RETENTION_DAYS;
  const raw = readJson<unknown>(file, []);
  let days: SampleDay[] = (Array.isArray(raw) ? raw : []).filter(wellFormed).map(d => ({
    date: d.date, sockets: count(d.sockets), players: count(d.players), samples: count(d.samples),
    hours: d.hours.map(h => (h === null ? null : count(h))),
  }));
  const save = debouncedWriter(file, () => days, 1_000);
  let timer: NodeJS.Timeout | null = null;

  /** Drop days that fell out of the retention window. True when any did. */
  const prune = (at: number) => {
    const oldest = dayKey(at - (keep - 1) * DAY_MS);
    const before = days.length;
    days = days.filter(d => d.date >= oldest).sort((a, b) => a.date.localeCompare(b.date));
    return days.length !== before;
  };
  if (prune(now())) save();

  /** Take one sample now. */
  function sample(): SampleDay {
    const at = now();
    const { sockets, players } = opts.read();
    const date = dayKey(at);
    let day = days.find(d => d.date === date);
    if (!day) {
      day = { date, sockets: 0, players: 0, hours: Array(24).fill(null), samples: 0 };
      days.push(day);
      prune(at);
    }
    const s = count(sockets), p = count(players);
    const h = new Date(at).getUTCHours();
    day.sockets = Math.max(day.sockets, s);
    day.players = Math.max(day.players, p);
    day.hours[h] = Math.max(day.hours[h] ?? 0, s);
    day.samples++;
    save();
    return day;
  }
  const safeSample = () => {
    try { sample(); } catch (e) { console.error('Could not sample live counts:', e); }
  };

  return {
    sample,
    days(): readonly SampleDay[] {
      prune(now());
      return days;
    },
    /** Sample now and every `ms` after (the timer never keeps the process alive). */
    start(ms = SAMPLE_EVERY_MS) {
      if (timer) return;
      safeSample();
      timer = setInterval(safeSample, ms);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Write the file now (tests, shutdown). */
    flush() {
      writeJson(file, days);
    },
  };
}

export type LiveSampler = ReturnType<typeof createLiveSampler>;
