// The Analytics tab's two counters: page loads (visits.ts) never keep an
// address, a user-agent or a visitor hash, rotate their key daily and forget
// days after the retention window; live samples (liveSamples.ts) keep peaks
// only, for the same window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-visits-'));
const DIR = process.env.DATA_DIR;

const { createVisitCounter, isBotAgent, pageOf, visitorHash, NOT_FOUND_PAGE } = await import('../src/visits.ts');
const { createLiveSampler } = await import('../src/liveSamples.ts');

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-21T10:00:00Z');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ZebraTestAgent';
const IP = '203.0.113.77';
const IP6 = '2001:db8::beef';

/** Everything the counter wrote to the data volume, as one string. */
const onDisk = () => readdirSync(DIR).map(f => readFileSync(join(DIR, f), 'utf8')).join('\n');

test('pages are counted by route pattern, never by id; the dashboard and the API are not counted', () => {
  assert.equal(pageOf('/'), '/');
  assert.equal(pageOf('/cards/'), '/cards');
  assert.equal(pageOf('/u/dc_12345?x=1'), '/u/:id');
  assert.equal(pageOf('/r/ABCD'), '/r/:code');
  assert.equal(pageOf('/cards/r/WXYZ'), '/cards/r/:code');
  assert.equal(pageOf('/tournaments/new'), '/tournaments/new');
  assert.equal(pageOf('/tournaments/t_9'), '/tournaments/:id');
  assert.equal(pageOf('/no/such/page'), NOT_FOUND_PAGE);
  assert.equal(pageOf('/admin/analytics'), null);
  assert.equal(pageOf('/api/health'), null);
});

test('crawlers and scripts are not visitors', () => {
  assert.equal(isBotAgent(undefined), true);
  assert.equal(isBotAgent('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'), true);
  assert.equal(isBotAgent('Googlebot/2.1'), true);
  assert.equal(isBotAgent('curl/8.4.0'), true);
  assert.equal(isBotAgent(UA), false);
});

test('the visitor hash is keyed: same input, same key; another key, another hash; never the input', () => {
  const k1 = Buffer.alloc(32, 1), k2 = Buffer.alloc(32, 2);
  const a = visitorHash(k1, IP, UA);
  assert.equal(a, visitorHash(k1, IP, UA));
  assert.notEqual(a, visitorHash(k2, IP, UA));
  assert.notEqual(a, visitorHash(k1, '203.0.113.78', UA));
  assert.notEqual(a, visitorHash(k1, IP, `${UA} other`));
  assert.ok(!a.includes('203') && a.length === 16);
});

test('unique-ish visitors per day, counts only on disk, a fresh key every day', () => {
  let now = T0;
  const c = createVisitCounter({ now: () => now, file: 'visits-a.json' });
  assert.equal(c.hit({ path: '/', ip: IP, ua: UA }), true);
  assert.equal(c.hit({ path: '/cards', ip: IP, ua: UA }), true);          // same visitor, second page
  assert.equal(c.hit({ path: '/u/dc_555', ip: IP6, ua: UA }), true);      // another visitor
  assert.equal(c.hit({ path: '/', ip: '198.51.100.1', ua: UA, optOut: true }), true); // DNT/GPC: a load, not a visitor
  assert.equal(c.hit({ path: '/', ip: IP, ua: 'Googlebot/2.1' }), false);
  assert.equal(c.hit({ path: '/admin/overview', ip: IP, ua: UA }), false);

  let today = c.days().at(-1)!;
  assert.equal(today.date, '2026-10-21');
  assert.equal(today.views, 4);
  assert.equal(today.visitors, 2);
  assert.deepEqual(today.pages, { '/': 2, '/cards': 1, '/u/:id': 1 });
  assert.equal(today.hours[10], 4);
  assert.equal(c.visitorsInMemory(), 2);

  // The same person tomorrow is a new visitor (yesterday cannot be linked to today)...
  now = T0 + DAY;
  c.hit({ path: '/', ip: IP, ua: UA });
  today = c.days().at(-1)!;
  assert.equal(today.date, '2026-10-22');
  assert.equal(today.visitors, 1);
  // ...and yesterday's hashes are gone from memory.
  assert.equal(c.visitorsInMemory(), 1);

  c.flush();
  const disk = onDisk();
  assert.ok(disk.includes('"views"'), 'counts were written');
  for (const secret of [IP, IP6, '198.51.100.1', '203.0.113', 'ZebraTestAgent', 'Mozilla', 'dc_555']) {
    assert.ok(!disk.includes(secret), `${secret} must never reach the disk`);
  }
  // Nor any hash: the file is just dates, pages and numbers.
  const saved = JSON.parse(readFileSync(join(DIR, 'visits-a.json'), 'utf8')) as Record<string, unknown>[];
  for (const d of saved) assert.deepEqual(Object.keys(d).sort(), ['date', 'hours', 'pages', 'views', 'visitors']);
});

