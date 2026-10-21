// The two boards with rules of their own: Blitz (a 24-space loop where the
// salary rises every lap and double 1s or 6s scoop the jackpot) and
// Crossroads (a loop with an Express lane across it, and points at Junction
// that whoever stops there throws for everyone). Their layout, the shared
// route maths, the engine rules, the bots and the room's defaults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.ts';
import { botAction } from '../src/engine/bot.ts';
import { Room, type RoomHooks } from '../src/rooms.ts';
import {
  BLITZ_MAP, CROSSROADS_MAP, MAPS, getMap, mapShape, salaryFor, shapeOf, validateMap, validateMaps,
} from '../../shared/maps.ts';
import { ahead, branch, legRoute, routeTo, stepBack, stepFrom, walk } from '../../shared/route.ts';
import { DEFAULT_RULES, resolveTheme } from '../../shared/themes.ts';
import { checkInvariants } from './sim.ts';
import { scripted, seeded } from './helpers.ts';

const XR = mapShape(CROSSROADS_MAP);

/** Turn down a deed on offer and let its auction run out with nobody bidding. */
function skipBuy(sc: ReturnType<typeof scripted>, id: string) {
  if (sc.g.phase === 'buy') sc.act(id, { type: 'decline' });
  while (sc.g.phase === 'auction') {
    sc.tick(60_000);
    sc.g.auctionTimeout();
  }
}
const LANE0 = XR.ring; // the lane's first space (48)
const LANE_LAST = XR.size - 1; // its last (58)

test('maps: every board is valid and has a size of its own (the renderer finds a lane by size)', () => {
  validateMaps();
  assert.deepEqual(MAPS.map(m => m.spaces.length), [40, 32, 48, 24, 59]);
  assert.equal(shapeOf(59).lane?.from, 6);
  assert.equal(shapeOf(40).lane, null);
  // A lane has to fit the renderer: across the middle, one space per edge tile.
  assert.throws(() => validateMap({ ...CROSSROADS_MAP, lane: { from: 5, to: 30, length: 11 } }), /middle/);
  assert.throws(() => validateMap({ ...CROSSROADS_MAP, spaces: CROSSROADS_MAP.spaces.slice(0, -1), lane: { from: 6, to: 30, length: 10 } }), /lane must have 11/);
  // Corner squares belong on the loop's corners, never on the lane.
  const bad = [...CROSSROADS_MAP.spaces];
  bad[LANE0] = { kind: 'parking', name: 'Free Parking' };
  assert.throws(() => validateMap({ ...CROSSROADS_MAP, spaces: bad }), /corner/);
});

test('maps: Blitz and Crossroads are what they say (sizes, sets, players, Chog names)', () => {
  assert.equal(BLITZ_MAP.spaces.length, 24);
  assert.deepEqual(BLITZ_MAP.players, [2, 4]);
  const sets = (m: typeof BLITZ_MAP) => new Set(m.spaces.filter(s => s.kind === 'property').map(s => s.group));
  assert.equal(sets(BLITZ_MAP).size, 6);
  for (const g of sets(BLITZ_MAP)) assert.equal(BLITZ_MAP.spaces.filter(s => s.group === g).length, 2, `${g} is a pair`);
  // More of the board draws cards than on the classic one.
  const cards = (m: typeof BLITZ_MAP) => m.spaces.filter(s => s.kind === 'chance' || s.kind === 'chest').length / m.spaces.length;
  assert.ok(cards(BLITZ_MAP) > cards(getMap('classic')));
  assert.equal(sets(CROSSROADS_MAP).size, 10);
  assert.deepEqual(CROSSROADS_MAP.players, [4, 8]);
  // Every space has its own Chog-season name (decks keep the edition's deck names).
  for (const m of [BLITZ_MAP, CROSSROADS_MAP]) {
    const chog = resolveTheme('chog', m.id);
    const orig = resolveTheme('classic', m.id);
    m.spaces.forEach((s, i) => {
      if (s.kind === 'chance' || s.kind === 'chest') return;
      assert.notEqual(chog.spaces[i].name, orig.spaces[i].name, `${m.id} ${i} keeps its Original name in the Chog look`);
    });
  }
});

