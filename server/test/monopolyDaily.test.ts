// The Monopoly Daily Challenge (src/monopolyDaily.ts, Room.setupDaily): one
// seeded game per UTC day on the day's board against the same three bots,
// dice by turn alone, a 20-turn cap, one official attempt per account per day
// (leaving or going idle is a loss, asking again goes back to the same game),
// practice after that, the day's leaderboard, streaks, the HTTP endpoints and
// a restart in the middle of it all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-monopoly-daily-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const { setFeatures } = await import('../src/features.ts');
const { Registry, Room } = await import('../src/rooms.ts');
const { botAction } = await import('../src/engine/bot.ts');
const daily = await import('../src/monopolyDaily.ts');
const { mountMonopolyDaily } = await import('../src/routes/monopolyDaily.ts');
const {
  MONOPOLY_DAILY_BOTS, MONOPOLY_DAILY_TURNS, addDays, compareMonopolyDaily, monopolyDailyMap, monopolyDailyNumber,
  monopolyDailyRules, monopolyDailyShareText, MONOPOLY_DAILY_BOARDS,
} = await import('../../shared/monopolyDaily.ts');
type RoomT = InstanceType<typeof Room>;
type Result = import('../../shared/monopolyDaily.ts').MonopolyDailyResult;
type Action = import('../../shared/types.ts').Action;

/** A Monday: the Classic board. */
const DAY1 = '2026-11-02';
const at = (date: string, hour = 10) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

const reg = new Registry({
  onChange() {}, onEvent() {},
  onFinished(r) { daily.settleMonopolyDaily(r); },
  onEnded(r) { daily.settleMonopolyDaily(r); },
}, 1e9);

/** Everyone plays under the same name, so two players' logs compare line for line. */
const member = (id: string) => ({ id, name: 'Player', avatar: '🎩' });
const start = (id: string, date = DAY1) => daily.startMonopolyDaily(reg, member(id), { now: at(date) });

type Policy = (r: RoomT, id: string) => Action | null;
/** The player plays like a bot (minus the deals there are none of at a daily table). */
const asBot: Policy = (r, id) => {
  const g = r.game!;
  const a = botAction(g, id);
  if (a?.type === 'proposeTrade') return { type: 'endTurn' };
  // The bot sometimes jumps a bid by a few steps, seeded by its own id: the player
  // (whose id differs from player to player) always bids one step, so two players play alike.
  if (a?.type === 'bid' && g.auction) return { type: 'bid', amount: g.auction.highBid + Math.max(5, Math.round((g.spaces[g.auction.space].price ?? 100) * 0.05)) };
  return a;
};
/** A player who never buys or builds: same dice, different game. */
const miser: Policy = (r, id) => {
  const g = r.game!;
  const a = asBot(r, id);
  if (!a) return null;
  if (a.type === 'buy') return { type: 'decline' };
  if (a.type === 'build' || a.type === 'unmortgage') return g.phase === 'done' ? { type: 'endTurn' } : { type: 'roll' };
  if (a.type === 'bid') return { type: 'pass' };
  return a;
};

/**
 * Play the table to its end, synchronously (the room's own timers never get
 * to fire): each step, the first seat with a move makes it. Records the
 * first throw of every turn.
 */
function playOut(r: RoomT, policy: Policy = asBot, steps = 20_000): Map<number, [number, number]> {
  const throws = new Map<number, [number, number]>();
  let seq = -1;
  for (let i = 0; i < steps && r.status === 'playing'; i++) {
    const g = r.game!;
    let moved = false;
    const order = [g.current.id, ...g.players.map(p => p.id).filter(id => id !== g.current.id)];
    for (const id of order) {
      const p = g.player(id);
      if (p.bankrupt) continue;
      let a = p.isBot ? botAction(g, id) : policy(r, id);
      if (p.isBot && a?.type === 'proposeTrade') a = { type: 'endTurn' };
      if (!a) continue;
      try { r.act(id, a, p.isBot); moved = true; break; } catch { /* not this seat's move after all */ }
    }
    // A debtor sitting out an auction holds it open until its clock: they pass.
    if (!moved && g.auction) {
      for (const id of g.auction.bidders) {
        if (id === g.auction.highBidder) continue;
        try { r.act(id, { type: 'pass' }, g.player(id).isBot); moved = true; break; } catch { /* next */ }
      }
    }
    if (g.dice && g.rollSeq !== seq) {
      seq = g.rollSeq;
      if (!throws.has(g.rollTurn)) throws.set(g.rollTurn, [...g.dice]);
    }
    if (!moved) break;
  }
  assert.equal(r.status, 'finished', 'the game was played out');
  return throws;
}

