import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Registry, type Room, type RoomHooks } from '../src/rooms.ts';
import { PokeTracker, REACTION_BURST, REACTION_EVERY_MS, ReactionLimiter, isReactionEmoji } from '../src/social.ts';
import { Game } from '../src/engine/game.ts';
import { POKE_AFTER_MS } from '../../shared/types.ts';
import { resolveTheme } from '../../shared/themes.ts';
import { scripted } from './helpers.ts';

const hooks = (): RoomHooks & { finished: number } => {
  const h = { finished: 0, onChange() {}, onEvent() {}, onFinished() { h.finished++; } };
  return h;
};
const m = (id: string, name = id) => ({ id, name, avatar: '🙂' });
const side = (cash = 0, spaces: number[] = [], jailCards = 0) => ({ cash, spaces, jailCards });

// ---- reactions ----------------------------------------------------------------

test('reactions: only the bar emoji, a burst of 3, then one per 1.5 s per player', () => {
  assert.ok(isReactionEmoji('🔥'));
  assert.ok(!isReactionEmoji('<b>hi</b>'));
  assert.ok(!isReactionEmoji(undefined));
  const lim = new ReactionLimiter();
  const t = 1_000_000;
  for (let i = 0; i < REACTION_BURST; i++) assert.ok(lim.take('a', t), `burst ${i}`);
  assert.ok(!lim.take('a', t), 'burst spent');
  assert.ok(lim.take('b', t), 'buckets are per player');
  assert.ok(!lim.take('a', t + REACTION_EVERY_MS - 10));
  assert.ok(lim.take('a', t + REACTION_EVERY_MS + 10), 'refills over time');
});

// ---- pokes --------------------------------------------------------------------

function playingRoom(reg: Registry, humans = ['a', 'b']): Room {
  const r = reg.create(humans[0]);
  for (const id of humans) r.join(m(id));
  r.start(humans[0], false);
  return r;
}

test('pokes: only after 15 s, only at a human whose turn it is, once per turn each', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = playingRoom(reg, ['a', 'b', 'c']);
  const pokes = new PokeTracker();
  const t0 = 5_000_000;
  pokes.observe(r, t0);
  const cur = r.game!.current.id;
  const other = ['a', 'b', 'c'].find(x => x !== cur)!;
  const third = ['a', 'b', 'c'].find(x => x !== cur && x !== other)!;

  assert.throws(() => pokes.poke(r, cur, t0 + POKE_AFTER_MS + 1), /your own turn/);
  assert.throws(() => pokes.poke(r, other, t0 + 1_000), /more/);
  assert.throws(() => pokes.poke(r, 'stranger', t0 + POKE_AFTER_MS + 1), /Only players/);
  assert.equal(pokes.poke(r, other, t0 + POKE_AFTER_MS + 1), cur);
  assert.throws(() => pokes.poke(r, other, t0 + POKE_AFTER_MS + 2), /already poked/);
  assert.equal(pokes.poke(r, third, t0 + POKE_AFTER_MS + 2), cur, 'someone else may still poke');
  assert.deepEqual(pokes.view(r, t0 + POKE_AFTER_MS + 3)!.pokedBy.sort(), [other, third].sort());

  // A new turn resets the clock and the list.
  const g = r.game!;
  g.turnNumber++;
  g.currentIdx = g.players.findIndex(p => p.id === other);
  const t1 = t0 + 60_000;
  const v = pokes.view(r, t1)!;
  assert.equal(v.since, t1);
  assert.deepEqual(v.pokedBy, []);
  assert.throws(() => pokes.poke(r, cur, t1 + 1_000), /more/);
  assert.equal(pokes.poke(r, cur, t1 + POKE_AFTER_MS), other);
  r.dispose();
});

