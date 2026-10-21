// Recurring tournaments: operators' schedules ("Monday Night Cup, every
// Monday 20:00 UTC") and the clock that turns each occurrence into an
// ordinary tournament `leadMinutes` before its start, so players can
// register in advance. Kept in DATA_DIR next to the tournaments.
//
// Exactly once: each schedule keeps a watermark (`handledUntil`), the latest
// start it has dealt with (created, skipped or passed over), and each event
// it creates carries its schedule and start (TournamentData.schedule). An
// occurrence is only ever considered after the watermark, so a clock that
// steps back cannot bring one round again; and an event already on the list
// for that start counts as created, so a restart between saving the event
// and saving the schedule does not make a second one.
//
// An occurrence whose previous event is still running waits; if that event
// is still running when the occurrence's start comes, it is skipped. An
// occurrence whose start passed while the server was down (or the schedule
// was paused) is passed over, never created late. Nothing here is announced
// on Discord.

import { randomUUID } from 'node:crypto';
import { stripInvisible } from '../auth.ts';
import { readJson, writeJson } from '../jsonstore.ts';
import {
  MAX_SCHEDULES, SCHEDULE_LEAD_MINUTES, SCHEDULE_LOG_MAX, SCHEDULE_NAME_MAX,
  lastOccurrence, nextOccurrences, scheduleName, validMinute,
  type NextTournament, type ScheduleLogEntry, type ScheduleOccurrence, type ScheduleSettings, type ScheduledEvent,
  type TournamentScheduleView,
} from '../../../shared/tournamentSchedules.ts';
import { TOURNEY_PRIZE_MAX, tournamentUrl } from '../../../shared/tournaments.ts';
import { TournamentError, type Requester, type TournamentManager } from './manager.ts';

export interface ScheduleData {
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
  createdBy: { id: string; name: string; avatar: string };
  /** Every occurrence starting at or before this has been dealt with. */
  handledUntil: number;
  log: ScheduleLogEntry[];
}

export interface SchedulerOptions {
  file?: string;
  /** Check the schedules this often; 0 leaves it to tick() (tests). */
  tickMs?: number;
}

