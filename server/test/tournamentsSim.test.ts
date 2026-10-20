// Whole tournaments on real tables: Monopoly rooms (../src/rooms.ts) and
// Cards tables (../src/cards/rooms.ts) opened through their registries,
// locked to the assigned players, played by the bots' policy on everyone's
// behalf (or ended by the round's time limit), with results going to the
// usual stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-tourney-sim-'));
process.env.ADMIN_DISCORD_IDS = '1001';

const { Registry, RoomError } = await import('../src/rooms.ts');
const { CardsRegistry, CardsRoomError } = await import('../src/cards/rooms.ts');
const { TournamentManager } = await import('../src/tournament/manager.ts');
const { monopolyAdapter, cardsAdapter } = await import('../src/tournament/adapters.ts');
const { botAction } = await import('../src/engine/bot.ts');
const { cardsBotAction } = await import('../src/cards/bot.ts');
const { recordResult, leaderboard, loadResults } = await import('../src/stats.ts');
const { recordCardsResult, cardsLeaderboard, loadCardsResults } = await import('../src/cards/stats.ts');
const { seeded } = await import('./helpers.ts');
const { TOURNEY_BREAK_MS } = await import('../../shared/tournaments.ts');
type Room = InstanceType<typeof Registry>['rooms'] extends Map<string, infer R> ? R : never;
type CardsRoom = InstanceType<typeof CardsRegistry>['rooms'] extends Map<string, infer R> ? R : never;

const ADMIN = { id: 'dc_1001', name: 'Op', avatar: '🎩', isAdmin: true };
const p = (i: number) => ({ id: `p${i}`, name: `Player ${i}`, avatar: '🙂' });
loadResults();
loadCardsResults();

/** p0 holds Chog Genesis #7; nobody holds #8. */
const holdsChog = (id: string, token: number) => id === 'p0' && token === 7;

function world() {
  let clock = Date.now();
  const now = () => clock;
  const mono = new Registry({
    onChange() {}, onEvent() {}, holdsChog,
    onFinished(r) {
      const g = r.game!;
      recordResult({
        code: r.code, mapId: r.mapId, themeId: r.themeId, startedAt: r.startedAt ?? 0, endedAt: Date.now(), turns: g.turnNumber,
        places: g.standings().map(s => ({ id: s.id, name: g.player(s.id).name, isBot: g.player(s.id).isBot, netWorth: s.netWorth })),
      });
    },
  }, 1e9);
  const cards = new CardsRegistry({ onChange() {}, onEvent() {}, holdsChog, onFinished(r) { recordCardsResult(r); } }, 1e9, { now, rng: seeded(5) });
  const m = new TournamentManager({
    monopoly: monopolyAdapter(mono, () => {}),
    cards: cardsAdapter(cards, () => {}, code => !!mono.get(code)),
  }, { onChange() {} }, { now, rng: seeded(9), file: `sim-${Math.random().toString(36).slice(2)}.json` });
  return {
    mono, cards, m, now,
    advance(ms: number) { clock += ms; m.tick(); },
    done() {
      m.stop();
      for (const code of [...mono.rooms.keys()]) mono.delete(code);
      for (const code of [...cards.rooms.keys()]) cards.delete(code);
    },
  };
}

/** Everyone the tournament seated opens their table (as the socket layer marks them). */
function arriveAll(rooms: Map<string, Room | CardsRoom>, codes: string[], except: string[] = []) {
  for (const code of codes) {
    const r = rooms.get(code)!;
    for (const s of r.seats) if (!s.isBot && !except.includes(s.id)) r.setConnected(s.id, true);
  }
}

