// The Analytics tab: the aggregations over synthetic stores, and the endpoint
// being operators-only.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-analytics-'));
process.env.DEMO_MODE = '1';
process.env.ADMIN_DISCORD_IDS = '999';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const { buildAnalytics, isDailyRecord } = await import('../src/analytics.ts');
type Sources = import('../src/analytics.ts').AnalyticsSources;
type Result = import('../src/analytics.ts').AnalyticsResult;
type VisitDay = import('../src/visits.ts').VisitDay;
const { analyticsRoutes } = await import('../src/routes/analytics.ts');
const { analyticsPeriod, lastDays } = await import('../../shared/analytics.ts');

const DAY = 86_400_000;
// 2026-10-21 15:30 UTC.
const NOW = Date.parse('2026-10-21T15:30:00Z');
const at = (daysAgo: number, hour = 12, min = 0) => Date.parse(`${new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);

const human = (id: string, name = id.toUpperCase()) => ({ id, name, isBot: false, avatar: '🎩' });
const bot = (id: string) => ({ id, name: `Bot ${id}`, isBot: true });

function monopoly(daysAgo: number, mapId: string, places: Result['places'], minutes = 40, hour = 14): Result {
  const endedAt = at(daysAgo, hour);
  return { code: `M${daysAgo}${mapId}`, startedAt: endedAt - minutes * 60_000, endedAt, mapId, places };
}
function cards(daysAgo: number, mode: 'classic' | 'chaos', places: Result['places'], minutes = 10, hour = 15): Result {
  const endedAt = at(daysAgo, hour);
  return { code: `C${daysAgo}${mode}`, startedAt: endedAt - minutes * 60_000, endedAt, mode, places };
}
function daily(daysAgo: number, who: string, minutes = 6): Result {
  const endedAt = at(daysAgo, 9);
  const date = new Date(endedAt).toISOString().slice(0, 10);
  return {
    code: `D${daysAgo}${who}`, startedAt: endedAt - minutes * 60_000, endedAt, mode: 'classic',
    places: [human(who), bot(`bot-daily-${date}-1`), bot(`bot-daily-${date}-2`)],
  };
}

function sources(over: Partial<Sources> = {}): Sources {
  const mono: Result[] = [
    monopoly(0, 'classic', [human('ann'), human('bob'), bot('b1')], 60),        // today
    monopoly(0, 'chog', [human('bob'), bot('b1'), bot('b2')], 30),              // today
    monopoly(3, 'classic', [human('ann'), human('cat')], 90),
    monopoly(20, 'chog', [human('ann'), human('dan')], 45),                     // inside 30, not 7
    monopoly(200, 'classic', [human('old'), human('older')]),                  // outside every period
  ];
  const card: Result[] = [
    cards(0, 'chaos', [human('cat'), human('ann')], 12),
    cards(1, 'classic', [human('ann'), bot('x1'), bot('x2')], 8),
    cards(5, 'chaos', [human('bob'), human('cat'), human('dan')], 20),
    daily(0, 'ann', 6),
    daily(2, 'bob', 8),
  ];
  return {
    monopolyResults: () => mono,
    cardsResults: () => card,
    dailyAttempts: () => [
      { date: lastDays(NOW, 1)[0], id: 'ann', startedAt: at(0, 9) - 6 * 60_000, endedAt: at(0, 9), result: { won: true } },
      { date: lastDays(NOW, 3)[0], id: 'bob', startedAt: at(2, 9), endedAt: at(2, 9), result: { won: false } },
      { date: lastDays(NOW, 3)[0], id: 'cat', startedAt: at(2, 9), endedAt: null },
      { date: lastDays(NOW, 40)[0], id: 'old', startedAt: at(39, 9), endedAt: at(39, 9), result: { won: true } },
    ],
    tournaments: () => [
      { status: 'finished', finishedAt: at(2) },
      { status: 'finished', finishedAt: at(50) },
      { status: 'running', finishedAt: null },
      { status: 'cancelled', finishedAt: at(1) },
    ],
    accounts: () => [
      { id: 'ann', firstSeen: at(0, 1) },
      { id: 'bob', firstSeen: at(0, 2) },
      { id: 'cat', firstSeen: at(4) },
      { id: 'dan', firstSeen: at(6) },
      { id: 'eve', firstSeen: at(7) },     // eight days back: not "this week"
      { id: 'old', firstSeen: at(300) },
    ],
    wallets: () => [
      { owner: 'ann', linkedAt: at(1), holds: true },
      { owner: 'ann', linkedAt: at(100), holds: false },
      { owner: 'bob', linkedAt: at(3), holds: false },
    ],
    live: () => ({ sockets: 9, players: 4, tables: 3, playing: 2 }),
    samples: () => [
      { date: lastDays(NOW, 1)[0], sockets: 12, players: 5, hours: Array.from({ length: 24 }, (_, h) => (h === 20 ? 12 : h < 16 ? 2 : null)), samples: 180 },
      { date: lastDays(NOW, 2)[0], sockets: 8, players: 3, hours: Array.from({ length: 24 }, (_, h) => (h === 20 ? 8 : 0)), samples: 288 },
    ],
    visits: (): VisitDay[] => [
      { date: lastDays(NOW, 1)[0], views: 30, visitors: 11, pages: { '/': 20, '/cards': 7, '/u/:id': 3 }, hours: Array.from({ length: 24 }, (_, h) => (h === 15 ? 30 : 0)) },
      { date: lastDays(NOW, 2)[0], views: 10, visitors: 6, pages: { '/': 4, '/cards': 6 }, hours: Array.from({ length: 24 }, (_, h) => (h === 9 ? 10 : 0)) },
    ],
    events: () => [
      { ts: at(0), gameId: 'client-errors' },
      { ts: at(1), gameId: 'admin' },
      { ts: at(1), gameId: 'ABCD' },
      { ts: at(60), gameId: 'client-errors' },
    ],
    mapName: id => ({ classic: 'Classic', chog: 'Chog City' }[id] ?? id),
    now: () => NOW,
    ...over,
  };
}

test('periods: only 7, 30 and 90 days, defaulting to 30', () => {
  assert.equal(analyticsPeriod('7'), 7);
  assert.equal(analyticsPeriod(90), 90);
  assert.equal(analyticsPeriod('365'), 30);
  assert.equal(analyticsPeriod(undefined), 30);
  const d = lastDays(NOW, 7);
  assert.equal(d.length, 7);
  assert.equal(d[6], '2026-10-21');
  assert.equal(d[0], '2026-10-15');
});

test('daily challenge records are told apart by their bots', () => {
  assert.equal(isDailyRecord(daily(0, 'ann')), true);
  assert.equal(isDailyRecord(cards(0, 'classic', [human('a'), bot('x')])), false);
});

test('games per day are stacked by game and bounded by the period', () => {
  const r = buildAnalytics(sources(), 7);
  assert.equal(r.dates.length, 7);
  assert.equal(r.gamesPerDay.length, 7);
  const today = r.gamesPerDay.at(-1)!;
  assert.deepEqual(today, { date: '2026-10-21', monopoly: 2, cards: 1, daily: 1 });
  assert.equal(r.kpis.gamesToday, 4);
  assert.deepEqual(r.kpis.gamesTodayBy, { monopoly: 2, cards: 1, daily: 1 });
  // 7 days: today's 4, plus Monopoly 3 days back, Cards 1 and 5 back, the daily 2 back.
  assert.equal(r.kpis.gamesPeriod, 8);
  const sum = r.gamesPerDay.reduce((a, d) => a + d.monopoly + d.cards + d.daily, 0);
  assert.equal(sum, 8);
  // 30 days takes in the Monopoly game 20 days back, never the one 200 back.
  assert.equal(buildAnalytics(sources(), 30).kpis.gamesPeriod, 9);
  assert.equal(buildAnalytics(sources(), 90).kpis.gamesPeriod, 9);
});

test('boards, card modes, game length and seats', () => {
  const r = buildAnalytics(sources(), 30);
  assert.deepEqual(r.boards, [{ id: 'chog', name: 'Chog City', games: 2 }, { id: 'classic', name: 'Classic', games: 2 }]);
  // Daily deals are their own kind: not in Classic vs Chaos.
  assert.deepEqual(r.cardsModes, { classic: 1, chaos: 2 });
  const len = Object.fromEntries(r.gameLength.map(g => [g.game, g]));
  assert.equal(len.monopoly.games, 4);
  assert.equal(len.monopoly.avgMin, 56.3); // (60 + 30 + 90 + 45) / 4, to a tenth
  assert.equal(len.monopoly.medianMin, (45 + 60) / 2);
  assert.equal(len.cards.avgMin, 13.3);
  assert.equal(len.cards.medianMin, 12);
  assert.equal(len.daily.avgMin, 7);
  const seats = Object.fromEntries(r.seats.map(s => [s.game, s]));
  assert.deepEqual(seats.monopoly, { game: 'monopoly', humans: 7, bots: 3 });
  assert.deepEqual(seats.cards, { game: 'cards', humans: 6, bots: 2 });
  assert.deepEqual(seats.daily, { game: 'daily', humans: 2, bots: 4 });
});

test('a game length nobody could have played is left out', () => {
  const r = buildAnalytics(sources({
    monopolyResults: () => [
      monopoly(0, 'classic', [human('a'), human('b')], 30),
      { ...monopoly(1, 'classic', [human('a'), human('b')]), startedAt: 0 },            // never started
      { ...monopoly(2, 'classic', [human('a'), human('b')]), startedAt: at(2) - 3 * DAY }, // left open for days
    ],
  }), 7);
  assert.equal(r.gameLength.find(g => g.game === 'monopoly')!.games, 1);
  assert.equal(r.gameLength.find(g => g.game === 'monopoly')!.avgMin, 30);
  assert.equal(r.kpis.gamesPeriod, 3 + 5);
});

test('new players, wallets, tournaments and the daily challenge', () => {
  const r = buildAnalytics(sources(), 7);
  assert.equal(r.kpis.newToday, 2);
  assert.equal(r.kpis.newWeek, 4);
  assert.equal(r.kpis.newPeriod, 4);
  assert.equal(r.kpis.playersTotal, 6);
  assert.equal(r.newPlayersPerDay.at(-1)!.players, 2);
  assert.equal(r.newPlayersPerDay.reduce((a, d) => a + d.players, 0), 4);
  assert.equal(buildAnalytics(sources(), 30).kpis.newPeriod, 5);

  assert.equal(r.kpis.walletsLinked, 3);
  assert.equal(r.kpis.walletAccounts, 2);
  assert.equal(r.kpis.holders, 1);
  assert.equal(r.kpis.walletsNewPeriod, 2);

  assert.equal(r.kpis.tournamentsRun, 1);
  assert.equal(r.kpis.tournamentsAllTime, 2);
  assert.equal(r.kpis.tournamentsLive, 1);
  assert.equal(buildAnalytics(sources(), 90).kpis.tournamentsRun, 2);

  assert.equal(r.kpis.dailyToday, 1);
  assert.equal(r.kpis.dailyPeriod, 3);
  assert.equal(r.kpis.dailyPlayers, 3);
  assert.equal(r.kpis.dailyWinRate, 0.5);
  assert.equal(buildAnalytics(sources({ dailyAttempts: () => [] }), 7).kpis.dailyWinRate, null);
});

test('live counts, peaks, active hours and visits', () => {
  const r = buildAnalytics(sources(), 7);
  assert.equal(r.kpis.onlineNow, 4);
  assert.equal(r.kpis.socketsNow, 9);
  assert.equal(r.kpis.tablesNow, 3);
  assert.equal(r.kpis.playingNow, 2);
  assert.deepEqual(r.peakPerDay.at(-1), { date: '2026-10-21', sockets: 12, players: 5 });
  assert.deepEqual(r.peakPerDay.at(-2), { date: '2026-10-20', sockets: 8, players: 3 });
  assert.equal(r.peakPerDay[0].sockets, null, 'no samples that day: a gap, not a zero');
  assert.equal(r.hours.sockets[20], 10);
  assert.equal(r.hours.sockets[3], 1);
  assert.equal(r.hours.sockets[18], 0, 'one day sampled 0, the other never');
  assert.equal(r.hours.games.length, 24);
  assert.equal(r.hours.games.reduce((a, b) => a + b, 0), r.kpis.gamesPeriod);
  // Monopoly today: 60 min ending 14:00 → started 13:00; 30 min → 13:30.
  assert.ok(r.hours.games[13] >= 2);
  assert.equal(r.hours.views[15], 30);
  assert.equal(r.hours.views[9], 10);
  assert.equal(r.kpis.viewsToday, 30);
  assert.equal(r.kpis.visitorsToday, 11);
  assert.deepEqual(r.visits.pages, [{ page: '/', views: 24 }, { page: '/cards', views: 13 }, { page: '/u/:id', views: 3 }]);
  assert.deepEqual(r.logs, { clientErrors: 1, adminActions: 1, gameEvents: 1 });
});

test('top players: humans only, most games first, latest name', () => {
  const r = buildAnalytics(sources({
    monopolyResults: () => [
      monopoly(3, 'classic', [human('ann', 'Ann (old)'), human('bob')]),
      monopoly(0, 'classic', [human('bob'), human('ann', 'Ann')]),
      monopoly(1, 'classic', [human('ann', 'Ann (mid)'), bot('b')]),
    ],
    cardsResults: () => [daily(0, 'ann')],
  }), 7);
  assert.equal(r.topPlayers[0].id, 'ann');
  assert.equal(r.topPlayers[0].name, 'Ann', 'the newest name wins whatever the order');
  assert.deepEqual(
    { games: r.topPlayers[0].games, wins: r.topPlayers[0].wins, monopoly: r.topPlayers[0].monopoly, daily: r.topPlayers[0].daily },
    { games: 4, wins: 3, monopoly: 3, daily: 1 },
  );
  assert.equal(r.topPlayers[1].id, 'bob');
  assert.ok(r.topPlayers.every(p => !p.id.startsWith('b') || p.id === 'bob'), 'no bots');
  assert.equal(r.kpis.activePlayers, 2);
});

test('an empty server answers with zeros, not errors', () => {
  const r = buildAnalytics(sources({
    monopolyResults: () => [], cardsResults: () => [], dailyAttempts: () => [], tournaments: () => [], accounts: () => [],
    wallets: () => [], samples: () => [], visits: () => [], events: () => [],
  }), 90);
  assert.equal(r.dates.length, 90);
  assert.equal(r.kpis.gamesPeriod, 0);
  assert.deepEqual(r.boards, []);
  assert.ok(r.gameLength.every(g => g.avgMin === null && g.medianMin === null));
  assert.ok(r.peakPerDay.every(d => d.sockets === null));
  assert.ok(r.hours.sockets.every(h => h === null));
  assert.deepEqual(r.topPlayers, []);
});

// ---- the endpoint ----

const op = signToken({ id: 'dc_999', name: 'Op', avatar: '🎩', provider: 'discord', discord: { id: '999', username: 'op' } });
const player = signToken({ id: 'dc_123', name: 'Pat', avatar: '🎩', provider: 'discord', discord: { id: '123', username: 'pat' } });

let server: Server;
let base = '';
let built = 0;
before(async () => {
  const app = express();
  const src = sources({ now: () => { built++; return NOW; } });
  const deps = {} as Parameters<typeof analyticsRoutes>[0];
  app.use('/api/admin/analytics', analyticsRoutes(deps, src));
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/analytics`;
});
after(() => server.close());

test('the endpoint is for operators only', async () => {
  const anon = await fetch(`${base}?days=7`);
  assert.equal(anon.status, 401);
  assert.equal(built, 0);
  const notOp = await fetch(`${base}?days=7`, { headers: { Authorization: `Bearer ${player}` } });
  assert.equal(notOp.status, 403);
  const forged = await fetch(`${base}?days=7`, { headers: { Authorization: `Bearer ${op.slice(0, -2)}xx` } });
  assert.equal(forged.status, 401);
  assert.equal(built, 0, 'nothing is worked out for anyone else');
  const ok = await fetch(`${base}?days=7`, { headers: { Authorization: `Bearer ${op}` } });
  assert.equal(ok.status, 200);
  const r = await ok.json() as { days: number; kpis: { gamesToday: number } };
  assert.equal(r.days, 7);
  assert.equal(r.kpis.gamesToday, 4);
});

test('an unknown period falls back to 30 days', async () => {
  const res = await fetch(`${base}?days=1000`, { headers: { Authorization: `Bearer ${op}` } });
  assert.equal(((await res.json()) as { days: number; dates: string[] }).dates.length, 30);
});
