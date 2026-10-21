// Tournaments: seating and byes, advancement and places, the final, host
// controls (and who may use them), operators only and Cards only, the
// optional player cap, no-shows, cancelling (nobody placed), and surviving a
// restart. Tables here are a fake game adapter the tests finish by hand;
// tournamentsSim.test.ts plays real Cards tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Storage and operators are read when the modules load (and on every check).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-tourneys-'));
process.env.ADMIN_DISCORD_IDS = '1001';

const { TournamentManager } = await import('../src/tournament/manager.ts');
const { planRound, effectiveAdvance, MAX_ENTRANTS } = await import('../src/tournament/engine.ts');
const { canHost } = await import('../src/hosting.ts');
const { linkWallet, setHoldings, resetWalletsForTest } = await import('../src/wallet/store.ts');
const { seeded } = await import('./helpers.ts');
const { writeJson } = await import('../src/jsonstore.ts');
const { TOURNEY_BREAK_MS, TOURNEY_PAUSE_MAX_MS } = await import('../../shared/tournaments.ts');
type Manager = InstanceType<typeof TournamentManager>;
type Adapter = ConstructorParameters<typeof TournamentManager>[0]['cards'];
type Lock = Parameters<Adapter['open']>[0];

const ADMIN = { id: 'dc_1001', name: 'Op', avatar: '🎩', isAdmin: true };
const OP2 = { id: 'dc_1002', name: 'Op Two', avatar: '🎩', isAdmin: true };
const HOLDER = { id: 'holder', name: 'Holder', avatar: '🎩', isAdmin: false };
const NOBODY = { id: 'nobody', name: 'Nobody', avatar: '🎩', isAdmin: false };
const p = (i: number) => ({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });

resetWalletsForTest();
const WALLET = '0x000000000000000000000000000000000000dEaD';
linkWallet(WALLET, HOLDER.id);
setHoldings(WALLET, { balance: 1, tokenIds: [7], checkedAt: Date.now(), method: 'enumerable', partial: false });

interface FakeRoom {
  lock: Lock; players: string[]; present: Set<string>; status: 'lobby' | 'playing' | 'finished';
  order?: string[]; byTime?: boolean; paused: boolean; dropped: string[]; bots: number; closed?: string; removed: string[];
}

/** A game whose tables the test finishes by hand. */
class FakeGame implements Adapter {
  graceMs = 0;
  rooms = new Map<string, FakeRoom>();
  private n = 0;
  open(lock: Lock, players: { id: string }[]) {
    const code = `F${++this.n}${lock.info.id.slice(0, 2)}`;
    this.rooms.set(code, { lock, players: players.map(x => x.id), present: new Set(), status: 'lobby', paused: false, dropped: [], bots: 0, removed: [] });
    return code;
  }
  attach(code: string, lock: Lock) { const r = this.rooms.get(code); if (r) r.lock = lock; return !!r; }
  present(code: string) { const r = this.rooms.get(code); return r ? [...r.present] : null; }
  begin(code: string, drop: string[], bots: number) {
    const r = this.rooms.get(code);
    if (!r) return false;
    Object.assign(r, { status: 'playing', dropped: drop, bots });
    return true;
  }
  result(code: string) {
    const r = this.rooms.get(code);
    if (!r) return 'gone' as const;
    return r.status === 'finished' ? { order: r.order!, byTime: !!r.byTime } : null;
  }
  timeUp(code: string) {
    const r = this.rooms.get(code)!;
    Object.assign(r, { status: 'finished', order: [...r.players].reverse(), byTime: true });
  }
  isPaused(code: string) { const r = this.rooms.get(code); return r?.status === 'playing' ? r.paused : null; }
  setPaused(code: string, paused: boolean) { this.rooms.get(code)!.paused = paused; }
  remove(code: string, id: string) { this.rooms.get(code)!.removed.push(id); }
  close(code: string, reason: string) { const r = this.rooms.get(code); if (r) { r.closed = reason; r.status = 'finished'; } }
  /** Everyone at the table opens it. */
  arrive(code: string, ids = this.rooms.get(code)!.players) { for (const id of ids) this.rooms.get(code)!.present.add(id); }
  /** The table's game ends in this order (default: seat order). */
  finish(code: string, order?: string[]) {
    const r = this.rooms.get(code)!;
    Object.assign(r, { status: 'finished', order: order ?? [...r.players] });
  }
}

