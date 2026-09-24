// Game rules & timing: turn timer, AFK, pause, game length, official-rule
// fixes, the Speed Die and operator fixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUCTION_MS, Game, type GameSnapshot } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { Room, type RoomHooks } from '../src/rooms.ts';
import { DEFAULT_RULES, resolveTheme } from '../../shared/themes.ts';
import { SPEED_FACES } from '../../shared/types.ts';
import { scripted } from './helpers.ts';

const CLASSIC = resolveTheme('classic', 'classic');
const face = (f: (typeof SPEED_FACES)[number]) => SPEED_FACES.indexOf(f);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Houses and hotels on the board plus the bank's supply always make 32 / 12. */
function assertSupply(g: Game) {
  const houses = Object.values(g.owned).reduce((s, o) => s + (o.houses < 5 ? o.houses : 0), 0);
  const hotels = Object.values(g.owned).filter(o => o.houses === 5).length;
  assert.equal(houses + g.housesLeft, 32, 'house supply');
  assert.equal(hotels + g.hotelsLeft, 12, 'hotel supply');
}

/** Each deck's Get Out of Jail Free card is either in the deck or in exactly one hand. */
function assertJailCards(g: Game) {
  for (const deck of ['chance', 'chest'] as const) {
    const cards = deck === 'chance' ? g.theme.chance : g.theme.chest;
    const idx = cards.findIndex(c => c.effect.type === 'jailFree');
    const inDeck = g.decks[deck].filter(i => i === idx).length;
    const held = g.players.reduce((s, p) => s + p.jailCards.filter(d => d === deck).length, 0);
    assert.equal(inDeck + held, 1, `${deck} jail card count`);
  }
}

// ---- turn timer -------------------------------------------------------------

test('turn timer: roll, buy and done each time out to the safe default', () => {
  const { g, dice, tick, now, act } = scripted(2, { turnSeconds: 60 });
  assert.equal(g.turnEndsAt, now() + 60_000);
  tick(59_999);
  assert.equal(g.clockTimeout(), false, 'not yet');
  dice(1, 2);
  tick(1);
  assert.equal(g.clockTimeout(), true);
  assert.equal(g.player('p0').position, 3, 'rolled for them');
  assert.equal(g.phase, 'buy');
  assert.equal(g.turnEndsAt, now() + 60_000, 'a new step gets a full window');
  assert.ok(!g.player('p0').afk);

  tick(60_000);
  g.clockTimeout();
  assert.equal(g.phase, 'auction', 'declined (never buys for them)');
  assert.equal(g.owned[3], undefined);
  assert.equal(g.player('p0').cash, 1500);
  assert.equal(g.turnEndsAt, null, 'auctions run their own clock');
  assert.equal(g.player('p0').afk, true, 'two timeouts in a row: away');

  tick(AUCTION_MS);
  g.auctionTimeout();
  assert.equal(g.phase, 'done');
  assert.equal(g.turnEndsAt, now() + 60_000);
  tick(60_000);
  g.clockTimeout();
  assert.equal(g.current.id, 'p1', 'ended the turn');

  // Acting yourself clears the away flag; autopilot moves (auto) do not.
  act('p1', { type: 'proposeTrade', to: 'p0', give: { cash: 1, spaces: [], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } });
  g.apply('p0', { type: 'rejectTrade', id: g.trades[0].id }, { auto: true });
  assert.equal(g.player('p0').afk, true, 'an autopilot move is not the player coming back');
  act('p1', { type: 'proposeTrade', to: 'p0', give: { cash: 1, spaces: [], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } });
  act('p0', { type: 'rejectTrade', id: g.trades[0].id });
  assert.equal(g.player('p0').afk, false, 'any own action clears afk');
});

test('turn timer: in jail a timeout rolls for doubles instead of paying', () => {
  const { g, dice, tick } = scripted(2, { turnSeconds: 30 });
  const p0 = g.player('p0');
  p0.inJail = true;
  p0.position = 10;
  dice(1, 2);
  tick(30_000);
  g.clockTimeout();
  assert.equal(p0.inJail, true);
  assert.equal(p0.jailTurns, 1);
  assert.equal(p0.cash, 1500, 'no fine paid');
  assert.equal(g.phase, 'done');
});

