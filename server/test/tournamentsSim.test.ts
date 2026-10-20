// Whole tournaments on real tables: Cards tables (../src/cards/rooms.ts)
// opened through their registry, locked to the assigned players, played by
// the bots' policy on everyone's behalf (or ended by the round's time limit),
// with results going to the usual store. And the whole socket layer: a
// tournament, start to finish, posts nothing to Discord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-tourney-sim-'));
process.env.ADMIN_DISCORD_IDS = '1001';

const { CardsRegistry, CardsRoomError } = await import('../src/cards/rooms.ts');
const { TournamentManager } = await import('../src/tournament/manager.ts');
const { cardsAdapter } = await import('../src/tournament/adapters.ts');
const { cardsBotAction } = await import('../src/cards/bot.ts');
const { recordCardsResult, cardsLeaderboard, loadCardsResults } = await import('../src/cards/stats.ts');
const { seeded } = await import('./helpers.ts');
const { TOURNEY_BREAK_MS } = await import('../../shared/tournaments.ts');
type CardsRoom = InstanceType<typeof CardsRegistry>['rooms'] extends Map<string, infer R> ? R : never;

const ADMIN = { id: 'dc_1001', name: 'Op', avatar: '🎩', isAdmin: true };
const p = (i: number) => ({ id: `p${i}`, name: `Player ${i}`, avatar: '🙂' });
loadCardsResults();

/** p0 holds Chog Genesis #7; nobody holds #8. */
const holdsChog = (id: string, token: number) => id === 'p0' && token === 7;

function world() {
  let clock = Date.now();
  const now = () => clock;
  const cards = new CardsRegistry({ onChange() {}, onEvent() {}, holdsChog, onFinished(r) { recordCardsResult(r); } }, 1e9, { now, rng: seeded(5) });
  const m = new TournamentManager({
    cards: cardsAdapter(cards, () => {}),
  }, { onChange() {} }, { now, rng: seeded(9), file: `sim-${Math.random().toString(36).slice(2)}.json` });
  return {
    cards, m, now,
    advance(ms: number) { clock += ms; m.tick(); },
    done() {
      m.stop();
      for (const code of [...cards.rooms.keys()]) cards.delete(code);
    },
  };
}

/** Everyone the tournament seated opens their table (as the socket layer marks them). */
function arriveAll(rooms: Map<string, CardsRoom>, codes: string[], except: string[] = []) {
  for (const code of codes) {
    const r = rooms.get(code)!;
    for (const s of r.seats) if (!s.isBot && !except.includes(s.id)) r.setConnected(s.id, true);
  }
}

/** Play a Cards table to its end with the bot's policy for every seat. */
function playCards(room: CardsRoom, steps = 5_000) {
  for (let i = 0; i < steps && room.status === 'playing'; i++) {
    const g = room.game!;
    let moved = false;
    for (const pl of g.players) {
      const a = cardsBotAction(g, pl.id);
      if (!a) continue;
      try { room.act(pl.id, a, true); moved = true; break; } catch { /* another seat */ }
    }
    if (!moved) break;
  }
}

const codesOf = (t: { currentRound(): { tables: { code: string | null }[] } | null }) => t.currentRound()!.tables.map(x => x.code!);

test('a Cards tournament on real tables: bots fill seats but never go through, time-up on points', () => {
  const w = world();
  try {
    const t = w.m.create(ADMIN, {
      game: 'cards', name: 'Sim Cards',
      settings: { maxPlayers: 12, tableSize: 4, advance: 2, roundMinutes: 10, botsFill: true, cardsMatch: 'single' },
    });
    for (let i = 0; i < 11; i++) w.m.register(t.id, p(i));
    w.m.start(t.id, ADMIN);
    const r1 = t.currentRound()!;
    assert.deepEqual(r1.tables.map(x => x.players.length), [4, 4, 3]);
    const table3 = w.cards.get(r1.tables[2].code!)!;
    assert.equal(table3.rules.match, 'single');
    assert.throws(() => table3.join(p(99)), (e: Error) => e instanceof CardsRoomError && /assigned/.test(e.message));
    arriveAll(w.cards.rooms, codesOf(t));
    w.m.tick();
    assert.ok(r1.tables.every(x => x.status === 'playing'));
    assert.equal(table3.seats.filter(s => s.isBot).length, 1, 'a bot fills the short table');
    assert.equal(table3.view().tournament?.endsAt, r1.tables[2].endsAt);

    // Two tables are played out; the third runs out of time and is decided on points.
    playCards(w.cards.get(r1.tables[0].code!)!);
    playCards(w.cards.get(r1.tables[1].code!)!);
    w.m.tick();
    assert.equal(r1.tables[0].status, 'done');
    assert.equal(r1.tables[2].status, 'playing');
    w.advance(10 * 60_000);
    assert.equal(r1.tables[2].status, 'done');
    assert.ok(r1.tables[2].byTime);
    assert.equal(table3.game!.phase, 'over');
    assert.match(table3.game!.log.map(l => l.text).join('\n'), /Time is up/);
    const bots = new Set(table3.seats.filter(s => s.isBot).map(s => s.id));
    assert.ok(!t.advancers(r1).some(id => bots.has(id)), 'bots never go through');
    assert.equal(t.advancers(r1).length, 6);

    for (let round = 2; t.d.status === 'running' && round <= 6; round++) {
      w.advance(TOURNEY_BREAK_MS);
      arriveAll(w.cards.rooms, codesOf(t));
      w.m.tick();
      for (const x of t.currentRound()!.tables) playCards(w.cards.get(x.code!)!);
      w.m.tick();
      if (t.d.status === 'running' && t.currentRound()!.tables.some(x => x.status !== 'done')) w.advance(10 * 60_000);
    }
    assert.equal(t.d.status, 'finished');
    assert.equal(t.d.places.length, 11);
    assert.ok(t.d.places.every(id => id.startsWith('p')), 'only entrants are placed');
    assert.ok(cardsLeaderboard().some(row => row.id === t.champion()), 'table results reach the Cards leaderboard');
  } finally {
    w.done();
  }
});