test('route: the loop, the lane, going back, the way ahead', () => {
  // A plain loop wraps.
  const loop = mapShape(getMap('classic'));
  assert.deepEqual(walk(loop, 38, 4), [39, 0, 1, 2]);
  assert.deepEqual(walk(loop, 1, -3), [0, 39, 38]);
  // Crossroads: the fork sends the walk up the lane or on round the loop.
  assert.equal(stepFrom(XR, 6, true), LANE0);
  assert.equal(stepFrom(XR, 6, false), 7);
  assert.equal(stepFrom(XR, LANE_LAST), 30, 'the lane comes out on Terminus');
  assert.equal(stepBack(XR, LANE0), 6, 'back down the lane to Junction');
  assert.equal(stepBack(XR, 30), 29, 'back from Terminus goes round the loop');
  assert.deepEqual(walk(XR, 4, 4, true), [5, 6, LANE0, LANE0 + 1]);
  assert.deepEqual(walk(XR, 4, 4, false), [5, 6, 7, 8]);
  // The shortest way to Terminus from GO is the lane; a full lap the short way is 36.
  assert.equal(routeTo(XR, 0, 30).length, 6 + 11 + 1);
  assert.equal(routeTo(XR, 0, 0).length, 36);
  assert.equal(routeTo(XR, 7, 30).length, 23, 'already on the long way: round the loop');
  // Ahead: each space once, nearest first, never where you stand.
  const a = ahead(XR, 0);
  assert.equal(new Set(a.map(x => x.i)).size, XR.size - 1);
  assert.ok(!a.some(x => x.i === 0));
  assert.equal(a.find(x => x.i === 30)!.d, 18);
  // A recorded walk is retraced the way it went.
  assert.deepEqual(legRoute(XR, 4, 4, LANE0 + 1), [5, 6, LANE0, LANE0 + 1]);
  assert.deepEqual(legRoute(XR, 4, 4, 8), [5, 6, 7, 8]);
  // The two ways between the fork and Terminus.
  assert.equal(branch(XR, true).length, 11);
  assert.equal(branch(XR, false).length, 23);
});

test('Blitz: every lap pays more, up to the cap; doubling on GO doubles the raised salary', () => {
  const sc = scripted(2, { goSalary: 100, doubleOnGo: true }, 'blitz');
  const { g, dice, act } = sc;
  const p = g.player('p0');
  const paid: number[] = [];
  for (let lap = 0; lap < 9; lap++) {
    p.position = 20;
    const before = p.cash;
    dice(1, 3); // 20 → 0: lands on GO (double)
    act('p0', { type: 'roll' });
    paid.push(p.cash - before);
    act('p0', { type: 'endTurn' });
    dice(1, 2);
    act('p1', { type: 'roll' });
    skipBuy(sc, 'p1');
    if (g.current.id === 'p1' && g.phase === 'done') act('p1', { type: 'endTurn' });
  }
  assert.deepEqual(paid, [200, 240, 280, 320, 360, 400, 440, 440, 440]);
  assert.equal(p.laps, 9);
  assert.equal(salaryFor(BLITZ_MAP, 100, 0), 100);
  assert.equal(salaryFor(BLITZ_MAP, 100, 50), 220);
  assert.equal(salaryFor(getMap('classic'), 200, 50), 200, 'other boards pay the same every lap');
});

test('Blitz: double 1s or double 6s scoop the jackpot; other doubles do not; no jackpot rule, nothing', () => {
  const sc = scripted(2, { freeParkingPot: true }, 'blitz');
  const { g, dice, act } = sc;
  g.pot = 300;
  dice(2, 2);
  act('p0', { type: 'roll' });
  assert.equal(g.pot, 300, 'double 2s are just doubles');
  skipBuy(sc, 'p0');
  dice(6, 6);
  act('p0', { type: 'roll' });
  assert.ok(g.log.some(l => l.text.startsWith('🎰 Double 6s! P0 scooped the Jackpot pot') && l.amount === 300 && l.reason === 'pot'));
  // Without the jackpot house rule there is no pot to win.
  const off = scripted(2, { freeParkingPot: false }, 'blitz');
  off.g.pot = 0;
  off.dice(1, 1);
  off.act('p0', { type: 'roll' });
  assert.ok(!off.g.log.some(l => l.text.includes('Double 1s')));
});