test('turn timer: off, and never for bots', () => {
  const off = scripted(2, { turnSeconds: 0 }).g;
  assert.equal(off.turnEndsAt, null);
  assert.equal(off.clockDeadline(), null);
  const bots = new Game({
    theme: CLASSIC, rules: { ...DEFAULT_RULES, turnSeconds: 30 }, now: () => 0,
    players: ['a', 'b'].map(id => ({ id, name: id, character: 'spiky' as const, color: '#fff', isBot: true })),
  });
  assert.equal(bots.turnEndsAt, null);
  assert.equal(bots.clockDeadline(), null);
});

test('debt deadline: pays by mortgaging when that covers it, else bankruptcy', () => {
  {
    const { g, dice, tick, now } = scripted(2, { turnSeconds: 30 });
    const p0 = g.player('p0');
    g.owned[1] = { owner: 'p1', houses: 5, mortgaged: false };
    g.hotelsLeft--;
    g.owned[39] = { owner: 'p0', houses: 0, mortgaged: false };
    p0.cash = 0;
    p0.position = 39;
    dice(1, 1); // passes GO (+200), lands on a 250 hotel, doubles
    g.apply('p0', { type: 'roll' });
    assert.equal(g.debtOf('p0'), 250);
    assert.equal(g.debtEndsAt.p0, now() + 60_000, 'two turn-lengths to pay');
    tick(30_000);
    g.clockTimeout();
    assert.equal(g.turnEndsAt, null, 'the turn waits on the debt');
    assert.equal(g.clockDeadline(), g.debtEndsAt.p0, 'no busy loop on a stalled step');
    tick(30_000);
    g.clockTimeout();
    assert.equal(g.owned[39].mortgaged, true);
    assert.equal(g.debtOf('p0'), 0);
    assert.equal(p0.cash, 150);
    assert.equal(g.player('p1').cash, 1750);
    assert.equal(g.debtEndsAt.p0, undefined);
    assert.equal(g.turnEndsAt, now() + 30_000, 'a fresh window once the debt is sorted');
  }
  {
    const { g, dice, tick } = scripted(2, { turnSeconds: 30 });
    g.owned[3] = { owner: 'p1', houses: 5, mortgaged: false };
    g.hotelsLeft--;
    g.player('p0').cash = 100;
    dice(1, 2);
    g.apply('p0', { type: 'roll' });
    assert.equal(g.debtOf('p0'), 450);
    tick(60_000);
    g.clockTimeout();
    assert.equal(g.player('p0').bankrupt, true);
    assert.equal(g.winner, 'p1');
    assert.equal(g.phase, 'over');
  }
});

// ---- pause ------------------------------------------------------------------

test('pause freezes every clock and blocks actions; resume shifts deadlines', () => {
  const { g, dice, tick, now, act } = scripted(3, { turnSeconds: 60, timeLimitMin: 30 });
  const t0 = now();
  assert.equal(g.endsAt, t0 + 30 * 60_000);
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  const auctionEnd = g.auction!.endsAt;
  g.player('p1').cash = 0;
  g.debts.push({ from: 'p1', to: null, amount: 10, reason: 'test' });
  act('p0', { type: 'bid', amount: 5 }); // settle() gives the debt its deadline
  const debtEnd = g.debtEndsAt.p1;
  assert.ok(debtEnd);

  tick(1_000);
  g.pause('Host');
  assert.throws(() => act('p0', { type: 'bid', amount: 10 }), /paused by Host/);
  assert.equal(g.clockDeadline(), null);
  assert.equal(g.view().paused?.by, 'Host');
  tick(100_000);
  assert.equal(g.auctionTimeout(), false, 'the auction clock is frozen');
  assert.equal(g.clockTimeout(), false);
  assert.throws(() => g.pause('Again'), /Already paused/);

  g.resume('Host');
  assert.equal(g.paused, null);
  assert.equal(g.auction!.endsAt, Math.max(auctionEnd, t0 + 6_000) + 100_000);
  assert.equal(g.debtEndsAt.p1, debtEnd + 100_000);
  assert.equal(g.endsAt, t0 + 30 * 60_000 + 100_000);
  act('p0', { type: 'bid', amount: 10 });
});

test('pause: resigning still works while paused', () => {
  const { g, act } = scripted(3);
  g.pause('Host');
  act('p2', { type: 'bankrupt' });
  assert.equal(g.player('p2').bankrupt, true);
  assert.equal(g.phase, 'roll', 'no estate auction starts while paused');
});

