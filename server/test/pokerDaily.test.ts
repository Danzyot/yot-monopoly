// The Poker Daily (src/poker/daily.ts, src/poker/spots.ts, shared/poker/daily.ts):
// the same ten hands for everyone on a date, a different ten the next day;
// hands sent one at a time and graded on the server; one official run a day
// (leaving locks it in), practice after; scoring, ranking, streaks and the
// HTTP endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-poker-daily-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';
delete process.env.POKER_DAILY_SECRET;

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const { setFeatures } = await import('../src/features.ts');
const daily = await import('../src/poker/daily.ts');
const spots = await import('../src/poker/spots.ts');
const { mountPokerDaily } = await import('../src/routes/pokerDaily.ts');
const { addDays, dayStreak } = await import('../../shared/daily.ts');
const {
  POKER_DAILY_HANDS, comparePokerDaily, gridSquare, pokerShareText, scoreMove,
} = await import('../../shared/poker/daily.ts');
type View = import('../../shared/poker/daily.ts').PokerRunView;

const DAY1 = '2026-11-02';
const at = (date: string, hour = 10, min = 0) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`);
const clock = { t: at(DAY1) };
const who = (id: string) => ({ id, name: id.toUpperCase(), avatar: '♠️' });

let server: HttpServer;
let base = '';
before(async () => {
  daily.loadPokerDaily();
  setFeatures({ leaderboard: true });
  const app = express();
  app.use(express.json());
  mountPokerDaily(app, () => clock.t);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** Every hand of a day, dealt up front (so the clock in the tests is not held up by dealing). */
async function dealDay(date: string) {
  return Promise.all(Array.from({ length: POKER_DAILY_HANDS }, (_, i) => daily.pokerDailySpot(date, i)));
}

test('scoring: 10 for the best move, less for every big blind given away', () => {
  assert.equal(scoreMove(5, [0, 5, 3]), 10);
  assert.equal(scoreMove(0, [0, 5, 3]), 0, 'giving away the whole gap scores 0');
  assert.equal(scoreMove(3, [0, 5, 3]), 6, '2 bb of a 5 bb gap given away');
  assert.equal(scoreMove(0, [0, 0.5]), 8, 'a small gap is measured against 2 bb at least');
  assert.equal(scoreMove(4.99, [0, 5]), 9, 'only the best move scores 10');
  assert.deepEqual([10, 7, 3, 0, -1].map(gridSquare), ['🟩', '🟨', '🟧', '🟥', '⬛']);
  const text = pokerShareText({ date: '2026-10-22', result: { points: 87, timeMs: 1000, grid: [10, 10, 7, 10, 0, 10, 10, 10, 10, 10] }, streak: 3, url: 'https://x/poker/daily' });
  assert.equal(text, 'Chog Poker Daily #2 — 87/100 🔥3\n🟩🟩🟨🟩🟥🟩🟩🟩🟩🟩\nhttps://x/poker/daily');
  // Ranking: points, then time, then who finished first.
  const r = (points: number, timeMs: number, endedAt: number) => ({ points, timeMs, endedAt, grid: [] });
  const sorted = [r(80, 50, 1), r(90, 99, 2), r(80, 40, 3), r(80, 40, 0)].sort(comparePokerDaily);
  assert.deepEqual(sorted.map(x => [x.points, x.timeMs, x.endedAt]), [[90, 99, 2], [80, 40, 0], [80, 40, 3], [80, 50, 1]]);
});

test('streaks: consecutive days up to today (or yesterday, today still open)', () => {
  const d = (n: number) => addDays(DAY1, n);
  assert.deepEqual(dayStreak([d(0), d(1), d(2)], d(2)), { current: 3, best: 3 });
  assert.deepEqual(dayStreak([d(0), d(1), d(2)], d(3)), { current: 3, best: 3 }, 'today not played yet: the streak stands');
  assert.deepEqual(dayStreak([d(0), d(1), d(2)], d(4)), { current: 0, best: 3 }, 'a day missed ends it');
  assert.deepEqual(dayStreak([d(0), d(2), d(3)], d(3)), { current: 2, best: 2 });
  assert.deepEqual(dayStreak([], d(0)), { current: 0, best: 0 });
});

test('the same date deals the same ten hands; another date, or another secret, deals others', async () => {
  const seed = daily.pokerDailySeed(DAY1);
  assert.equal(seed, daily.pokerDailySeed(DAY1));
  assert.notEqual(seed, daily.pokerDailySeed(addDays(DAY1, 1)));
  const a = await dealDay(DAY1);
  const again = Array.from({ length: POKER_DAILY_HANDS }, (_, i) => spots.daySpot(seed, i));
  assert.deepEqual(again, a, 'dealt afresh from the seed: identical, answers and all');
  const b = await dealDay(addDays(DAY1, 1));
  assert.notDeepEqual(b.map(x => x.spot.hole), a.map(x => x.spot.hole));

  process.env.POKER_DAILY_SECRET = 'another-secret';
  assert.notEqual(daily.pokerDailySeed(DAY1), seed, 'the secret is part of the seed');
  delete process.env.POKER_DAILY_SECRET;

  // The shape of a day: two hands before the flop, then three flops, three turns, two rivers.
  assert.deepEqual(a.map(x => x.spot.street), ['preflop', 'preflop', 'flop', 'flop', 'flop', 'turn', 'turn', 'turn', 'river', 'river']);
  assert.deepEqual(a.map(x => x.spot.board.length), [0, 0, 3, 3, 3, 4, 4, 4, 5, 5]);
  for (const { spot, answer } of [...a, ...b]) {
    const cards = [...spot.hole, ...spot.board];
    assert.equal(new Set(cards).size, cards.length, 'no card twice');
    assert.equal(spot.options[0].id, 'fold');
    assert.ok(spot.options.length >= 2 && spot.options.length <= 4);
    assert.ok(spot.toCall > 0 && spot.pot > 0 && spot.history.length >= 2 && spot.facing.startsWith('Villain'));
    const best = answer.options.find(o => o.id === answer.best)!;
    assert.equal(best.points, 10);
    assert.equal(answer.options.filter(o => o.points === 10).length, 1, 'one best move');
    assert.equal(answer.options.find(o => o.id === 'fold')!.ev, 0, 'folding is worth 0 from here');
    assert.equal(best.ev, Math.max(...answer.options.map(o => o.ev)), 'the best move has the highest EV');
    // A real decision: some equity, and the best move not miles clear of the next.
    assert.ok(answer.equity >= 0.12 && answer.equity <= 0.92, `equity ${answer.equity}`);
    const evs = answer.options.map(o => o.ev).sort((x, y) => y - x);
    assert.ok(evs[0] - evs[1] >= 0.2, 'a clear best move');
    // The call is the pot-odds sum: equity of the final pot, less the call.
    const call = answer.options.find(o => o.id === 'call');
    if (call) {
      const finalPot = spot.pot + spot.toCall;
      assert.ok(Math.abs(call.ev - (answer.equity * finalPot - spot.toCall)) < 0.05 * finalPot, 'call EV = equity × pot − call');
      assert.ok(Math.abs(answer.needed - spot.toCall / finalPot) < 0.01);
    }
  }
  // A mix of answers across a day, not ten folds.
  for (const day of [a, b]) assert.ok(new Set(day.map(x => x.answer.best)).size >= 2);
});

test('one hand at a time; graded on the server; the answer only once it is answered', async () => {
  clock.t = at(DAY1, 9);
  const day = await dealDay(DAY1);
  const me = who('pd_flow');
  let v: View = await daily.playPokerDaily(me, { now: clock.t });
  assert.equal(v.mode, 'official');
  assert.equal(v.spot!.index, 0);
  assert.deepEqual(v.spot, day[0].spot);
  assert.deepEqual(v.reveals, []);
  // Asking again: the same hand, the clock not reset.
  clock.t += 5_000;
  v = await daily.playPokerDaily(me, { now: clock.t });
  assert.equal(v.spot!.index, 0);

  // Secrecy: nothing about the answer, and no hand but this one.
  const json = JSON.stringify(v);
  for (const k of ['"ev"', '"best"', '"equity"', '"points"', '"needed"', '"range"', 'answer']) assert.ok(!json.includes(k), `no ${k} before answering`);
  for (let i = 1; i < POKER_DAILY_HANDS; i++) assert.ok(!json.includes(JSON.stringify(day[i].spot.history)), `hand ${i} not sent`);
  assert.ok(!json.includes(daily.pokerDailySeed(DAY1)));

  await assert.rejects(daily.answerPokerDaily(me, { run: 'official', index: 1, choice: 'fold' }, { now: clock.t }), /not the one in front of you/);
  await assert.rejects(daily.answerPokerDaily(me, { run: 'official', index: 0, choice: 'bluff' }, { now: clock.t }), /moves on offer/);

  clock.t += 7_000;
  const best = day[0].answer.best;
  const r = await daily.answerPokerDaily(me, { run: 'official', index: 0, choice: best }, { now: clock.t });
  assert.equal(r.reveal.points, 10);
  assert.equal(r.reveal.best, best);
  assert.ok(r.reveal.ms >= 12_000 && r.reveal.ms < 13_000, `thinking time counted from the hand being sent: ${r.reveal.ms}`);
  assert.deepEqual(r.reveal.options, day[0].answer.options);
  assert.equal(r.view.spot, null, 'the next hand waits until asked for');
  await assert.rejects(daily.answerPokerDaily(me, { run: 'official', index: 0, choice: best }, { now: clock.t }), /not the one in front of you/, 'no answering twice');

  // Reading the answer is free: the next hand's clock starts when it is sent.
  clock.t += 60_000;
  v = await daily.playPokerDaily(me, { now: clock.t });
  assert.equal(v.spot!.index, 1);
  assert.equal(v.reveals.length, 1);
  const worst = day[1].answer.options.reduce((x, y) => (y.ev < x.ev ? y : x));
  clock.t += 3_000;
  const r2 = await daily.answerPokerDaily(me, { run: 'official', index: 1, choice: worst.id }, { now: clock.t });
  assert.equal(r2.reveal.points, worst.points);
  assert.ok(worst.points < 10);
  assert.ok(r2.reveal.ms < 4_000);

  // The rest, all best.
  for (let i = 2; i < POKER_DAILY_HANDS; i++) {
    v = await daily.playPokerDaily(me, { now: clock.t });
    assert.equal(v.spot!.index, i);
    clock.t += 1_000;
    await daily.answerPokerDaily(me, { run: 'official', index: i, choice: day[i].answer.best }, { now: clock.t });
  }
  v = await daily.playPokerDaily(me, { now: clock.t });
  assert.equal(v.spot, null);
  assert.equal(v.reveals.length, POKER_DAILY_HANDS);
  assert.equal(v.result!.points, 90 + worst.points);
  assert.deepEqual(v.result!.grid, [10, worst.points, 10, 10, 10, 10, 10, 10, 10, 10]);
  assert.ok(!v.result!.left);
  assert.equal(v.rank, 1);
  assert.equal(v.streak, 1);

  // One official run a day: playing again is practice, fresh hands, never ranked.
  const p = await daily.playPokerDaily(me, { practice: true, now: clock.t });
  assert.equal(p.mode, 'practice');
  assert.notEqual(p.run, 'official');
  assert.ok(p.spot);
  assert.ok(!day.some(d => JSON.stringify(d.spot.history) === JSON.stringify(p.spot!.history) && d.spot.hole.join() === p.spot!.hole.join()), 'practice deals other hands');
  const pr = await daily.answerPokerDaily(me, { run: p.run, index: 0, choice: 'fold' }, { now: clock.t + 1000 });
  assert.equal(pr.view.mode, 'practice');
  assert.equal(pr.view.result, undefined);
  const info = daily.pokerDailyInfo(DAY1, { userId: me.id, now: clock.t });
  assert.equal(info.players, 1, 'practice is never on the board');
  assert.equal(info.you!.status, 'done');
  assert.equal(info.you!.result!.points, 90 + worst.points);
  await assert.rejects(daily.answerPokerDaily(me, { run: 'official', index: 0, choice: best }, { now: clock.t }), /over/);
});

test('leaving locks in the answers so far and scores the rest 0; so does the day ending', async () => {
  clock.t = at(DAY1, 11);
  const day = await dealDay(DAY1);
  const me = who('pd_leave');
  for (let i = 0; i < 3; i++) {
    await daily.playPokerDaily(me, { now: clock.t });
    clock.t += 2_000;
    await daily.answerPokerDaily(me, { run: 'official', index: i, choice: day[i].answer.best }, { now: clock.t });
  }
  // The fourth hand is in front of them when they go.
  await daily.playPokerDaily(me, { now: clock.t });
  clock.t += 4_000;
  assert.deepEqual(daily.leavePokerDaily(me, 'official', clock.t), { left: true });
  const v = await daily.playPokerDaily(me, { now: clock.t });
  assert.equal(v.spot, null, 'no coming back to it');
  assert.deepEqual(v.result!.grid, [10, 10, 10, -1, -1, -1, -1, -1, -1, -1], 'the hand left open scores 0, shown as not answered');
  assert.equal(v.result!.points, 30);
  assert.equal(v.result!.left, true);
  // (Less the few real milliseconds each deal took: the clock starts once the hand is dealt.)
  assert.ok(v.result!.timeMs > 9_900 && v.result!.timeMs <= 10_000, `the open hand's time still counts (${v.result!.timeMs})`);
  assert.deepEqual(daily.leavePokerDaily(me, 'official', clock.t), { left: false }, 'already over');

  // Started, never finished, and the day ended: left, as at midnight.
  const late = who('pd_late');
  clock.t = at(DAY1, 23, 50);
  await daily.playPokerDaily(late, { now: clock.t });
  daily.reconcilePokerDaily(at(addDays(DAY1, 1), 1));
  const info = daily.pokerDailyInfo(DAY1, { userId: late.id, now: at(addDays(DAY1, 1), 1) });
  assert.equal(info.you!.status, 'done');
  assert.equal(info.you!.result!.points, 0);
  assert.equal(info.you!.result!.timeMs, 10 * 60_000, 'counted to midnight');

  // Rank: the full run above the walk-outs.
  const rows = daily.pokerDailyInfo(DAY1, { now: clock.t }).leaders;
  assert.equal(rows[0].id, 'pd_flow');
  assert.ok(rows.findIndex(r => r.id === 'pd_leave') < rows.findIndex(r => r.id === 'pd_late'));
});