function harness(file = `t-${Math.random().toString(36).slice(2)}.json`) {
  let clock = 1_000_000_000;
  const games = { cards: new FakeGame() };
  const seated: string[][] = [];
  const m: Manager = new TournamentManager(games, {
    onChange() {}, onSeated(_t, table) { seated.push([...table.players]); },
  }, { now: () => clock, rng: seeded(11), file });
  return {
    m, games, seated, file,
    advance(ms: number) { clock += ms; m.tick(); },
    now: () => clock,
  };
}

/** A tournament with n entrants (no cap), started. */
function running(h: ReturnType<typeof harness>, n: number, settings: Record<string, unknown> = {}) {
  const t = h.m.create(ADMIN, { game: 'cards', name: 'Test Cup', settings });
  for (let i = 0; i < n; i++) h.m.register(t.id, p(i));
  h.m.start(t.id, ADMIN);
  return t;
}

/** Open, fill and finish every table of the current round (seat order unless `order` decides). */
function playRound(h: ReturnType<typeof harness>, t: ReturnType<typeof running>, order?: (players: string[]) => string[]) {
  const g = h.games[t.d.game];
  const round = t.currentRound()!;
  for (const table of round.tables) g.arrive(table.code!);
  h.m.tick();
  for (const table of round.tables) {
    assert.equal(table.status, 'playing', `table ${table.id} started`);
    g.finish(table.code!, order?.(table.players));
  }
  h.m.tick();
}

test('planRound: balanced tables of 3+, byes only when needed, always progress', () => {
  assert.deepEqual(planRound(4, 4), { sizes: [4], byes: 0, final: true });
  assert.deepEqual(planRound(4, 3), { sizes: [3], byes: 1, final: false });
  assert.deepEqual(planRound(7, 3), { sizes: [3, 3], byes: 1, final: false });
  assert.deepEqual(planRound(5, 4), { sizes: [4], byes: 1, final: false });
  assert.deepEqual(planRound(13, 4), { sizes: [4, 3, 3, 3], byes: 0, final: false });
  assert.deepEqual(planRound(10, 6), { sizes: [5, 5], byes: 0, final: false });
  for (let size = 3; size <= 8; size++) {
    for (let n = 1; n <= 200; n++) {
      const plan = planRound(n, size);
      assert.equal(plan.sizes.reduce((a, b) => a + b, 0) + plan.byes, n, `everyone placed (${n}/${size})`);
      assert.equal(plan.final, n <= size);
      if (!plan.final) {
        for (const s of plan.sizes) assert.ok(s >= 3 && s <= size, `table of ${s} (${n}/${size})`);
        assert.ok(Math.max(...plan.sizes) - Math.min(...plan.sizes) <= 1, 'balanced');
        assert.ok(plan.byes < 3, 'byes only for the leftovers');
        for (const adv of [1, 2]) {
          const next = plan.byes + plan.sizes.reduce((a, s) => a + effectiveAdvance(adv, s), 0);
          assert.ok(next < n, `round shrinks (${n}/${size}, advance ${adv})`);
        }
      }
    }
  }
});

test('a full tournament: rounds, advancement, the final, places 1..N', () => {
  const h = harness();
  const t = running(h, 10, { tableSize: 4, advance: 2 });
  const r1 = t.currentRound()!;
  assert.deepEqual(r1.tables.map(x => x.players.length), [4, 3, 3]);
  assert.equal(new Set(r1.tables.flatMap(x => x.players)).size, 10, 'everyone seated once');
  assert.equal(h.seated.length, 3, 'every table told its players');
  assert.ok(r1.tables.every(x => x.status === 'waiting' && x.code), 'rooms opened at the start');
  const lock = h.games.cards.rooms.get(r1.tables[0].code!)!.lock;
  assert.deepEqual(lock.seats, r1.tables[0].players, 'seats locked to the assigned players');
  assert.equal(lock.hostId, `tourney-${t.id}`, 'the tournament hosts its tables');

  playRound(h, t);
  assert.equal(r1.finishedAt, h.now());
  assert.ok(t.d.nextRoundAt, 'a break before the next round');
  const through1 = t.advancers(r1);
  assert.equal(through1.length, 6);
  assert.deepEqual(through1, r1.tables.flatMap(x => x.players.slice(0, 2)), 'top two of each table');
  const v = h.m.view(t);
  assert.equal(v.entrants.filter(e => e.state === 'through').length, 6);
  assert.equal(v.entrants.filter(e => e.state === 'out').length, 4);

  h.advance(TOURNEY_BREAK_MS);
  const r2 = t.currentRound()!;
  assert.equal(r2.n, 2);
  assert.deepEqual(r2.tables.map(x => x.players.length), [3, 3]);
  assert.deepEqual(new Set(r2.tables.flatMap(x => x.players)), new Set(through1));
  playRound(h, t);
  h.advance(TOURNEY_BREAK_MS);
  const final = t.currentRound()!;
  assert.ok(final.final, 'four left: the final');
  assert.equal(final.tables.length, 1);
  playRound(h, t, players => [...players].reverse());
  assert.equal(t.d.status, 'finished');
  const places = t.d.places;
  assert.equal(places.length, 10);
  assert.equal(new Set(places).size, 10, 'places 1..N, each once');
  assert.deepEqual(places.slice(0, 4), [...final.tables[0].players].reverse(), 'the final decides the top four');
  assert.equal(t.champion(), places[0]);
  // Round two's knock-outs (both 3rd) come next, then round one's: three 3rds, then the 4th.
  const r2out = r2.tables.map(x => x.players[2]);
  assert.deepEqual(places.slice(4, 6), r2out);
  assert.deepEqual(places.slice(6, 9), r1.tables.map(x => x.players[2]));
  assert.equal(places[9], r1.tables[0].players[3]);
  const view = h.m.view(t);
  assert.equal(view.entrants.find(e => e.state === 'champion')?.id, places[0]);
  assert.equal(view.places[0].place, 1);
  assert.deepEqual(h.m.resultsOf(places[0]), [{ id: t.id, game: 'cards', name: 'Test Cup', place: 1, of: 10, endedAt: h.now(), finalTable: true }]);
});

