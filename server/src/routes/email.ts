// Email over HTTP (../email/*):
//   GET  /api/email/prefs                 your own address (from Discord) and topics; signed in
//   PUT  /api/email/prefs {topics}        turn topics on or off
//   GET  /unsubscribe?t=…                 the link in every email: unsubscribes at once, no sign-in
//   POST /unsubscribe?t=…                 the same for mail apps' one-click button (RFC 8058)
//   POST /api/email/webhook               Resend's bounce and spam-report events (RESEND_WEBHOOK_SECRET)
// Operators (Dashboard → Email):
//   GET  /api/admin/email                 counts per topic, the queue, recent sends (player ids, never addresses)
//   GET  /api/admin/email/export.csv      email, name, topics of subscribers (logged)
//   POST /api/admin/email/test {to?}      a test email to you (or an address you type)
//   POST /api/admin/email/announcement/preview {subject, body, buttonLabel?, buttonUrl?}
//   POST /api/admin/email/announcement    the same plus {confirm: <recipient count>}: queue it (logged)
//   GET  /api/admin/email/sample/:kind    a template rendered with sample data, as HTML
import { createHmac, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { BRAND, GAMES } from '../../../shared/brand.ts';
import { topicInfo, type AnnouncementPreview, type EmailAdminOverview, type EmailPrefs } from '../../../shared/email.ts';
import { getAccount } from '../connections.ts';
import { adminLog, authed, fail, rateLimit, requireAdmin } from '../http.ts';
import { emailFrom, mailer } from '../email/mailer.ts';
import {
  cleanEmail, emailRecord, emailStats, exportRows, markDelivery, setTopics, subscribers, suppression, topicsOf, unsubscribe,
} from '../email/store.ts';
import { esc } from '../email/templates.ts';
import * as T from '../email/templates.ts';
import { verifyUnsubscribeToken } from '../email/token.ts';
import { emailTriggers } from '../email/triggers.ts';

function prefsOf(id: string): EmailPrefs {
  const r = emailRecord(id);
  return { email: r?.email ?? null, verified: !!r?.verified, topics: topicsOf(id), suppressed: suppression(id), sending: mailer().configured };
}

/** Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body" with the whsec_ secret. */
export function validWebhook(secret: string, headers: Record<string, unknown>, body: Buffer, now = Date.now()): boolean {
  const id = String(headers['svix-id'] ?? '');
  const ts = String(headers['svix-timestamp'] ?? '');
  const sigs = String(headers['svix-signature'] ?? '');
  if (!id || !/^\d+$/.test(ts) || !sigs) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const want = createHmac('sha256', key).update(`${id}.${ts}.${body.toString('utf8')}`).digest();
  return sigs.split(' ').some(s => {
    const [v, b64] = s.split(',');
    if (v !== 'v1' || !b64) return false;
    const got = Buffer.from(b64, 'base64');
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** Must be mounted BEFORE express.json(): the signature covers the raw body. */
export function mountEmailWebhook(app: express.Express): void {
  app.post('/api/email/webhook', express.raw({ type: '*/*', limit: '256kb' }), (req, res) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    if (!secret) { res.status(404).json({ error: 'Not configured' }); return; }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!validWebhook(secret, req.headers, raw)) { res.status(401).json({ error: 'bad signature' }); return; }
    let ev: { type?: string; data?: { to?: unknown; bounce?: { type?: string } } };
    try { ev = JSON.parse(raw.toString('utf8')); } catch { res.status(400).json({ error: 'bad body' }); return; }
    const to = Array.isArray(ev.data?.to) ? ev.data!.to : [ev.data?.to];
    const kind = ev.type === 'email.bounced' && ev.data?.bounce?.type !== 'Transient' ? 'bounced'
      : ev.type === 'email.complained' ? 'complained' : null;
    let n = 0;
    if (kind) for (const e of to) n += markDelivery(String(e ?? ''), kind).length;
    if (n) console.log(`[email] ${kind} recorded for ${n} account(s)`);
    res.json({ ok: true });
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · ${esc(BRAND.name)}</title>
<style>body{margin:0;background:#0f1420;color:#eef1f7;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:520px;margin:12vh auto;padding:28px 24px;background:#161c2a;border:1px solid #273049;border-radius:16px}
h1{font-size:24px;margin:0 0 12px}p{margin:0 0 14px;color:#c9d0de}a{color:#ff6b5f}
.bar{height:4px;width:56px;background:#e1251b;border-radius:2px;margin:0 0 18px}.brand{font-weight:800;margin-bottom:18px;display:flex;gap:10px;align-items:center}
.brand img{border-radius:8px}</style></head>
<body><main><div class="brand"><img src="/brand/icon-48.png" width="32" height="32" alt="">${esc(BRAND.name)}</div><div class="bar"></div>${body}</main></body></html>`;
}

export function mountEmail(app: express.Express): void {
  const r = express.Router();
  r.use(rateLimit(60, 60_000));

  r.get('/prefs', (req, res) => {
    const p = authed(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return; }
    res.json(prefsOf(p.id));
  });

  r.put('/prefs', (req, res) => {
    const p = authed(req);
    if (!p) { res.status(401).json({ error: 'Sign in first' }); return; }
    try {
      setTopics(p.id, req.body?.topics);
      res.json(prefsOf(p.id));
    } catch (e) { fail(res, e); }
  });
  app.use('/api/email', r);

  // The unsubscribe link: one click, no sign-in. GET does it too, as the email promises.
  const unsub = (req: express.Request) => {
    const claim = verifyUnsubscribeToken(req.query.t);
    if (claim) unsubscribe(claim.id, claim.topic);
    return claim;
  };
  app.get('/unsubscribe', rateLimit(60, 60_000), (req, res) => {
    res.setHeader('cache-control', 'no-store');
    const claim = unsub(req);
    if (!claim) {
      res.status(400).type('html').send(page('Link not valid', `<h1>That link didn't work</h1>
<p>The unsubscribe link looks damaged. Sign in and turn emails off on your <a href="/settings">notification settings</a> instead.</p>`));
      return;
    }
    const what = claim.topic === 'all' ? 'all emails from us' : `“${topicInfo(claim.topic).label}” emails`;
    res.type('html').send(page('Unsubscribed', `<h1>You're unsubscribed</h1>
<p>You won't get ${esc(what)} any more.</p>
<p>Changed your mind, or want to stop something else? Sign in and open your <a href="/settings">notification settings</a>.</p>
<p><a href="/">Back to ${esc(BRAND.name)}</a></p>`));
  });
  app.post('/unsubscribe', rateLimit(60, 60_000), (req, res) => {
    if (!unsub(req)) { res.status(400).json({ error: 'Invalid link' }); return; }
    res.json({ ok: true });
  });

  // ---- operators ----
  const a = express.Router();
  a.use((req, res, next) => {
    const p = requireAdmin(req, res);
    if (!p) return;
    res.locals.admin = p;
    next();
  });

  a.get('/', (_req, res) => {
    const s = emailStats();
    const m = mailer();
    const out: EmailAdminOverview = {
      configured: m.configured,
      from: emailFrom(),
      webhook: !!process.env.RESEND_WEBHOOK_SECRET?.trim(),
      publicUrl: m.origin(),
      accounts: s.accounts, withEmail: s.withEmail, verified: s.verified, suppressed: s.suppressed,
      topics: s.topics,
      queue: m.stats(),
      limits: { perUserPerDay: m.perUserPerDay, perSecond: m.perSecond },
      recent: m.recent(40),
    };
    res.json(out);
  });

  a.get('/export.csv', (_req, res) => {
    const rows = exportRows();
    const cell = (v: string) => {
      // A leading = + - @ would run as a formula in a spreadsheet.
      const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['email,name,topics', ...rows.map(r => [r.email, getAccount(r.id)?.name ?? '', r.topics.join(' ')].map(cell).join(','))];
    adminLog(res.locals.admin, `exported the email list (${rows.length} subscribers)`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="email-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`${lines.join('\r\n')}\r\n`);
  });

  a.post('/test', rateLimit(10, 60 * 60_000), (req, res) => {
    const by = res.locals.admin as { id: string; name: string };
    const typed = String(req.body?.to ?? '').trim();
    const to = typed ? cleanEmail(typed) : emailRecord(by.id)?.email ?? null;
    if (!to) {
      fail(res, new Error(typed ? 'That is not an email address' : 'You have no email on file: sign in with Discord once, or type an address'));
      return;
    }
    const m = mailer();
    m.enqueueTest(by, to, T.testEmail({ origin: m.origin(), by: by.name }));
    void m.tick();
    adminLog(res.locals.admin, `sent a test email${typed ? ' to a typed address' : ' to their own address'}`);
    res.json({ ok: true, configured: m.configured });
  });

  const announcementInput = (req: express.Request) => {
    const subject = T.plain(req.body?.subject, 120);
    const body = T.plain(req.body?.body, 5000);
    if (subject.length < 3) throw new Error('Give it a subject');
    if (body.length < 10) throw new Error('Write a little more in the message');
    const url = String(req.body?.buttonUrl ?? '').trim();
    if (url && !/^\/[^/\\]/.test(url) && !/^https:\/\/[^\s]+$/.test(url) && url !== '/') throw new Error('The button link must be a site path (/cards) or an https:// address');
    const t = emailTriggers();
    if (!t) throw new Error('Not ready yet, try again in a moment');
    return { t, content: t.announcementContent({ subject, body, buttonLabel: req.body?.buttonLabel, buttonUrl: url || undefined }) };
  };

  a.post('/announcement/preview', (req, res) => {
    try {
      const { content } = announcementInput(req);
      const r = mailer().renderFor(null, 'announcements', content);
      const out: AnnouncementPreview = { subject: r.subject, html: r.html, text: r.text, recipients: subscribers('announcements').length };
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  a.post('/announcement', rateLimit(5, 60 * 60_000), (req, res) => {
    try {
      const { t, content } = announcementInput(req);
      const recipients = subscribers('announcements').length;
      if (Number(req.body?.confirm) !== recipients) {
        res.status(409).json({ error: `The audience changed (now ${recipients}): preview again before sending`, recipients });
        return;
      }
      const out = t.sendAnnouncement(content);
      adminLog(res.locals.admin, `sent the announcement "${content.subject}" (${out.queued} queued, ${out.skipped} skipped)`);
      res.json(out);
    } catch (e) { fail(res, e); }
  });

  a.get('/sample/:kind', (req, res) => {
    const m = mailer();
    const origin = m.origin();
    const now = Date.now();
    const samples: Record<string, () => T.EmailContent> = {
      tournament: () => T.tournamentReminder({ origin, name: 'Monday Night Cup #12', start: now + 3_600_000, now, href: '/tournaments', registered: true, prize: '1 Chog Genesis' }),
      streak: () => T.streakReminder({ origin, name: 'Chogster', dailies: [{ label: GAMES.cards.name, streak: 6, path: `${GAMES.cards.path}#daily` }] }),
      invite: () => T.friendInvite({ origin, from: 'Chogster', game: GAMES.cards.name, url: `${origin}/cards/r/ABCDE` }),
      digest: () => T.weeklyDigest({ origin, name: 'Chogster', d: {
        weekOf: '', games: 412, players: 96,
        top: [{ name: 'Moonchog', wins: 21, games: 40 }, { name: 'Purple Rain', wins: 17, games: 31 }, { name: 'Chogster', wins: 12, games: 29 }],
        tournaments: [{ name: 'Monday Night Cup #13', start: now + 2 * 86_400_000 }, { name: 'Weekend Clash #4', start: now + 5 * 86_400_000 }],
        you: { games: 9, wins: 3 },
      } }),
      announcement: () => T.announcement({ origin, subject: 'A new board just landed', body: 'The Monad City board is live in Monopoly: new streets, new chance cards and a skyline to match.\n\nOpen a table and take it for a spin.', buttonLabel: 'Play Monopoly', buttonUrl: '/monopoly' }),
      test: () => T.testEmail({ origin, by: (res.locals.admin as { name: string }).name }),
    };
    const make = samples[String(req.params.kind)];
    if (!make) { res.status(404).json({ error: `Unknown sample (one of ${Object.keys(samples).join(', ')})` }); return; }
    const kind = String(req.params.kind);
    const topic = kind === 'tournament' ? 'tournaments' : kind === 'streak' ? 'streak' : kind === 'invite' ? 'friendInvites' : kind === 'digest' ? 'digest' : kind === 'announcement' ? 'announcements' : 'test';
    const r = m.renderFor(topic === 'test' ? null : (res.locals.admin as { id: string }).id, topic, make());
    if (req.query.format === 'text') { res.type('text/plain').send(r.text); return; }
    res.type('html').send(r.html);
  });

  app.use('/api/admin/email', a);
}
