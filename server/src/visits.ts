// A tiny visit counter for the dashboard's Analytics tab: page loads per page
// per UTC day, and roughly how many different visitors came that day. No
// cookies, no scripts, nothing sent anywhere.
//
// "Different visitors" is a keyed hash of the address and the browser's
// user-agent under a random key that lives only in memory and is replaced
// every UTC day. The hashes sit in memory for the current day only, so the
// same person is counted once that day, and the next day cannot be linked to
// the one before. Neither the address, the user-agent nor any hash is ever
// written down: the file (visits.json) holds counts only, by page pattern
// ("/u/:id", never the id) and by hour, for RETENTION_DAYS days.
//
// A restart loses the day's key, so someone who comes back after one is
// counted again: the figure is "unique-ish" by design. Crawlers and link
// previews are not counted, nor the dashboard itself. A browser that sends
// Do Not Track or Global Privacy Control still counts as a page load but is
// never hashed.
import { createHmac, randomBytes } from 'node:crypto';
import type express from 'express';
import { debouncedWriter, readJson, writeJson } from './jsonstore.ts';
import { DAY_MS, dayKey } from '../../shared/analytics.ts';
import { ROUTES, cleanPath } from '../../shared/seo.ts';

export interface VisitDay {
  date: string;
  views: number;
  visitors: number;
  /** Page pattern → loads. */
  pages: Record<string, number>;
  /** Loads per UTC hour. */
  hours: number[];
}

export const VISIT_RETENTION_DAYS = 90;
/** Distinct visitors remembered per day before counting stops growing (bounds memory under a flood). */
export const MAX_VISITORS_PER_DAY = 200_000;
export const NOT_FOUND_PAGE = '(not found)';

/** Crawlers, link unfurlers, uptime checks and scripts. */
const BOT_UA = /bot|crawl|spider|slurp|preview|embed|facebookexternalhit|^whatsapp|monitor|uptime|curl|wget|python|httpclient|go-http|java\/|node-fetch|axios|headless|lighthouse|pingdom/i;

export function isBotAgent(ua: string | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => (seg.startsWith(':') ? b[i].length > 0 : seg === b[i]));
}

/**
 * The page a path counts under: its route pattern (so ids and table codes are
 * never kept), NOT_FOUND_PAGE for paths no page answers, null for paths not
 * counted at all (the dashboard, the API).
 */
export function pageOf(rawPath: string): string | null {
  const path = cleanPath(rawPath);
  if (path.startsWith('/api/') || path === '/api' || path.startsWith('/socket.io')) return null;
  const hit = ROUTES.find(r => !r.pattern.endsWith('/*') && matches(r.pattern, path)) ?? ROUTES.find(r => matches(r.pattern, path));
  if (!hit) return NOT_FOUND_PAGE;
  if (hit.pattern === '/admin/*') return null;
  return hit.pattern;
}

/** The day's visitor key: HMAC-SHA256 of address and user-agent under that day's secret, shortened. */
export function visitorHash(secret: Buffer, ip: string, ua: string): string {
  return createHmac('sha256', secret).update(`${ip}\n${ua}`).digest('base64url').slice(0, 16);
}

export interface Hit {
  path: string;
  ip: string | null | undefined;
  ua: string | undefined;
  /** Do Not Track / Global Privacy Control: counted as a load, never hashed. */
  optOut?: boolean;
}

export interface VisitCounterOptions {
  now?: () => number;
  file?: string;
  retentionDays?: number;
  maxVisitorsPerDay?: number;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);

function wellFormed(d: unknown): d is VisitDay {
  const o = d as VisitDay;
  return !!o && typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && !!o.pages && typeof o.pages === 'object';
}

export function createVisitCounter(opts: VisitCounterOptions = {}) {
  const now = opts.now ?? Date.now;
  const file = opts.file ?? 'visits.json';
  const keep = opts.retentionDays ?? VISIT_RETENTION_DAYS;
  const cap = opts.maxVisitorsPerDay ?? MAX_VISITORS_PER_DAY;
  const raw = readJson<unknown>(file, []);
  let days: VisitDay[] = (Array.isArray(raw) ? raw : []).filter(wellFormed).map(d => ({
    date: d.date, views: n(d.views), visitors: n(d.visitors),
    pages: Object.fromEntries(Object.entries(d.pages).map(([k, v]) => [String(k).slice(0, 64), n(v)])),
    hours: Array.from({ length: 24 }, (_, i) => n(Array.isArray(d.hours) ? d.hours[i] : 0)),
  }));
  const save = debouncedWriter(file, () => days, 2_000);

  // Memory only, never saved: the day's key and the visitors seen under it.
  let secretDay = '';
  let secret = Buffer.alloc(0);
  let seen = new Set<string>();

  const prune = (at: number) => {
    const oldest = dayKey(at - (keep - 1) * DAY_MS);
    const before = days.length;
    days = days.filter(d => d.date >= oldest).sort((a, b) => a.date.localeCompare(b.date));
    return days.length !== before;
  };
  if (prune(now())) save();

  function hit(h: Hit): boolean {
    if (isBotAgent(h.ua)) return false;
    const page = pageOf(h.path);
    if (!page) return false;
    const at = now();
    const date = dayKey(at);
    if (date !== secretDay) {
      // A new day: a new key, and yesterday's visitors forgotten.
      secretDay = date;
      secret = randomBytes(32);
      seen = new Set();
    }
    let day = days.find(d => d.date === date);
    if (!day) {
      day = { date, views: 0, visitors: 0, pages: {}, hours: Array(24).fill(0) };
      days.push(day);
      prune(at);
    }
    day.views++;
    day.pages[page] = (day.pages[page] ?? 0) + 1;
    day.hours[new Date(at).getUTCHours()]++;
    if (!h.optOut && h.ip && seen.size < cap) {
      const key = visitorHash(secret, h.ip, h.ua ?? '');
      if (!seen.has(key)) {
        seen.add(key);
        day.visitors++;
      }
    }
    save();
    return true;
  }

  return {
    hit,
    days(): readonly VisitDay[] {
      prune(now());
      return days;
    },
    /** Counts a page load, then hands on (put it in front of the page handler). */
    middleware(): express.RequestHandler {
      return (req, _res, next) => {
        try {
          if (req.method === 'GET' && req.get('sec-purpose') !== 'prefetch' && req.get('purpose') !== 'prefetch') {
            hit({
              path: req.path, ip: req.ip, ua: req.get('user-agent'),
              optOut: req.get('dnt') === '1' || req.get('sec-gpc') === '1',
            });
          }
        } catch (e) {
          console.error('Could not count a visit:', e);
        }
        next();
      };
    },
    /** Write the file now (tests, shutdown). */
    flush() {
      writeJson(file, days);
    },
    /** How many visitors are held in memory for today (tests). */
    visitorsInMemory: () => seen.size,
  };
}

export type VisitCounter = ReturnType<typeof createVisitCounter>;