test('byes: the odd players out go straight through, a different one each time', () => {
  const h = harness();
  const t = running(h, 7, { tableSize: 3, advance: 1 });
  const r1 = t.currentRound()!;
  assert.deepEqual(r1.tables.map(x => x.players.length), [3, 3]);
  assert.equal(r1.byes.length, 1);
  assert.ok(!r1.tables.some(x => x.players.includes(r1.byes[0])), 'a bye does not play');
  assert.equal(h.m.view(t).entrants.find(e => e.id === r1.byes[0])?.state, 'through');
  playRound(h, t);
  const through = t.advancers(r1);
  assert.equal(through.length, 3);
  assert.ok(through.includes(r1.byes[0]), 'the bye goes through');
  h.advance(TOURNEY_BREAK_MS);
  assert.ok(t.currentRound()!.final, 'three left: the final');
  playRound(h, t);
  assert.equal(t.d.status, 'finished');
  assert.equal(t.d.places.length, 7);

  // Eight at tables of three, one through: 2 tables and 2 byes, then 4 = a table and a bye.
  const h2 = harness();
  const t2 = running(h2, 8, { tableSize: 3, advance: 1 });
  const first = t2.currentRound()!.byes;
  assert.equal(first.length, 2);
  playRound(h2, t2);
  h2.advance(TOURNEY_BREAK_MS);
  const second = t2.currentRound()!.byes;
  assert.equal(second.length, 1);
  assert.ok(!first.includes(second[0]), 'a second bye goes to someone who has not had one');
});

test('one player left after a round is the champion without a final', () => {
  const h = harness();
  const t = running(h, 6, { tableSize: 3, advance: 1 });
  // 6 at tables of 3: two tables, one each through: two left = a final of two.
  playRound(h, t);
  h.advance(TOURNEY_BREAK_MS);
  assert.ok(t.currentRound()!.final);
  assert.equal(t.currentRound()!.tables[0].players.length, 2);

  // A table where nobody shows up sends nobody through; the other's winner is champion.
  const h2 = harness();
  const t2 = running(h2, 6, { tableSize: 3, advance: 1 });
  const [a, b] = t2.currentRound()!.tables;
  h2.games.cards.arrive(a.code!);
  h2.advance(3 * 60_000);
  assert.equal(b.status, 'done');
  assert.ok(b.walkover);
  assert.deepEqual(b.noShows.length, 3);
  h2.games.cards.finish(a.code!);
  h2.m.tick();
  assert.equal(t2.d.status, 'finished');
  assert.equal(t2.champion(), a.players[0]);
  assert.equal(t2.d.places.length, 6);
});

