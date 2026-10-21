// The Cards Daily Challenge (src/cards/daily.ts, CardsRoom.setupDaily): one
// seeded deal per UTC day against the same bots, one official attempt per
// account per day (leaving is a loss, asking again goes back to the same
// game), practice after that, the day's leaderboard, streaks across days and
// the HTTP endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-cards-daily-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const { setFeatures } = await import('../src/features.ts');
const { CardsRegistry } = await import('../src/cards/rooms.ts');
const { cardsBotAction } = await import('../src/cards/bot.ts');
const { recordCardsResult } = await import('../src/cards/stats.ts');
const daily = await import('../src/cards/daily.ts');
const { mountCardsDaily } = await import('../src/routes/cardsDaily.ts');
const {
  CARDS_DAILY_BOTS, CARDS_DAILY_RULES, addDays, compareDaily, dailyNumber, dailyShareText, dailyStreaks,
} = await import('../../shared/cards/daily.ts');
type CardsRoom = InstanceType<typeof CardsRegistry>['rooms'] extends Map<string, infer R> ? R : never;
type Row = import('../../shared/cards/daily.ts').CardsDailyRow;

const DAY1 = '2026-11-02';
const at = (date: string, hour = 10) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
/** The game clock of every table here: moved on by hand, so catch windows always pass. */
const clock = { t: at(DAY1) };

const reg = new CardsRegistry({
  onChange() {}, onEvent() {},
  onFinished(r) { recordCardsResult(r); daily.settleCardsDaily(r, clock.t); },
  onEnded(r) { daily.settleCardsDaily(r, clock.t); },
}, 1e9, { now: () => clock.t });

const member = (id: string) => ({ id, name: id.toUpperCase(), avatar: '🃏' });
const start = (id: string, date = DAY1) => daily.startCardsDaily(reg, member(id), { now: at(date) });

/** Every seat (the player too) plays the bot's move, first come first served, until the match is over. */
function playOut(r: CardsRoom) {
  for (let i = 0; i < 5_000 && r.status === 'playing'; i++) {
    clock.t += 1_500;
    const g = r.game!;
    let moved = false;
    for (const p of g.players) {
      const a = cardsBotAction(g, p.id);
      if (!a) continue;
      try { r.act(p.id, a, p.isBot); moved = true; break; } catch { /* another seat's move */ }
    }
    if (!moved) break;
  }
  assert.equal(r.status, 'finished', 'the deal was played out');
}

/** The deal as dealt, with the player's own id written as "you" so two players' deals compare. */
function deal(r: CardsRoom) {
  const g = r.game!;
  const you = r.daily!.userId;
  return {
    seats: g.players.map(p => (p.id === you ? 'you' : `${p.id}:${p.name}:${p.level}`)),
    hands: g.players.map(p => p.hand.map(c => c.id)),
    pile: g.pile.map(c => c.id),
    discard: g.discard.map(c => c.id),
    current: g.currentIdx,
    color: g.color,
  };
}
const asYou = (r: CardsRoom, v: unknown) => JSON.parse(JSON.stringify(v).split(r.daily!.userId).join('you').split(r.seat(r.daily!.userId)!.name).join('YOU'));

let server: HttpServer;
let base = '';
before(async () => {
  daily.loadCardsDaily();
  setFeatures({ leaderboard: true, bots: true });
  const app = express();
  mountCardsDaily(app, reg, () => clock.t);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  for (const code of [...reg.rooms.keys()]) reg.delete(code);
});

test('the same date deals the same game to everyone; another date deals another', () => {
  const a = start('dc_det_a').room;
  const b = start('dc_det_b').room;
  assert.notEqual(a.code, b.code);
  assert.ok(a.private && b.private, 'daily tables are private');
  assert.deepEqual(a.rules, CARDS_DAILY_RULES);
  assert.equal(a.rules.mode, 'classic');
  assert.equal(a.rules.match, 'single');
  assert.equal(a.seats.length, 1 + CARDS_DAILY_BOTS);
  assert.ok(a.seats.filter(s => s.isBot).every(s => s.level === 'normal'), 'every bot at the fixed level');
  assert.deepEqual(deal(a), deal(b), 'same seats, same hands, same deck order');

  // Played the same way, the two games run exactly alike (bots and reshuffles included).
  playOut(a);
  playOut(b);
  assert.deepEqual(asYou(a, a.game!.history), asYou(b, b.game!.history));
  assert.deepEqual(asYou(a, a.game!.log.map(e => e.text)), asYou(b, b.game!.log.map(e => e.text)));
  assert.equal(a.daily!.turns, b.daily!.turns);
  assert.deepEqual(a.daily!.result, b.daily!.result);
  assert.ok(a.daily!.turns > 0);

  const next = start('dc_det_a', addDays(DAY1, 1)).room;
  assert.notDeepEqual(deal(next).hands, deal(a).hands, 'the next day deals other cards');
  assert.equal(next.daily!.practice, false, 'a new day is a new official attempt');
  next.leave('dc_det_a');
});

