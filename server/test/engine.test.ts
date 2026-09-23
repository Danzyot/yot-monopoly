import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { DEFAULT_RULES, YOT, resolveTheme } from '../../shared/themes.ts';
import { MAPS, validateMap } from '../../shared/maps.ts';

const CLASSIC = resolveTheme('classic', 'classic');
import { scripted, seeded } from './helpers.ts';

test('roll, move, buy', () => {
  const { g, dice, act } = scripted();
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 3);
  assert.equal(g.phase, 'buy');
  act('p0', { type: 'buy' });
  assert.equal(g.owned[3].owner, 'p0');
  assert.equal(g.player('p0').cash, 1440);
  assert.equal(g.phase, 'done');
  act('p0', { type: 'endTurn' });
  assert.equal(g.current.id, 'p1');
});

test('cannot act out of turn', () => {
  const { g, act } = scripted();
  assert.throws(() => act('p1', { type: 'roll' }), /Not your turn/);
  assert.equal(g.phase, 'roll');
});

test('passing GO pays salary', () => {
  const { g, dice, act } = scripted();
  g.player('p0').position = 38;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 1);
  assert.equal(g.player('p0').cash, 1700);
});

test('rent: base, full set doubles, houses', () => {
  const { g, dice, act } = scripted();
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  g.currentIdx = 1;
  g.player('p1').position = 39;
  dice(1, 1);
  act('p1', { type: 'roll' });
  assert.equal(g.player('p1').position, 1);
  // passed GO (+200), paid base rent 2
  assert.equal(g.player('p1').cash, 1500 + 200 - 2);
  assert.equal(g.player('p0').cash, 1502);

  g.owned[3] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.equal(g.rentFor(1), 4); // set owned: double base
  g.owned[1].houses = 2;
  g.owned[3].houses = 2;
  assert.equal(g.rentFor(1), 30);
  g.owned[1].houses = 5;
  assert.equal(g.rentFor(1), 250);
  g.owned[1].mortgaged = true;
  assert.equal(g.rentFor(1), 0);
});

test('railroad and utility rents', () => {
  const { g } = scripted();
  for (const i of [5, 15]) g.owned[i] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.equal(g.rentFor(5), 50);
  g.owned[25] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.equal(g.rentFor(5), 100);
  assert.equal(g.rentFor(5, { railroadMultiplier: 2 }), 200);
  g.owned[12] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.equal(g.rentFor(12, {}, 7), 28);
  g.owned[28] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.equal(g.rentFor(12, {}, 7), 70);
});

test('doubles give another roll; three doubles go to jail', () => {
  const { g, dice, act } = scripted();
  dice(2, 2);
  act('p0', { type: 'roll' }); // → 4 income tax
  assert.equal(g.phase, 'roll');
  assert.equal(g.current.id, 'p0');
  dice(3, 3);
  act('p0', { type: 'roll' }); // → 10 jail (visiting)
  assert.equal(g.phase, 'roll');
  dice(1, 1);
  act('p0', { type: 'roll' });
  const p = g.player('p0');
  assert.equal(p.inJail, true);
  assert.equal(p.position, 10);
  assert.equal(g.phase, 'done');
});

test('jail: doubles release without an extra roll', () => {
  const { g, dice, act } = scripted();
  const p = g.player('p0');
  p.inJail = true; p.position = 10;
  dice(3, 3);
  act('p0', { type: 'roll' });
  assert.equal(p.inJail, false);
  assert.equal(p.position, 16);
  act('p0', { type: 'decline' });
  assert.equal(g.phase, 'auction');
});

test('jail: third miss pays fine and moves', () => {
  const { g, dice, act } = scripted();
  const p = g.player('p0');
  p.inJail = true; p.position = 10; p.jailTurns = 2;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(p.inJail, false);
  assert.equal(p.position, 13);
  assert.equal(p.cash, 1500 - 50);
});

test('auction: highest bid wins, bidders can pass', () => {
  const { g, dice, act, tick } = scripted(3);
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  assert.equal(g.phase, 'auction');
  act('p1', { type: 'bid', amount: 10 });
  act('p2', { type: 'bid', amount: 20 });
  assert.throws(() => act('p1', { type: 'bid', amount: 15 }));
  act('p0', { type: 'pass' });
  act('p1', { type: 'pass' });
  assert.equal(g.auction, null);
  assert.equal(g.owned[3].owner, 'p2');
  assert.equal(g.player('p2').cash, 1480);
  assert.equal(g.phase, 'done');
  void tick;
});