test('pokes: never at bots, and not outside a running game', () => {
  const reg = new Registry(hooks(), 1e9);
  const r = reg.create('a');
  r.join(m('a'));
  r.addBot('a', false);
  const pokes = new PokeTracker();
  assert.throws(() => pokes.poke(r, 'a'), /No game/);
  r.start('a', false);
  r.dispose(); // no bot timers: we drive it by hand
  const g = r.game!;
  if (g.current.id === 'a') g.currentIdx = g.players.findIndex(p => p.isBot);
  pokes.observe(r, 0);
  assert.throws(() => pokes.poke(r, 'a', POKE_AFTER_MS + 1), /Bots/);
});

// ---- counter-offers -------------------------------------------------------------

test('counter-offer replaces the original in one step', () => {
  const { g, act } = scripted(3);
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  g.owned[3] = { owner: 'p1', houses: 0, mortgaged: false };
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(50), get: side(0, [3]) });
  const original = g.trades[0].id;

  // Only the recipient can counter, and only towards the proposer.
  assert.throws(() => act('p0', { type: 'proposeTrade', to: 'p1', give: side(60), get: side(0, [3]), counterOf: original }), /counter an offer made to you/);
  assert.throws(() => act('p1', { type: 'proposeTrade', to: 'p2', give: side(10), get: side(), counterOf: original }), /counter an offer made to you/);
  assert.throws(() => act('p1', { type: 'proposeTrade', to: 'p0', give: side(), get: side(), counterOf: 'nope' }), /gone/);

  // An invalid counter leaves the original standing.
  assert.throws(() => act('p1', { type: 'proposeTrade', to: 'p0', give: side(0, [3]), get: side(0, [5]), counterOf: original }), /does not own/);
  assert.deepEqual(g.trades.map(t => t.id), [original]);

  act('p1', { type: 'proposeTrade', to: 'p0', give: side(0, [3]), get: side(150, [1]), counterOf: original });
  assert.equal(g.trades.length, 1);
  const counter = g.trades[0];
  assert.notEqual(counter.id, original);
  assert.equal(counter.from, 'p1');
  assert.equal(counter.to, 'p0');
  assert.ok(g.log.at(-1)!.text.includes('countered'));
  assert.throws(() => act('p0', { type: 'acceptTrade', id: original }), /gone/);
  act('p0', { type: 'acceptTrade', id: counter.id });
  assert.equal(g.owned[3].owner, 'p0');
  assert.equal(g.owned[1].owner, 'p1');
  assert.equal(g.player('p1').cash, 1650);
});

// ---- summary stats & net worth ----------------------------------------------

test('stats: rent, biggest rent, buys, jail — and net worth in the view — survive snapshot/restore', () => {
  const { g, dice, act } = scripted();
  dice(1, 2);
  act('p0', { type: 'roll' }); // lands on 3
  act('p0', { type: 'buy' });
  act('p0', { type: 'endTurn' });
  g.player('p1').position = 1;
  dice(1, 1); // doubles: 1 -> 3, pays p0 rent
  act('p1', { type: 'roll' });
  const rent = g.rentFor(3);
  assert.ok(rent > 0);
  let v = g.view();
  assert.equal(v.stats.p0.propertiesBought, 1);
  assert.equal(v.stats.p0.rentCollected, rent);
  assert.equal(v.stats.p1.biggestRentPaid, rent);
  assert.equal(v.stats.p1.propertiesBought, 0);
  assert.equal(v.netWorth.p0, g.player('p0').cash + 60, 'cash + the deed at its printed price (official short-game count)');
  assert.equal(v.netWorth.p1, g.player('p1').cash);

  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const g2 = Game.restore({ theme: resolveTheme('classic', 'classic'), rules: g.rules, now: () => 2_000_000 }, snap);
  v = g2.view();
  assert.equal(v.stats.p0.rentCollected, rent);
  assert.equal(v.startedAt, g.startedAt);
  assert.equal(v.endedAt, null);

  // Old snapshots without the counters still load.
  delete snap.stats; delete snap.startedAt; delete snap.endedAt;
  const g3 = Game.restore({ theme: resolveTheme('classic', 'classic'), rules: g.rules, now: () => 3_000_000 }, snap);
  assert.equal(g3.view().stats.p0.rentCollected, 0);
  assert.equal(g3.view().startedAt, 3_000_000);
});