test('pause: mini-game clocks are frozen and shifted too', () => {
  const { g, dice, tick, act } = scripted(2, {}, 'speed');
  // Find an arcade and walk onto it.
  const arcade = g.spaces.findIndex(s => s.kind === 'arcade');
  g.player('p0').position = arcade - 3;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.phase, 'minigame');
  const due = g.minigameDeadline()!;
  g.pause('Host');
  assert.equal(g.minigameDeadline(), null);
  tick(50_000);
  assert.equal(g.minigameTimeout(), false);
  g.resume('Host');
  assert.equal(g.minigameDeadline(), due + 50_000);
});

// ---- game length ------------------------------------------------------------

test('time limit: ends between steps, richest wins, everyone ranked', () => {
  const { g, tick } = scripted(3, { timeLimitMin: 30, turnSeconds: 0 });
  g.player('p1').cash = 5000;
  g.owned[39] = { owner: 'p2', houses: 0, mortgaged: false };
  g.owned[37] = { owner: 'p2', houses: 0, mortgaged: true };
  tick(30 * 60_000 - 1);
  assert.equal(g.clockTimeout(), false);
  tick(1);
  assert.equal(g.clockTimeout(), true);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p1');
  // Deeds at printed price, mortgaged ones at the mortgage value.
  assert.deepEqual(g.standings(), [
    { id: 'p1', netWorth: 5000 }, { id: 'p2', netWorth: 1500 + 400 + 175 }, { id: 'p0', netWorth: 1500 },
  ]);
});

test('time limit: the current turn step finishes first', () => {
  const { g, dice, tick, act } = scripted(2, { timeLimitMin: 30, turnSeconds: 0 });
  dice(1, 2);
  act('p0', { type: 'roll' });
  tick(30 * 60_000);
  g.clockTimeout();
  assert.equal(g.timeUp, true);
  assert.equal(g.phase, 'buy', 'mid-step: keeps going');
  act('p0', { type: 'buy' });
  assert.equal(g.phase, 'done');
  act('p0', { type: 'endTurn' });
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0', 'deed at full price + cash beats cash');
});

test('time limit: the room records the result like any ending', async () => {
  let finished = 0;
  const hooks: RoomHooks = { onChange() {}, onEvent() {}, onFinished() { finished++; } };
  const r = new Room('TIMER', 'a', hooks);
  r.join({ id: 'a', name: 'A', avatar: '' });
  r.join({ id: 'b', name: 'B', avatar: '' });
  r.configure('a', false, { rules: { timeLimitMin: 30 } });
  r.start('a', false);
  r.game!.endsAt = Date.now() + 20;
  r.setConnected('a', true); // re-arms the room's timers
  await sleep(250);
  assert.equal(r.game!.phase, 'over');
  assert.equal(r.status, 'finished');
  assert.equal(finished, 1);
  r.dispose();
});

// ---- official rules ---------------------------------------------------------

test('receiving a mortgaged deed in a trade costs 10% of its mortgage value', () => {
  const { g, act } = scripted();
  g.owned[39] = { owner: 'p0', houses: 0, mortgaged: true }; // mortgage value 200
  act('p0', { type: 'proposeTrade', to: 'p1', give: { cash: 0, spaces: [39], jailCards: 0 }, get: { cash: 100, spaces: [], jailCards: 0 } });
  act('p1', { type: 'acceptTrade', id: g.trades[0].id });
  assert.equal(g.owned[39].owner, 'p1');
  assert.equal(g.player('p1').cash, 1500 - 100 - 20);
  assert.equal(g.player('p0').cash, 1600, 'the giver pays nothing extra');

  // Cannot pay: it becomes a debt.
  g.owned[37] = { owner: 'p0', houses: 0, mortgaged: true }; // mortgage value 175 → 18
  g.player('p1').cash = 0;
  act('p0', { type: 'proposeTrade', to: 'p1', give: { cash: 0, spaces: [37], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } });
  act('p1', { type: 'acceptTrade', id: g.trades[0].id });
  assert.equal(g.debtOf('p1'), 18);
});