test('no-shows: dropped when the seating clock runs out, never through; or auto-played', () => {
  const h = harness();
  const t = running(h, 4, { tableSize: 4, advance: 2, noShowMinutes: 2 });
  const table = t.currentRound()!.tables[0];
  const g = h.games.cards;
  const [x, y, z, late] = table.players;
  g.arrive(table.code!, [x, y, z]);
  h.advance(60_000);
  assert.equal(table.status, 'waiting', 'still waiting for the last player');
  assert.deepEqual(table.arrived.sort(), [x, y, z].sort());
  assert.equal(g.rooms.get(table.code!)!.lock.info.startsBy, table.startsBy, 'the room shows when the table starts');
  h.advance(60_000);
  assert.equal(table.status, 'playing');
  assert.deepEqual(table.noShows, [late]);
  assert.deepEqual(g.rooms.get(table.code!)!.dropped, [late], 'the no-show is dropped from the game');
  g.finish(table.code!, [z, y, x]);
  h.m.tick();
  assert.deepEqual(table.order, [z, y, x, late], 'no-shows finish last');
  assert.deepEqual(t.d.places, [z, y, x, late]);

  // Auto-play keeps their seat, but a no-show never goes through.
  const h2 = harness();
  const t2 = running(h2, 6, { tableSize: 3, advance: 1, noShow: 'autoplay', noShowMinutes: 2 });
  const [ta, tb] = t2.currentRound()!.tables;
  h2.games.cards.arrive(ta.code!);
  h2.games.cards.arrive(tb.code!, tb.players.slice(0, 2));
  h2.advance(2 * 60_000);
  assert.deepEqual(h2.games.cards.rooms.get(tb.code!)!.dropped, []);
  h2.games.cards.finish(ta.code!);
  h2.games.cards.finish(tb.code!, [tb.players[2], tb.players[1], tb.players[0]]);
  h2.m.tick();
  assert.deepEqual(t2.advancers(t2.d.rounds[0]), [ta.players[0], tb.players[1]], 'the auto-played winner does not go through');

  // Bots fill the empty seats when the host allows it.
  const h3 = harness();
  const t3 = running(h3, 3, { tableSize: 5, botsFill: true });
  const only = t3.currentRound()!.tables[0];
  h3.games.cards.arrive(only.code!);
  h3.m.tick();
  assert.equal(h3.games.cards.rooms.get(only.code!)!.bots, 2);
});

test('round time limit: the game is ended on its tiebreak', () => {
  const h = harness();
  const t = running(h, 3, { roundMinutes: 20 });
  const table = t.currentRound()!.tables[0];
  h.games.cards.arrive(table.code!);
  h.m.tick();
  assert.equal(table.endsAt, h.now() + 20 * 60_000);
  assert.equal(h.games.cards.rooms.get(table.code!)!.lock.info.endsAt, table.endsAt);
  h.advance(20 * 60_000 - 1);
  assert.equal(table.status, 'playing');
  h.advance(1);
  assert.equal(table.status, 'done');
  assert.ok(table.byTime);
  assert.deepEqual(table.order, [...table.players].reverse());
  assert.equal(t.d.status, 'finished');
});

test('host controls: start, pause, resume and cancel are the host’s (and other operators’)', () => {
  const h = harness();
  const t = h.m.create(ADMIN, { game: 'cards', name: 'Friday Cards', prize: '  10 MON   to the winner ' });
  assert.equal(t.d.prize, '10 MON to the winner');
  for (let i = 0; i < 6; i++) h.m.register(t.id, p(i));
  assert.throws(() => h.m.start(t.id, NOBODY), /Only the host/);
  assert.throws(() => h.m.start(t.id, HOLDER), /Only the host/, 'holding a Chog runs nothing here');
  assert.throws(() => h.m.setPrize(t.id, NOBODY, 'mine'), /Only the host/);
  h.m.setPrize(t.id, ADMIN, 'A Chog plushie');
  assert.equal(t.d.prize, 'A Chog plushie');
  assert.throws(() => h.m.pause(t.id, ADMIN), /running/);
  h.m.start(t.id, ADMIN);
  assert.equal(t.d.status, 'running');
  assert.throws(() => h.m.unregister(t.id, 'p0'), /started/);
  assert.throws(() => h.m.register(t.id, p(9)), /closed/);

  const table = t.currentRound()!.tables[0];
  const startsBy = table.startsBy!;
  assert.throws(() => h.m.pause(t.id, { ...p(0), isAdmin: false }), /Only the host/);
  h.m.pause(t.id, ADMIN);
  assert.throws(() => h.m.pause(t.id, ADMIN), /Already paused/);
  h.advance(10 * 60_000);
  assert.equal(table.status, 'waiting', 'nothing moves while paused');
  assert.throws(() => h.m.resume(t.id, NOBODY), /Only the host/);
  h.m.resume(t.id, OP2);
  assert.equal(t.d.paused, null);
  assert.equal(table.startsBy, startsBy + 10 * 60_000, 'the seating clock froze for the pause');

  // Paused mid-game: the tables pause with it, and stay paused until the tournament resumes.
  h.games.cards.arrive(table.code!);
  h.m.tick();
  assert.equal(table.status, 'playing');
  h.m.pause(t.id, ADMIN);
  assert.equal(h.games.cards.rooms.get(table.code!)!.paused, true);
  h.games.cards.rooms.get(table.code!)!.paused = false; // the game's own pause limit ran out
  h.advance(1_000);
  assert.equal(h.games.cards.rooms.get(table.code!)!.paused, true, 'held for the tournament');
  const endsAt = table.endsAt!;
  h.m.resume(t.id, ADMIN);
  assert.equal(h.games.cards.rooms.get(table.code!)!.paused, false);
  assert.equal(table.endsAt, endsAt + 1_000);

  // A pause carries on by itself after the limit.
  h.m.pause(t.id, ADMIN);
  h.advance(TOURNEY_PAUSE_MAX_MS);
  assert.equal(t.d.paused, null, 'a forgotten pause ends by itself');

  assert.throws(() => h.m.cancel(t.id, NOBODY), /Only the host/);
  assert.throws(() => h.m.remove(t.id, NOBODY, 'p1'), /operators/, 'no kicking for players');
  h.m.cancel(t.id, ADMIN, 'Rain');
  assert.equal(t.d.status, 'cancelled');
  assert.equal(t.d.cancelReason, 'Rain');
  assert.ok(h.games.cards.rooms.get(table.code!)!.closed, 'open tables are closed');
  assert.throws(() => h.m.cancel(t.id, ADMIN), /already over/);
});