test('stats: jail and game end time', () => {
  const { g, dice, act, tick } = scripted();
  g.player('p0').position = 20;
  dice(5, 5); // 20 -> 30: go to jail
  act('p0', { type: 'roll' });
  assert.equal(g.view().stats.p0.jailed, 1);
  tick(90_000);
  act('p1', { type: 'bankrupt' });
  assert.equal(g.view().winner, 'p0');
  assert.equal(g.view().endedAt! - g.view().startedAt, 90_000);
});

// ---- rematch --------------------------------------------------------------------

function finishedRoom(h = hooks()) {
  const reg = new Registry(h, 1e9);
  const r = reg.create('a');
  r.join(m('a')); r.join(m('b')); r.join(m('c'));
  r.addBot('a', false);
  r.configure('a', false, { mapId: 'speed', themeId: 'tptv', rules: { startingCash: 777 } });
  const style = { ...r.style };
  r.start('a', false);
  r.dispose(); // no bot timers: finish it by hand
  const bot = r.seats.find(s => s.isBot)!.id;
  for (const id of ['b', 'c', bot]) r.act(id, { type: 'bankrupt' });
  r.dispose();
  return { reg, r, style };
}

test('rematch: host only, after the game; keeps settings, bots and present humans', () => {
  const h = hooks();
  const { reg, r, style } = finishedRoom(h);
  assert.equal(r.status, 'finished');
  assert.equal(h.finished, 1);
  const bot = r.seats.find(s => s.isBot)!;
  const before = r.seat('b')!;

  assert.throws(() => r.rematch('b', false, () => true), /host/);
  // c left the table; a and b are still here.
  r.rematch('a', false, id => id !== 'c');
  assert.equal(r.status, 'lobby');
  assert.equal(r.game, null);
  assert.equal(r.startedAt, null);
  assert.deepEqual(r.seats.map(s => s.id).sort(), ['a', 'b', bot.id].sort());
  assert.equal(r.seat('b')!.character, before.character, 'seats keep their character and colour');
  assert.equal(r.seat('b')!.color, before.color);
  assert.equal(r.mapId, 'speed');
  assert.equal(r.themeId, 'tptv');
  assert.equal(r.rules.startingCash, 777);
  assert.deepEqual(r.style, style);
  assert.throws(() => r.rematch('a', false, () => true), /not over/);

  // …and the next game starts from there.
  r.start('a', false);
  assert.equal(r.status, 'playing');
  assert.equal(r.game!.players.length, 3);
  assert.ok(r.game!.players.every(p => p.cash === 777));
  r.dispose();
  reg.delete(r.code);
});

test('rematch: an operator may reset it; a missing host hands the room on', () => {
  const { r } = finishedRoom();
  r.rematch('admin', true, id => id === 'b');
  assert.equal(r.hostId, 'b');
  assert.ok(!r.seat('a'));
  r.dispose();
});

test('finished rooms stay while people are still at the table', () => {
  const { reg, r } = finishedRoom();
  const sweep = () => (reg as unknown as { sweep(): void }).sweep();
  r.finishedAt = Date.now() - 11 * 60_000;
  sweep();
  assert.equal(reg.get(r.code), r, 'a is still connected: kept');
  for (const id of ['a', 'b', 'c']) r.leave(id);
  sweep();
  assert.equal(reg.get(r.code), undefined, 'everyone left: swept');
});

test('chat refusals are ChatErrors so the sender reads the reason, not "Server error"', async () => {
  const { checkChat, ChatError } = await import('../src/chat.ts');
  assert.throws(() => checkChat('chat-t1', '   '), ChatError);
  checkChat('chat-t1', 'hello');
  assert.throws(() => checkChat('chat-t1', 'again'), (e: unknown) => e instanceof ChatError && /Slow down/.test((e as Error).message));
});