const clean = (raw: unknown, max: number) =>
  Array.from(stripInvisible(String(raw ?? '').normalize('NFKC')).replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function wellFormed(d: unknown): d is ScheduleData {
  return obj(d) && typeof d.id === 'string' && !!d.id && typeof d.name === 'string' && Array.isArray(d.days)
    && typeof d.minute === 'number' && obj(d.settings) && typeof d.leadMinutes === 'number'
    && typeof d.handledUntil === 'number' && typeof d.nextNumber === 'number' && obj(d.createdBy);
}

const fail = (msg: string): never => { throw new TournamentError(msg); };

export class TournamentScheduler {
  schedules = new Map<string, ScheduleData>();
  private readonly file: string;
  private timer: NodeJS.Timeout | null = null;
  /** Due but held back (previous event still running, or the server at its limit): id → why. */
  private held = new Map<string, string>();

  constructor(private manager: TournamentManager, private hooks: { onChange(): void } = { onChange() {} }, opts: SchedulerOptions = {}) {
    this.file = opts.file ?? 'tournament-schedules.json';
    if (opts.tickMs) {
      this.timer = setInterval(() => this.tick(), opts.tickMs);
      this.timer.unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private get now(): number {
    return this.manager.now();
  }

  private admin(by: Requester) {
    if (!by.isAdmin) fail('Only operators can manage tournament schedules');
  }

  private require(id: unknown): ScheduleData {
    return this.schedules.get(String(id ?? '')) ?? fail('No schedule with that id');
  }

  // ---- operators ----------------------------------------------------------------------

  /** Create (no id) or edit (id) a schedule: everything checked, the tournament settings by the manager's own rules. */
  save(by: Requester, input: unknown): ScheduleData {
    this.admin(by);
    const raw = obj(input) ? input : {};
    const editing = raw.id !== undefined && raw.id !== null && raw.id !== '' ? this.require(raw.id) : null;
    if (!editing && this.schedules.size >= MAX_SCHEDULES) fail(`There can be at most ${MAX_SCHEDULES} schedules`);

    const name = clean(raw.name, SCHEDULE_NAME_MAX);
    if (Array.from(name).length < 2) fail('Give the schedule a name (2 characters or more)');
    const days = Array.isArray(raw.days) ? [...new Set(raw.days.map(Number))].sort((a, b) => a - b) : [];
    if (!days.length) fail('Pick at least one day of the week');
    if (!days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) fail('Unknown day of the week');
    const minute = Number(raw.minute);
    if (!validMinute(minute)) fail('Pick a start time (UTC)');
    const leadMinutes = Number(raw.leadMinutes);
    if (!SCHEDULE_LEAD_MINUTES.includes(leadMinutes)) fail('Pick a lead time from the list');
    const nextNumber = raw.nextNumber === undefined ? (editing?.nextNumber ?? 1) : Number(raw.nextNumber);
    if (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 9999) fail('The next number is 1 to 9999');
    const prize = clean(raw.prize, TOURNEY_PRIZE_MAX);
    const s = obj(raw.settings) ? { ...raw.settings } : {};
    delete s.startAt;
    const { startAt: _startAt, ...settings } = this.manager.checkSettings(s);
    const enabled = raw.enabled === undefined ? (editing?.enabled ?? true) : raw.enabled === true;

    const now = this.now;
    const d: ScheduleData = editing ?? {
      id: randomUUID().replace(/-/g, '').slice(0, 10), name, days, minute, prize, settings, leadMinutes, enabled, nextNumber,
      createdAt: now, updatedAt: now, createdBy: { id: by.id, name: by.name, avatar: by.avatar }, handledUntil: now, log: [],
    };
    Object.assign(d, { name, days, minute, prize, settings, leadMinutes, enabled, nextNumber, updatedAt: now });
    // A new or changed rule never reaches back: what started before now is passed over.
    d.handledUntil = Math.max(d.handledUntil, now);
    this.schedules.set(d.id, d);
    this.held.delete(d.id);
    this.changed();
    this.tick();
    return d;
  }

  /** Pause (nothing more is created) or carry on (from now: what was missed meanwhile is not made up). */
  setEnabled(by: Requester, id: unknown, enabled: boolean) {
    this.admin(by);
    const d = this.require(id);
    if (d.enabled === enabled) return;
    d.enabled = enabled;
    d.updatedAt = this.now;
    d.handledUntil = Math.max(d.handledUntil, this.now);
    this.held.delete(d.id);
    this.changed();
    this.tick();
  }

  /** Delete a schedule. The events it already created stay: they are ordinary tournaments. */
  remove(by: Requester, id: unknown) {
    this.admin(by);
    const d = this.require(id);
    this.schedules.delete(d.id);
    this.held.delete(d.id);
    this.changed();
  }

  list(by: Requester): TournamentScheduleView[] {
    this.admin(by);
    return this.views();
  }

  /** Every schedule, oldest first (for operators only: the socket layer sends these to its operators' channel). */
  views(): TournamentScheduleView[] {
    return [...this.schedules.values()].sort((a, b) => a.createdAt - b.createdAt).map(d => this.view(d));
  }

  view(d: ScheduleData): TournamentScheduleView {
    const live = this.manager.fromSchedule(d.id).filter(t => t.live);
    const cur = live.find(t => t.d.status === 'running') ?? live[live.length - 1];
    return {
      id: d.id, name: d.name, days: [...d.days], minute: d.minute, prize: d.prize, settings: { ...d.settings },
      leadMinutes: d.leadMinutes, enabled: d.enabled, nextNumber: d.nextNumber,
      createdAt: d.createdAt, updatedAt: d.updatedAt, createdBy: { id: d.createdBy.id, name: d.createdBy.name },
      handledUntil: d.handledUntil,
      next: d.enabled ? this.upcomingOf(d, 3) : [],
      current: cur ? { id: cur.id, name: cur.d.name, status: cur.d.status as 'registering' | 'running', startAt: cur.d.settings.startAt } : null,
      waiting: this.held.has(d.id),
      log: d.log.map(e => ({ ...e })),
    };
  }

  /** The next `count` occurrences not yet created, numbered as they will be. */
  upcomingOf(d: ScheduleData, count: number): ScheduleOccurrence[] {
    const from = Math.max(d.handledUntil, this.now);
    return nextOccurrences(d.days, d.minute, from, count).map((start, i) => ({
      start, opensAt: start - d.leadMinutes * 60_000, n: d.nextNumber + i, name: scheduleName(d.name, d.nextNumber + i),
    }));
  }

  // ---- everyone -----------------------------------------------------------------------

  /** Each running schedule's next event that is not on the list yet (the public "Upcoming"). */
  upcoming(): ScheduledEvent[] {
    const out: ScheduledEvent[] = [];
    for (const d of this.schedules.values()) {
      if (!d.enabled) continue;
      const [o] = this.upcomingOf(d, 1);
      if (!o) continue;
      out.push({
        scheduleId: d.id, name: o.name, start: o.start, opensAt: o.opensAt, prize: d.prize,
        cardsMode: d.settings.cardsMode, maxPlayers: d.settings.maxPlayers,
      });
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /** The soonest event to look forward to: one taking registrations, or a scheduled one. */
  next(): NextTournament | null {
    const now = this.now;
    const open = [...this.manager.tournaments.values()]
      .filter(t => t.d.status === 'registering' && t.d.settings.startAt !== null && t.d.settings.startAt > now)
      .map(t => ({ name: t.d.name, start: t.d.settings.startAt!, href: tournamentUrl(t.id), open: true }));
    const later = this.upcoming().map(e => ({ name: e.name, start: e.start, href: '/tournaments', open: false }));
    return [...open, ...later].sort((a, b) => a.start - b.start)[0] ?? null;
  }

  // ---- the clock ----------------------------------------------------------------------

  tick() {
    for (const d of this.schedules.values()) {
      if (!d.enabled) continue;
      try {
        this.drive(d);
      } catch (e) {
        console.error(`[schedule ${d.id}] tick failed:`, e);
      }
    }
  }

  private drive(d: ScheduleData) {
    const now = this.now;
    // A schedule with lead times longer than its gaps has several events open at once: one at a time, a few per tick.
    for (let i = 0; i < 4; i++) {
      const [slot] = nextOccurrences(d.days, d.minute, d.handledUntil, 1);
      if (slot === undefined) return;
      const running = this.manager.fromSchedule(d.id).find(t => t.d.status === 'running');

      if (slot <= now) {
        // Its start went by without an event: never created late. Only the latest one is logged.
        const passed = lastOccurrence(d.days, d.minute, now) ?? slot;
        if (!this.manager.fromSchedule(d.id).some(t => t.d.schedule!.slot === passed)) {
          this.log(d, running
            ? { at: now, slot: passed, kind: 'skipped', note: `${running.d.name} was still running` }
            : { at: now, slot: passed, kind: 'missed', note: this.held.get(d.id) ?? 'The server was not running when it was due' });
        }
        d.handledUntil = Math.max(d.handledUntil, passed);
        this.held.delete(d.id);
        this.changed();
        continue;
      }
      if (slot - d.leadMinutes * 60_000 > now) {
        this.hold(d, null);
        return;
      }
      // Already on the list (made before a restart that lost the schedule's own save).
      const made = this.manager.fromSchedule(d.id).find(t => t.d.schedule!.slot === slot);
      if (made) {
        d.handledUntil = slot;
        d.nextNumber = Math.max(d.nextNumber, made.d.schedule!.n + 1);
        this.hold(d, null);
        this.changed();
        continue;
      }
      if (running) {
        this.hold(d, `Waiting for ${running.d.name} to finish`);
        return;
      }
      const n = d.nextNumber;
      let t;
      try {
        t = this.manager.createScheduled({
          host: d.createdBy, name: scheduleName(d.name, n), prize: d.prize,
          settings: { ...d.settings, startAt: slot }, schedule: { id: d.id, slot, n },
        });
      } catch (e) {
        if (!(e instanceof TournamentError)) throw e;
        this.hold(d, e.message);
        return;
      }
      // The event first, then the schedule: a crash in between is caught by `made` above.
      this.manager.saveNow();
      d.handledUntil = slot;
      d.nextNumber = n + 1;
      this.hold(d, null);
      this.log(d, { at: now, slot, kind: 'created', tournamentId: t.id, name: t.d.name });
      this.changed();
    }
  }

  private hold(d: ScheduleData, why: string | null) {
    const was = this.held.get(d.id) ?? null;
    if (was === why) return;
    if (why === null) this.held.delete(d.id);
    else this.held.set(d.id, why);
    this.hooks.onChange();
  }

  private log(d: ScheduleData, e: ScheduleLogEntry) {
    d.log = [e, ...d.log].slice(0, SCHEDULE_LOG_MAX);
  }

  private changed() {
    this.saveNow();
    this.hooks.onChange();
  }

  // ---- persistence -------------------------------------------------------------------

  /** Synchronous: schedules change rarely, and an occurrence must not be forgotten once made. */
  saveNow() {
    try {
      writeJson(this.file, { savedAt: this.now, schedules: [...this.schedules.values()] });
    } catch (e) {
      console.error('Could not save tournament schedules:', e);
    }
  }

  /** Load the saved schedules (after the manager's restore, so their events are known). Returns how many are running. */
  restore(): number {
    const saved = readJson<{ schedules?: unknown[] }>(this.file, {});
    let on = 0;
    for (const d of Array.isArray(saved.schedules) ? saved.schedules : []) {
      if (!wellFormed(d)) {
        console.warn(`Skipping a saved tournament schedule that cannot be read (${String((d as { id?: unknown } | null)?.id ?? '?')})`);
        continue;
      }
      d.log = Array.isArray(d.log) ? d.log : [];
      d.prize = typeof d.prize === 'string' ? d.prize : '';
      this.schedules.set(d.id, d);
      if (d.enabled) on++;
    }
    return on;
  }
}
