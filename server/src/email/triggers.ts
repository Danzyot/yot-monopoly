// When the site emails someone, topic by topic. Each trigger only queues mail
// for players who turned that topic on (store.ts deliverableAddress, checked
// again by the mailer); each occurrence is sent once, remembered by a key in
// email-sent.json so a restart never sends it twice.
//
//   tournaments    an hour before a tournament starts: to its entrants, and to every
//                  subscriber for the schedule's (Cards) tournaments; not to someone who
//                  signed up inside that hour (they know already).
//   streak         in the evening (EMAIL_STREAK_HOUR_UTC, 18 by default): to players with a
//                  streak going on any registered Daily Challenge who have not played today's.
//                  Games add their daily with registerDailySource().
//   friendInvites  a friend's invite that found nobody online (routes/friends.ts),
//                  at most one per friend every six hours.
//   digest         weekly (Monday, EMAIL_DIGEST_HOUR_UTC, 15 by default): last week's top
//                  players and the new week's tournaments.
//   announcements  sent by an operator from the dashboard.
import { readJson, writeJson } from '../jsonstore.ts';
import type { EmailTopic } from '../../../shared/email.ts';
import type { Mailer } from './mailer.ts';
import { subscribers } from './store.ts';
import {
  announcement, friendInvite, streakReminder, tournamentReminder, weeklyDigest, type DigestData, type EmailContent,
} from './templates.ts';

/** One game's Daily Challenge, as the streak reminder sees it. */
export interface DailySource {
  id: string;
  /** "Cards", "Monopoly", "Poker". */
  label: string;
  /** Where to play it, a site path. */
  path: string;
  /** Their current streak and whether today's (UTC) is already played; null when they never played it. */
  status(playerId: string, now: number): { streak: number; playedToday: boolean } | null;
}

const dailySources = new Map<string, DailySource>();

/** Each game with a Daily Challenge registers it once at startup (index.ts). */
export function registerDailySource(s: DailySource): void {
  dailySources.set(s.id, s);
}

export function registeredDailies(): DailySource[] {
  return [...dailySources.values()];
}

export interface ReminderTournament {
  id: string;
  name: string;
  start: number;
  href: string;
  prize?: string;
  /** Created by a schedule: the occurrence's key ("s:<schedule>:<start>"), shared with its not-yet-created twin. */
  scheduleKey?: string;
  entrants: { id: string; at: number }[];
}

export interface ReminderScheduled {
  key: string;
  name: string;
  start: number;
  opensAt: number;
  prize?: string;
}

export interface TriggerDeps {
  mailer: Mailer;
  now?: () => number;
  /** The name to greet them by (their account's), or null. */
  name(id: string): string | null;
  banned(id: string): boolean;
  /** Tournaments taking registrations. */
  tournaments(): ReminderTournament[];
  /** Schedule occurrences not created yet. */
  scheduled(): ReminderScheduled[];
  /** Last week's numbers and the new week's tournaments; `you` filled per player. */
  digest(now: number): Omit<DigestData, 'you'>;
  digestYou?(id: string, now: number): DigestData['you'];
  /** File for the "already sent" keys; null keeps them in memory (tests). */
  file?: string | null;
}

export const REMINDER_LEAD_MS = 60 * 60_000;
/** Too close to the start to be worth an email (a restart caught up late). */
export const REMINDER_MIN_MS = 5 * 60_000;
export const INVITE_EMAIL_EVERY_MS = 6 * 3_600_000;
const KEEP_KEYS_MS = 40 * 86_400_000;

const hourEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
};
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export class EmailTriggers {
  private sent = new Map<string, number>();
  private readonly now: () => number;
  private readonly file: string | null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private d: TriggerDeps) {
    this.now = d.now ?? Date.now;
    this.file = d.file === undefined ? 'email-sent.json' : d.file;
    if (this.file) {
      const saved = readJson<Record<string, number>>(this.file, {});
      for (const [k, v] of Object.entries(saved && typeof saved === 'object' ? saved : {})) if (typeof v === 'number') this.sent.set(k, v);
    }
  }

  start(everyMs = 60_000) {
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private persist() {
    if (!this.file) return;
    const cutoff = this.now() - KEEP_KEYS_MS;
    for (const [k, t] of this.sent) if (t < cutoff) this.sent.delete(k);
    try { writeJson(this.file, Object.fromEntries(this.sent)); } catch (e) { console.error('[email] could not save sent keys:', e); }
  }

  /** Queue once per key. True when it was queued now. */
  private once(key: string, id: string, topic: EmailTopic, content: EmailContent): boolean {
    if (this.sent.has(key) || this.d.banned(id)) return false;
    const r = this.d.mailer.enqueue(id, topic, content, this.d.name(id));
    // Remembered either way: a capped or unsubscribed player is not asked again for this occurrence.
    this.sent.set(key, this.now());
    return r.queued;
  }

  hasSent(key: string): boolean {
    return this.sent.has(key);
  }

  tick(): void {
    const now = this.now();
    let n = 0;
    try { n += this.tournamentReminders(now); } catch (e) { console.error('[email] tournament reminders failed:', e); }
    try { n += this.streakReminders(now); } catch (e) { console.error('[email] streak reminders failed:', e); }
    try { n += this.weeklyDigest(now); } catch (e) { console.error('[email] weekly digest failed:', e); }
    if (n) this.persist();
  }

  // ---- tournaments --------------------------------------------------------------------

  tournamentReminders(now = this.now()): number {
    const subs = subscribers('tournaments');
    if (!subs.length) return 0;
    const origin = this.d.mailer.origin();
    const due = (start: number) => start - now <= REMINDER_LEAD_MS && start - now > REMINDER_MIN_MS;
    let n = 0;
    const seen = new Set<string>();
    for (const t of this.d.tournaments()) {
      if (!due(t.start)) continue;
      const base = t.scheduleKey ?? `t:${t.id}`;
      seen.add(base);
      for (const id of subs) {
        const e = t.entrants.find(x => x.id === id);
        // Signed up inside the last hour: they know it is soon.
        if (e && e.at > t.start - REMINDER_LEAD_MS) continue;
        // One-off events reach their entrants; a schedule's reach every subscriber.
        if (!e && !t.scheduleKey) continue;
        if (this.once(`${base}|${id}`, id, 'tournaments', tournamentReminder({
          origin, name: t.name, start: t.start, now, href: t.href, registered: !!e, prize: t.prize,
        }))) n++;
      }
    }
    for (const s of this.d.scheduled()) {
      if (!due(s.start) || seen.has(s.key)) continue;
      for (const id of subs) {
        if (this.once(`${s.key}|${id}`, id, 'tournaments', tournamentReminder({
          origin, name: s.name, start: s.start, now, href: '/tournaments', registered: false, prize: s.prize, opensAt: s.opensAt,
        }))) n++;
      }
    }
    return n;
  }

  // ---- the Daily streak --------------------------------------------------------------

  streakReminders(now = this.now()): number {
    const hour = hourEnv('EMAIL_STREAK_HOUR_UTC', 18);
    const h = new Date(now).getUTCHours();
    // From the hour until the last half hour of the (UTC) day.
    if (h < hour || (h === 23 && new Date(now).getUTCMinutes() >= 30)) return 0;
    const sources = registeredDailies();
    if (!sources.length) return 0;
    const today = dayOf(now);
    const origin = this.d.mailer.origin();
    let n = 0;
    for (const id of subscribers('streak')) {
      const key = `streak:${today}|${id}`;
      if (this.sent.has(key)) continue;
      const atRisk = this.atRisk(id, now);
      if (!atRisk.length) continue;
      if (this.once(key, id, 'streak', streakReminder({ origin, name: this.d.name(id) ?? 'there', dailies: atRisk }))) n++;
    }
    return n;
  }

  /** The dailies where this player has a streak going and has not played today. */
  atRisk(id: string, now = this.now()): { label: string; streak: number; path: string }[] {
    const out: { label: string; streak: number; path: string }[] = [];
    for (const s of registeredDailies()) {
      let st: ReturnType<DailySource['status']> = null;
      try { st = s.status(id, now); } catch (e) { console.error(`[email] daily ${s.id} status failed:`, e); }
      if (st && st.streak > 0 && !st.playedToday) out.push({ label: s.label, streak: st.streak, path: s.path });
    }
    return out.sort((a, b) => b.streak - a.streak);
  }

  // ---- friends ------------------------------------------------------------------------

  /** A friend's invite found nobody online. Never says whether an email went (the inviter learns nothing). */
  friendInviteOffline(from: { id: string; name: string }, to: string, game: string, path: string): boolean {
    const now = this.now();
    const key = `fi:${from.id}|${to}`;
    const last = this.sent.get(key);
    if (last !== undefined && now - last < INVITE_EMAIL_EVERY_MS) return false;
    if (this.d.banned(to) || this.d.banned(from.id)) return false;
    const r = this.d.mailer.enqueue(to, 'friendInvites', friendInvite({ origin: this.d.mailer.origin(), from: from.name, game, url: `${this.d.mailer.origin()}${path}` }), this.d.name(to));
    if (!r.queued) return false;
    this.sent.set(key, now);
    this.persist();
    return true;
  }

  // ---- the weekly digest --------------------------------------------------------------

  weeklyDigest(now = this.now()): number {
    const at = new Date(now);
    const weekday = Number(process.env.EMAIL_DIGEST_WEEKDAY ?? 1);
    if (at.getUTCDay() !== (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : 1)) return 0;
    if (at.getUTCHours() < hourEnv('EMAIL_DIGEST_HOUR_UTC', 15)) return 0;
    const subs = subscribers('digest');
    if (!subs.length) return 0;
    const week = dayOf(now);
    const fresh = subs.filter(id => !this.sent.has(`digest:${week}|${id}`));
    if (!fresh.length) return 0;
    const base = this.d.digest(now);
    const origin = this.d.mailer.origin();
    let n = 0;
    for (const id of fresh) {
      const you = this.d.digestYou?.(id, now);
      if (this.once(`digest:${week}|${id}`, id, 'digest', weeklyDigest({ origin, name: this.d.name(id) ?? 'there', d: { ...base, ...(you && { you }) } }))) n++;
    }
    return n;
  }

  // ---- announcements ------------------------------------------------------------------

  announcementContent(input: { subject: unknown; body: unknown; buttonLabel?: unknown; buttonUrl?: unknown }): EmailContent {
    return announcement({
      origin: this.d.mailer.origin(),
      subject: String(input.subject ?? ''), body: String(input.body ?? ''),
      buttonLabel: typeof input.buttonLabel === 'string' ? input.buttonLabel : undefined,
      buttonUrl: typeof input.buttonUrl === 'string' ? input.buttonUrl.trim() : undefined,
    });
  }

  /** Everyone on the announcements topic. Returns how many were queued. */
  sendAnnouncement(content: EmailContent): { queued: number; skipped: number } {
    let queued = 0;
    let skipped = 0;
    for (const id of subscribers('announcements')) {
      if (this.d.banned(id)) { skipped++; continue; }
      if (this.d.mailer.enqueue(id, 'announcements', content, this.d.name(id)).queued) queued++;
      else skipped++;
    }
    return { queued, skipped };
  }

  /** A deleted player: their keys go too. */
  forget(id: string): void {
    let hit = false;
    for (const k of this.sent.keys()) {
      if (k.endsWith(`|${id}`) || k.startsWith(`fi:${id}|`)) { this.sent.delete(k); hit = true; }
    }
    if (hit) this.persist();
  }
}

let shared: EmailTriggers | null = null;

export function configureEmailTriggers(t: EmailTriggers | null): void {
  shared = t;
}

export function emailTriggers(): EmailTriggers | null {
  return shared;
}