/** The game as set up, with the player written as "you" so two players' tables compare. */
function setup(r: RoomT) {
  const g = r.game!;
  const you = r.daily!.userId;
  const snap = g.snapshot();
  return {
    map: r.mapId, rules: r.rules,
    seats: g.players.map(p => (p.id === you ? 'you' : `${p.id}:${p.name}:${p.character}`)),
    decks: snap.decks,
    cash: g.players.map(p => p.cash),
  };
}
const logOf = (r: RoomT) => r.game!.log.map(e => e.text);

let server: HttpServer;
let base = '';
before(async () => {
  daily.loadMonopolyDaily();
  setFeatures({ leaderboard: true, bots: true });
  const app = express();
  mountMonopolyDaily(app, reg, () => clock.t);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  for (const code of [...reg.rooms.keys()]) reg.delete(code);
});
const clock = { t: at(DAY1) };

test('the boards rotate by weekday, Blitz and Crossroads included; the rules are fixed', () => {
  const week = Array.from({ length: 7 }, (_, i) => monopolyDailyMap(addDays(DAY1, i)));
  assert.equal(week[0], 'classic', 'Mondays are Classic');
  for (const id of ['classic', 'speed', 'metropolis', 'blitz', 'crossroads']) assert.ok(week.includes(id), `${id} is in the week`);
  assert.equal(new Set(MONOPOLY_DAILY_BOARDS).size, 5);
  const blitz = monopolyDailyRules('blitz');
  assert.equal(blitz.startingCash, 1000);
  assert.equal(blitz.goSalary, 100);
  assert.equal(blitz.freeParkingPot, true, 'Blitz keeps its jackpot');
  for (const id of MONOPOLY_DAILY_BOARDS) {
    const r = monopolyDailyRules(id);
    assert.equal(r.minigames, false);
    assert.equal(r.speedDie, false);
    assert.equal(r.timeLimitMin, 0);
    assert.equal(r.maxPlayers, 1 + MONOPOLY_DAILY_BOTS);
    assert.ok(r.turnSeconds > 0, 'a turn timer keeps an idle attempt moving');
  }
});

test('the same date sets up and plays the same game for everyone; another date differs', () => {
  const a = start('md_det_a').room;
  const b = start('md_det_b').room;
  assert.notEqual(a.code, b.code);
  assert.ok(a.private && b.private, 'daily tables are private');
  assert.equal(a.mapId, monopolyDailyMap(DAY1));
  assert.deepEqual(a.rules, monopolyDailyRules(a.mapId));
  assert.equal(a.seats.length, 1 + MONOPOLY_DAILY_BOTS);
  assert.deepEqual(setup(a), setup(b), 'same board, seats, bots and Chance / Community Chest order');

  // Played the same way, the two games run exactly alike: dice, cards and every bot move.
  const ta = playOut(a);
  const tb = playOut(b);
  assert.deepEqual(logOf(a), logOf(b));
  assert.deepEqual([...ta], [...tb]);
  assert.deepEqual(a.daily!.result, b.daily!.result);
  assert.ok(a.daily!.turns > 0);

  const next = start('md_det_a', addDays(DAY1, 1)).room;
  assert.notEqual(next.mapId, a.mapId, 'the next day is another board');
  assert.equal(next.daily!.practice, false, 'a new day is a new official attempt');
  const sameBoard = start('md_det_a', addDays(DAY1, 7)).room;
  assert.equal(sameBoard.mapId, a.mapId, 'a week later, the same board…');
  assert.notDeepEqual(setup(sameBoard).decks, setup(a).decks, '…with other cards');
  next.leave('md_det_a');
  sameBoard.leave('md_det_a');
});

