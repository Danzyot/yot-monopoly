// Sending: a queue in front of Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
//
//   RESEND_API_KEY  the key (re_…). Unset: nothing is sent; each email is logged
//                   as "not configured" and everything else keeps working.
//   EMAIL_FROM      "Chog Games <hello@choggames.com>" by default; the domain must
//                   be verified in Resend.
//
// The queue sends at most `perSecond` emails a second (Resend's default limit is
// 2), retries 429s, 5xx and network failures with exponential backoff, and caps
// what one player can be sent in a UTC day. Addresses are looked up when an
// email is queued and again just before it goes, so an unsubscribe in between
// wins; they never reach a log line, the activity list or an error message.
import { randomUUID } from 'node:crypto';
import { BRAND } from '../../../shared/brand.ts';
import type { EmailLogRow, EmailTopic } from '../../../shared/email.ts';
import { siteOrigin } from '../seo.ts';
import { deliverableAddress } from './store.ts';
import { render, type EmailContent, type Rendered } from './templates.ts';
import { unsubscribeToken } from './token.ts';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
}

export type SendResult = { ok: true; id?: string } | { ok: false; status: number; error: string; retryAfterMs?: number };
export type Transport = (m: OutgoingEmail) => Promise<SendResult>;

/** Anything that looks like an address, out of a provider's error text before it is logged or shown. */
export const scrubAddresses = (s: string) => s.replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '[address]');

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim();
}

export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || `${BRAND.name} <hello@choggames.com>`;
}

export function resendTransport(apiKey: string, fetchImpl: typeof fetch = fetch): Transport {
  return async m => {
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
        body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({})) as { id?: string };
        return { ok: true, id: j.id };
      }
      const body = await res.text().catch(() => '');
      const after = Number(res.headers.get('retry-after'));
      return { ok: false, status: res.status, error: scrubAddresses(body.slice(0, 300)), ...(after > 0 && { retryAfterMs: after * 1000 }) };
    } catch (e) {
      return { ok: false, status: 0, error: scrubAddresses(e instanceof Error ? e.message : String(e)) };
    }
  };
}

interface Job {
  id: string;
  playerId: string;
  name: string | null;
  topic: EmailTopic | 'test';
  /** Only for test emails, which go to an address an operator typed. */
  testTo?: string;
  content: EmailContent;
  attempts: number;
  nextAt: number;
}

export interface MailerOptions {
  /** null: not configured (log only). Default: Resend when RESEND_API_KEY is set. */
  transport?: Transport | null;
  from?: string;
  now?: () => number;
  origin?: () => string;
  perSecond?: number;
  perUserPerDay?: number;
  maxAttempts?: number;
  /** First retry after this; doubles each time, capped at an hour. */
  backoffMs?: number;
  /** Work the queue this often; 0 leaves it to tick() (tests). */
  tickMs?: number;
  /** Most emails waiting at once; past it new ones are dropped (and logged). */
  maxQueue?: number;
}

export type EnqueueResult = { queued: true } | { queued: false; reason: 'no-address' | 'cap' | 'full' };

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const LOG_MAX = 200;

export class Mailer {
  private queue: Job[] = [];
  private log: EmailLogRow[] = [];
  private perUser = new Map<string, number>();
  private counts = { day: '', sent: 0, failed: 0, notConfigured: 0 };
  private recentSends: number[] = [];
  private busy = false;
  private timer: NodeJS.Timeout | null = null;
  readonly transport: Transport | null;
  readonly from: string;
  readonly now: () => number;
  readonly origin: () => string;
  readonly perSecond: number;
  readonly perUserPerDay: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly maxQueue: number;

