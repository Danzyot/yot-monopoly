// The home page's live ticker (GET /api/activity): what goes in, what never
// does (private tables, bots' wins, banned players, addresses), and the
// ten-second cache.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-activity-'));
process.env.DEMO_MODE = '1';

const { buildActivity, createActivityFeed, TTL_MS } = await import('../src/activity.ts');
type Sources = import('../src/activity.ts').ActivitySources;
type Table = import('../src/activity.ts').ActivityTable;
type Result = import('../src/activity.ts').ActivityResult;
type Tourney = import('../../shared/tournaments.ts').TournamentSummary;

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const table = (t: Partial<Table> & { code: string }): Table => ({
  private: false, status: 'lobby', players: 2, maxPlayers: 6, createdAt: NOW - 5 * MIN, startedAt: null,
  occupied: true, restricted: false, ...t,
});
const result = (code: string, winner: { id: string; name: string; isBot?: boolean }, extra: Partial<Result> = {}): Result => ({
  code, endedAt: NOW - 10 * MIN, places: [{ isBot: false, ...winner }, { id: 'bot-x', name: 'Bot', isBot: true }], ...extra,
});
const tourney = (t: Partial<Tourney> & { id: string; name: string }): Tourney => ({
  game: 'cards', prize: '', hostName: 'Op', status: 'finished', paused: false, entrants: 8, maxPlayers: null,
  startAt: null, startedAt: NOW - 90 * MIN, finishedAt: NOW - 30 * MIN, round: null, champion: null, ...t,
});

function sources(over: Partial<Sources> = {}): Sources {
  return {
    monopolyResults: () => [
      result('AAAAA', { id: 'p-pete', name: 'Pete' }, { mapId: 'metro', endedAt: NOW - 2 * MIN }),
      result('PRIVA', { id: 'p-secret', name: 'Secret Sam' }, { private: true, endedAt: NOW - MIN }),
      result('BOTWN', { id: 'bot-1', name: 'Botty', isBot: true }, { endedAt: NOW - 3 * MIN }),
      result('BANNE', { id: 'p-cheat', name: 'Cheater' }, { endedAt: NOW - 4 * MIN }),
      result('OLDIE', { id: 'p-old', name: 'Ancient' }, { endedAt: NOW - 10 * 24 * 60 * MIN }),
    ],
    cardsResults: () => [
      { code: 'CCCCC', endedAt: NOW - 6 * MIN, places: [
        { id: 'p-moxie', name: 'Moxie', isBot: false }, { id: 'b1', name: 'B1', isBot: true },
        { id: 'b2', name: 'B2', isBot: true }, { id: 'b3', name: 'B3', isBot: true }] },
      // A tournament table's result: private, so only the champion line speaks for it.
      { code: 'TTTTT', endedAt: NOW - 7 * MIN, private: true, places: [{ id: 'p-t', name: 'Table Winner', isBot: false }] },
    ],
    monopolyTables: () => [
      table({ code: '9CL9K', status: 'playing', players: 4, startedAt: NOW - 3 * MIN }),
      table({ code: 'HIDDN', status: 'playing', players: 4, startedAt: NOW - 2 * MIN, private: true }),
      table({ code: 'STALE', status: 'playing', players: 3, startedAt: NOW - 90 * MIN }),
      table({ code: 'OPEN1', status: 'lobby', players: 2, maxPlayers: 6 }),
      table({ code: 'GATED', status: 'lobby', restricted: true }),
      table({ code: 'EMPTY', status: 'lobby', occupied: false }),
      table({ code: 'FULL1', status: 'lobby', players: 6, maxPlayers: 6 }),
    ],
    cardsTables: () => [
      table({ code: 'CARD1', status: 'playing', players: 4, startedAt: NOW - MIN }),
      table({ code: 'TOURN', status: 'playing', players: 4, startedAt: NOW - MIN, private: true, restricted: true }),
    ],
    tournaments: () => [
      tourney({ id: 't1', name: 'Monday Night Cup', champion: { id: 'p-moxie', name: 'Moxie' } }),
      tourney({ id: 't2', name: 'Live Cup', status: 'running', round: 2, finishedAt: null, startedAt: NOW - 8 * MIN }),
      tourney({ id: 't3', name: 'Banned Cup', champion: { id: 'p-cheat', name: 'Cheater' } }),
      tourney({ id: 't4', name: 'Called Off', status: 'cancelled' }),
    ],
    newAccounts: since => [
      { id: 'n1', firstSeen: NOW - 20 * MIN }, { id: 'n2', firstSeen: NOW - 40 * MIN }, { id: 'p-cheat', firstSeen: NOW - 5 * MIN },
    ].filter(a => a.firstSeen >= since),
    resultsPublic: () => true,
    banned: id => id === 'p-cheat',
    mapName: id => (id === 'metro' ? 'Metropolis' : 'Classic'),
    now: () => NOW,
    ...over,
  };
}