/** Play a Monopoly table with the bot's policy for every seat, for at most `steps` moves. */
function playMonopoly(room: Room, steps: number) {
  for (let i = 0; i < steps && room.game && room.game.phase !== 'over' && room.status === 'playing'; i++) {
    const g = room.game;
    const ids = [g.current.id, ...g.players.map(x => x.id).filter(id => id !== g.current.id)];
    let moved = false;
    for (const id of ids) {
      const a = botAction(g, id);
      if (!a) continue;
      for (const tryA of [a, { type: 'pass' } as const, { type: 'endTurn' } as const]) {
        try { room.act(id, tryA, true); moved = true; break; } catch { /* next */ }
      }
      if (moved) break;
    }
    if (!moved) break;
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

test('a Monopoly tournament on real tables: locked seats, a no-show, time limits, a champion', () => {
  const w = world();
  try {
    const t = w.m.create(ADMIN, { game: 'monopoly', name: 'Sim Cup', settings: { maxPlayers: 10, tableSize: 4, advance: 1, roundMinutes: 20, noShowMinutes: 2 } });
    for (let i = 0; i < 10; i++) w.m.register(t.id, p(i));
    w.m.start(t.id, ADMIN);
    const r1 = t.currentRound()!;
    assert.deepEqual(r1.tables.map(x => x.players.length), [4, 3, 3]);
    const room = w.mono.get(r1.tables[0].code!)!;
    assert.equal(room.status, 'lobby');
    assert.equal(room.private, true, 'not in the public list');
    assert.equal(room.rules.timeLimitMin, 20, 'the round limit is the game’s');
    assert.deepEqual(room.seats.map(s => s.id), r1.tables[0].players, 'everyone is seated');
    assert.ok(room.seats.every(s => !s.connected), '…but away until they open it');
    assert.throws(() => room.join(p(99)), (e: Error) => e instanceof RoomError && /assigned/.test(e.message), 'nobody else sits down');
    assert.throws(() => room.start(r1.tables[0].players[0], false), /host/, 'no player runs the table');
    assert.throws(() => room.kick(r1.tables[0].players[0], r1.tables[0].players[1], false), /host/, 'or kicks');
    assert.equal(room.view().tournament?.id, t.id, 'the table knows its tournament');
    assert.equal(room.view().tournament?.round, 1);

    // Everyone but one opens their table; the last is dropped when the clock runs out.
    const late = r1.tables[0].players[3];
    arriveAll(w.mono.rooms, codesOf(t), [late]);
    w.m.tick();
    assert.equal(r1.tables[1].status, 'playing', 'a full table starts at once');
    assert.equal(r1.tables[0].status, 'waiting');
    w.advance(2 * 60_000);
    assert.equal(r1.tables[0].status, 'playing');
    assert.equal(room.status, 'playing');
    assert.ok(!room.seat(late), 'the no-show is dropped');
    assert.equal(room.hostId, `tourney-${t.id}`, 'the host never passes to a player');

    for (let round = 1; t.d.status === 'running' && round <= 6; round++) {
      const tables = t.currentRound()!.tables;
      if (round > 1) {
        arriveAll(w.mono.rooms, codesOf(t));
        w.m.tick();
      }
      for (const x of tables) if (x.status === 'playing') playMonopoly(w.mono.get(x.code!)!, 300);
      w.m.tick();
      // Whatever is still going ends on net worth when the round's time is up.
      w.advance(20 * 60_000 + 3 * 60_000);
      assert.ok(tables.every(x => x.status === 'done'), `round ${round} finished`);
      if (t.d.status === 'running') w.advance(TOURNEY_BREAK_MS);
    }
    assert.equal(t.d.status, 'finished');
    assert.equal(t.d.places.length, 10);
    assert.equal(new Set(t.d.places).size, 10);
    assert.equal(t.d.places[9], late, 'the no-show is last');
    const champ = t.champion()!;
    assert.ok(t.d.rounds.at(-1)!.final);
    assert.equal(t.d.rounds.at(-1)!.tables[0].order![0], champ, 'the final’s winner is champion');
    assert.ok(leaderboard().some(row => row.id === champ), 'table results reach the leaderboard');
    assert.equal(w.m.resultsOf(champ)[0].place, 1);
  } finally {
    w.done();
  }
});

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

test('entrants sit down as their own Chog only when their wallet holds it, in both games', () => {
  const w = world();
  try {
    for (const game of ['monopoly', 'cards'] as const) {
      const t = w.m.create(ADMIN, { game, name: `Chogs ${game}`, settings: { maxPlayers: 3 } });
      w.m.register(t.id, { ...p(0), chogToken: 7 });
      w.m.register(t.id, { ...p(1), chogToken: 8 });
      w.m.register(t.id, p(2));
      w.m.start(t.id, ADMIN);
      const code = t.currentRound()!.tables[0].code!;
      const room = game === 'cards' ? w.cards.get(code)! : w.mono.get(code)!;
      assert.equal(room.seat('p0')!.chogToken, 7, `${game}: a holder plays their Chog`);
      assert.equal(room.seat('p0')!.character, 'chog');
      assert.equal(room.seat('p1')!.chogToken, undefined, `${game}: a token not in the wallet is refused quietly`);
      assert.equal(room.seat('p2')!.chogToken, undefined);
    }
  } finally {
    w.done();
  }
});