test('bankrupt to the bank: the estate is auctioned lot by lot, then the turn resumes', () => {
  const { g, act } = scripted(3);
  g.owned[1] = { owner: 'p1', houses: 0, mortgaged: true };
  g.owned[3] = { owner: 'p1', houses: 0, mortgaged: false };
  act('p1', { type: 'bankrupt' });
  assert.equal(g.phase, 'auction');
  assert.equal(g.auction!.bank, true);
  assert.equal(g.auction!.space, 1);
  assert.equal(g.owned[1], undefined);
  act('p0', { type: 'bid', amount: 10 });
  act('p2', { type: 'pass' });
  assert.deepEqual(g.owned[1], { owner: 'p0', houses: 0, mortgaged: false }, 'sold unmortgaged');
  assert.equal(g.player('p0').cash, 1490);
  assert.equal(g.auction!.space, 3, 'next lot straight away');
  act('p0', { type: 'pass' });
  act('p2', { type: 'pass' });
  assert.equal(g.owned[3], undefined, 'no bids: stays with the bank');
  assert.equal(g.phase, 'roll');
  assert.equal(g.current.id, 'p0', 'the current turn carries on');
});

test('bankrupt to the bank on your own turn: the auctions run, then the next player', () => {
  const { g, dice, act } = scripted(3);
  g.owned[39] = { owner: 'p0', houses: 0, mortgaged: false };
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  act('p0', { type: 'pass' }); act('p1', { type: 'pass' }); act('p2', { type: 'pass' });
  assert.equal(g.phase, 'done');
  act('p0', { type: 'bankrupt' });
  assert.equal(g.current.id, 'p1');
  assert.equal(g.phase, 'auction');
  act('p1', { type: 'bid', amount: 50 });
  act('p2', { type: 'pass' });
  assert.equal(g.owned[39].owner, 'p1');
  assert.equal(g.phase, 'roll');
  assert.equal(g.current.id, 'p1');
});

test('bank estate auctions follow a running auction', () => {
  const { g, dice, act } = scripted(3);
  g.owned[39] = { owner: 'p2', houses: 0, mortgaged: false };
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' }); // auction for 3
  act('p2', { type: 'bankrupt' }); // mid-auction
  assert.equal(g.auction!.space, 3);
  act('p0', { type: 'pass' }); act('p1', { type: 'pass' });
  assert.equal(g.auction!.space, 39, 'then the estate');
  assert.equal(g.auction!.bank, true);
  act('p0', { type: 'pass' }); act('p1', { type: 'pass' });
  assert.equal(g.phase, 'done');
  assert.equal(g.current.id, 'p0');
});

test('house rule: no rent collected while the owner is in jail', () => {
  for (const noRentInJail of [true, false]) {
    const { g, dice, act } = scripted(2, { noRentInJail });
    g.owned[3] = { owner: 'p1', houses: 0, mortgaged: false };
    Object.assign(g.player('p1'), { inJail: true, position: 10 });
    dice(1, 2);
    act('p0', { type: 'roll' });
    assert.equal(g.player('p0').cash, noRentInJail ? 1500 : 1496);
  }
});

// ---- Speed Die --------------------------------------------------------------

test('speed die: only after passing GO once, never for jail escapes', () => {
  const { g, dice, raw, act } = scripted(2, { speedDie: true });
  const p0 = g.player('p0');
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.speed, null, 'not until GO has been passed');
  assert.equal(p0.passedGo, undefined);
  act('p0', { type: 'decline' });
  act('p0', { type: 'pass' }); act('p1', { type: 'pass' });
  act('p0', { type: 'endTurn' });
  g.player('p1').position = 37;
  dice(1, 2); // lands on GO
  act('p1', { type: 'roll' });
  assert.equal(g.player('p1').passedGo, true);
  // Jail: white dice only.
  act('p1', { type: 'endTurn' });
  Object.assign(p0, { inJail: true, position: 10, passedGo: true });
  dice(1, 2); raw(face(1));
  act('p0', { type: 'roll' });
  assert.equal(g.speed, null);
});

test('speed die: a number adds to the move', () => {
  const { g, dice, raw, act } = scripted(2, { speedDie: true });
  g.player('p0').passedGo = true;
  dice(1, 2); raw(face(2));
  act('p0', { type: 'roll' });
  assert.equal(g.speed, 2);
  assert.equal(g.player('p0').position, 5);
  assert.equal(g.view().speed, 2);
});

