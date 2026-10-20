import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-seo-'));
process.env.RATE_LIMIT_OFF = '1';
process.env.DEMO_MODE = '1';
delete process.env.PUBLIC_URL;

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const seo = await import('../src/seo.ts');
const { routeMeta, sitemapPaths, cleanPath } = await import('../../shared/seo.ts');
const { mountSite, clientErrorLine } = await import('../src/routes/site.ts');
const { eventsForGame } = await import('../src/eventlog.ts');
const { DEFAULT_LEGAL, parseLegal, safeHref } = await import('../../shared/legal.ts');

const TEMPLATE = `<!doctype html><html><head>
    <meta charset="UTF-8" />
    <!--seo-->
    <title>Chog Games</title>
    <meta name="description" content="default" />
    <!--/seo-->
    <link rel="manifest" href="/site.webmanifest" />
  </head><body><div id="root"></div></body></html>`;

const player = signToken({ id: 'demo_seo', name: 'Seo', avatar: '🎩', provider: 'demo' });

let server: Server;
let base = '';
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yot-seo-dist-'));
  writeFileSync(join(dir, 'index.html'), TEMPLATE);
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  mountSite(app);
  seo.mountCrawlerFiles(app);
  app.get(/^\/(?!api|socket\.io).*/, seo.spaHandler(join(dir, 'index.html')));
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const meta = (html: string, attr: string) => new RegExp(`<meta (?:name|property)="${attr}" content="([^"]*)"`).exec(html)?.[1];

// ---- the route table -------------------------------------------------------------

test('every public page has its own title and description', () => {
  const seen = new Set<string>();
  for (const p of ['/', '/cards', '/poker', '/monopoly', '/characters', '/leaderboard', '/tournaments', '/terms', '/privacy', '/fair-play']) {
    const m = routeMeta(p);
    assert.equal(m.status, 200, p);
    assert.ok(!m.noindex, `${p} is indexable`);
    assert.ok(m.description.length >= 50 && m.description.length <= 170, `${p} description length ${m.description.length}`);
    assert.ok(!seen.has(m.title), `${p} title is unique`);
    seen.add(m.title);
  }
});

test('routes match generically: params, prefixes, trailing slashes and queries', () => {
  assert.equal(cleanPath('/cards/?x=1#y'), '/cards');
  assert.equal(routeMeta('/cards/').title, routeMeta('/cards').title);
  assert.equal(routeMeta('/r/ABCD').noindex, true);
  assert.equal(routeMeta('/r/ABCD').status, 200);
  assert.equal(routeMeta('/cards/r/WXYZ').title, 'Join the table · Chog Games');
  assert.equal(routeMeta('/tournaments/t_1').title, 'Tournament · Chog Games');
  assert.equal(routeMeta('/tournaments/new').noindex, true);
  assert.equal(routeMeta('/admin').noindex, true);
  assert.equal(routeMeta('/admin/players').noindex, true);
  // Pages other parts of the site add under a game are known (not 404), just not indexed.
  assert.equal(routeMeta('/poker/tables').status, 200);
  assert.equal(routeMeta('/monopoly/lobby').status, 200);
  assert.equal(routeMeta('/nope').status, 404);
  assert.equal(routeMeta('/u').status, 404);
  assert.equal(routeMeta('/r/A/B').status, 404);
});

test('the game pages carry VideoGame data; the home page WebSite', () => {
  assert.ok(routeMeta('/cards').game);
  assert.ok(routeMeta('/poker').game);
  assert.ok(routeMeta('/monopoly').game);
  assert.ok(!routeMeta('/leaderboard').game);
  const home = seo.headTags(routeMeta('/'), 'https://choggames.com');
  assert.match(home, /"@type":"WebSite"/);
  const cards = seo.headTags(routeMeta('/cards'), 'https://choggames.com');
  assert.match(cards, /"@type":"VideoGame"/);
  assert.match(cards, /"name":"Cards"/);
});

// ---- injecting into index.html --------------------------------------------------