test('entrants sit down as their own Chog only when their wallet holds it', () => {
  const w = world();
  try {
    const t = w.m.create(ADMIN, { game: 'cards', name: 'Chogs', settings: { maxPlayers: 3 } });
    w.m.register(t.id, { ...p(0), chogToken: 7 });
    w.m.register(t.id, { ...p(1), chogToken: 8 });
    w.m.register(t.id, p(2));
    w.m.start(t.id, ADMIN);
    const room = w.cards.get(t.currentRound()!.tables[0].code!)!;
    assert.equal(room.seat('p0')!.chogToken, 7, 'a holder plays their Chog');
    assert.equal(room.seat('p0')!.character, 'chog');
    assert.equal(room.seat('p1')!.chogToken, undefined, 'a token not in the wallet is refused quietly');
    assert.equal(room.seat('p2')!.chogToken, undefined);
  } finally {
    w.done();
  }
});

test('a tournament table is a locked Cards room: assigned seats, no player host, a no-show dropped', () => {
  const w = world();
  try {
    const t = w.m.create(ADMIN, { game: 'cards', name: 'Locked', settings: { tableSize: 4, advance: 1, noShowMinutes: 2 } });
    for (let i = 0; i < 4; i++) w.m.register(t.id, p(i));
    w.m.start(t.id, ADMIN);
    const table = t.currentRound()!.tables[0];
    const room = w.cards.get(table.code!)!;
    assert.equal(room.status, 'lobby');
    assert.equal(room.private, true, 'not in the public list');
    assert.deepEqual(room.seats.map(s => s.id), table.players, 'everyone is seated');
    assert.ok(room.seats.every(s => !s.connected), '…but away until they open it');
    assert.throws(() => room.join(p(99)), (e: Error) => e instanceof CardsRoomError && /assigned/.test(e.message), 'nobody else sits down');
    assert.throws(() => room.start(table.players[0], false), /host/, 'no player runs the table');
    assert.throws(() => room.kick(table.players[0], table.players[1], false), /host/, 'or kicks');
    assert.equal(room.view().tournament?.id, t.id, 'the table knows its tournament');
    assert.equal(room.view().tournament?.round, 1);

    const late = table.players[3];
    arriveAll(w.cards.rooms, codesOf(t), [late]);
    w.m.tick();
    assert.equal(table.status, 'waiting');
    w.advance(2 * 60_000);
    assert.equal(table.status, 'playing');
    assert.equal(room.status, 'playing');
    assert.ok(!room.seat(late), 'the no-show is dropped');
    assert.equal(room.hostId, `tourney-${t.id}`, 'the host never passes to a player');
    playCards(room);
    w.m.tick();
    assert.equal(t.d.status, 'finished');
    assert.equal(t.d.places.at(-1), late, 'the no-show is last');
  } finally {
    w.done();
  }
});

test('no Discord posts: not on creation, start, a table result or the finish', async () => {
  const { Server } = await import('socket.io');
  const { attachSockets } = await import('../src/sockets.ts');
  const { attachCardsSockets } = await import('../src/cards/sockets.ts');
  const { attachTournaments } = await import('../src/tournament/sockets.ts');
  const { setFeatures } = await import('../src/features.ts');
  // Everything an announcement needs is in place: a bot, a channel, the switch on.
  const env = { token: process.env.DISCORD_BOT_TOKEN, channel: process.env.DISCORD_ANNOUNCE_CHANNEL_ID };
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.DISCORD_ANNOUNCE_CHANNEL_ID = '123456789';
  setFeatures({ announceResults: true });
  const posts: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    posts.push(String(url instanceof Request ? url.url : url));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const io = new Server();
  const mono = attachSockets(io);
  const cards = attachCardsSockets(io, { taken: code => !!mono.registry.get(code) });
  const { manager } = attachTournaments(io, { monopoly: mono, cards }, { tickMs: 0 });
  try {
    const t = manager.create(ADMIN, { game: 'cards', name: 'Quiet Cup', prize: 'Glory', settings: { tableSize: 3, advance: 1 } });
    for (let i = 0; i < 6; i++) manager.register(t.id, p(i));
    manager.start(t.id, ADMIN);
    for (let round = 1; t.d.status === 'running' && round <= 4; round++) {
      if (t.d.nextRoundAt !== null) t.d.nextRoundAt = 0;
      manager.tick();
      arriveAll(cards.registry.rooms, codesOf(t));
      manager.tick();
      for (const x of t.currentRound()!.tables) playCards(cards.registry.get(x.code!)!);
      manager.tick();
    }
    assert.equal(t.d.status, 'finished', 'the event ran to the end');
    assert.ok(t.d.rounds.length >= 2, 'with table results along the way');
    const off = manager.create(ADMIN, { game: 'cards', name: 'Called off' });
    manager.cancel(off.id, ADMIN, 'Rain');
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(posts.filter(u => u.includes('discord')), [], 'nothing posted to Discord');
  } finally {
    manager.stop();
    for (const code of [...cards.registry.rooms.keys()]) cards.registry.delete(code);
    io.disconnectSockets(true);
    globalThis.fetch = realFetch;
    setFeatures({ announceResults: false });
    if (env.token === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = env.token;
    if (env.channel === undefined) delete process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
    else process.env.DISCORD_ANNOUNCE_CHANNEL_ID = env.channel;
  }
});