test('speed die: Mr. Monopoly goes on to the next unowned deed after the first landing', () => {
  const { g, dice, raw, act } = scripted(2, { speedDie: true });
  const p0 = g.player('p0');
  p0.passedGo = true;
  dice(1, 2); raw(face('mr'));
  act('p0', { type: 'roll' });
  assert.equal(p0.position, 3);
  assert.equal(g.phase, 'buy');
  act('p0', { type: 'buy' });
  assert.equal(p0.position, 5, 'then on to Reading Railroad');
  assert.equal(g.phase, 'buy');
  act('p0', { type: 'decline' });
  act('p0', { type: 'pass' }); act('p1', { type: 'pass' });
  assert.equal(g.phase, 'done');
});

test('speed die: Mr. Monopoly with everything owned goes to the next rent', () => {
  const { g, dice, raw, act } = scripted(2, { speedDie: true });
  g.spaces.forEach((s, i) => { if (s.price) g.owned[i] = { owner: i === 5 ? 'p0' : 'p1', houses: 0, mortgaged: i === 6 }; });
  g.player('p0').passedGo = true;
  dice(1, 2); raw(face('mr'));
  act('p0', { type: 'roll' });
  // 3 (rent) → skips its own 5 and the mortgaged 6 → 8.
  assert.equal(g.player('p0').position, 8);
  assert.equal(g.phase, 'done');
  assert.equal(g.player('p0').cash, 1500 - g.rentFor(3) - g.rentFor(8));
});

