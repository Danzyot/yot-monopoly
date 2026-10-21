// The share card (GET /api/players/:id/card.png), the badges endpoint, and a
// profile page's link preview pointing at the card.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-player-card-'));
process.env.RATE_LIMIT_OFF = '1';
delete process.env.PUBLIC_URL;

const { default: express } = await import('express');
const { mountPlayerCard } = await import('../src/routes/playerCard.ts');
const card = await import('../src/playerCard.ts');
const { recordResult, loadResults } = await import('../src/stats.ts');
const { loadCardsResults } = await import('../src/cards/stats.ts');
const { setFeatures } = await import('../src/features.ts');
const { addBan, loadBans, removeBan } = await import('../src/bans.ts');
const { spaHandler, renderIndex } = await import('../src/seo.ts');
const { routeMeta, profileIdOf } = await import('../../shared/seo.ts');
type Reply = import('../../shared/achievements.ts').AchievementsReply;

const TEMPLATE = `<!doctype html><html><head>
    <!--seo-->
    <title>Chog Games</title>
    <!--/seo-->
  </head><body><div id="root"></div></body></html>`;

const now = Date.now();
const place = (id: string, name: string, isBot = false, extra = {}) => ({ id, name, isBot, netWorth: 100, character: 'chog', ...extra });