test('the seed never reaches a client', () => {
  const r = start('dc_secret').room;
  const seed = r.daily!.seed;
  assert.match(seed, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(r.view('dc_secret')).includes(seed));
  assert.ok(!JSON.stringify(r.view()).includes(seed));
  const v = r.view('dc_secret').daily!;
  assert.equal(v.number, dailyNumber(DAY1));
  assert.equal(v.practice, false);
  r.leave('dc_secret');
});

test('one official attempt a day: asking again returns the same game, then practice that is never ranked', () => {
  const first = start('dc_once');
  assert.equal(first.practice, false);
  assert.equal(first.resumed, false);
  const dealt = deal(first.room);
  assert.equal(daily.cardsDailyAttempt(DAY1, 'dc_once')!.code, first.room.code, 'recorded the moment it is dealt');

  const again = start('dc_once');
  assert.equal(again.room, first.room, 'the official game, not a new deal');
  assert.equal(again.resumed, true);

  playOut(first.room);
  const rec = daily.cardsDailyAttempt(DAY1, 'dc_once')!;
  assert.ok(rec.result, 'recorded when the round ended');
  assert.deepEqual(rec.result, first.room.daily!.result);
  assert.ok(first.room.daily!.rank! >= 1, 'the table learns its rank');
  assert.equal(first.room.daily!.streak, 1);
  assert.throws(() => first.room.rematch('dc_once', false, () => true), /one deal/);

  const practice = start('dc_once');
  assert.equal(practice.practice, true);
  assert.notEqual(practice.room.code, first.room.code);
  assert.equal(practice.room.view('dc_once').daily!.practice, true);
  assert.deepEqual(deal(practice.room), dealt, 'the same deal again');
  playOut(practice.room);
  assert.deepEqual(daily.cardsDailyAttempt(DAY1, 'dc_once')!.result, rec.result, 'practice changes nothing');
  assert.equal(practice.room.daily!.rank, undefined, 'practice is not ranked');
  assert.equal(daily.cardsDailyLeaders(DAY1).filter(r => r.id === 'dc_once').length, 1);
});

test('leaving the official attempt is a loss, and it cannot be dealt again', () => {
  const s = start('dc_quit');
  const r = s.room;
  assert.throws(() => r.pause('dc_quit', false, 'QUIT'), /cannot be paused/);
  assert.throws(() => r.setAutopilot('dc_quit', 'dc_quit', true, false), /for you/);
  r.leave('dc_quit');
  assert.equal(r.status, 'finished', 'the table stops there');
  const res = daily.cardsDailyAttempt(DAY1, 'dc_quit')!.result!;
  assert.equal(res.won, false);
  assert.equal(res.left, true);
  assert.equal(r.view('dc_quit').daily!.result!.left, true);

  // Coming back: the seat is there, the game is not.
  r.join(member('dc_quit'));
  assert.equal(r.status, 'finished');
  const after = start('dc_quit');
  assert.equal(after.practice, true, 'the day is used up: practice only');
  after.room.leave('dc_quit');
  assert.deepEqual(daily.cardsDailyAttempt(DAY1, 'dc_quit')!.result, res, 'walking out of practice changes nothing');
  const rows = daily.cardsDailyLeaders(DAY1);
  const quit = rows.find(x => x.id === 'dc_quit')!;
  assert.ok(rows.filter(x => !x.left).every(x => x.rank < quit.rank), 'walk-outs rank below every finished attempt');
});