test('operators can remove a player: off the list, or out of a running event', () => {
  const h = harness();
  const t = running(h, 4, { tableSize: 4, advance: 2 });
  const table = t.currentRound()!.tables[0];
  h.games.cards.arrive(table.code!);
  h.m.tick();
  h.m.remove(t.id, ADMIN, table.players[0]);
  assert.deepEqual(h.games.cards.rooms.get(table.code!)!.removed, [table.players[0]]);
  h.games.cards.finish(table.code!);
  h.m.tick();
  assert.equal(t.d.status, 'finished');

  const h2 = harness();
  const t2 = h2.m.create(ADMIN, { game: 'cards', name: 'Cup' });
  h2.m.register(t2.id, p(1));
  h2.m.remove(t2.id, ADMIN, 'p1');
  assert.equal(t2.d.entrants.length, 0);
});

test('who may create: operators only; holders and approved hosts still host on Poker', () => {
  // canHost stays as it was: Poker asks it before a player opens a table or a poker tournament.
  assert.equal(canHost(ADMIN.id), true);
  assert.equal(canHost(HOLDER.id), true);
  assert.equal(canHost(NOBODY.id), false);
  assert.equal(canHost('demo_x'), false);
  const h = harness();
  assert.throws(() => h.m.create(HOLDER, { game: 'cards', name: 'Holder Cup' }), /Only operators/, 'a Chog holder may not');
  assert.throws(() => h.m.create(NOBODY, { game: 'cards', name: 'Mine' }), /Only operators/);
  assert.equal(h.m.tournaments.size, 0);
  assert.deepEqual(h.m.me(NOBODY), { isAdmin: false });
  assert.deepEqual(h.m.me(HOLDER), { isAdmin: false });
  assert.deepEqual(h.m.me(null), { isAdmin: false });
  assert.deepEqual(h.m.me(ADMIN), { isAdmin: true });
  // Operators are not limited to one event at a time.
  h.m.create(ADMIN, { game: 'cards', name: 'One' });
  h.m.create(ADMIN, { game: 'cards', name: 'Two' });
  assert.equal(h.m.list().length, 2);
});

test('Cards only: a Monopoly (or any other) tournament is refused', () => {
  const h = harness();
  assert.throws(() => h.m.create(ADMIN, { game: 'monopoly', name: 'Board Cup' }), /Cards only/);
  assert.throws(() => h.m.create(ADMIN, { game: 'chess', name: 'Cup' }), /Cards only/);
  assert.throws(() => h.m.create(ADMIN, { name: 'Cup' }), /Cards only/);
  assert.equal(h.m.tournaments.size, 0);
  assert.equal(h.m.create(ADMIN, { game: 'cards', name: 'Cup' }).d.game, 'cards');
});