test('streaks across days, history and the profile panel', async () => {
  const me = who('pd_streak');
  for (const n of [1, 2, 3]) {
    const t = at(addDays(DAY1, n));
    await daily.playPokerDaily(me, { now: t });
    daily.leavePokerDaily(me, 'official', t + 1000);
  }
  const t4 = at(addDays(DAY1, 4));
  let info = daily.pokerDailyInfo(addDays(DAY1, 4), { userId: me.id, now: t4 });
  assert.equal(info.you!.status, 'none');
  assert.equal(info.you!.streaks.streak, 3, 'today still open');
  info = daily.pokerDailyInfo(addDays(DAY1, 5), { userId: me.id, now: at(addDays(DAY1, 5)) });
  assert.equal(info.you!.streaks.streak, 0);
  assert.equal(info.you!.streaks.best, 3);

  const hist = daily.pokerDailyHistory({ days: 5, userId: me.id, now: t4 });
  assert.deepEqual(hist.map(h => h.date), [3, 2, 1, 0, -1].map(n => addDays(DAY1, n)));
  assert.equal(hist[0].you!.id, me.id);
  assert.equal(hist[3].top!.id, 'pd_flow');

  const prof = daily.pokerDailyProfile(me.id, t4)!;
  assert.equal(prof.played, 3);
  assert.equal(prof.streaks.streak, 3);
  assert.equal(daily.pokerDailyProfile('nobody'), null);
  assert.equal(daily.pokerDailyProfile('pd_flow', t4)!.best!.rank, 1);
});