test('renderIndex swaps the default block for the route tags', () => {
  const { html, status } = seo.renderIndex(TEMPLATE, '/leaderboard', 'https://choggames.com');
  assert.equal(status, 200);
  assert.match(html, /<title>Leaderboard · Chog Games<\/title>/);
  assert.equal((html.match(/<title>/g) ?? []).length, 1, 'one title');
  assert.ok(!html.includes('content="default"'), 'the default description is gone');
  assert.match(html, /<link rel="canonical" href="https:\/\/choggames.com\/leaderboard" \/>/);
  assert.equal(meta(html, 'og:url'), 'https://choggames.com/leaderboard');
  assert.equal(meta(html, 'og:image'), 'https://choggames.com/brand/og.jpg');
  assert.equal(meta(html, 'og:image:width'), '1200');
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
  assert.equal(meta(html, 'robots'), undefined);
  // The rest of the page is untouched.
  assert.match(html, /<link rel="manifest" href="\/site.webmanifest" \/>/);
  assert.match(html, /<div id="root"><\/div>/);
});

test('renderIndex: unknown paths are 404, noindex and have no canonical', () => {
  const { html, status } = seo.renderIndex(TEMPLATE, '/no/such/page', 'https://choggames.com');
  assert.equal(status, 404);
  assert.equal(meta(html, 'robots'), 'noindex');
  assert.ok(!html.includes('rel="canonical"'));
  assert.match(html, /Page not found/);
});

test('renderIndex: the path never reaches the page unescaped', () => {
  const { html } = seo.renderIndex(TEMPLATE, '/tournaments/"><script>alert(1)</script>', 'https://choggames.com');
  assert.ok(!html.includes('<script>alert(1)'));
  const r = seo.renderIndex(TEMPLATE, '/u/</script><script>x', 'https://choggames.com');
  assert.ok(!r.html.includes('</script><script>x'));
});

test('renderIndex without markers still sets the title', () => {
  const { html } = seo.renderIndex('<head><title>Chog Games</title></head>', '/cards');
  assert.match(html, /<title>Cards · Chog Games<\/title>/);
});

test('siteOrigin takes a clean PUBLIC_URL and ignores junk', () => {
  assert.equal(seo.siteOrigin(undefined), 'https://choggames.com');
  assert.equal(seo.siteOrigin('https://staging.choggames.com/'), 'https://staging.choggames.com');
  assert.equal(seo.siteOrigin('javascript:alert(1)'), 'https://choggames.com');
  assert.equal(seo.siteOrigin('https://x.com/"><b>'), 'https://choggames.com');
});

// ---- over HTTP --------------------------------------------------------------------

test('GET a page: its meta and status', async () => {
  for (const [path, status, title] of [
    ['/', 200, 'Chog Games: Monopoly, cards and poker with the Chog crew'],
    ['/cards', 200, 'Cards · Chog Games'],
    ['/poker', 200, 'Poker · Chog Games'],
    ['/monopoly', 200, 'Monopoly · Chog Games'],
    ['/characters', 200, 'Characters · Chog Games'],
    ['/tournaments', 200, 'Tournaments · Chog Games'],
    ['/privacy', 200, 'Privacy · Chog Games'],
    ['/what', 404, 'Page not found · Chog Games'],
  ] as const) {
    const res = await fetch(base + path);
    assert.equal(res.status, status, path);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    const html = await res.text();
    assert.ok(html.includes(`<title>${title}</title>`), `${path}: ${html.slice(0, 300)}`);
  }
});

test('robots.txt keeps crawlers out of private pages and points at the sitemap', async () => {
  const res = await fetch(`${base}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  const txt = await res.text();
  assert.match(txt, /^User-agent: \*$/m);
  for (const p of ['/api/', '/admin', '/r/', '/cards/r/', '/wallet', '/sso']) assert.ok(txt.includes(`Disallow: ${p}\n`), p);
  assert.match(txt, /^Sitemap: https:\/\/choggames.com\/sitemap.xml$/m);
});

test('sitemap.xml lists exactly the public pages', async () => {
  const res = await fetch(`${base}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/xml/);
  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual(locs, sitemapPaths().map(p => `https://choggames.com${p}`));
  for (const p of ['/', '/cards', '/poker', '/monopoly', '/characters', '/leaderboard', '/tournaments', '/terms', '/privacy', '/fair-play']) {
    assert.ok(locs.includes(`https://choggames.com${p}`), p);
  }
  assert.ok(!locs.some(l => /\/(r|u|admin|wallet|sso)\b/.test(l)), 'no private pages');
});