test('activity: wins, fresh tables, open lobbies, champions and sign-ups, newest first', () => {
  const items = buildActivity(sources());
  const texts = items.map(i => i.text);
  assert.ok(texts.includes('Pete won on Metropolis'), texts.join('\n'));
  assert.ok(texts.includes('Moxie won at Cards (4 players)'));
  assert.ok(texts.includes('Table 9CL9K just started (Monopoly, 4 players)'));
  assert.ok(texts.includes('Table CARD1 just started (Cards, 4 players)'));
  assert.ok(texts.includes('Table OPEN1 has 4 seats free (Monopoly, 2/6)'));
  assert.ok(texts.includes('Moxie took 1st in Monday Night Cup'));
  assert.ok(texts.includes('Live Cup is under way (round 2)'));
  assert.ok(texts.includes('2 new players joined today'), 'the banned sign-up is not counted');
  // Newest first, ids unique.
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].at >= items[i].at);
  assert.equal(new Set(items.map(i => i.id)).size, items.length);
  // Links: a profile for a win, a table to watch, a tournament page.
  assert.equal(items.find(i => i.text.startsWith('Pete'))!.href, '/u/p-pete');
  assert.equal(items.find(i => i.text.includes('CARD1'))!.href, '/cards/r/CARD1');
  assert.equal(items.find(i => i.kind === 'champion')!.href, '/tournaments/t1');
  assert.equal(items.find(i => i.kind === 'joined')!.href, undefined);
});

test('activity: nothing from private tables, bots, banned players, stale or gated tables', () => {
  const json = JSON.stringify(buildActivity(sources()));
  for (const hidden of ['HIDDN', 'PRIVA', 'Secret Sam', 'TTTTT', 'Table Winner', 'TOURN', 'Botty', 'Cheater', 'Banned Cup',
    'STALE', 'GATED', 'EMPTY', 'FULL1', 'Ancient', 'Called Off', 'p-cheat', 'n1']) {
    assert.ok(!json.includes(hidden), `${hidden} must not appear`);
  }
  // Only the public fields go out.
  for (const item of buildActivity(sources())) {
    assert.deepEqual(Object.keys(item).filter(k => !['id', 'kind', 'game', 'text', 'at', 'href'].includes(k)), []);
  }
});

test('activity: with the leaderboard switched off, nobody is named for a win', () => {
  const items = buildActivity(sources({ resultsPublic: () => false }));
  assert.equal(items.filter(i => i.kind === 'win').length, 0);
  assert.ok(items.some(i => i.kind === 'started'), 'live tables still show');
});

test('activity: an empty site gives an empty list (the strip hides)', () => {
  const none = () => [];
  assert.deepEqual(buildActivity(sources({
    monopolyResults: none, cardsResults: none, monopolyTables: none, cardsTables: none, tournaments: none, newAccounts: none,
  })), []);
});

test('activity: cached for TTL_MS, then rebuilt; limit is clamped', () => {
  let clock = NOW;
  let builds = 0;
  let pete = 'Pete';
  const src = sources({
    now: () => clock,
    monopolyResults: () => { builds++; return [result('AAAAA', { id: 'p-pete', name: pete }, { mapId: 'metro', endedAt: NOW - MIN })]; },
  });
  const feed = createActivityFeed(src);
  const first = feed.get(20);
  assert.equal(builds, 1);
  pete = 'Peter';
  clock += TTL_MS - 1;
  assert.deepEqual(feed.get(20), first, 'same list within the TTL');
  assert.equal(builds, 1);
  clock += 1;
  assert.ok(feed.get(20).items.some(i => i.text === 'Peter won on Metropolis'), 'rebuilt after the TTL');
  assert.equal(builds, 2);
  assert.equal(feed.get(2).items.length, 2);
  assert.equal(feed.get(0).items.length, 1, 'at least one');
  assert.ok(feed.get(10_000).items.length <= 50);
  assert.equal(builds, 2, 'other limits share the cached list');
});