test('the endpoints', async () => {
  clock.t = at(addDays(DAY1, 2), 15);
  const D = addDays(DAY1, 2);
  const token = signToken({ id: 'demo_http_pd', name: 'Http', avatar: '♠️', provider: 'demo' });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const get = async (path: string, signed = true) => (await fetch(`${base}${path}`, signed ? { headers: auth } : {}));
  const post = async (path: string, body: unknown, signed = true) =>
    fetch(`${base}${path}`, { method: 'POST', headers: signed ? auth : { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const anon = await (await get('/api/poker/daily', false)).json() as any;
  assert.equal(anon.date, D);
  assert.equal(anon.hands, 10);
  assert.equal(anon.you, undefined);
  assert.equal((await post('/api/poker/daily/play', {}, false)).status, 401, 'signed in to play');

  const fresh = await (await get('/api/poker/daily')).json() as any;
  assert.equal(fresh.you.status, 'none');

  const v = await (await post('/api/poker/daily/play', {})).json() as View;
  assert.equal(v.spot!.index, 0);
  assert.ok(!JSON.stringify(v).includes('"ev"'));
  const playing = await (await get('/api/poker/daily')).json() as any;
  assert.equal(playing.you.status, 'playing');
  assert.ok(!JSON.stringify(playing).includes('"hole"'), 'the info endpoint sends no hands');

  assert.equal((await post('/api/poker/daily/answer', { run: 'official', index: 0 })).status, 400);
  assert.equal((await post('/api/poker/daily/answer', { run: 'official', index: 4, choice: 'fold' })).status, 409);
  const a = await post('/api/poker/daily/answer', { run: 'official', index: 0, choice: v.spot!.options[1].id });
  assert.equal(a.status, 200);
  const ans = await a.json() as any;
  assert.equal(ans.reveal.index, 0);
  assert.ok(typeof ans.reveal.options[0].ev === 'number');
  assert.equal(ans.view.spot, null);

  const left = await (await post('/api/poker/daily/leave', { run: 'official' })).json() as any;
  assert.deepEqual(left, { left: true });
  const done = await (await get('/api/poker/daily')).json() as any;
  assert.equal(done.you.status, 'done');
  assert.equal(done.you.answered, 1);
  assert.equal(done.leaders.find((r: any) => r.id === 'demo_http_pd').grid.filter((x: number) => x >= 0).length, 1);

  const prac = await (await post('/api/poker/daily/play', { practice: true })).json() as View;
  assert.equal(prac.mode, 'practice');

  const hist = await (await get('/api/poker/daily/history?days=3')).json() as any;
  assert.equal(hist.days.length, 3);
  assert.equal(hist.days[0].date, addDays(D, -1));
  const prof = await (await get('/api/players/demo_http_pd/poker-daily', false)).json() as any;
  assert.equal(prof.profile.played, 1);

  assert.equal((await get(`/api/poker/daily?date=${addDays(D, 1)}`)).status, 400, 'no peeking at a future day');
  assert.equal((await get('/api/poker/daily?date=nonsense')).status, 400);
  assert.equal((await get('/api/poker/daily?date=2020-01-01')).status, 400);
  const past = await (await get(`/api/poker/daily?date=${DAY1}`)).json() as any;
  assert.equal(past.leaders[0].id, 'pd_flow');

  setFeatures({ leaderboard: false });
  assert.deepEqual((await (await get('/api/poker/daily')).json() as any).leaders, []);
  assert.equal((await get('/api/poker/daily/history')).status, 404);
  assert.equal((await get('/api/players/demo_http_pd/poker-daily')).status, 404);
  setFeatures({ leaderboard: true });
});

test('erasing a player takes their runs', () => {
  assert.ok(daily.erasePokerDaily('pd_streak') === 3);
  assert.equal(daily.pokerDailyProfile('pd_streak'), null);
});