test('settings: no player cap unless the operator sets one, and every setting checked', () => {
  const h = harness();
  const create = (settings: Record<string, unknown>) => h.m.create(ADMIN, { game: 'cards', name: 'Cup', settings });
  assert.throws(() => create({ startAt: h.now() + 31 * 86_400_000 }), /30 days ahead/);
  assert.throws(() => create({ startAt: h.now() + 1_000 }), /a minute from now/);
  assert.throws(() => create({ tableSize: 9 }), /Tables seat 3 to 8/);
  assert.throws(() => create({ tableSize: 2 }), /Tables seat 3 to 8/);
  assert.throws(() => create({ advance: 3 }), /One or two/);
  assert.throws(() => create({ minPlayers: 2 }), /minimum/);
  assert.throws(() => create({ roundMinutes: 17 }), /from the list/);
  assert.throws(() => create({ roundMinutes: 45 }), /from the list/);
  assert.throws(() => create({ cardsTarget: 150 }), /points target/);
  assert.throws(() => create({ cardsMode: 'mayhem' }), /Unknown mode/);
  assert.equal(create({}).d.settings.cardsMode, 'classic', 'Classic unless the operator picks Chog Chaos');
  assert.throws(() => create({ maxPlayers: 2 }), /at least 3/);
  assert.throws(() => create({ maxPlayers: 4, minPlayers: 5 }), /no more than the cap/);
  assert.throws(() => create({ maxPlayers: 'many' }), /Bad number/);
  assert.throws(() => h.m.create(ADMIN, { game: 'cards', name: ' ' }), /name/);
  assert.doesNotThrow(() => create({ startAt: h.now() + 29 * 86_400_000, roundMinutes: 30 }));

  // No cap by default: a big field registers, well past any old limit.
  const open = create({});
  assert.equal(open.d.settings.maxPlayers, null);
  for (let i = 0; i < 200; i++) h.m.register(open.id, p(i));
  assert.equal(open.d.entrants.length, 200);
  assert.equal(h.m.summary(open).maxPlayers, null);
  assert.equal(create({ maxPlayers: null }).d.settings.maxPlayers, null, 'null is no cap');
  assert.equal(create({ maxPlayers: '' }).d.settings.maxPlayers, null, 'an empty field is no cap');
  // ...though the server keeps a safety bound nobody sees.
  assert.throws(() => create({ maxPlayers: MAX_ENTRANTS + 1 }), /at most/);
  const huge = create({});
  for (let i = 0; i < MAX_ENTRANTS; i++) huge.d.entrants.push({ id: `x${i}`, name: `X${i}`, avatar: '🙂', at: 0 });
  assert.throws(() => h.m.register(huge.id, p(0)), /full/);

  // A cap set by the operator closes registration when it is reached.
  const small = create({ maxPlayers: 3 });
  assert.equal(small.d.settings.maxPlayers, 3);
  for (let i = 0; i < 3; i++) h.m.register(small.id, p(i));
  assert.throws(() => h.m.register(small.id, p(3)), /full/);
  assert.throws(() => h.m.register(small.id, p(0)), /already registered/);
  h.m.unregister(small.id, 'p0');
  h.m.register(small.id, p(3));
  assert.throws(() => h.m.register(small.id, p(4)), /full/);
  h.m.unregister(small.id, 'p3');
  assert.throws(() => h.m.unregister(small.id, 'p3'), /not registered/);
  assert.throws(() => h.m.start(small.id, ADMIN), /at least 3/);
});

test('a cancelled tournament places nobody: no champion, nothing on profiles', () => {
  const h = harness();
  const t = running(h, 10, { tableSize: 4, advance: 2 });
  playRound(h, t);
  assert.ok(t.d.nextRoundAt, 'round one is over');
  h.m.cancel(t.id, ADMIN, 'Server maintenance');
  assert.equal(t.d.status, 'cancelled');
  assert.deepEqual(t.d.places, []);
  assert.equal(t.champion(), null);
  const v = h.m.view(t);
  assert.deepEqual(v.places, []);
  assert.ok(v.entrants.every(e => e.place === undefined && e.state !== 'champion'), 'no entrant has a place');
  assert.equal(h.m.summary(t).champion, null);
  for (let i = 0; i < 10; i++) assert.deepEqual(h.m.resultsOf(`p${i}`), [], `p${i} has no result`);

  // Called off before the start (by hand, or a scheduled start with too few): nobody either.
  const early = h.m.create(ADMIN, { game: 'cards', name: 'Early' });
  for (let i = 0; i < 3; i++) h.m.register(early.id, p(i));
  h.m.cancel(early.id, ADMIN);
  assert.deepEqual(early.d.places, []);
  const thin = h.m.create(ADMIN, { game: 'cards', name: 'Thin', settings: { startAt: h.now() + 60_000, minPlayers: 5 } });
  h.m.register(thin.id, p(0));
  h.advance(60_000);
  assert.equal(thin.d.status, 'cancelled');
  assert.deepEqual(thin.d.places, []);

  // Still nobody after a restart.
  h.m.saveNow();
  const m2 = new TournamentManager({ cards: new FakeGame() }, { onChange() {} }, { now: h.now, file: h.file });
  m2.restore();
  assert.deepEqual(m2.get(t.id)!.d.places, []);
  assert.deepEqual(m2.resultsOf('p0'), []);
});