  constructor(o: MailerOptions = {}) {
    const key = process.env.RESEND_API_KEY?.trim();
    this.transport = o.transport !== undefined ? o.transport : key ? resendTransport(key) : null;
    this.from = o.from ?? emailFrom();
    this.now = o.now ?? Date.now;
    this.origin = o.origin ?? (() => siteOrigin());
    this.perSecond = o.perSecond ?? 2;
    this.perUserPerDay = o.perUserPerDay ?? (Number(process.env.EMAIL_PER_USER_DAILY) || 4);
    this.maxAttempts = o.maxAttempts ?? 5;
    this.backoffMs = o.backoffMs ?? 30_000;
    this.maxQueue = o.maxQueue ?? 20_000;
    if (o.tickMs) {
      this.timer = setInterval(() => void this.tick(), o.tickMs);
      this.timer.unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get configured(): boolean {
    return !!this.transport;
  }

  private rollDay() {
    const d = day(this.now());
    if (this.counts.day === d) return;
    this.counts = { day: d, sent: 0, failed: 0, notConfigured: 0 };
    this.perUser.clear();
  }

  private note(j: Job, status: EmailLogRow['status'], note?: string) {
    this.log.unshift({ at: this.now(), topic: j.topic, to: j.playerId, name: j.name, subject: j.content.subject, status, ...(note && { note }) });
    if (this.log.length > LOG_MAX) this.log.length = LOG_MAX;
  }

  /** Emails sent (or queued) to this player today, against the daily cap. */
  sentTodayTo(playerId: string): number {
    this.rollDay();
    return this.perUser.get(playerId) ?? 0;
  }

  /**
   * Queue an email for a player on a topic. Refused when they have no deliverable
   * address for it (not verified, unsubscribed, bounced) or hit today's cap.
   */
  enqueue(playerId: string, topic: EmailTopic, content: EmailContent, name: string | null = null): EnqueueResult {
    this.rollDay();
    if (!deliverableAddress(playerId, topic)) return { queued: false, reason: 'no-address' };
    if (topic !== 'account') {
      const n = this.perUser.get(playerId) ?? 0;
      if (n >= this.perUserPerDay) {
        this.note({ id: '', playerId, name, topic, content, attempts: 0, nextAt: 0 }, 'dropped', 'daily cap reached');
        return { queued: false, reason: 'cap' };
      }
      this.perUser.set(playerId, n + 1);
    }
    return this.push({ id: randomUUID(), playerId, name, topic, content, attempts: 0, nextAt: this.now() });
  }

  /** The dashboard's test email: to the operator's own address or one they typed. */
  enqueueTest(by: { id: string; name: string }, to: string, content: EmailContent): EnqueueResult {
    return this.push({ id: randomUUID(), playerId: by.id, name: by.name, topic: 'test', testTo: to, content, attempts: 0, nextAt: this.now() });
  }

  private push(j: Job): EnqueueResult {
    if (this.queue.length >= this.maxQueue) {
      this.note(j, 'dropped', 'queue full');
      return { queued: false, reason: 'full' };
    }
    this.queue.push(j);
    return { queued: true };
  }

  /** The finished email, as it would be sent to this player on this topic (also the dashboard's preview). */
  renderFor(playerId: string | null, topic: EmailTopic | 'test', content: EmailContent): Rendered & { headers: Record<string, string> } {
    const origin = this.origin();
    const unsubscribeUrl = playerId && topic !== 'test' ? `${origin}/unsubscribe?t=${unsubscribeToken(playerId, topic)}` : null;
    const r = render(content, { origin, topic, unsubscribeUrl });
    const headers: Record<string, string> = unsubscribeUrl
      ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : {};
    return { ...r, headers };
  }

  /** Send what is due, within the per-second limit. Safe to call often; one run at a time. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.rollDay();
      for (;;) {
        const now = this.now();
        this.recentSends = this.recentSends.filter(t => now - t < 1000);
        if (this.recentSends.length >= this.perSecond) return;
        const i = this.queue.findIndex(j => j.nextAt <= now);
        if (i < 0) return;
        const [j] = this.queue.splice(i, 1);
        await this.sendOne(j);
      }
    } finally {
      this.busy = false;
    }
  }

  private async sendOne(j: Job) {
    const to = j.topic === 'test' ? j.testTo ?? null : deliverableAddress(j.playerId, j.topic);
    if (!to) { this.note(j, 'dropped', 'unsubscribed or no longer deliverable'); return; }
    const r = this.renderFor(j.topic === 'test' ? null : j.playerId, j.topic, j.content);
    if (!this.transport) {
      this.counts.notConfigured++;
      this.note(j, 'not-configured');
      console.log(`[email] not configured (RESEND_API_KEY unset): "${r.subject}" (${j.topic}) for player ${j.playerId} not sent`);
      return;
    }
    this.recentSends.push(this.now());
    const res = await this.transport({ from: this.from, to, subject: r.subject, html: r.html, text: r.text, headers: r.headers, idempotencyKey: j.id });
    if (res.ok) {
      this.counts.sent++;
      this.note(j, 'sent');
      return;
    }
    j.attempts++;
    const retryable = res.status === 0 || res.status === 429 || res.status >= 500;
    if (retryable && j.attempts < this.maxAttempts) {
      const wait = res.retryAfterMs ?? Math.min(3_600_000, this.backoffMs * 2 ** (j.attempts - 1));
      j.nextAt = this.now() + wait;
      this.queue.push(j);
      this.note(j, 'retrying', `HTTP ${res.status || 'network'}; again in ${Math.round(wait / 1000)}s`);
      return;
    }
    this.counts.failed++;
    this.note(j, 'failed', `HTTP ${res.status || 'network'}: ${scrubAddresses(res.error).slice(0, 160)}`);
    console.error(`[email] "${r.subject}" for player ${j.playerId} failed: HTTP ${res.status} ${scrubAddresses(res.error).slice(0, 200)}`);
  }

  stats() {
    this.rollDay();
    return {
      pending: this.queue.length,
      sentToday: this.counts.sent,
      failedToday: this.counts.failed,
      notConfiguredToday: this.counts.notConfigured,
    };
  }

  recent(n = 50): EmailLogRow[] {
    return this.log.slice(0, n).map(r => ({ ...r }));
  }

  /** A deleted player: nothing queued for them goes out. */
  forget(playerId: string): void {
    this.queue = this.queue.filter(j => j.playerId !== playerId || j.topic === 'test');
    this.log = this.log.filter(r => r.to !== playerId);
    this.perUser.delete(playerId);
  }
}

let shared: Mailer | null = null;

/** The server's mailer (index.ts starts its clock). */
export function mailer(): Mailer {
  return shared ??= new Mailer({ tickMs: 500 });
}

/** For tests: use this one instead. */
export function setMailer(m: Mailer | null): void {
  shared = m;
}