test('a table that is lost or swept while the attempt runs counts as a walk-out', () => {
  const lost = start('dc_lost').room;
  reg.delete(lost.code); // a restart that did not bring it back
  daily.reconcileCardsDaily(reg, clock.t);
  assert.equal(daily.cardsDailyAttempt(DAY1, 'dc_lost')!.result!.left, true);
  assert.equal(start('dc_lost').practice, true);

  const idle = start('dc_idle').room;
  idle.end('nobody has been at the table for 30 minutes');
  assert.equal(daily.cardsDailyAttempt(DAY1, 'dc_idle')!.result!.left, true);

  // Disconnected, nobody plays for them: no autopilot at a daily table.
  const away = start('dc_away').room;
  away.setConnected('dc_away', false);
  assert.equal(away.automated(away.seat('dc_away')!, clock.t + 10 * 60_000), null);
  away.leave('dc_away');
});

test('the leaderboard ranks wins by fewest turns, then points; losses by points left in hand', () => {
  const row = (id: string, o: Partial<Row>): Row => ({
    id, name: id, endedAt: 0, rank: 0, won: false, turns: 10, points: 0, handPoints: 0, cards: 0, oppCards: 0, ...o,
  });
  const rows = [
    row('loss-close', { handPoints: 4, cards: 1, endedAt: 1 }),
    row('win-slow', { won: true, turns: 15, points: 90 }),
    row('walked', { left: true, endedAt: 0 }),
    row('win-fast-small', { won: true, turns: 9, points: 20 }),
    row('loss-far', { handPoints: 80, cards: 9 }),
    row('win-fast-big', { won: true, turns: 9, points: 75, endedAt: 5 }),
    row('win-fast-big-later', { won: true, turns: 9, points: 75, endedAt: 6 }),
    row('loss-close-later', { handPoints: 4, cards: 1, endedAt: 2 }),
  ];
  assert.deepEqual(rows.sort(compareDaily).map(r => r.id), [
    'win-fast-big', 'win-fast-big-later', 'win-fast-small', 'win-slow', 'loss-close', 'loss-close-later', 'loss-far', 'walked',
  ]);

  // The stored day: best first, ranks 1..n, in that same order.
  const day = daily.cardsDailyLeaders(DAY1);
  assert.ok(day.length >= 4);
  day.forEach((r, i) => {
    assert.equal(r.rank, i + 1);
    if (i) assert.ok(compareDaily(day[i - 1], r) <= 0);
  });
});

test('streaks: consecutive days played and won, broken by a gap', () => {
  const d = (k: number) => addDays(DAY1, k);
  // Played days 0, 1, 2, then 4, 5; won 0, 1, 4, 5.
  const played = [d(0), d(1), d(2), d(4), d(5)];
  const won = [d(0), d(1), d(4), d(5)];
  assert.deepEqual(dailyStreaks(played, won, d(5)), { streak: 2, best: 3, winStreak: 2, bestWin: 2 });
  assert.deepEqual(dailyStreaks(played, won, d(6)), { streak: 2, best: 3, winStreak: 2, bestWin: 2 }, 'today still open: yesterday keeps it alive');
  assert.deepEqual(dailyStreaks(played, won, d(7)), { streak: 0, best: 3, winStreak: 0, bestWin: 2 }, 'a whole day missed ends it');
  assert.equal(dailyStreaks([d(0), d(1)], [d(0)], d(1)).winStreak, 0, 'a loss today ends the win streak at once');
  assert.deepEqual(dailyStreaks([], [], d(0)), { streak: 0, best: 0, winStreak: 0, bestWin: 0 });

  // Through the store: official attempts on days 10, 11, then 13 (walked out of: still played).
  for (const k of [10, 11, 13]) start('dc_streak', d(k)).room.leave('dc_streak');
  const info = (k: number) => daily.cardsDailyInfo(d(k), { userId: 'dc_streak', now: at(d(k), 20) }).you!;
  assert.equal(info(11).streaks.streak, 2);
  assert.equal(info(13).streaks.streak, 1, 'day 12 was missed');
  assert.equal(info(13).streaks.best, 2);
  assert.equal(info(14).streaks.streak, 1, 'day 14 is not over yet');
  assert.equal(info(15).streaks.streak, 0);

  const prof = daily.cardsDailyProfile('dc_streak', at(d(13), 20))!;
  assert.equal(prof.played, 3);
  assert.equal(prof.wins, 0);
  assert.equal(prof.streaks.streak, 1);
  assert.equal(prof.best!.left, true);
  assert.equal(daily.cardsDailyProfile('dc_nobody'), null);
});

