// Email notifications (src/email/*, routes/email.ts): the Discord `email` scope and
// where the address is kept, opt-in defaults, the unsubscribe token, the send queue
// (not configured, rate limit, per-player cap, retries), when each trigger fires,
// data deletion, and that the operator routes are operators-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-email-'));
process.env.RATE_LIMIT_OFF = '1';
process.env.APP_SECRET = 'email-test-secret';
process.env.ADMIN_DISCORD_IDS = '111';
process.env.DISCORD_CLIENT_ID = '123456789012345678';
process.env.DISCORD_CLIENT_SECRET = 'shh';
process.env.PUBLIC_URL = 'https://choggames.com';
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_WEBHOOK_SECRET;
delete process.env.DEMO_MODE;

const { default: express } = await import('express');
const { authorizeUrl, OAUTH_SCOPES } = await import('../src/discord.ts');
const { authRoutes } = await import('../src/routes/auth.ts');
const { mountEmail, mountEmailWebhook, validWebhook } = await import('../src/routes/email.ts');
const { signState, signToken, makeDiscordProfile, serviceMac } = await import('../src/auth.ts');
const store = await import('../src/email/store.ts');
const { unsubscribeToken, verifyUnsubscribeToken } = await import('../src/email/token.ts');
const { Mailer, setMailer, scrubAddresses } = await import('../src/email/mailer.ts');
const { EmailTriggers, configureEmailTriggers, registerDailySource, REMINDER_LEAD_MS } = await import('../src/email/triggers.ts');
const { buildDigest } = await import('../src/email/digest.ts');
const { erasePlayer } = await import('../src/erase.ts');
const { getAccount, loadAccounts, recordConnection } = await import('../src/connections.ts');
const { eventsForGame } = await import('../src/eventlog.ts');
const { defaultTopics, EMAIL_TOPIC_IDS } = await import('../../shared/email.ts');
type OutgoingEmail = import('../src/email/mailer.ts').OutgoingEmail;
type SendResult = import('../src/email/mailer.ts').SendResult;

const realFetch = globalThis.fetch;
const OP = signToken(makeDiscordProfile({ id: '111', username: 'Operator' }));
const PLAYER = signToken(makeDiscordProfile({ id: '222', username: 'Player' }));

let server: Server;
let base = '';

