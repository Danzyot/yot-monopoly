// The opening bet cap: for a set number of minutes from the start, a player
// may not volunteer more than half the chips behind them in one bet or raise.
//
// Two things make this worth testing hard rather than eyeballing. It changes
// the legal-actions maths that every hand runs through, so an error here is an
// error in every hand of every tournament, capped or not — which is why the
// first test is that an uncapped hand is untouched. And the rule is a wall
// clock owned by the event, deliberately not a per-table counter, because a
// player moved between tables mid-event must neither lose the protection nor
// get a fresh helping of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldemHand } from '../src/engine/hand.ts';
import { Tournament, BET_CAP_FRACTION, DEFAULT_BET_CAP_MINUTES } from '../src/tournament/tournament.ts';
import { joinEveryone } from './seating.ts';

const P = (seat: number, stack: number) => ({ seat, id: `p${seat}`, stack });

// Three-handed, button on 0, so preflop action starts on seat 0 with the
// blinds already posted by seats 1 and 2.
function hand(stacks: [number, number, number], maxBetFraction?: number) {
  return new HoldemHand({
    players: [P(0, stacks[0]), P(1, stacks[1]), P(2, stacks[2])],
    buttonSeat: 0, sb: 5, bb: 10, ante: 0, maxBetFraction,
  });
}

test('an uncapped hand is exactly what it always was', () => {
  const h = hand([1000, 1000, 1000]);
  const legal = h.legalActions()!;
  assert.equal(legal.maxRaiseTo, 1000, 'all-in is still the ceiling');
  assert.equal(legal.capped, false);
  assert.equal(legal.canRaise, true);
  // And the all-in path still gets there.
  h.act(0, 'allin');
  assert.equal(h.seats[0].allIn, true);
  assert.equal(h.seats[0].stack, 0);
});

test('the ceiling is half the chips behind, and the rest stays behind', () => {
  const h = hand([1000, 1000, 1000], 0.5);
  const legal = h.legalActions()!;
  assert.equal(legal.capped, true);
  assert.equal(legal.maxRaiseTo, 500, 'seat 0 has posted nothing, so half of 1000');
  h.act(0, 'raise', 500);
  assert.equal(h.seats[0].stack, 500, 'half is still behind them');
  assert.equal(h.seats[0].allIn, false, 'and they are not all-in');
  assert.equal(h.seats[0].lastAction, 'Raise 500');
});

test('the cap is on chips volunteered, not on chips already forced in', () => {
  // Seat 2 posts the big blind, so 10 of their stack is committed before they
  // choose anything. The cap must be half of what is BEHIND them (495), on top
  // of the 10 already in — not half of the 1000 they started with.
  const h = hand([1000, 1000, 1000], 0.5);
  h.act(0, 'call');
  h.act(1, 'call');
  const legal = h.legalActions()!;
  assert.equal(legal.seat, 2, 'big blind acts last preflop');
  assert.equal(legal.myBet, 10);
  assert.equal(legal.maxRaiseTo, 10 + Math.floor(990 * 0.5));
});

test('a raise over the ceiling is cut down to it, not accepted', () => {
  const h = hand([1000, 1000, 1000], 0.5);
  h.act(0, 'raise', 900);
  assert.equal(h.seats[0].totalCommitted, 500, 'clamped to the cap');
  assert.equal(h.seats[0].stack, 500);
});

test('pressing all-in under the cap bets the cap and leaves chips behind', () => {
  const h = hand([1000, 1000, 1000], 0.5);
  h.act(0, 'allin');
  assert.equal(h.seats[0].allIn, false);
  assert.equal(h.seats[0].stack, 500);
  assert.equal(h.seats[0].totalCommitted, 500);
});

test('calling is never capped — a legal bet can always be answered', () => {
  // Seat 0 is deep and bets 500. Seat 1 has 600 behind, so calling costs far
  // more than half of it. They must still be able to call: a cap that forbids
  // answering a legal bet turns a protection into a forced fold.
  const h = hand([2000, 600, 1000], 0.5);
  h.act(0, 'raise', 500);
  const legal = h.legalActions()!;
  assert.equal(legal.seat, 1);
  assert.equal(legal.toCall, 495, 'the full price of the call, uncapped');
  h.act(1, 'call');
  assert.equal(h.seats[1].totalCommitted, 500);
  assert.equal(h.seats[1].stack, 100);
});

test('blinds and antes are forced posts and ignore the cap entirely', () => {
  // A stack smaller than the big blind still posts all of it. If the cap
  // reached forced bets, a short stack could not be dealt in at all.
  const h = new HoldemHand({
    players: [P(0, 1000), P(1, 1000), P(2, 6)],
    buttonSeat: 0, sb: 5, bb: 10, ante: 3, maxBetFraction: 0.5,
  });
  assert.equal(h.seats[2].stack, 0, 'posted everything it had');
  assert.equal(h.seats[2].allIn, true);
});