test('the share text: day number, outcome and streak', () => {
  const text = dailyShareText({
    date: '2026-11-01', streak: 3, rank: 4, of: 120, url: 'https://example.test/cards',
    result: { won: true, turns: 14, points: 87, handPoints: 0, cards: 0, oppCards: 17 },
  });
  assert.equal(text.split('\n')[0], `Chog Cards Daily #${dailyNumber('2026-11-01')} — won in 14 turns 🔥3`);
  assert.match(text, /\+87 pts · #4 of 120/);
  const lost = dailyShareText({ date: '2026-11-01', result: { won: false, turns: 20, points: 0, handPoints: 23, cards: 3, oppCards: 9 } });
  assert.match(lost, /lost with 23 points in hand/);
});

test('GET /api/cards/daily and /history', async () => {
  const D = addDays(DAY1, 30);
  clock.t = at(D);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anon = await (await fetch(`${base}/api/cards/daily`)).json() as any;
  assert.equal(anon.date, D);
  assert.equal(anon.today, D);
  assert.equal(anon.number, dailyNumber(D));
  assert.equal(anon.bots.length, CARDS_DAILY_BOTS);
  assert.equal(anon.endsAt, Date.parse(`${addDays(D, 1)}T00:00:00Z`));
  assert.deepEqual(anon.leaders, []);
  assert.equal(anon.you, undefined, 'signed out: no status');

  const token = signToken({ id: 'demo_http', name: 'Http', avatar: '🃏', provider: 'demo' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = async (path: string): Promise<any> => (await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal((await get('/api/cards/daily')).you.status, 'none');

  const s = daily.startCardsDaily(reg, { id: 'demo_http', name: 'Http', avatar: '🃏' }, { now: clock.t });
  const playing = (await get('/api/cards/daily')).you;
  assert.equal(playing.status, 'playing');
  assert.equal(playing.code, s.room.code, 'the way back to the game under way');

  playOut(s.room);
  const done = await get('/api/cards/daily');
  assert.equal(done.you.status, 'done');
  assert.deepEqual(done.you.result, s.room.daily!.result);
  assert.equal(done.you.rank, 1);
  assert.equal(done.you.streaks.streak, 1);
  assert.equal(done.players, 1);
  assert.equal(done.leaders[0].id, 'demo_http');
  assert.equal(done.bots.map((b: { name: string }) => b.name).join(), s.room.seats.filter(x => x.isBot).map(x => x.name).join());

  // The next day: yesterday is history, with the player's own row.
  clock.t = at(addDays(D, 1));
  const hist = await get('/api/cards/daily/history?days=3');
  assert.equal(hist.days.length, 3);
  assert.equal(hist.days[0].date, D);
  assert.equal(hist.days[0].players, 1);
  assert.equal(hist.days[0].top.id, 'demo_http');
  assert.equal(hist.days[0].you.id, 'demo_http');
  assert.equal(hist.days[1].you, null);
  const past = await get(`/api/cards/daily?date=${D}`);
  assert.equal(past.date, D);
  assert.equal(past.leaders.length, 1);

  assert.equal((await fetch(`${base}/api/cards/daily?date=${addDays(D, 5)}`)).status, 400, 'no peeking at a future day');
  assert.equal((await fetch(`${base}/api/cards/daily?date=nonsense`)).status, 400);
  assert.equal((await fetch(`${base}/api/cards/daily?date=2020-01-01`)).status, 400, 'before the first daily');

  setFeatures({ leaderboard: false });
  assert.deepEqual((await (await fetch(`${base}/api/cards/daily`)).json() as { leaders: unknown[] }).leaders, [], 'leaderboards ride on the leaderboard switch');
  assert.equal((await fetch(`${base}/api/cards/daily/history`)).status, 404);
  setFeatures({ leaderboard: true });
});

test('a restored daily table keeps its player, its count and its seeded shuffle', () => {
  clock.t = at(addDays(DAY1, 40));
  const r = daily.startCardsDaily(reg, member('dc_restore'), { now: clock.t }).room;
  const snap = JSON.parse(JSON.stringify(r.snapshot()));
  assert.ok(snap.daily && snap.daily.userId === 'dc_restore');
  reg.delete(r.code);
  reg.restore([snap]);
  const back = reg.get(r.code)!;
  assert.equal(back.daily!.userId, 'dc_restore');
  assert.equal(back.daily!.turns, r.daily!.turns);
  assert.equal(back.automated(back.seat('dc_restore')!, clock.t + 3_600_000), null, 'still nobody plays for them');
  // The same attempt, picked up again.
  assert.equal(daily.startCardsDaily(reg, member('dc_restore'), { now: clock.t }).room, back);
  back.leave('dc_restore');
});