// ---- the info pages ----------------------------------------------------------------

test('info pages: defaults, an operator edit, a reset', async () => {
  const r0 = await (await fetch(`${base}/api/pages/privacy`)).json() as { page: { title: string; body: string; edited: boolean } };
  assert.equal(r0.page.title, 'Privacy');
  assert.equal(r0.page.edited, false);
  assert.equal((await fetch(`${base}/api/pages/nope`)).status, 404);

  const put = (body: unknown, token: string | null = player) => fetch(`${base}/api/admin/pages/privacy`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await put({ title: 'Privacy', body: 'x' }, null)).status, 401);
  assert.equal((await put({ title: 'Privacy', body: '' })).status, 400);
  assert.equal((await put({ title: 'Privacy', body: 'x'.repeat(20_001) })).status, 400);
  const ok = await put({ title: '  Privacy  notice ', body: 'Short.\r\n\r\n\r\n\r\n## Data\n- one   ' });
  assert.equal(ok.status, 200);
  const r1 = await (await fetch(`${base}/api/pages/privacy`)).json() as { page: { title: string; body: string; edited: boolean; updated: string } };
  assert.equal(r1.page.title, 'Privacy notice');
  assert.equal(r1.page.body, 'Short.\n\n## Data\n- one');
  assert.equal(r1.page.edited, true);
  assert.match(r1.page.updated, /^\d{4}-\d{2}-\d{2}$/);

  const del = await fetch(`${base}/api/admin/pages/privacy`, { method: 'DELETE', headers: { authorization: `Bearer ${player}` } });
  assert.equal(del.status, 200);
  const r2 = await (await fetch(`${base}/api/pages/privacy`)).json() as { page: { body: string; edited: boolean } };
  assert.equal(r2.page.edited, false);
  assert.equal(r2.page.body, DEFAULT_LEGAL.privacy.body);
});

test('the legal markup: headings, lists, bold and only safe links', () => {
  const blocks = parseLegal('Intro with **bold** and [a link](/terms).\n\n## Head\n- one [x](javascript:alert(1))\n- two [d](discord:)\nafter', 'https://discord.gg/abc');
  assert.deepEqual(blocks.map(b => b.kind), ['p', 'h2', 'ul', 'p']);
  const intro = blocks[0].kind === 'p' ? blocks[0].parts : [];
  assert.deepEqual(intro.find(p => p.bold), { text: 'bold', bold: true });
  assert.equal(intro.find(p => p.href)?.href, '/terms');
  const items = blocks[2].kind === 'ul' ? blocks[2].items : [];
  assert.equal(items[0].find(p => p.text === 'x')?.href, undefined, 'javascript: dropped');
  assert.equal(items[1].find(p => p.text === 'd')?.href, 'https://discord.gg/abc');
  assert.equal(safeHref('//evil.com', null), undefined);
  assert.equal(safeHref('http://plain.com', null), undefined);
  assert.equal(safeHref('https://opensea.io/collection/chog-genesis', null), 'https://opensea.io/collection/chog-genesis');
  // The shipped pages say it is not legal advice and parse cleanly.
  assert.match(DEFAULT_LEGAL.terms.body, /not legal advice/);
  assert.match(DEFAULT_LEGAL.privacy.body, /not legal advice/);
  for (const p of Object.values(DEFAULT_LEGAL)) {
    assert.ok(parseLegal(p.body).some(b => b.kind === 'h2'), p.slug);
  }
});

// ---- crash reports ------------------------------------------------------------------

test('client crash reports land in the event log, trimmed', async () => {
  const send = (body: unknown) => fetch(`${base}/api/client-error`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${player}` }, body: JSON.stringify(body),
  });
  assert.equal((await send({ message: 'Boom\nline two', path: '/leaderboard', where: 'at Leaderboard', ua: 'Test' })).status, 204);
  assert.equal((await send({})).status, 204);
  const events = eventsForGame('client-errors');
  assert.equal(events.length, 1);
  assert.match(events[0].text, /^Boom line two · at \/leaderboard · in at Leaderboard · by Seo \(demo_seo\) · \(Test\)$/);
  assert.equal(clientErrorLine({ message: 'x'.repeat(1000) }, null)?.length, 300);
});