test('a restart keeps the counts but not the key', () => {
  const now = T0 + 5 * DAY;
  const a = createVisitCounter({ now: () => now, file: 'visits-b.json' });
  a.hit({ path: '/', ip: IP, ua: UA });
  a.flush();
  const b = createVisitCounter({ now: () => now, file: 'visits-b.json' });
  assert.equal(b.days().at(-1)!.views, 1);
  assert.equal(b.visitorsInMemory(), 0);
  b.hit({ path: '/', ip: IP, ua: UA });
  assert.equal(b.days().at(-1)!.views, 2);
  assert.equal(b.days().at(-1)!.visitors, 2, 'unique-ish: the old key is gone, so they count again');
});

test('visit counts older than the retention window are dropped, in memory and on disk', () => {
  let now = T0;
  const c = createVisitCounter({ now: () => now, file: 'visits-c.json', retentionDays: 90 });
  c.hit({ path: '/', ip: IP, ua: UA });
  now = T0 + 89 * DAY;
  c.hit({ path: '/', ip: IP, ua: UA });
  assert.equal(c.days().length, 2, 'day 0 is still inside 90 days on day 89');
  now = T0 + 90 * DAY;
  c.hit({ path: '/', ip: IP, ua: UA });
  assert.deepEqual(c.days().map(d => d.date), ['2027-01-18', '2027-01-19']);
  c.flush();
  const saved = JSON.parse(readFileSync(join(DIR, 'visits-c.json'), 'utf8')) as { date: string }[];
  assert.ok(!saved.some(d => d.date === '2026-10-21'));
  // A file left from long ago is trimmed on load too.
  now = T0 + 400 * DAY;
  assert.equal(createVisitCounter({ now: () => now, file: 'visits-c.json' }).days().length, 0);
});

test('the per-day visitor memory is bounded', () => {
  const c = createVisitCounter({ now: () => T0, file: 'visits-d.json', maxVisitorsPerDay: 3 });
  for (let i = 0; i < 10; i++) c.hit({ path: '/', ip: `192.0.2.${i}`, ua: UA });
  const d = c.days().at(-1)!;
  assert.equal(d.views, 10);
  assert.equal(d.visitors, 3);
  assert.equal(c.visitorsInMemory(), 3);
});

test('the middleware counts page loads and always hands on', () => {
  const c = createVisitCounter({ now: () => T0, file: 'visits-e.json' });
  const mw = c.middleware();
  let nexts = 0;
  const req = (path: string, headers: Record<string, string>, method = 'GET') => ({
    method, path, ip: IP, get: (h: string) => headers[h.toLowerCase()],
  }) as never;
  mw(req('/', { 'user-agent': UA }), {} as never, () => { nexts++; });
  mw(req('/', { 'user-agent': UA, 'sec-purpose': 'prefetch' }), {} as never, () => { nexts++; });
  mw(req('/', { 'user-agent': UA }, 'POST'), {} as never, () => { nexts++; });
  mw(req('/cards', { 'user-agent': UA, 'sec-gpc': '1' }), {} as never, () => { nexts++; });
  assert.equal(nexts, 4);
  const d = c.days().at(-1)!;
  assert.equal(d.views, 2);
  assert.equal(d.visitors, 1, 'Global Privacy Control: counted as a load, never hashed');
});

test('live samples keep daily and hourly peaks, for 90 days', () => {
  let now = Date.parse('2026-10-21T20:10:00Z');
  let live = { sockets: 5, players: 2 };
  const s = createLiveSampler({ read: () => live, now: () => now, file: 'samples-a.json' });
  s.sample();
  live = { sockets: 9, players: 4 };
  now += 5 * 60_000;
  s.sample();
  live = { sockets: 3, players: 1 };
  now += 60 * 60_000;                 // 21:15
  s.sample();
  const [d] = s.days();
  assert.equal(d.date, '2026-10-21');
  assert.equal(d.sockets, 9);
  assert.equal(d.players, 4);
  assert.equal(d.hours[20], 9);
  assert.equal(d.hours[21], 3);
  assert.equal(d.hours[5], null);
  assert.equal(d.samples, 3);

  now += 91 * DAY;
  s.sample();
  assert.deepEqual(s.days().map(x => x.date), ['2027-01-20']);
  s.flush();
  const again = createLiveSampler({ read: () => live, now: () => now, file: 'samples-a.json' });
  assert.equal(again.days().length, 1);
  now += 200 * DAY;
  assert.equal(again.days().length, 0);
});