test('the dice go by turn alone: a player who plays differently throws the same dice on the same turn', () => {
  const D = addDays(DAY1, 2);
  const a = start('md_dice_a', D).room;
  const b = start('md_dice_b', D).room;
  const ta = playOut(a, asBot);
  const tb = playOut(b, miser);
  assert.notDeepEqual(logOf(a), logOf(b), 'the two games went differently');
  const common = [...ta.keys()].filter(t => tb.has(t));
  assert.ok(common.length >= 20, `many turns in common (${common.length})`);
  for (const t of common) assert.deepEqual(ta.get(t), tb.get(t), `turn ${t}`);
});

test('the seed never reaches a client', () => {
  const r = start('md_secret', addDays(DAY1, 3)).room;
  const seed = r.daily!.seed;
  assert.match(seed, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(r.view()).includes(seed));
  const info = daily.monopolyDailyInfo(addDays(DAY1, 3), { userId: 'md_secret', now: at(addDays(DAY1, 3)) });
  assert.ok(!JSON.stringify(info).includes(seed));
  const v = r.view().daily!;
  assert.equal(v.number, monopolyDailyNumber(addDays(DAY1, 3)));
  assert.equal(v.practice, false);
  assert.equal(v.maxTurns, MONOPOLY_DAILY_TURNS);
  assert.equal(v.turns >= 0, true);
  assert.equal(Object.keys(v).includes('seed'), false);
  r.leave('md_secret');
});

test('one official attempt a day: asking again returns the same game, then practice that is never ranked', () => {
  const D = addDays(DAY1, 4);
  const first = start('md_once', D);
  assert.equal(first.practice, false);
  assert.equal(first.resumed, false);
  const again = start('md_once', D);
  assert.equal(again.room, first.room, 'back to the game under way');
  assert.equal(again.resumed, true);
  const dealt = setup(first.room);
  playOut(first.room);
  const official = daily.monopolyDailyAttempt(D, 'md_once')!;
  assert.deepEqual(official.result, first.room.daily!.result);
  assert.equal(first.room.daily!.rank, 1, 'the result screen gets the rank');
  assert.equal(first.room.daily!.streak, 1);

  const practice = start('md_once', D);
  assert.equal(practice.practice, true);
  assert.notEqual(practice.room, first.room);
  assert.deepEqual(setup(practice.room), dealt, 'practice is the same game');
  practice.room.leave('md_once');
  assert.deepEqual(daily.monopolyDailyAttempt(D, 'md_once'), official, 'the official result stands');
  assert.equal(daily.monopolyDailyLeaders(D).length, 1, 'practice never reaches the board');
});

test('leaving the official attempt is a loss, and it cannot be played again', () => {
  const D = addDays(DAY1, 5);
  const s = start('md_leave', D);
  s.room.leave('md_leave');
  assert.equal(s.room.status, 'finished');
  const a = daily.monopolyDailyAttempt(D, 'md_leave')!;
  assert.equal(a.result!.left, true);
  assert.equal(a.result!.won, false);
  const next = start('md_leave', D);
  assert.equal(next.practice, true, 'only practice after a walk-out');
  next.room.leave('md_leave');
  assert.equal(daily.monopolyDailyAttempt(D, 'md_leave')!.result!.left, true);
});