test('Crossroads: past Junction the points decide the way; the move records the tiles it walked', () => {
  const sc = scripted(4, {}, 'crossroads');
  const { g, dice, act } = sc;
  assert.equal(g.points, 'lane');
  assert.equal(g.view().points, 'lane');
  g.player('p0').position = 3;
  dice(3, 4); // 3 → 4, 5, 6 (Junction), then the lane: 48, 49, 50, 51
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, LANE0 + 3);
  const leg = g.lastMove!.legs[0];
  assert.deepEqual([leg.steps, leg.via], [7, [4, 5, 6, LANE0, LANE0 + 1, LANE0 + 2, LANE0 + 3]]);
  // Points set the long way: the next piece goes round.
  g.points = 'loop';
  skipBuy(sc, 'p0');
  act('p0', { type: 'endTurn' });
  g.player('p1').position = 3;
  dice(3, 4);
  act('p1', { type: 'roll' });
  assert.equal(g.player('p1').position, 10);
  // Off the end of the lane onto Terminus, and on round to GO for the salary.
  g.points = 'lane';
  skipBuy(sc, 'p1');
  act('p1', { type: 'endTurn' });
  const p2 = g.player('p2');
  p2.position = LANE_LAST - 1;
  dice(1, 2);
  act('p2', { type: 'roll' });
  assert.equal(p2.position, 31);
  assert.deepEqual(g.lastMove!.legs[0].via, [LANE_LAST, 30, 31]);
  // Plain loops never carry `via`.
  const c = scripted(2);
  c.dice(3, 4);
  c.act('p0', { type: 'roll' });
  assert.equal(c.g.lastMove!.legs[0].via, undefined);
});

test('Crossroads: stopping on Junction throws the points for everyone, then the station is bought or paid as usual', () => {
  const { g, dice, act } = scripted(4, {}, 'crossroads');
  g.player('p0').position = 1;
  dice(2, 3); // 1 → 6, Junction (a station)
  act('p0', { type: 'roll' });
  assert.equal(g.phase, 'choose');
  const c = g.choice!;
  assert.equal(c.kind, 'points');
  assert.deepEqual(c.kind === 'points' && [c.lane, c.loop], [LANE0, 7]);
  assert.throws(() => act('p0', { type: 'choose', value: 30 }), /lane or the long way/);
  assert.throws(() => act('p1', { type: 'choose', value: 7 }), /Not your turn/);
  act('p0', { type: 'choose', value: 7 });
  assert.equal(g.points, 'loop');
  assert.ok(g.log.some(l => l.text.includes('threw the points')));
  assert.equal(g.phase, 'buy', 'then the station itself');
  act('p0', { type: 'buy' });
  assert.equal(g.owned[6].owner, 'p0');
  // The points survive a restart.
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const back = Game.restore({ theme: g.theme, rules: g.rules }, snap);
  assert.equal(back.points, 'loop');
  // Leaving them as they were says so; then the station's rent is paid as usual.
  act('p0', { type: 'endTurn' });
  g.player('p1').position = 2;
  dice(1, 3);
  act('p1', { type: 'roll' });
  act('p1', { type: 'choose', value: 7 });
  assert.ok(g.log.some(l => l.text.includes('P1 left the points as they were')));
  assert.ok(g.log.some(l => l.text === 'P1 paid $25 to P0 (rent on Junction).'));
});

test('Crossroads: a nearest-railroad card onto Junction throws the points and still charges double rent', () => {
  const { g, act, dice } = scripted(4, {}, 'crossroads');
  g.owned[6] = { owner: 'p1', houses: 0, mortgaged: false };
  const nearest = g.theme.chance.findIndex(cd => cd.effect.type === 'nearest' && cd.effect.kind === 'railroad');
  g.decks.chance = [nearest];
  g.player('p0').position = 43;
  dice(1, 1); // 43 → 45 (Chance): nearest railroad ahead is Junction past GO
  act('p0', { type: 'roll' });
  assert.equal(g.player('p0').position, 6);
  assert.equal(g.phase, 'choose');
  const before = g.player('p1').cash;
  act('p0', { type: 'choose', value: LANE0 });
  assert.equal(g.player('p1').cash - before, 50, 'twice the one-station rent');
});

test('Crossroads: go back 3 from the lane walks back down it; a card to a lane space takes the lane whatever the points', () => {
  const { g, act, dice } = scripted(4, {}, 'crossroads');
  const back = g.theme.chance.findIndex(cd => cd.effect.type === 'back');
  g.decks.chance = [back];
  // 50 is the lane's Chance square.
  g.player('p0').position = LANE0;
  g.points = 'loop';
  dice(1, 1); // 48 → 50 (Chance) → back 3: 49, 48, 6 (Junction)
  act('p0', { type: 'roll' });
  const legs = g.lastMove!.legs;
  assert.deepEqual(legs.map(l => [l.to, l.kind, l.steps]), [[LANE0 + 2, 'roll', 2], [6, 'card', -3]]);
  assert.deepEqual(legs[1].via, [LANE0 + 1, LANE0, 6]);
  assert.equal(g.phase, 'choose', 'landing on Junction by a card throws the points too');
  act('p0', { type: 'choose', value: 7 });
  // An advance card to a lane space with the points against it: the lane anyway.
  const theme = resolveTheme('classic', 'crossroads');
  const faces = [0, 0];
  const q = new Game({
    theme: { ...theme, chance: [{ text: 'Advance to Overpass.', effect: { type: 'advance', to: LANE0 + 3 } }] },
    rules: { ...DEFAULT_RULES },
    players: ['a', 'b'].map(id => ({ id, name: id, character: 'spiky' as const, color: '#fff', isBot: false })),
    rng: k => (faces.length ? faces.shift()! : 0) % k,
  });
  q.points = 'loop';
  q.player('a').position = 3;
  q.apply('a', { type: 'roll' }); // 1 + 1: 3 → 5 (Chance) → Overpass
  assert.equal(q.player('a').position, LANE0 + 3);
  assert.deepEqual(q.lastMove!.legs[1].via, [6, LANE0, LANE0 + 1, LANE0 + 2, LANE0 + 3]);
});