test('a scheduled start: begins on time, or is called off with too few players', () => {
  const h = harness();
  const at = h.now() + 10 * 60_000;
  const on = h.m.create(ADMIN, { game: 'cards', name: 'On time', settings: { startAt: at } });
  const off = h.m.create(ADMIN, { game: 'cards', name: 'Too few', settings: { startAt: at, minPlayers: 4 } });
  for (let i = 0; i < 3; i++) { h.m.register(on.id, p(i)); h.m.register(off.id, p(i)); }
  h.advance(10 * 60_000 - 1);
  assert.equal(on.d.status, 'registering');
  h.advance(1);
  assert.equal(on.d.status, 'running');
  assert.equal(on.currentRound()!.tables[0].status, 'waiting');
  assert.equal(off.d.status, 'cancelled');
  assert.match(off.d.cancelReason!, /Not enough players/);
  assert.deepEqual(h.m.list().map(s => s.status), ['running', 'cancelled']);
});

test('persistence: a restart picks up mid-round, and a room that did not survive is opened again', () => {
  const h = harness();
  const t = running(h, 9, { tableSize: 3, advance: 1 });
  const [a, b, c] = t.currentRound()!.tables;
  h.games.cards.arrive(a.code!);
  h.games.cards.arrive(b.code!);
  h.games.cards.arrive(c.code!, c.players.slice(0, 1));
  h.m.tick();
  h.games.cards.finish(a.code!);
  h.m.tick();
  assert.equal(a.status, 'done');
  assert.equal(b.status, 'playing');
  assert.equal(c.status, 'waiting');
  const startsBy = c.startsBy!;
  h.m.saveNow();
  h.m.stop();

  // The server comes back a minute later. Table b's room survived; table c's did not.
  let clock = h.now() + 60_000;
  const games = { cards: new FakeGame() };
  games.cards.rooms.set(b.code!, { ...h.games.cards.rooms.get(b.code!)! });
  let seatedAgain = 0;
  const m2 = new TournamentManager(games, { onChange() {}, onSeated() { seatedAgain++; } }, { now: () => clock, rng: seeded(3), file: h.file });
  assert.equal(m2.restore(), 1);
  const t2 = m2.get(t.id)!;
  const [a2, b2, c2] = t2.currentRound()!.tables;
  assert.equal(a2.status, 'done');
  assert.deepEqual(a2.order, a.order);
  assert.equal(b2.status, 'playing');
  assert.equal(games.cards.rooms.get(b2.code!)!.lock.hostId, `tourney-${t.id}`, 'the lock is back on the room');
  assert.equal(b2.endsAt, b.endsAt! + 60_000, 'deadlines move on by the downtime');
  assert.equal(c2.status, 'pending', 'the lost table is seated again');
  m2.tick();
  assert.equal(seatedAgain, 1);
  assert.equal(c2.status, 'waiting');
  assert.notEqual(c2.code, c.code);
  assert.ok(c2.startsBy! > startsBy);
  assert.deepEqual(c2.arrived, [], 'everyone opens the new table');

  games.cards.finish(b2.code!);
  games.cards.arrive(c2.code!);
  m2.tick();
  games.cards.finish(c2.code!);
  m2.tick();
  clock += TOURNEY_BREAK_MS;
  m2.tick();
  const final = t2.currentRound()!;
  assert.ok(final.final);
  games.cards.arrive(final.tables[0].code!);
  m2.tick();
  games.cards.finish(final.tables[0].code!);
  m2.tick();
  assert.equal(t2.d.status, 'finished');
  assert.equal(t2.d.places.length, 9);

  // A paused event comes back paused, and finished ones come back for their pages.
  m2.saveNow();
  const m3 = new TournamentManager(games, { onChange() {} }, { now: () => clock, file: h.file });
  assert.equal(m3.restore(), 0);
  assert.equal(m3.get(t.id)!.d.status, 'finished');
  assert.equal(m3.resultsOf(t2.d.places[0])[0].place, 1);
});