test('going idle (three turn steps run out in a row) ends the attempt as a loss', () => {
  const D = addDays(DAY1, 6);
  const s = start('md_idle', D);
  const r = s.room;
  const g = r.game!;
  // Bots play until it is the player's turn.
  for (let i = 0; i < 500 && g.current.id !== 'md_idle'; i++) {
    const a = botAction(g, g.current.id);
    if (a) r.act(g.current.id, a.type === 'proposeTrade' ? { type: 'endTurn' } : a, true);
  }
  assert.equal(g.current.id, 'md_idle');
  // Nobody plays for them: no autopilot, however long they are gone.
  r.setConnected('md_idle', false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const room = r as any;
  assert.equal(room.automated(r.seat('md_idle'), Date.now() + 3_600_000), null);
  // Their steps run out; the bots play their own turns in between (the dice
  // decide whether three steps fit in one turn of theirs).
  for (let k = 0; k < 500 && r.status === 'playing'; k++) {
    if (g.current.id !== 'md_idle') {
      const a = botAction(g, g.current.id);
      if (a) r.act(g.current.id, a.type === 'proposeTrade' ? { type: 'endTurn' } : a, true);
      continue;
    }
    g.turnEndsAt = 0;
    if (g.clockTimeout()) room.afterChange();
  }
  assert.equal(r.status, 'finished');
  assert.equal(daily.monopolyDailyAttempt(D, 'md_idle')!.result!.left, true);
});

test('no kicking the bots, no pause, no auto-play, no trades, no rematch, no rule changes', () => {
  const D = addDays(DAY1, 8);
  const r = start('md_fair', D).room;
  const bot = r.seats.find(s => s.isBot)!;
  assert.throws(() => r.kick('md_fair', bot.id, false), /all of the day's bots/);
  assert.throws(() => r.kick('md_fair', bot.id, true), /all of the day's bots/, 'not even an operator');
  assert.throws(() => r.pause('md_fair', false, 'P'), /cannot be paused/);
  assert.throws(() => r.setAutopilot('md_fair', 'md_fair', true, false), /Nobody plays/);
  assert.throws(() => r.configure('md_fair', false, { rules: { startingCash: 99_999 } }), /already started/);
  assert.throws(() => r.addBot('md_fair', false), /already started/);
  const trade: Action = { type: 'proposeTrade', to: bot.id, give: { cash: 0, spaces: [], jailCards: 0 }, get: { cash: 1, spaces: [], jailCards: 0 } };
  assert.throws(() => r.act('md_fair', trade), /No trades/);
  assert.equal(r.seats.filter(s => s.isBot).length, MONOPOLY_DAILY_BOTS);
  r.leave('md_fair');
  assert.throws(() => r.rematch('md_fair', false, () => true), /one game/);
});

test('the turn cap: the game ends when the player\'s 20 turns are up, and the result is worked out by the server', () => {
  const D = addDays(DAY1, 7 * 2); // a Monday: Classic, where 20 turns rarely bankrupt anyone
  const r = start('md_cap', D).room;
  playOut(r);
  const res = r.daily!.result!;
  assert.ok(res.turns <= MONOPOLY_DAILY_TURNS);
  if (!res.won && !res.bankrupt) {
    assert.equal(res.turns, MONOPOLY_DAILY_TURNS);
    assert.ok(logOf(r).some(t => t.includes(`${MONOPOLY_DAILY_TURNS}th turn`)), 'the cap ended it');
    assert.equal(res.netWorth, r.game!.netWorth('md_cap'));
    assert.equal(res.place, r.game!.standings().findIndex(s => s.id === 'md_cap') + 1);
  }
  // Every bot had as many turns as the player, or one fewer if seated before them... never more.
  assert.equal(r.game!.phase, 'over');
});

test('scoring: a win beats everything (fewer turns first), then net worth after the cap, then going broke, then walking out', () => {
  const row = (r: Partial<Result>, endedAt = 0) => ({ won: false, turns: 20, netWorth: 0, place: 2, botsOut: 0, ...r, endedAt });
  const rows = [
    row({ left: true, netWorth: 9_000 }, 1),
    row({ bankrupt: true, turns: 5 }, 2),
    row({ bankrupt: true, turns: 12 }, 3),
    row({ netWorth: 1_800 }, 4),
    row({ netWorth: 2_340 }, 5),
    row({ netWorth: 2_340, turns: 19 }, 6),
    row({ won: true, turns: 18, netWorth: 5_000 }, 7),
    row({ won: true, turns: 14, netWorth: 3_000 }, 8),
    row({ won: true, turns: 14, netWorth: 4_000 }, 9),
  ];
  const order = [...rows].sort(compareMonopolyDaily).map(r => r.endedAt);
  assert.deepEqual(order, [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  // Equal in everything: whoever finished first.
  assert.ok(compareMonopolyDaily(row({ netWorth: 100 }, 1), row({ netWorth: 100 }, 2)) < 0);
});

test('streaks: consecutive days played and won, broken by a gap', () => {
  const id = 'md_streak';
  const D = addDays(DAY1, 20);
  for (const k of [0, 1, 2, 4, 5]) {
    const s = start(id, addDays(D, k));
    s.room.leave(id);
  }
  const p = daily.monopolyDailyProfile(id, at(addDays(D, 5)))!;
  assert.equal(p.played, 5);
  assert.equal(p.streaks.streak, 2, 'the gap on day 3 broke it');
  assert.equal(p.streaks.best, 3);
  assert.equal(p.streaks.winStreak, 0);
  assert.equal(p.best!.left, true);
  // Today not yet played: yesterday's streak still stands.
  assert.equal(daily.monopolyDailyProfile(id, at(addDays(D, 6)))!.streaks.streak, 2);
  assert.equal(daily.monopolyDailyProfile(id, at(addDays(D, 7)))!.streaks.streak, 0);
});

test('the share text: board, outcome, streak', () => {
  const base1 = { won: true, turns: 14, netWorth: 4_200, place: 1, botsOut: 3 };
  const thursday = '2026-11-05';
  assert.equal(monopolyDailyMap(thursday), 'blitz');
  const won = monopolyDailyShareText({ date: thursday, result: base1, streak: 3, rank: 2, of: 40, url: 'https://x/monopoly#daily' });
  assert.equal(won.split('\n')[0], `Chog Monopoly Daily #${monopolyDailyNumber(thursday)} — won on Blitz in 14 turns 🔥3`);
  assert.match(won, /#2 of 40/);
  assert.match(won, /https:\/\/x\/monopoly#daily$/);
  const fin = monopolyDailyShareText({ date: thursday, result: { won: false, turns: 20, netWorth: 2_340, place: 2, botsOut: 1 } });
  assert.equal(fin.split('\n')[0], `Chog Monopoly Daily #${monopolyDailyNumber(thursday)} — finished with $2,340 on Blitz`);
  assert.match(fin, /2nd of 4 · 1 bot broke/);
});

test('GET /api/monopoly/daily and /history', async () => {
  const D = addDays(DAY1, 40);
  clock.t = at(D);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anon = await (await fetch(`${base}/api/monopoly/daily`)).json() as any;
  assert.equal(anon.date, D);
  assert.equal(anon.today, D);
  assert.equal(anon.number, monopolyDailyNumber(D));
  assert.equal(anon.mapId, monopolyDailyMap(D));
  assert.equal(anon.turns, MONOPOLY_DAILY_TURNS);
  assert.equal(anon.bots.length, MONOPOLY_DAILY_BOTS);
  assert.equal(anon.endsAt, Date.parse(`${addDays(D, 1)}T00:00:00Z`));
  assert.deepEqual(anon.leaders, []);
  assert.equal(anon.you, undefined, 'signed out: no status');

  const token = signToken({ id: 'demo_mhttp', name: 'Http', avatar: '🎩', provider: 'demo' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = async (path: string): Promise<any> => (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal((await get('/api/monopoly/daily')).you.status, 'none');

  const s = daily.startMonopolyDaily(reg, { id: 'demo_mhttp', name: 'Http', avatar: '🎩' }, { now: clock.t });
  const playing = (await get('/api/monopoly/daily')).you;
  assert.equal(playing.status, 'playing');
  assert.equal(playing.code, s.room.code, 'the way back to the game under way');

  playOut(s.room);
  const done = await get('/api/monopoly/daily');
  assert.equal(done.you.status, 'done');
  assert.deepEqual(done.you.result, s.room.daily!.result);
  assert.equal(done.you.rank, 1);
  assert.equal(done.you.streaks.streak, 1);
  assert.equal(done.players, 1);
  assert.equal(done.leaders[0].id, 'demo_mhttp');
  assert.equal(done.bots.map((b: { name: string }) => b.name).join(), s.room.seats.filter(x => x.isBot).map(x => x.name).join());
  assert.ok(!JSON.stringify(done).includes(s.room.daily!.seed), 'no seed in the answer');

  clock.t = at(addDays(D, 1));
  const hist = await get('/api/monopoly/daily/history?days=3');
  assert.equal(hist.days.length, 3);
  assert.equal(hist.days[0].date, D);
  assert.equal(hist.days[0].mapId, monopolyDailyMap(D));
  assert.equal(hist.days[0].players, 1);
  assert.equal(hist.days[0].top.id, 'demo_mhttp');
  assert.equal(hist.days[0].you.id, 'demo_mhttp');
  assert.equal(hist.days[1].you, null);
  const past = await get(`/api/monopoly/daily?date=${D}`);
  assert.equal(past.date, D);
  assert.equal(past.leaders.length, 1);

  assert.equal((await fetch(`${base}/api/monopoly/daily?date=${addDays(D, 5)}`)).status, 400, 'no peeking at a future day');
  assert.equal((await fetch(`${base}/api/monopoly/daily?date=nonsense`)).status, 400);
  assert.equal((await fetch(`${base}/api/monopoly/daily?date=2020-01-01`)).status, 400, 'before the first daily');

  setFeatures({ leaderboard: false });
  assert.deepEqual((await (await fetch(`${base}/api/monopoly/daily`)).json() as { leaders: unknown[] }).leaders, []);
  assert.equal((await fetch(`${base}/api/monopoly/daily/history`)).status, 404);
  setFeatures({ leaderboard: true });
});

test('a restart mid-game: the restored table plays on exactly as it would have, and a lost table is a walk-out', () => {
  const D = addDays(DAY1, 50);
  const r = start('md_restore', D).room;
  // Part of the way in.
  for (let i = 0; i < 400 && r.daily!.turns < 6; i++) { if (!stepOnce(r)) break; }
  assert.ok(r.daily!.turns >= 6);
  const snap = JSON.parse(JSON.stringify(r.snapshot()));
  assert.equal(snap.daily.userId, 'md_restore');

  const twin = Room.restore(JSON.parse(JSON.stringify(snap)), { onChange() {}, onEvent() {}, onFinished() {} });
  assert.equal(twin.daily!.turns, r.daily!.turns);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((twin as any).automated(twin.seat('md_restore'), Date.now() + 3_600_000), null, 'still nobody plays for them');
  playOut(r);
  playOut(twin);
  assert.deepEqual(logOf(twin).slice(-60), logOf(r).slice(-60), 'the same dice and moves after the restart');
  assert.deepEqual(twin.daily!.result, r.daily!.result);
  twin.dispose();

  // A table that did not come back: its attempt is settled as a walk-out.
  const D2 = addDays(DAY1, 51);
  const lost = start('md_lost', D2).room;
  reg.delete(lost.code);
  daily.reconcileMonopolyDaily(reg, at(D2));
  assert.equal(daily.monopolyDailyAttempt(D2, 'md_lost')!.result!.left, true);
  // And the restored registry picks the same attempt up again when it does come back.
  const D3 = addDays(DAY1, 52);
  const kept = start('md_kept', D3).room;
  const ksnap = JSON.parse(JSON.stringify(kept.snapshot()));
  reg.delete(kept.code);
  reg.restore([ksnap]);
  daily.reconcileMonopolyDaily(reg, at(D3));
  const back = reg.get(kept.code)!;
  assert.equal(daily.monopolyDailyAttempt(D3, 'md_kept')!.result, undefined, 'still under way');
  assert.equal(start('md_kept', D3).room, back, 'the same attempt, picked up again');
  back.leave('md_kept');
});

/** One move by whoever has one (see playOut). */
function stepOnce(r: RoomT): boolean {
  const g = r.game!;
  const order = [g.current.id, ...g.players.map(p => p.id).filter(id => id !== g.current.id)];
  for (const id of order) {
    const p = g.player(id);
    if (p.bankrupt) continue;
    let a = p.isBot ? botAction(g, id) : asBot(r, id);
    if (p.isBot && a?.type === 'proposeTrade') a = { type: 'endTurn' };
    if (!a) continue;
    try { r.act(id, a, p.isBot); return true; } catch { /* next */ }
  }
  return false;
}