test('speed die: Bus lets the player pick a die or the sum; doubles still roll again', () => {
  {
    const { g, dice, raw, act } = scripted(2, { speedDie: true });
    g.player('p0').passedGo = true;
    dice(1, 4); raw(face('bus'));
    act('p0', { type: 'roll' });
    assert.equal(g.phase, 'choose');
    assert.deepEqual(g.choice, { kind: 'bus', options: [1, 4, 5] });
    assert.throws(() => act('p0', { type: 'choose', value: 2 }), /Pick one/);
    assert.throws(() => act('p0', { type: 'endTurn' }), /Can't do that now/);
    act('p0', { type: 'choose', value: 4 });
    assert.equal(g.player('p0').position, 4);
    assert.equal(g.player('p0').cash, 1300, 'income tax');
    assert.equal(g.phase, 'done');
    assert.equal(g.choice, null);
  }
  {
    const { g, dice, raw, act } = scripted(2, { speedDie: true });
    g.player('p0').passedGo = true;
    dice(3, 3); raw(face('bus'));
    act('p0', { type: 'roll' });
    assert.deepEqual(g.choice, { kind: 'bus', options: [3, 6] });
    act('p0', { type: 'choose', value: 3 });
    assert.equal(g.player('p0').position, 3);
    act('p0', { type: 'decline' });
    act('p0', { type: 'pass' }); act('p1', { type: 'pass' });
    assert.equal(g.phase, 'roll', 'doubles: roll again');
  }
});

test('speed die: triples jump anywhere and end the rolling', () => {
  const { g, dice, raw, act } = scripted(2, { speedDie: true });
  const p0 = g.player('p0');
  p0.passedGo = true;
  p0.position = 5;
  dice(2, 2); raw(face(2));
  act('p0', { type: 'roll' });
  assert.equal(g.phase, 'choose');
  assert.deepEqual(g.choice, { kind: 'triples' });
  assert.throws(() => act('p0', { type: 'choose', value: 40 }), /No such space/);
  act('p0', { type: 'choose', value: 0 });
  assert.equal(p0.position, 0);
  assert.equal(p0.cash, 1700, 'passing GO on the way pays');
  assert.equal(g.phase, 'done', 'no extra roll after triples');
});

test('speed die: timeouts and bots take the sum, and the best free deed for triples', () => {
  {
    const { g, dice, raw, tick, act } = scripted(2, { speedDie: true, turnSeconds: 30 });
    g.player('p0').passedGo = true;
    dice(1, 4); raw(face('bus'));
    act('p0', { type: 'roll' });
    assert.deepEqual(botAction(g, 'p0'), { type: 'choose', value: 5 });
    tick(30_000);
    g.clockTimeout();
    assert.equal(g.player('p0').position, 5);
  }
  {
    const { g, dice, raw, tick, act } = scripted(2, { speedDie: true, turnSeconds: 30 });
    g.player('p0').passedGo = true;
    g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
    dice(1, 1); raw(face(1));
    act('p0', { type: 'roll' });
    assert.equal(g.bestTriplesTarget('p0'), 39, 'Boardwalk');
    tick(30_000);
    g.clockTimeout();
    assert.equal(g.player('p0').position, 39);
    assert.equal(g.phase, 'buy');
  }
  {
    const { g } = scripted(2, { speedDie: true });
    g.spaces.forEach((s, i) => { if (s.price) g.owned[i] = { owner: 'p1', houses: 0, mortgaged: false }; });
    assert.equal(g.bestTriplesTarget('p0'), 0, 'nothing free: GO');
  }
});

// ---- operator fixes ---------------------------------------------------------

test('admin fixes keep money, buildings and jail cards consistent', () => {
  const { g, act } = scripted(2);
  const p0 = g.player('p0'), p1 = g.player('p1');
  g.owned[1] = { owner: 'p0', houses: 2, mortgaged: false };
  g.owned[3] = { owner: 'p0', houses: 2, mortgaged: false };
  g.housesLeft -= 4;
  assertSupply(g);

  g.pause('Op'); // fixes work on a paused table
  g.adminMoveProperty(3, 'p1');
  assertSupply(g);
  assert.equal(g.housesLeft, 32, 'the broken set sells its buildings back');
  assert.equal(p0.cash, 1500 + 25 * 4);
  assert.deepEqual(g.owned[3], { owner: 'p1', houses: 0, mortgaged: false });
  assert.equal(g.owned[1].houses, 0);
  g.adminMoveProperty(3, null);
  assert.equal(g.owned[3], undefined);
  assert.throws(() => g.adminMoveProperty(3, null), /bank already/);
  assert.throws(() => g.adminMoveProperty(4, 'p1'), /cannot be owned/);

  g.owned[39] = { owner: 'p1', houses: 5, mortgaged: false };
  g.owned[37] = { owner: 'p1', houses: 4, mortgaged: false };
  g.hotelsLeft--; g.housesLeft -= 4;
  g.adminMoveProperty(37, 'p0');
  assertSupply(g);
  assert.equal(p1.cash, 1500 + 100 * 9);

  g.adminSetCash('p0', 42);
  assert.equal(p0.cash, 42);
  assert.throws(() => g.adminSetCash('p0', -1), /whole number/);

  g.adminJailCard('p0', true);
  g.adminJailCard('p0', true);
  assert.throws(() => g.adminJailCard('p1', true), /already held/);
  assertJailCards(g);
  g.adminJailCard('p0', false);
  assertJailCards(g);
  assert.equal(p0.jailCards.length, 1);

  g.debts.push({ from: 'p1', to: 'p0', amount: 99, reason: 'test' });
  g.adminClearDebt('p1');
  assert.equal(g.debtOf('p1'), 0);
  assert.throws(() => g.adminClearDebt('p1'), /owes nothing/);

  g.adminJail('p1', true);
  assert.equal(p1.inJail, true);
  assert.equal(p1.position, g.jailIndex);
  g.adminJail('p1', false);
  assert.equal(p1.inJail, false);
  g.resume('Op');
  act('p0', { type: 'roll' });
  assert.ok(g.log.some(l => l.text.includes('An operator')), 'players see the fixes');
});

test('admin: sending the current player to jail ends their rolling', () => {
  const { g } = scripted(2);
  g.adminJail('p0', true);
  assert.equal(g.phase, 'done');
  assert.equal(g.player('p0').inJail, true);
});

// ---- snapshot / restore -----------------------------------------------------

function restoreAt(g: Game, snap: GameSnapshot, t: number): Game {
  return Game.restore({ theme: g.theme, rules: g.rules, now: () => t }, JSON.parse(JSON.stringify(snap)));
}

test('snapshot / restore mid-timer shifts the deadlines by the downtime', () => {
  const { g, tick, now } = scripted(2, { turnSeconds: 60, timeLimitMin: 30 });
  const t0 = now();
  tick(10_000);
  const snap = g.snapshot();
  const g2 = restoreAt(g, snap, now() + 5_000);
  assert.equal(g2.turnEndsAt, t0 + 65_000);
  assert.equal(g2.endsAt, t0 + 30 * 60_000 + 5_000);
});

test('snapshot / restore mid-pause keeps the pause and its frozen clocks', () => {
  const { g, tick, now } = scripted(2, { turnSeconds: 60 });
  const t0 = now();
  tick(10_000);
  g.pause('Host');
  tick(10_000);
  const snap = g.snapshot();
  let t = now() + 10_000;
  const g2 = Game.restore({ theme: g.theme, rules: g.rules, now: () => t }, JSON.parse(JSON.stringify(snap)));
  assert.equal(g2.paused?.by, 'Host');
  assert.throws(() => g2.apply('p0', { type: 'roll' }), /paused/);
  t += 10_000;
  g2.resume('Host');
  // 30 s paused in total (10 before the snapshot, 10 down, 10 after).
  assert.equal(g2.turnEndsAt, t0 + 60_000 + 30_000);
});

test('snapshots from before timers and the Speed Die still load', () => {
  const { g, now } = scripted(2, { speedDie: true });
  const snap = JSON.parse(JSON.stringify(g.snapshot())) as Record<string, unknown>;
  for (const k of ['turnEndsAt', 'turnKey', 'debtEndsAt', 'timeoutStreak', 'paused', 'endsAt', 'timeUp', 'speed', 'choice', 'speedPending', 'estateQueue', 'resumePhase']) {
    delete snap[k];
  }
  const g2 = Game.restore({ theme: g.theme, rules: { ...g.rules, turnSeconds: 0 }, now }, snap as unknown as GameSnapshot);
  assert.equal(g2.paused, null);
  assert.equal(g2.speed, null);
  assert.equal(g2.turnEndsAt, null);
  assert.equal(g2.view().choice, null);
  g2.apply('p0', { type: 'roll' });
});

// ---- rooms: pause, autopilot, afk ------------------------------------------

function room() {
  const events: string[] = [];
  const r = new Room('RULES', 'a', { onChange() {}, onEvent(_r, t) { events.push(t); }, onFinished() {} });
  r.join({ id: 'a', name: 'A', avatar: '' });
  r.join({ id: 'b', name: 'B', avatar: '' });
  r.start('a', false);
  return { r, g: r.game!, events };
}

test('room: host pauses and resumes; players cannot act meanwhile', () => {
  const { r, g, events } = room();
  assert.throws(() => r.pause('b', false, 'B'), /host/);
  r.pause('a', false, 'A');
  assert.throws(() => r.act(g.current.id, { type: 'roll' }), /paused/);
  assert.equal(r.view().game!.paused!.by, 'A');
  assert.throws(() => r.resume('b', false, 'B'), /host/);
  r.resume('b', true, 'Operator');
  r.act(g.current.id, { type: 'roll' });
  assert.ok(events.includes('Game paused by A'));
  r.dispose();
});

test('room: autopilot plays a handed-over player until they act again', async () => {
  const { r, g, events } = room();
  const cur = g.current.id;
  const other = cur === 'a' ? 'b' : 'a';
  assert.throws(() => r.setAutopilot('b', cur, true, false), /host/);
  r.setAutopilot('a', cur, true, false);
  assert.equal(r.view().seats.find(s => s.id === cur)!.autopilot, true);
  await sleep(1_300);
  assert.ok(g.rollSeq > 0, 'autopilot rolled for them');
  assert.equal(r.seat(cur)!.autopilot, true, 'autopilot moves do not hand control back');
  r.act(cur, { type: 'proposeTrade', to: other, give: { cash: 1, spaces: [], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } });
  assert.equal(r.seat(cur)!.autopilot, false, 'acting takes control back');
  assert.ok(events.some(e => e.includes('took back control')));
  r.dispose();
});

test('room: an afk player is played by autopilot until they act', async () => {
  const { r, g } = room();
  const cur = g.current.id;
  g.player(cur).afk = true;
  r.setConnected(cur, true); // re-arm timers, as any change does
  await sleep(1_300);
  assert.ok(g.rollSeq > 0, 'autopilot rolled for the away player');
  assert.equal(g.player(cur).afk, true);
  const other = cur === 'a' ? 'b' : 'a';
  r.act(cur, { type: 'proposeTrade', to: other, give: { cash: 1, spaces: [], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } });
  assert.equal(g.player(cur).afk, false);
  r.dispose();
});