test('auction: timeout awards to high bidder', () => {
  const { g, dice, act, tick } = scripted(3);
  dice(1, 2);
  act('p0', { type: 'roll' });
  act('p0', { type: 'decline' });
  act('p1', { type: 'bid', amount: 5 });
  assert.equal(g.auctionTimeout(), false);
  tick(60_000);
  assert.equal(g.auctionTimeout(), true);
  assert.equal(g.owned[3].owner, 'p1');
});

test('building: needs set, builds evenly, respects supply', () => {
  const { g, act } = scripted();
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  assert.throws(() => act('p0', { type: 'build', space: 1 }), /whole colour group/);
  g.owned[3] = { owner: 'p0', houses: 0, mortgaged: false };
  act('p0', { type: 'build', space: 1 });
  assert.throws(() => act('p0', { type: 'build', space: 1 }), /evenly/);
  act('p0', { type: 'build', space: 3 });
  assert.equal(g.housesLeft, 30);
  for (let k = 0; k < 3; k++) { act('p0', { type: 'build', space: 1 }); act('p0', { type: 'build', space: 3 }); }
  act('p0', { type: 'build', space: 1 }); // hotel
  assert.equal(g.owned[1].houses, 5);
  assert.equal(g.hotelsLeft, 11);
  assert.equal(g.housesLeft, 32 - 8 + 4);
  assert.throws(() => act('p0', { type: 'mortgage', space: 1 }), /buildings/);
  assert.throws(() => act('p0', { type: 'sell', space: 3 }), /evenly/);
  act('p0', { type: 'sell', space: 1 });
  assert.equal(g.owned[1].houses, 4);
  assert.equal(g.hotelsLeft, 12);
});

test('debt: raise funds by mortgaging, then pay', () => {
  const { g, dice, act } = scripted();
  const p1 = g.player('p1');
  g.owned[39] = { owner: 'p0', houses: 5, mortgaged: false };
  g.owned[37] = { owner: 'p0', houses: 5, mortgaged: false };
  g.owned[5] = { owner: 'p1', houses: 0, mortgaged: false };
  g.currentIdx = 1;
  p1.position = 35; p1.cash = 300;
  dice(1, 3);
  act('p1', { type: 'roll' });
  assert.equal(p1.position, 39);
  assert.equal(g.debtOf('p1'), 2000);
  assert.throws(() => act('p1', { type: 'endTurn' }), /debts/);
  assert.throws(() => act('p1', { type: 'payDebt' }), /more/);
  act('p1', { type: 'mortgage', space: 5 });
  assert.equal(p1.cash, 400);
  act('p1', { type: 'bankrupt' });
  assert.equal(g.winner, 'p0');
  assert.equal(g.owned[5].owner, 'p0');
  assert.equal(g.owned[5].mortgaged, true);
  assert.equal(g.phase, 'over');
});

test('bankrupt to the bank returns property', () => {
  const { g, act } = scripted(3);
  g.owned[1] = { owner: 'p1', houses: 0, mortgaged: false };
  act('p1', { type: 'bankrupt' });
  assert.equal(g.owned[1], undefined);
  assert.equal(g.active().length, 2);
});

test('trade: propose, accept, and validation', () => {
  const { g, act } = scripted();
  g.owned[1] = { owner: 'p0', houses: 0, mortgaged: false };
  g.owned[3] = { owner: 'p1', houses: 0, mortgaged: false };
  act('p0', { type: 'proposeTrade', to: 'p1', give: { cash: 100, spaces: [], jailCards: 0 }, get: { cash: 0, spaces: [3], jailCards: 0 } });
  assert.throws(() => act('p0', { type: 'acceptTrade', id: g.trades[0].id }), /not for you/);
  act('p1', { type: 'acceptTrade', id: g.trades[0].id });
  assert.equal(g.owned[3].owner, 'p0');
  assert.equal(g.player('p0').cash, 1400);
  assert.equal(g.player('p1').cash, 1600);
  assert.throws(() => act('p0', { type: 'proposeTrade', to: 'p1', give: { cash: 0, spaces: [5], jailCards: 0 }, get: { cash: 0, spaces: [], jailCards: 0 } }), /does not own/);
});