test('a playing table whose room is lost is replayed, and after a few tries its seat order stands', () => {
  const h = harness();
  const t = running(h, 3);
  const table = t.currentRound()!.tables[0];
  for (let i = 1; i <= 3; i++) {
    h.games.cards.arrive(table.code!);
    h.m.tick();
    assert.equal(table.status, 'playing');
    h.games.cards.rooms.delete(table.code!);
    h.m.tick();
    if (i <= 2) {
      assert.equal(table.status, 'pending', `lost room ${i}: opened again`);
      h.m.tick();
    }
  }
  assert.equal(table.status, 'done');
  assert.deepEqual(table.order, table.players);
  assert.equal(t.d.status, 'finished');
});

test('restoring a file with malformed events skips them; the list, pages and profiles keep working', () => {
  const h = harness();
  const live = running(h, 3);
  const done = running(h, 3);
  playRound(h, done);
  const odd = (id: string, patch: Record<string, unknown>) => ({ ...structuredClone(done.d), id, ...patch });
  const file = `odd-${Math.random().toString(36).slice(2)}.json`;
  writeJson(file, {
    savedAt: h.now(),
    tournaments: [
      live.d, done.d,
      odd('no-entrants', { entrants: null }),
      odd('no-rounds', { status: 'running', rounds: 'x' }),
      odd('no-places', { places: {} }),
      odd('no-settings', { status: 'registering', settings: null }),
      odd('odd-status', { status: 'exploded' }),
      odd('odd-round', { status: 'running', rounds: [{ n: 1, tables: null, byes: [] }] }),
      odd('odd-entrant', { entrants: [null] }),
      odd('odd-pause', { status: 'running', paused: true }),
      null, 7, 'junk',
    ],
  });
  const games = { cards: new FakeGame() };
  for (const table of live.currentRound()!.tables) games.cards.rooms.set(table.code!, { ...h.games.cards.rooms.get(table.code!)! });
  const m2 = new TournamentManager(games, { onChange() {} }, { now: h.now, file });
  let n = -1;
  assert.doesNotThrow(() => { n = m2.restore(); });
  assert.equal(n, 1);
  assert.deepEqual([...m2.tournaments.keys()].sort(), [live.id, done.id].sort(), 'only the well-formed events are back');
  assert.doesNotThrow(() => m2.list());
  assert.doesNotThrow(() => m2.resultsOf(done.d.places[0]));
  for (const t of m2.tournaments.values()) assert.doesNotThrow(() => m2.view(t));
  assert.doesNotThrow(() => m2.tick());
});

test('restoring an old file with a Monopoly tournament in it skips that one and keeps the rest', () => {
  const h = harness();
  const cards = running(h, 3);
  const done = running(h, 3);
  playRound(h, done);
  assert.equal(done.d.status, 'finished');
  // Written before Monopoly tournaments were retired: a live one mid-round and a finished one,
  // with the fields they had then (a board, `official`, a numeric cap).
  const old = (id: string, from: typeof cards) => ({
    ...structuredClone(from.d), id, game: 'monopoly', official: true,
    settings: { ...from.d.settings, maxPlayers: 16, mapId: 'classic' },
  });
  const file = `old-${Math.random().toString(36).slice(2)}.json`;
  writeJson(file, { savedAt: h.now(), tournaments: [old('mono-live', cards), cards.d, old('mono-done', done), done.d] });

  const games = { cards: new FakeGame() };
  for (const table of cards.currentRound()!.tables) games.cards.rooms.set(table.code!, { ...h.games.cards.rooms.get(table.code!)! });
  const m2 = new TournamentManager(games, { onChange() {} }, { now: h.now, file });
  let live = -1;
  assert.doesNotThrow(() => { live = m2.restore(); });
  assert.equal(live, 1, 'only the Cards event is live');
  assert.equal(m2.get('mono-live'), undefined);
  assert.equal(m2.get('mono-done'), undefined);
  assert.deepEqual(m2.list().map(s => s.id).sort(), [cards.id, done.id].sort());
  assert.deepEqual(m2.resultsOf(done.d.places[0]).map(r => r.id), [done.id], 'no Monopoly results on profiles');
  // The Cards event carries on.
  assert.doesNotThrow(() => m2.tick());
  assert.equal(m2.get(cards.id)!.d.status, 'running');
  m2.saveNow();
  const m3 = new TournamentManager(games, { onChange() {} }, { now: h.now, file });
  m3.restore();
  assert.equal(m3.tournaments.size, 2, 'the skipped events are gone from the file');
});