// ---- the endpoint, wired to the real stores ----

const express = (await import('express')).default;
const { mountActivity } = await import('../src/routes/activity.ts');
const { Registry } = await import('../src/rooms.ts');
const { CardsRegistry } = await import('../src/cards/rooms.ts');
const { recordResult } = await import('../src/stats.ts');
const { addBan } = await import('../src/bans.ts');
type Manager = import('../src/tournament/manager.ts').TournamentManager;

const registries: { rooms: Map<string, { dispose(): void }> }[] = [];
after(() => { for (const r of registries) for (const room of r.rooms.values()) room.dispose(); });

test('GET /api/activity: public tables and wins only, cached ten seconds', async () => {
  const hooks = { onChange: () => {}, onEvent: () => {}, onFinished: () => {} };
  const monopoly = new Registry(hooks);
  const cards = new CardsRegistry(hooks);
  registries.push(monopoly, cards);
  const member = (id: string, name: string) => ({ id, name, avatar: '🎩' });

  const pub = monopoly.create('host-1', true);
  pub.join(member('host-1', 'Hosty'));
  const priv = monopoly.create('host-2', true);
  priv.join(member('host-2', 'Hidden Host'));
  priv.configure('host-2', false, { private: true });
  const table = cards.create('host-3', true);
  table.join(member('host-3', 'Carda'));

  const now = Date.now();
  const place = (id: string, name: string, isBot = false) => ({ id, name, isBot, netWorth: 1 });
  recordResult({ code: 'PUBWN', mapId: 'classic', themeId: 'classic', startedAt: now - 60_000, endedAt: now - 1_000, turns: 9,
    places: [place('p-win', 'Winnie'), place('bot-1', 'Bot', true)] });
  recordResult({ code: priv.code, mapId: 'classic', themeId: 'classic', startedAt: now - 60_000, endedAt: now - 500, turns: 9, private: true,
    places: [place('p-hid', 'Hush'), place('bot-2', 'Bot', true)] });
  recordResult({ code: 'BANWN', mapId: 'classic', themeId: 'classic', startedAt: now - 60_000, endedAt: now - 800, turns: 9,
    places: [place('p-banned', 'Banned Bob'), place('bot-3', 'Bot', true)] });
  addBan({ kind: 'player', value: 'p-banned', name: 'Banned Bob', reason: 'test', by: 'test' });

  const app = express();
  mountActivity(app, { monopoly, cards, tournaments: { list: () => [] } as unknown as Manager });
  const http = createServer(app).listen(0);
  await new Promise(r => http.once('listening', r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/api/activity?limit=20`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=10');
    const body = await res.json() as { items: { text: string }[]; now: number };
    const texts = body.items.map(i => i.text);
    assert.ok(texts.includes('Winnie won on Classic'), texts.join('\n'));
    assert.ok(texts.some(t => t.includes(pub.code)), 'the public lobby');
    assert.ok(texts.some(t => t.includes(table.code)), 'the public card table');
    const raw = JSON.stringify(body);
    for (const hidden of [priv.code, 'Hush', 'Hidden Host', 'Banned Bob', 'p-banned', 'host-2']) assert.ok(!raw.includes(hidden), hidden);

    // Within ten seconds a new public table is not there yet: the list is cached.
    const later = monopoly.create('host-4', true);
    later.join(member('host-4', 'Late'));
    const again = await (await fetch(`${base}/api/activity`)).json() as { items: { text: string }[]; now: number };
    assert.equal(again.now, body.now);
    assert.ok(!JSON.stringify(again).includes(later.code));
    assert.equal((await (await fetch(`${base}/api/activity?limit=1`)).json() as { items: unknown[] }).items.length, 1);
  } finally {
    http.close();
  }
});