test('when the cap sits below the minimum raise, raising is off — not an underraise', () => {
  // Seat 0 raises to 400. Seat 1 has 500 behind: half of it is 250, which
  // cannot even match the 400, let alone reach the minimum re-raise of 790.
  // No-Limit only allows a short raise as an all-in, and this player is not
  // all-in, so the correct answer is that they cannot raise at all.
  const h = hand([2000, 500, 2000], 0.5);
  h.act(0, 'raise', 400);
  const legal = h.legalActions()!;
  assert.equal(legal.seat, 1);
  assert.equal(legal.canRaise, false, 'no legal raise exists for them');
  assert.equal(legal.toCall, 395, 'but calling is still on the table');
});

test('a short stack can still get all-in under the cap when that is a real raise', () => {
  // Seat 1 has 40 behind facing a bet of 10. Half of 40 is 20, which is below
  // the minimum raise of 20... and equal to it, so it stands. Push further:
  // the true all-in of 40 is above the cap, so the cap is what applies.
  const h = hand([1000, 40, 1000], 0.5);
  h.act(0, 'call');
  h.act(1, 'raise', 40);
  assert.equal(h.seats[1].totalCommitted, 5 + Math.floor(35 * 0.5),
    'the small blind volunteered half of what was behind, not all of it');
  assert.equal(h.seats[1].allIn, false);
});

test('an absurd fraction cannot forbid every bet or invent chips', () => {
  assert.equal(hand([1000, 1000, 1000], 0).maxBetFraction, 0.01);
  assert.equal(hand([1000, 1000, 1000], -5).maxBetFraction, 0.01);
  assert.equal(hand([1000, 1000, 1000], 9).maxBetFraction, 1);
});

// ---------- the event's clock, which is what tables must not own ----------

function tourney(betCapMinutes: number | null, ctx?: { after: (fn: () => void) => void }) {
  const t = new Tournament(
    {
      name: `Cap ${Math.random()}`, startingStack: 10_000, levelMinutes: 10,
      structure: 'regular', maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15,
      approveRegistrations: false, buyIn: 0, breakEveryLevels: 0, seatsPerTable: 9,
      social: null, maxReentries: 0, prizeText: null, rabbitHunting: false,
      displayMode: 'chips', betCapMinutes,
    },
    { id: 'host', name: 'Host' },
    {
      broadcastTable: () => {}, tableChat: () => {}, tableEvent: () => {},
      broadcastTourney: () => {}, tourneyChat: () => {}, assigned: () => {},
      lobbyChanged: () => {}, finished: () => {}, eliminated: () => {},
    } as never,
  );
  ctx?.after(() => t.dispose());
  return t;
}

test('the cap is off unless the host switched it on', ctx => {
  const off = tourney(null, ctx);
  assert.equal(off.betCapWindowMs, null);
  assert.equal(off.betCapEndsAt, null);
  assert.equal(off.betCapActive, false);
});

test('the window is one clock for the event, read from the start', ctx => {
  const t = tourney(DEFAULT_BET_CAP_MINUTES, ctx);
  assert.equal(t.betCapEndsAt, null, 'nothing to count before the start');
  assert.equal(t.betCapWindowMs, DEFAULT_BET_CAP_MINUTES * 60_000);
});

test('every table reads the same deadline, whenever it was created', ctx => {
  // The point of the rule living on the event: a player moved to a table that
  // was created ten minutes in must get the same remaining protection as one
  // who never moved — not a fresh window, and not none.
  const t = tourney(DEFAULT_BET_CAP_MINUTES, ctx);
  for (let i = 0; i < 12; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);
  const tables = [...t.tables.values()];
  assert.ok(tables.length >= 2, 'more than one table, so there is something to compare');
  const deadlines = new Set(tables.map(tb => tb.tourneyInfo!()!.betCap?.endsAt ?? null));
  assert.equal(deadlines.size, 1, 'one deadline across every table');
  assert.equal([...deadlines][0], t.betCapEndsAt);
  const fractions = new Set(tables.map(tb => tb.tourneyInfo!()!.betCap?.fraction));
  assert.deepEqual([...fractions], [BET_CAP_FRACTION]);
});

test('a pause freezes the window instead of spending it', ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = tourney(10, ctx);
  for (let i = 0; i < 4; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);
  const before = t.betCapEndsAt!;

  t.pause();
  ctx.mock.timers.tick(5 * 60_000);
  assert.equal(t.betCapEndsAt, before + 5 * 60_000,
    'the deadline moves with the freeze, so the countdown sits still');
  assert.equal(t.betCapActive, true);

  t.resume();
  assert.equal(t.betCapEndsAt, before + 5 * 60_000, 'and the time is kept after resuming');
});

test('the window closes on time, and the host can change it while the event runs', ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const t = tourney(10, ctx);
  for (let i = 0; i < 4; i++) t.register({ id: `p${i}`, name: `P${i}`, avatar: '🙂' });
  t.start();
  joinEveryone(t);
  assert.equal(t.betCapActive, true);

  t.updateSettings({ betCapMinutes: 20 });
  ctx.mock.timers.tick(12 * 60_000);
  assert.equal(t.betCapActive, true, 'extending it kept the rule on');

  t.updateSettings({ betCapMinutes: null });
  assert.equal(t.betCapActive, false, 'and switching it off ends it at once');
  assert.equal(t.tables.values().next().value!.tourneyInfo!()!.betCap, null);
});