before(async () => {
  loadAccounts();
  const app = express();
  mountEmailWebhook(app);
  app.use(express.json());
  app.use('/api/auth', authRoutes());
  mountEmail(app);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server?.close();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** A deliverable subscriber with these topics on. */
function subscribe(id: string, topics: Partial<Record<string, boolean>>, email = `${id}@example.com`) {
  store.recordDiscordEmail(id, email, true);
  store.setTopics(id, topics);
}

/** A transport that records what it was asked to send. */
function recorder(results: SendResult[] = []) {
  const sent: OutgoingEmail[] = [];
  const t = async (m: OutgoingEmail): Promise<SendResult> => { sent.push(m); return results.shift() ?? { ok: true, id: 'x' }; };
  return { sent, t };
}

// ---- Discord sign-in ------------------------------------------------------------------

test('sign-in asks Discord for the email scope (with the scopes it had)', () => {
  const url = new URL(authorizeUrl('state', 'https://choggames.com/api/auth/discord/callback'));
  const scopes = url.searchParams.get('scope')!.split(' ');
  for (const s of ['identify', 'email', 'guilds', 'guilds.members.read']) assert.ok(scopes.includes(s), s);
  assert.deepEqual([...OAUTH_SCOPES].sort(), scopes.sort());
});

test('a Discord sign-in stores the address and verified flag server-side only, never in the token or /me', async () => {
  store.resetEmailStore();
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (u.includes('discord.com/api/v10/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    if (u.includes('/users/@me/guilds')) return new Response('[]', { status: 200 });
    if (u.includes('/users/@me')) {
      return new Response(JSON.stringify({ id: '555000555', username: 'mailer', global_name: 'Mail Person', avatar: null, email: 'Mail.Person@Example.com', verified: true }), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const state = signState({ return: '/cards' });
    const res = await realFetch(`${base}/api/auth/discord/callback?code=c-1&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location')!;
    assert.match(loc, /^\/cards#dtoken=/);
    const token = decodeURIComponent(loc.split('#dtoken=')[1]);
    // The token is base64url JSON: the address must not be in it.
    const payload = Buffer.from(token.slice(0, token.lastIndexOf('.')), 'base64url').toString('utf8');
    assert.ok(!/mail\.person/i.test(payload), 'no address in the session token');
    assert.ok(!/@example/i.test(loc));

    const rec = store.emailRecord('dc_555000555');
    assert.equal(rec?.email, 'mail.person@example.com');
    assert.equal(rec?.verified, true);

    const me = await (await realFetch(`${base}/api/auth/me`, { headers: auth(token) })).text();
    assert.ok(!/example\.com/i.test(me), '/api/auth/me carries no address');

    // Their own settings show it (to them only).
    const prefs = await (await realFetch(`${base}/api/email/prefs`, { headers: auth(token) })).json() as { email: string; verified: boolean; topics: Record<string, boolean> };
    assert.equal(prefs.email, 'mail.person@example.com');
    assert.equal(prefs.verified, true);
    assert.deepEqual(prefs.topics, defaultTopics());

    // Discord says unverified next time: kept, but not deliverable.
    store.recordDiscordEmail('dc_555000555', 'mail.person@example.com', false);
    store.setTopics('dc_555000555', { announcements: true });
    assert.equal(store.deliverableAddress('dc_555000555', 'announcements'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the address lives in email.json only: the account record and its file never hold it', async () => {
  store.flushEmailStore();
  const saved = JSON.parse(readFileSync(join(process.env.DATA_DIR!, 'email.json'), 'utf8'));
  assert.equal(saved['dc_555000555'].email, 'mail.person@example.com');
  recordConnection(makeDiscordProfile({ id: '555000555', username: 'Mail Person' }), '203.0.113.5');
  assert.ok(!JSON.stringify(getAccount('dc_555000555')).includes('@'));
});

// ---- consent ------------------------------------------------------------------------

test('every topic is off by default except account notices; turning one on records consent', () => {
  store.resetEmailStore();
  const t = store.topicsOf('dc_new');
  for (const id of EMAIL_TOPIC_IDS) assert.equal(t[id], id === 'account', id);
  store.recordDiscordEmail('dc_new', 'new@example.com', true);
  // Having an address is not consent.
  assert.equal(store.deliverableAddress('dc_new', 'digest'), null);
  assert.equal(store.deliverableAddress('dc_new', 'account'), 'new@example.com');
  assert.deepEqual(store.subscribers('announcements'), []);
  store.setTopics('dc_new', { digest: true, bogus: true, streak: 'yes' }, 1234);
  assert.equal(store.topicsOf('dc_new').digest, true);
  assert.equal(store.topicsOf('dc_new').streak, false, 'only real booleans count');
  assert.equal(store.emailRecord('dc_new')?.consentAt.digest, 1234);
  assert.equal(store.deliverableAddress('dc_new', 'digest'), 'new@example.com');
});

test('only Discord-verified addresses are deliverable; bounces and spam reports stop mail', () => {
  store.resetEmailStore();
  subscribe('dc_a', { announcements: true });
  store.recordDiscordEmail('dc_b', 'b@example.com', false);
  store.setTopics('dc_b', { announcements: true });
  assert.deepEqual(store.subscribers('announcements'), ['dc_a']);
  store.markDelivery('DC_A@example.com', 'bounced');
  assert.equal(store.deliverableAddress('dc_a', 'announcements'), null);
  // A new address from Discord clears the bounce.
  store.recordDiscordEmail('dc_a', 'a2@example.com', true);
  assert.equal(store.deliverableAddress('dc_a', 'announcements'), 'a2@example.com');
  store.markDelivery('a2@example.com', 'complained');
  assert.equal(store.topicsOf('dc_a').announcements, false, 'a spam report turns topics off');
  assert.equal(store.suppression('dc_a'), 'complained');
});

// ---- unsubscribe tokens ---------------------------------------------------------------

test('unsubscribe tokens verify, and any tampering is refused', () => {
  const t = unsubscribeToken('dc_42', 'digest');
  assert.deepEqual(verifyUnsubscribeToken(t), { id: 'dc_42', topic: 'digest' });
  assert.deepEqual(verifyUnsubscribeToken(unsubscribeToken('dc_42', 'all')), { id: 'dc_42', topic: 'all' });
  const [payload, mac] = t.split('.');
  const forged = Buffer.from('dc_43|digest').toString('base64url');
  assert.equal(verifyUnsubscribeToken(`${forged}.${mac}`), null, 'another player');
  assert.equal(verifyUnsubscribeToken(`${payload}.${mac.slice(0, -2)}xx`), null, 'bad mac');
  assert.equal(verifyUnsubscribeToken(`${payload}.`), null);
  assert.equal(verifyUnsubscribeToken(payload), null);
  assert.equal(verifyUnsubscribeToken(''), null);
  assert.equal(verifyUnsubscribeToken(null), null);
  const otherTopic = Buffer.from('dc_42|nope').toString('base64url');
  assert.equal(verifyUnsubscribeToken(`${otherTopic}.${serviceMac(`unsub:${otherTopic}`)}`), null, 'unknown topic');
  // A MAC made for another purpose does not pass.
  assert.equal(verifyUnsubscribeToken(`${payload}.${serviceMac(payload)}`), null);
  // Nor does a session token.
  assert.equal(verifyUnsubscribeToken(PLAYER), null);
});

test('GET /unsubscribe unsubscribes in one click; POST does too (List-Unsubscribe-Post); a bad link changes nothing', async () => {
  store.resetEmailStore();
  subscribe('dc_u', { digest: true, streak: true, announcements: true });
  const one = await realFetch(`${base}/unsubscribe?t=${unsubscribeToken('dc_u', 'digest')}`);
  assert.equal(one.status, 200);
  assert.match(await one.text(), /unsubscribed/i);
  assert.equal(store.topicsOf('dc_u').digest, false);
  assert.equal(store.topicsOf('dc_u').streak, true);

  const post = await realFetch(`${base}/unsubscribe?t=${unsubscribeToken('dc_u', 'streak')}`, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(post.status, 200);
  assert.equal(store.topicsOf('dc_u').streak, false);

  const bad = await realFetch(`${base}/unsubscribe?t=${unsubscribeToken('dc_u', 'all').slice(0, -3)}abc`);
  assert.equal(bad.status, 400);
  assert.equal(store.topicsOf('dc_u').announcements, true);

  await realFetch(`${base}/unsubscribe?t=${unsubscribeToken('dc_u', 'all')}`);
  for (const id of EMAIL_TOPIC_IDS) assert.equal(store.topicsOf('dc_u')[id], false, id);
});

test('PUT /api/email/prefs needs a session and saves only that player', async () => {
  store.resetEmailStore();
  assert.equal((await realFetch(`${base}/api/email/prefs`)).status, 401);
  const res = await realFetch(`${base}/api/email/prefs`, { method: 'PUT', headers: { ...auth(PLAYER), 'content-type': 'application/json' }, body: JSON.stringify({ topics: { tournaments: true } }) });
  assert.equal(res.status, 200);
  const body = await res.json() as { email: string | null; topics: Record<string, boolean>; sending: boolean };
  assert.equal(body.email, null, 'no address yet (never signed in with Discord here)');
  assert.equal(body.topics.tournaments, true);
  assert.equal(body.sending, false);
  assert.equal(store.topicsOf('dc_222').tournaments, true);
  assert.equal(store.topicsOf('dc_111').tournaments, false);
});

// ---- the queue -----------------------------------------------------------------------

const content = (subject = 'Hello') => ({ subject, preheader: 'p', heading: 'h', blocks: [{ p: 'body' }] });

test('not configured: nothing is sent, each email is logged as not configured', async () => {
  store.resetEmailStore();
  subscribe('dc_nc', { announcements: true });
  const m = new Mailer({ transport: null, origin: () => 'https://choggames.com' });
  assert.equal(m.configured, false);
  assert.deepEqual(m.enqueue('dc_nc', 'announcements', content()), { queued: true });
  await m.tick();
  assert.equal(m.stats().notConfiguredToday, 1);
  assert.equal(m.stats().pending, 0);
  assert.equal(m.recent()[0].status, 'not-configured');
  assert.ok(!JSON.stringify(m.recent()).includes('@example.com'), 'the log names players, not addresses');
  // And by default (no RESEND_API_KEY) the mailer is not configured.
  assert.equal(new Mailer().configured, false);
});

test('the queue sends within the per-second limit', async () => {
  store.resetEmailStore();
  for (let i = 0; i < 5; i++) subscribe(`dc_r${i}`, { announcements: true });
  let clock = 1_000_000;
  const { sent, t } = recorder();
  const m = new Mailer({ transport: t, now: () => clock, perSecond: 2, origin: () => 'https://choggames.com' });
  for (let i = 0; i < 5; i++) m.enqueue(`dc_r${i}`, 'announcements', content());
  await m.tick();
  assert.equal(sent.length, 2);
  await m.tick();
  assert.equal(sent.length, 2, 'still inside the same second');
  clock += 1000;
  await m.tick();
  assert.equal(sent.length, 4);
  clock += 1000;
  await m.tick();
  assert.equal(sent.length, 5);
  assert.equal(m.stats().sentToday, 5);
});

test('each email carries List-Unsubscribe, a one-click link in both parts, and a plain-text alternative', async () => {
  store.resetEmailStore();
  subscribe('dc_h', { digest: true });
  const { sent, t } = recorder();
  const m = new Mailer({ transport: t, from: 'Chog Games <hello@choggames.com>', origin: () => 'https://choggames.com' });
  m.enqueue('dc_h', 'digest', content('Weekly'));
  await m.tick();
  const e = sent[0];
  assert.equal(e.to, 'dc_h@example.com');
  assert.equal(e.from, 'Chog Games <hello@choggames.com>');
  const link = e.headers['List-Unsubscribe'].slice(1, -1);
  assert.match(link, /^https:\/\/choggames\.com\/unsubscribe\?t=/);
  assert.deepEqual(verifyUnsubscribeToken(new URL(link).searchParams.get('t')), { id: 'dc_h', topic: 'digest' });
  assert.equal(e.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(e.html.includes(link.replace(/&/g, '&amp;')));
  assert.ok(e.text.includes(link));
  assert.match(e.text, /Weekly|h/);
  assert.ok(!/<[a-z]/i.test(e.text), 'the text part has no markup');
});

test('a player is capped per day; the cap resets the next UTC day', async () => {
  store.resetEmailStore();
  subscribe('dc_cap', { announcements: true, digest: true });
  let clock = Date.UTC(2026, 9, 21, 10);
  const { t } = recorder();
  const m = new Mailer({ transport: t, now: () => clock, perUserPerDay: 2, origin: () => 'https://choggames.com' });
  assert.equal(m.enqueue('dc_cap', 'announcements', content()).queued, true);
  assert.equal(m.enqueue('dc_cap', 'digest', content()).queued, true);
  assert.deepEqual(m.enqueue('dc_cap', 'announcements', content()), { queued: false, reason: 'cap' });
  assert.equal(m.recent()[0].status, 'dropped');
  clock += 24 * 3_600_000;
  assert.equal(m.enqueue('dc_cap', 'announcements', content()).queued, true);
  // Nobody without an address or topic is queued at all.
  assert.deepEqual(m.enqueue('dc_nobody', 'announcements', content()), { queued: false, reason: 'no-address' });
});

test('retries 429 / 5xx / network with backoff; other errors fail at once; unsubscribing before the send wins', async () => {
  store.resetEmailStore();
  subscribe('dc_rt', { announcements: true, digest: true, streak: true });
  let clock = 5_000_000;
  const { sent, t } = recorder([
    { ok: false, status: 503, error: 'down' },
    { ok: false, status: 0, error: 'ECONNRESET' },
    { ok: true },
    { ok: false, status: 422, error: 'Invalid `to` field: dc_rt@example.com' },
  ]);
  const m = new Mailer({ transport: t, now: () => clock, backoffMs: 30_000, origin: () => 'https://choggames.com', perUserPerDay: 10 });
  m.enqueue('dc_rt', 'announcements', content('A'));
  await m.tick();
  assert.equal(sent.length, 1);
  assert.equal(m.stats().pending, 1);
  assert.equal(m.recent()[0].status, 'retrying');
  clock += 29_000;
  await m.tick();
  assert.equal(sent.length, 1, 'not before the backoff');
  clock += 2_000;
  await m.tick();
  assert.equal(sent.length, 2, 'second try');
  clock += 59_000;
  await m.tick();
  assert.equal(sent.length, 2, 'backoff doubled');
  clock += 2_000;
  await m.tick();
  assert.equal(sent.length, 3);
  assert.equal(m.stats().sentToday, 1);

  m.enqueue('dc_rt', 'digest', content('B'));
  clock += 2_000;
  await m.tick();
  assert.equal(m.stats().failedToday, 1);
  assert.equal(m.stats().pending, 0, 'a 422 is not retried');
  assert.ok(!JSON.stringify(m.recent()).includes('dc_rt@example.com'), 'provider errors are scrubbed of addresses');
  assert.equal(scrubAddresses('to a@b.co failed'), 'to [address] failed');

  m.enqueue('dc_rt', 'streak', content('C'));
  store.unsubscribe('dc_rt', 'streak');
  clock += 2_000;
  await m.tick();
  assert.equal(sent.length, 4, 'nothing sent after the unsubscribe');
  assert.equal(m.recent()[0].status, 'dropped');
});

// ---- triggers ------------------------------------------------------------------------

function triggerRig(now: number, opts: Partial<ConstructorParameters<typeof EmailTriggers>[0]> = {}) {
  const { sent, t } = recorder();
  let clock = now;
  const m = new Mailer({ transport: t, now: () => clock, perSecond: 1000, perUserPerDay: 50, origin: () => 'https://choggames.com' });
  const trig = new EmailTriggers({
    mailer: m, now: () => clock, file: null,
    name: id => id.toUpperCase(), banned: id => id === 'dc_banned',
    tournaments: () => [], scheduled: () => [],
    digest: () => ({ weekOf: '', games: 3, players: 2, top: [{ name: 'Ace', wins: 2, games: 3 }], tournaments: [] }),
    ...opts,
  });
  return { sent, m, trig, set: (t: number) => { clock = t; }, flush: () => m.tick() };
}

test('tournament reminders: an hour before, to entrants (not ones who just signed up), every subscriber for scheduled events, once', async () => {
  store.resetEmailStore();
  for (const id of ['dc_in', 'dc_late', 'dc_out', 'dc_off', 'dc_banned']) subscribe(id, { tournaments: id !== 'dc_off' });
  const T0 = Date.UTC(2026, 9, 22, 20);
  const key = `s:sch:${T0 + 30 * 60_000}`;
  let created = false;
  const rig = triggerRig(T0 - 90 * 60_000, {
    tournaments: () => [{
      id: 'cup1', name: 'Monday Cup #1', start: T0, href: '/tournaments/cup1',
      entrants: [{ id: 'dc_in', at: T0 - 5 * 3_600_000 }, { id: 'dc_late', at: T0 - 30 * 60_000 }, { id: 'dc_off', at: 0 }, { id: 'dc_banned', at: 0 }],
    }, ...(created ? [{ id: 'n4', name: 'Nightly #4', start: T0 + 30 * 60_000, href: '/tournaments/n4', scheduleKey: key, entrants: [{ id: 'dc_in', at: 0 }] }] : [])],
    scheduled: () => (created ? [] : [{ key, name: 'Nightly #4', start: T0 + 30 * 60_000, opensAt: T0 + 20 * 60_000 }]),
  });
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 0, '90 minutes out: too early');

  rig.set(T0 - REMINDER_LEAD_MS + 60_000);
  rig.trig.tick();
  await rig.flush();
  assert.deepEqual(rig.sent.map(s => s.to), ['dc_in@example.com'], 'only the entrant who signed up before the hour');
  assert.match(rig.sent[0].subject, /Monday Cup #1 starts in about an hour/);
  assert.match(rig.sent[0].html, /choggames\.com\/tournaments\/cup1/);

  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 1, 'never twice');

  // The scheduled one (starts 30 min after the cup) comes due later: every subscriber.
  rig.set(T0 + 30 * 60_000 - 50 * 60_000);
  rig.trig.tick();
  await rig.flush();
  const nightly = rig.sent.filter(s => /Nightly/.test(s.subject)).map(s => s.to).sort();
  assert.deepEqual(nightly, ['dc_in@example.com', 'dc_late@example.com', 'dc_out@example.com']);
  assert.match(rig.sent.find(s => /Nightly/.test(s.subject))!.text, /Registration opens at/);

  // Once the schedule creates the event, it shares the occurrence's key: nobody is reminded twice.
  created = true;
  rig.set(T0 - 10 * 60_000);
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.filter(s => /Nightly/.test(s.subject)).length, 3);
});

test('tournament reminders: not inside the last five minutes (a late catch-up)', async () => {
  store.resetEmailStore();
  subscribe('dc_x', { tournaments: true });
  const start = Date.UTC(2026, 9, 22, 20);
  const rig = triggerRig(start - 4 * 60_000, { tournaments: () => [{ id: 'c', name: 'Cup', start, href: '/tournaments/c', entrants: [{ id: 'dc_x', at: 0 }] }] });
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 0);
});

test('streak reminder: in the evening, only with a streak going and today not played, across every registered daily', async () => {
  store.resetEmailStore();
  const status: Record<string, { streak: number; playedToday: boolean } | null> = {
    dc_streak: { streak: 4, playedToday: false },
    dc_played: { streak: 5, playedToday: true },
    dc_zero: { streak: 0, playedToday: false },
    dc_never: null,
    dc_nosub: { streak: 9, playedToday: false },
  };
  registerDailySource({ id: 'cards', label: 'Cards', path: '/cards#daily', status: id => status[id] ?? null });
  registerDailySource({ id: 'other', label: 'Other', path: '/other', status: id => (id === 'dc_played' ? { streak: 2, playedToday: false } : null) });
  for (const id of Object.keys(status)) subscribe(id, { streak: id !== 'dc_nosub' });
  const day = Date.UTC(2026, 9, 22);
  const rig = triggerRig(day + 12 * 3_600_000);
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 0, 'not at noon');

  rig.set(day + 19 * 3_600_000);
  rig.trig.tick();
  await rig.flush();
  assert.deepEqual(rig.sent.map(s => s.to).sort(), ['dc_played@example.com', 'dc_streak@example.com']);
  const played = rig.sent.find(s => s.to === 'dc_played@example.com')!;
  assert.match(played.subject, /2-day Other streak/, 'the one daily still open today');
  assert.match(rig.sent.find(s => s.to === 'dc_streak@example.com')!.html, /cards#daily/);

  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 2, 'once a day');
  rig.set(day + 43 * 3_600_000);
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 4, 'and again the next evening');
});

test('weekly digest: on its day and hour, once, to subscribers only', async () => {
  store.resetEmailStore();
  subscribe('dc_d1', { digest: true });
  subscribe('dc_d2', { announcements: true });
  const monday = Date.UTC(2026, 9, 26); // a Monday
  const rig = triggerRig(monday + 10 * 3_600_000);
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 0, 'before the hour');
  rig.set(monday + 16 * 3_600_000);
  rig.trig.tick();
  rig.trig.tick();
  await rig.flush();
  assert.deepEqual(rig.sent.map(s => s.to), ['dc_d1@example.com']);
  assert.match(rig.sent[0].html, /Ace/);
  rig.set(monday + 40 * 3_600_000);
  rig.trig.tick();
  await rig.flush();
  assert.equal(rig.sent.length, 1, 'not on Tuesday');
});

test('the digest counts public games of the last week, top players by wins, no bots or banned players', () => {
  const now = Date.UTC(2026, 9, 26, 15);
  const g = (endedAt: number, ids: string[], priv = false) => ({
    endedAt, ...(priv && { private: true as const }),
    places: ids.map(id => ({ id, name: id.toUpperCase(), isBot: id.startsWith('bot') })),
  });
  const d = buildDigest({
    monopoly: [g(now - 86_400_000, ['dc_a', 'dc_b']), g(now - 2 * 86_400_000, ['dc_a', 'bot1']), g(now - 9 * 86_400_000, ['dc_b', 'dc_a'])],
    cards: [g(now - 3_600_000, ['dc_ban', 'dc_a']), g(now - 3_600_000, ['dc_b', 'dc_a'], true)],
    banned: id => id === 'dc_ban',
    tournaments: () => [{ name: 'Soon', start: now + 86_400_000 }, { name: 'Too far', start: now + 9 * 86_400_000 }],
  }, now);
  assert.equal(d.games, 3);
  assert.deepEqual(d.top.map(t => t.name), ['DC_A']);
  assert.deepEqual(d.tournaments.map(t => t.name), ['Soon']);
});

test('friend invite while offline: only when they opted in, at most once per friend every six hours', async () => {
  store.resetEmailStore();
  subscribe('dc_friend', { friendInvites: true });
  subscribe('dc_nope', { announcements: true });
  const rig = triggerRig(Date.UTC(2026, 9, 22, 12));
  assert.equal(rig.trig.friendInviteOffline({ id: 'dc_me', name: 'Me' }, 'dc_friend', 'Cards', '/cards/r/ABCDE'), true);
  assert.equal(rig.trig.friendInviteOffline({ id: 'dc_me', name: 'Me' }, 'dc_friend', 'Cards', '/cards/r/ABCDE'), false);
  assert.equal(rig.trig.friendInviteOffline({ id: 'dc_me', name: 'Me' }, 'dc_nope', 'Cards', '/cards/r/ABCDE'), false);
  await rig.flush();
  assert.equal(rig.sent.length, 1);
  assert.match(rig.sent[0].subject, /Me invited you to a Cards table/);
  assert.match(rig.sent[0].html, /choggames\.com\/cards\/r\/ABCDE/);
  rig.set(Date.UTC(2026, 9, 22, 19));
  assert.equal(rig.trig.friendInviteOffline({ id: 'dc_me', name: 'Me' }, 'dc_friend', 'Cards', '/cards/r/FGHIJ'), true);
});

// ---- deletion -------------------------------------------------------------------------

test('deleting a player erases their address, choices and anything queued', async () => {
  store.resetEmailStore();
  subscribe('dc_gone', { announcements: true, digest: true });
  const { sent, t } = recorder();
  const m = new Mailer({ transport: t, origin: () => 'https://choggames.com' });
  setMailer(m);
  m.enqueue('dc_gone', 'announcements', content());
  const report = erasePlayer('dc_gone', { seatedAt: () => [], tournaments: { forgetPlayer: () => 0 }, friends: null });
  assert.equal(report.email, true);
  assert.equal(store.emailRecord('dc_gone'), null);
  assert.deepEqual(store.subscribers('announcements'), []);
  await m.tick();
  assert.equal(sent.length, 0);
  store.flushEmailStore();
  assert.ok(!readFileSync(join(process.env.DATA_DIR!, 'email.json'), 'utf8').includes('dc_gone'));
  setMailer(null);
});

// ---- operators ------------------------------------------------------------------------

test('the Email tab routes are operators-only', async () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/admin/email'],
    ['GET', '/api/admin/email/export.csv'],
    ['POST', '/api/admin/email/test', {}],
    ['POST', '/api/admin/email/announcement/preview', { subject: 'Hello all', body: 'Something new is here.' }],
    ['POST', '/api/admin/email/announcement', { subject: 'Hello all', body: 'Something new is here.', confirm: 0 }],
    ['GET', '/api/admin/email/sample/digest'],
  ];
  for (const [method, path, body] of routes) {
    const init = (h: Record<string, string>) => ({ method, headers: { ...h, 'content-type': 'application/json' }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    assert.equal((await realFetch(base + path, init({}))).status, 401, `${path} signed out`);
    assert.equal((await realFetch(base + path, init(auth(PLAYER)))).status, 403, `${path} as a player`);
  }
});

test('operators: overview counts without addresses, a logged CSV export, preview then confirm', async () => {
  store.resetEmailStore();
  recordConnection(makeDiscordProfile({ id: '333', username: '=Evil' }), null);
  subscribe('dc_333', { announcements: true, digest: true }, 'evil@example.com');
  subscribe('dc_444', { tournaments: true });
  store.recordDiscordEmail('dc_555', 'unverified@example.com', false);
  store.setTopics('dc_555', { announcements: true });
  const trig = triggerRig(Date.now());
  setMailer(trig.m);
  configureEmailTriggers(trig.trig);
  try {
    const o = await (await realFetch(`${base}/api/admin/email`, { headers: auth(OP) })).json() as import('../../shared/email.ts').EmailAdminOverview;
    assert.equal(o.withEmail, 3);
    assert.equal(o.verified, 2);
    assert.equal(o.topics.announcements, 1);
    assert.equal(o.topics.tournaments, 1);
    assert.equal(o.configured, true);
    assert.ok(!JSON.stringify(o).includes('@example.com'));

    const csv = await realFetch(`${base}/api/admin/email/export.csv`, { headers: auth(OP) });
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    const text = await csv.text();
    assert.match(text, /^email,name,topics\r\n/);
    assert.match(text, /evil@example\.com,'=Evil,digest announcements/, 'formula-safe names');
    assert.ok(!text.includes('unverified@'), 'unverified addresses are not exported');
    assert.ok(eventsForGame('admin').some(e => /exported the email list/.test(e.text)), 'the export is logged');

    const prev = await (await realFetch(`${base}/api/admin/email/announcement/preview`, {
      method: 'POST', headers: { ...auth(OP), 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'New board', body: 'Monad City is <b>live</b>.', buttonUrl: '/monopoly' }),
    })).json() as import('../../shared/email.ts').AnnouncementPreview;
    assert.equal(prev.recipients, 1);
    assert.ok(prev.html.includes('&lt;b&gt;live&lt;/b&gt;'), 'operator text is escaped');
    assert.match(prev.html, /choggames\.com\/monopoly/);

    const wrong = await realFetch(`${base}/api/admin/email/announcement`, {
      method: 'POST', headers: { ...auth(OP), 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'New board', body: 'Monad City is live.', confirm: 7 }),
    });
    assert.equal(wrong.status, 409, 'the confirm step must match the previewed audience');
    const ok = await (await realFetch(`${base}/api/admin/email/announcement`, {
      method: 'POST', headers: { ...auth(OP), 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'New board', body: 'Monad City is live.', confirm: 1 }),
    })).json() as { queued: number };
    assert.equal(ok.queued, 1);
    await trig.flush();
    assert.deepEqual(trig.sent.map(s => s.to), ['evil@example.com']);

    const sample = await realFetch(`${base}/api/admin/email/sample/streak`, { headers: auth(OP) });
    assert.match(await sample.text(), /Daily/);
  } finally {
    setMailer(null);
    configureEmailTriggers(null);
  }
});

test('the Resend webhook checks its signature and records bounces', async () => {
  const secret = `whsec_${Buffer.from('webhook-key-0123456789').toString('base64')}`;
  const body = Buffer.from(JSON.stringify({ type: 'email.bounced', data: { to: ['hook@example.com'], bounce: { type: 'Permanent' } } }));
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', Buffer.from('webhook-key-0123456789')).update(`msg_1.${ts}.${body}`).digest('base64');
  const headers = { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` };
  assert.equal(validWebhook(secret, headers, body), true);
  assert.equal(validWebhook(secret, { ...headers, 'svix-signature': `v1,${sig.slice(0, -4)}AAAA` }, body), false);
  assert.equal(validWebhook(secret, headers, Buffer.from(`${body} `)), false);
  assert.equal(validWebhook(secret, { ...headers, 'svix-timestamp': String(Number(ts) - 3600) }, body), false);

  store.resetEmailStore();
  subscribe('dc_hook', { announcements: true }, 'hook@example.com');
  assert.equal((await realFetch(`${base}/api/email/webhook`, { method: 'POST', headers, body })).status, 404, 'off without a secret');
  process.env.RESEND_WEBHOOK_SECRET = secret;
  try {
    assert.equal((await realFetch(`${base}/api/email/webhook`, { method: 'POST', headers: { ...headers, 'svix-signature': 'v1,AAAA' }, body })).status, 401);
    assert.equal((await realFetch(`${base}/api/email/webhook`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body })).status, 200);
    assert.equal(store.suppression('dc_hook'), 'bounced');
  } finally {
    delete process.env.RESEND_WEBHOOK_SECRET;
  }
});