test('Crossroads: bots throw the points toward their own rents; timeouts use the same pick', () => {
  const { g, dice, act, tick } = scripted(4, { turnSeconds: 30 }, 'crossroads');
  // p0 owns the built-up purple set on the lane; p1 a hotel row in the west.
  for (const i of [54, 56, 57]) g.owned[i] = { owner: 'p0', houses: 3, mortgaged: false };
  for (const i of [13, 15, 16]) g.owned[i] = { owner: 'p1', houses: 5, mortgaged: false };
  g.points = 'loop';
  g.player('p0').position = 1;
  dice(2, 3);
  act('p0', { type: 'roll' });
  assert.equal(g.phase, 'choose');
  assert.equal(g.bestPoints('p0'), 'lane');
  assert.equal(g.bestPoints('p1'), 'loop');
  assert.deepEqual(botAction(g, 'p0'), { type: 'choose', value: LANE0 });
  // A human who lets the clock run out gets the same pick.
  tick(31_000);
  g.clockTimeout();
  assert.equal(g.points, 'lane');
});

test('bots finish whole games on Blitz and Crossroads, every invariant intact', () => {
  for (const [mapId, sizes] of [['blitz', [2, 3, 4]], ['crossroads', [4, 6, 8]]] as const) {
    for (const n of sizes) {
      for (let seed = 1; seed <= 4; seed++) {
        let clock = 0;
        let bank = 0;
        const map = getMap(mapId);
        const g = new Game({
          theme: resolveTheme(seed % 2 ? 'chog' : 'classic', mapId),
          rules: { ...DEFAULT_RULES, startingCash: map.startingCash!, goSalary: map.goSalary!, ...map.rules, turnSeconds: 0 },
          players: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, character: 'spiky' as const, color: '#fff', isBot: true })),
          rng: seeded(seed * 31 + n),
          now: () => clock,
          onBank: x => { bank += x; },
        });
        const start = g.players.reduce((s, p) => s + p.cash, 0);
        let step = 0;
        for (; step < 40_000 && g.phase !== 'over'; step++) {
          clock += 250;
          let acted = false;
          for (const p of [g.current, ...g.players.filter(x => x !== g.current)]) {
            const a = p.bankrupt ? null : botAction(g, p.id);
            if (!a) continue;
            g.apply(p.id, a);
            acted = true;
            break;
          }
          if (acted) { /* next step */ } else if (g.phase === 'minigame') g.minigameTimeout();
          else if (g.phase === 'auction') { clock += 20_000; g.auctionTimeout(); } else { clock = Math.max(clock, g.clockDeadline() ?? clock); g.clockTimeout(); }
          checkInvariants(g, start, bank, `${mapId} ${n}p seed ${seed} step ${step}`);
        }
        assert.equal(g.phase, 'over', `${mapId} ${n}p seed ${seed} did not finish in ${step} steps`);
      }
    }
  }
});

test('rooms: picking a board brings its economy; leaving Blitz brings the usual salary back', () => {
  const hooks: RoomHooks = { onChange() {}, onEvent() {}, onFinished() {} };
  const r = new Room('MAPS1', 'h', hooks);
  r.configure('h', false, { mapId: 'blitz' });
  assert.deepEqual([r.rules.goSalary, r.rules.startingCash, r.rules.freeParkingPot, r.rules.maxPlayers <= 4], [100, 1000, true, true]);
  r.configure('h', false, { themeId: 'classic' });
  assert.equal(r.rules.freeParkingPot, true, "Blitz keeps its jackpot whatever the look");
  r.configure('h', false, { mapId: 'crossroads' });
  assert.deepEqual([r.rules.goSalary, r.rules.startingCash], [150, 1400]);
  r.configure('h', false, { mapId: 'classic' });
  assert.deepEqual([r.rules.goSalary, r.rules.startingCash], [200, 1500]);
});