let server: Server;
let base = '';
before(async () => {
  loadResults();
  loadCardsResults();
  loadBans();
  setFeatures({ leaderboard: true });
  recordResult({
    code: 'AAAAA', mapId: 'classic', themeId: 'chog', startedAt: now - 60_000, endedAt: now - 1000, turns: 40,
    places: [place('dc_111', 'Chog <Star> & Co', false, { chogToken: 42, sets: 2 }), place('dc_222', 'Rival'), place('bot1', 'Spike', true)],
  });
  recordResult({
    code: 'BBBBB', mapId: 'speed', themeId: 'chog', startedAt: now - 60_000, endedAt: now - 500, turns: 40,
    places: [place('dc_222', 'Rival'), place('dc_111', 'Chog <Star> & Co')],
  });
  const dir = mkdtempSync(join(tmpdir(), 'yot-player-card-dist-'));
  writeFileSync(join(dir, 'index.html'), TEMPLATE);
  const app = express();
  app.use('/api', (_req, res, next) => { res.setHeader('cache-control', 'no-store, max-age=0'); next(); });
  mountPlayerCard(app);
  app.get(/^\/(?!api).*/, spaHandler(join(dir, 'index.html'), card.profileMeta));
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('card.png: a 1200×630 PNG, cached for a few minutes', async () => {
  card.clearCardCache();
  const res = await fetch(`${base}/api/players/dc_111/card.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), `public, max-age=${card.CARD_TTL_MS / 1000}`, 'not the /api no-store default');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.subarray(0, 8).equals(PNG), 'a PNG');
  assert.equal(buf.readUInt32BE(16), 1200, 'width');
  assert.equal(buf.readUInt32BE(20), 630, 'height');
  // The second ask is the cached picture: the very same bytes, at once.
  assert.ok(card.cachedCard('dc_111'));
  const again = Buffer.from(await (await fetch(`${base}/api/players/dc_111/card.png?v=2`)).arrayBuffer());
  assert.ok(again.equals(buf));
  // Expired after the TTL.
  assert.equal(card.cachedCard('dc_111', Date.now() + card.CARD_TTL_MS + 1), null);
});

test('card.png: 404 for unknown players, bad ids, banned players and with profiles switched off', async () => {
  assert.equal((await fetch(`${base}/api/players/dc_nobody/card.png`)).status, 404, 'no finished games');
  assert.equal((await fetch(`${base}/api/players/${encodeURIComponent('bad id!')}/card.png`)).status, 404);
  assert.equal((await fetch(`${base}/api/players/bot1/card.png`)).status, 404, 'bots have no card');

  // A ban by Discord id covers the dc_ account, and beats a cached card.
  await fetch(`${base}/api/players/dc_222/card.png`);
  assert.ok(card.cachedCard('dc_222'));
  addBan({ kind: 'player', value: '222', name: 'Rival', reason: 'test', by: 'test' });
  assert.equal((await fetch(`${base}/api/players/dc_222/card.png`)).status, 404, 'banned: no card');
  removeBan('player', '222');
  assert.equal((await fetch(`${base}/api/players/dc_222/card.png`)).status, 200, 'unbanned: back');

  setFeatures({ leaderboard: false });
  assert.equal((await fetch(`${base}/api/players/dc_111/card.png`)).status, 404, 'on the leaderboard switch');
  setFeatures({ leaderboard: true });
});

test('the card\'s SVG: name (escaped), numbers, the NFT Chog chip and top badges', () => {
  const s = card.playerSnapshot('dc_111')!;
  assert.equal(s.chogToken, 42, 'the Chog they last played as');
  const svg = card.cardSvg(s, { avatar: null, mark: null });
  assert.match(svg, /Chog &lt;Star&gt; &amp; Co/);
  assert.match(svg, /Chog #42/);
  assert.match(svg, /MONOPOLY/);
  assert.match(svg, />2<\/text>[\s\S]*GAMES/, 'games played');
  assert.match(svg, /50%/, 'win rate');
  assert.doesNotMatch(svg, /MATCHES/, 'no Cards panel without Cards matches');
  const top = card.topBadges(s.achievements);
  assert.ok(top.length > 0 && top.length <= 5);
  for (const a of top) assert.ok(svg.includes(a.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;')), a.name);
  assert.ok(top.some(a => a.id === 'own-chog-win'), 'won as their own Chog');
});

test('printable and fitText: names the fonts cannot draw, and names too long to fit', () => {
  assert.equal(card.printable('Ann 🐸 B'), 'Ann B');
  assert.equal(card.printable('漢字'), 'Player');
  const long = card.fitText('A very very long player name that goes on and on', 600, 76, 40);
  assert.equal(long.size, 40);
  assert.ok(long.text.endsWith('…'));
  assert.deepEqual(card.fitText('Ann', 600, 76, 40), { text: 'Ann', size: 76 });
});

test('GET /api/players/:id/achievements: the badges, with the server clock', async () => {
  const r = await (await fetch(`${base}/api/players/dc_111/achievements`)).json() as Reply;
  assert.ok(Math.abs(r.now - Date.now()) < 5_000);
  const byId = Object.fromEntries(r.achievements.map(a => [a.id, a]));
  assert.equal(byId['mono-first-win'].earned, true);
  assert.equal(byId['mono-landlord'].earned, true, 'sets recorded with the result');
  assert.equal(byId['own-chog'].earned, true);
  assert.equal(byId['cards-first-win'].earned, false);
  assert.deepEqual((await (await fetch(`${base}/api/players/dc_nobody/achievements`)).json() as Reply).achievements.filter(a => a.earned), []);
  setFeatures({ leaderboard: false });
  assert.equal((await fetch(`${base}/api/players/dc_111/achievements`)).status, 404);
  setFeatures({ leaderboard: true });
});

test('a profile page\'s share tags point at the player\'s card', async () => {
  assert.equal(profileIdOf('/u/dc_111'), 'dc_111');
  assert.equal(profileIdOf('/u/dc_111/'), 'dc_111');
  assert.equal(profileIdOf('/u/a%20b'), 'a b');
  assert.equal(profileIdOf('/cards'), null);

  const html = await (await fetch(`${base}/u/dc_111`)).text();
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  assert.equal(og, 'https://choggames.com/api/players/dc_111/card.png?v=2', 'versioned by games played');
  assert.match(html, /<meta name="twitter:image" content="https:\/\/choggames\.com\/api\/players\/dc_111\/card\.png\?v=2"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<meta property="og:image:width" content="1200"/);
  assert.match(html, /<meta property="og:image:height" content="630"/);
  assert.match(html, /<title>Chog &lt;Star&gt; &amp; Co · Chog Games<\/title>/);
  assert.match(html, /<meta property="og:description" content="1 win in 2 games · Monopoly 1\/2/);

  // Unknown, banned or switched off: the site's own image, the page as before.
  const plain = (path: string) => renderIndex(TEMPLATE, path, undefined, card.profileMeta).html;
  assert.match(plain('/u/dc_nobody'), /og:image" content="https:\/\/choggames\.com\/brand\/og\.jpg"/);
  addBan({ kind: 'player', value: 'dc_111', name: 'X', reason: 'test', by: 'test' });
  assert.match(plain('/u/dc_111'), /brand\/og\.jpg/);
  assert.match(plain('/u/dc_111'), /<title>Player profile · Chog Games<\/title>/);
  removeBan('player', 'dc_111');
  setFeatures({ leaderboard: false });
  assert.match(plain('/u/dc_111'), /brand\/og\.jpg/);
  setFeatures({ leaderboard: true });
  // Other pages are untouched.
  assert.deepEqual(card.profileMeta(routeMeta('/cards')), routeMeta('/cards'));
});