test('cards: nearest railroad pays double, birthday collects from everyone', () => {
  const { g, dice, act } = scripted(3);
  g.owned[15] = { owner: 'p1', houses: 0, mortgaged: false };
  const railIdx = CLASSIC.chance.findIndex(c => c.effect.type === 'nearest' && c.effect.kind === 'railroad');
  g.decks.chance = [railIdx];
  dice(3, 4); // 0 → 7 chance → nearest railroad 15
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 15);
  assert.equal(g.player('p1').cash, 1550);
  act('p0', { type: 'endTurn' });

  const bday = CLASSIC.chest.findIndex(c => c.effect.type === 'collectEach');
  g.decks.chest = [bday];
  g.player('p2').cash = 5;
  dice(1, 1); // p1: 0 → 2 chest
  act('p1', { type: 'roll' });
  assert.equal(g.player('p1').cash, 1560);
  assert.equal(g.debtOf('p2'), 10);
});

test('free parking pot house rule', () => {
  const { g, dice, act } = scripted(2, { freeParkingPot: true });
  dice(1, 3);
  act('p0', { type: 'roll' }); // income tax 200
  assert.equal(g.pot, 200);
  act('p0', { type: 'endTurn' });
  g.player('p1').position = 17;
  dice(1, 2);
  act('p1', { type: 'roll' });
  assert.equal(g.pot, 0);
  assert.equal(g.player('p1').cash, 1700);
});

test('editions only change cosmetics: YOT uses classic economics', () => {
  const yot = resolveTheme(YOT.id, 'classic');
  assert.equal(yot.spaces.length, 40);
  yot.spaces.forEach((s, i) => {
    assert.equal(s.kind, CLASSIC.spaces[i].kind);
    assert.equal(s.price, CLASSIC.spaces[i].price);
  });
  assert.notEqual(yot.spaces[39].name, CLASSIC.spaces[39].name);
  // Card text names the edition's own spaces, not the classic ones.
  assert.ok(yot.chance.some(c => c.text.includes('Yot Tower')));
  assert.ok(!yot.chance.some(c => c.text.includes('Boardwalk')));
});

test('every map is well-formed for every edition', () => {
  for (const m of MAPS) {
    validateMap(m);
    for (const ed of ['classic', 'chog', 'yot']) {
      const t = resolveTheme(ed, m.id);
      assert.equal(t.spaces.length, m.spaces.length);
      for (const c of [...t.chance, ...t.chest]) assert.ok(!/[{}]/.test(c.text), `unfilled card text: ${c.text}`);
      for (const s of t.spaces) if (s.group) assert.ok(t.groupColors[s.group], `${ed}/${m.id}: no colour for ${s.group}`);
    }
  }
});

test('non-classic maps: jail, GO and wrap-around use the board size', () => {
  const { g, dice, act } = scripted(2, {}, 'speed');
  assert.equal(g.size, 32);
  assert.equal(g.jailIndex, 8);
  g.player('p0').position = 30;
  dice(1, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 1);
  assert.equal(g.player('p0').cash, 1700);
});

// Bots play complete games across many seeds; every step must be legal and
// money/buildings must stay consistent.
test('bot games run to completion without illegal moves', () => {
  let finished = 0;
  for (let seed = 1; seed <= 60; seed++) {
    let clock = 0;
    const n = 2 + (seed % 7);
    const map = MAPS[seed % MAPS.length];
    const g = new Game({
      theme: resolveTheme(seed % 2 ? 'classic' : 'yot', map.id),
      rules: { ...DEFAULT_RULES, ...(seed % 2 ? {} : YOT.rules), startingCash: map.startingCash ?? 1500 },
      players: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot${i}`, character: 'spiky' as const, color: '#fff', isBot: true })),
      rng: seeded(seed),
      now: () => clock,
    });
    for (let step = 0; step < 20_000 && g.phase !== 'over'; step++) {
      clock += 100;
      let acted = false;
      for (const p of g.players) {
        const a = botAction(g, p.id);
        if (!a) continue;
        g.apply(p.id, a);
        acted = true;
        break;
      }
      if (!acted) {
        assert.equal(g.phase, 'auction', `stuck in ${g.phase} (seed ${seed})`);
        clock += 60_000;
        g.auctionTimeout();
      }
      for (const p of g.players) assert.ok(p.cash >= 0, `negative cash seed ${seed}`);
      const houses = Object.values(g.owned).reduce((s, o) => s + (o.houses < 5 ? o.houses : 0), 0);
      const hotels = Object.values(g.owned).filter(o => o.houses === 5).length;
      assert.equal(houses + g.housesLeft, 32, `house supply seed ${seed}`);
      assert.equal(hotels + g.hotelsLeft, 12, `hotel supply seed ${seed}`);
    }
    if (g.phase === 'over') finished++;
  }
  assert.ok(finished >= 50, `only ${finished}/60 bot games finished`);
});
