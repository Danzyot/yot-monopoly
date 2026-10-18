// Long seeded bot games with every rule toggle, checking the invariants after
// every move. Shared by the test suite (a modest run) and ad-hoc soak runs:
//   npx tsx server/test/sim.ts 500
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.ts';
import { autopilotAction, botAction } from '../src/engine/bot.ts';
import { DEFAULT_RULES, resolveTheme, type RuleConfig } from '../../shared/themes.ts';
import { MAPS } from '../../shared/maps.ts';
import { seeded } from './helpers.ts';

export interface SimStats {
  games: number;
  finished: number;
  byTime: number;
  turns: number;
  houses: number;
  hotels: number;
  trades: number;
  auctions: number;
  /** Bids placed, and log lines an auction produced (start, bids, drop-outs, result). */
  bids: number;
  auctionLines: number;
  bankruptcies: number;
  maxSteps: number;
  /** Seeds whose game hit the step cap. */
  unfinished: number[];
}

/** Check the money, building, jail-card and debt invariants of a running game. */
export function checkInvariants(g: Game, start: number, bank: number, where: string) {
  const money = g.players.reduce((s, p) => s + p.cash, 0) + g.pot;
  assert.equal(money, start + bank, `money conservation (${where})`);
  assert.ok(g.pot >= 0, `negative pot (${where})`);
  for (const p of g.players) {
    assert.ok(p.cash >= 0, `negative cash ${p.id} (${where})`);
    if (p.bankrupt) {
      assert.equal(p.cash, 0, `bankrupt with cash (${where})`);
      assert.equal(g.debtOf(p.id), 0, `bankrupt debtor (${where})`);
      assert.equal(g.ownedBy(p.id).length, 0, `bankrupt owner (${where})`);
    }
  }
  for (const d of g.debts) {
    assert.ok(d.amount > 0, `empty debt (${where})`);
    if (d.to) assert.ok(!g.player(d.to).bankrupt, `debt owed to a bankrupt player (${where})`);
    assert.notEqual(d.from, d.to, `self debt (${where})`);
  }
  if (g.rules.limitedBuildings) {
    assert.ok(g.housesLeft >= 0 && g.hotelsLeft >= 0, `bank supply below zero (${where})`);
  }
  const houses = Object.values(g.owned).reduce((s, o) => s + (o.houses < 5 ? o.houses : 0), 0);
  const hotels = Object.values(g.owned).filter(o => o.houses === 5).length;
  assert.equal(houses + g.housesLeft, 32, `house supply (${where})`);
  assert.equal(hotels + g.hotelsLeft, 12, `hotel supply (${where})`);
  for (const [k, o] of Object.entries(g.owned)) {
    const s = g.spaces[Number(k)];
    if (o.houses === 0) continue;
    assert.equal(s.kind, 'property', `building off a street (${where})`);
    assert.ok(g.ownsGroup(o.owner, s.group!), `building without the set (${where})`);
    assert.ok(!o.mortgaged, `building on a mortgage (${where})`);
    if (g.rules.evenBuild) {
      const lv = Object.entries(g.owned).filter(([i]) => g.spaces[Number(i)].group === s.group).map(([, x]) => x.houses);
      assert.ok(Math.max(...lv) - Math.min(...lv) <= 1, `uneven group ${s.group} ${lv} (${where})`);
    }
  }
  for (const deck of ['chance', 'chest'] as const) {
    const cards = deck === 'chance' ? g.theme.chance : g.theme.chest;
    const idx = cards.findIndex(c => c.effect.type === 'jailFree');
    if (idx < 0) continue;
    const inDeck = g.decks[deck].filter(i => i === idx).length;
    const held = g.players.reduce((s, p) => s + p.jailCards.filter(d => d === deck).length, 0);
    assert.equal(inDeck + held, 1, `${deck} jail card count (${where})`);
    assert.equal(g.decks[deck].length + held, cards.length, `${deck} deck size (${where})`);
  }
}

/** Play `games` all-bot games from `seed0`, every rule toggle varied by seed. */
export function simulate(games: number, seed0 = 1): SimStats {
  const st: SimStats = { games, finished: 0, byTime: 0, turns: 0, houses: 0, hotels: 0, trades: 0, auctions: 0, bids: 0, auctionLines: 0, bankruptcies: 0, maxSteps: 0, unfinished: [] };
  for (let seed = seed0; seed < seed0 + games; seed++) {
    const coin = seeded(seed * 104729);
    const map = MAPS[seed % MAPS.length];
    const rules: RuleConfig = {
      ...DEFAULT_RULES,
      startingCash: map.startingCash ?? 1500,
      freeParkingPot: coin(2) === 0,
      doubleOnGo: coin(2) === 0,
      auctions: coin(4) !== 0,
      evenBuild: coin(4) !== 0,
      limitedBuildings: coin(4) !== 0,
      noRentInJail: coin(3) === 0,
      speedDie: coin(2) === 0,
      minigames: coin(3) === 0,
      arcadeParking: coin(4) === 0,
      // Some games run the turn timer with one dozy human seat the timeouts and autopilot cover for.
      turnSeconds: seed % 4 === 0 ? 30 : 0,
      timeLimitMin: coin(5) === 0 ? 3 : 0,
    };
    let clock = 0;
    let bank = 0;
    const n = 2 + (seed % 5);
    const init = {
      theme: resolveTheme(seed % 3 === 0 ? 'chog' : 'classic', map.id),
      rules,
      rng: seeded(seed),
      now: () => clock,
      onBank: (x: number) => { bank += x; },
      onLog: (t: string) => { if (/is up for auction|is auctioning/.test(t)) st.auctions++; if (/ bid \$|is up for auction|is auctioning|Nobody bid|can't top|won .* for \$|auction/.test(t)) st.auctionLines++; },
    };
    let g = new Game({
      ...init,
      players: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot${i}`, character: 'spiky' as const, color: '#fff', isBot: !(seed % 4 === 0 && i === 0) })),
    });
    const start = g.players.reduce((s, p) => s + p.cash, 0);
    let step = 0;
    let idle = 0;
    for (; step < 30_000 && g.phase !== 'over'; step++) {
      clock += 250;
      let acted = false;
      for (const p of [g.current, ...g.players.filter(x => x !== g.current)]) {
        if (p.bankrupt) continue;
        // The human often dozes off; once marked away, autopilot plays for them.
        const away = !p.isBot && !!p.afk;
        if (!p.isBot && !away && coin(3) > 0) continue;
        let a = botAction(g, p.id);
        if (a && away) a = autopilotAction(g, p.id, a);
        if (!a) continue;
        if (a.type === 'acceptTrade') st.trades++;
        if (a.type === 'bid') st.bids++;
        g.apply(p.id, a, { auto: away });
        acted = true;
        break;
      }
      if (!acted) {
        if (g.phase === 'minigame') {
          assert.ok(++idle < 2000, `mini-game stalled (seed ${seed})`);
          g.minigameTimeout();
        } else if (g.phase === 'auction') {
          clock += 20_000;
          g.auctionTimeout();
        } else {
          const due = g.clockDeadline();
          assert.ok(due !== null, `stuck in ${g.phase} (seed ${seed}, step ${step})`);
          clock = Math.max(clock, due);
          g.clockTimeout();
        }
      } else idle = 0;
      if ((g.clockDeadline() ?? Infinity) <= clock) g.clockTimeout();
      checkInvariants(g, start, bank, `seed ${seed} step ${step}`);
      // Now and then, a server restart: the game must carry on from its snapshot.
      if (step % 397 === 396) {
        g = Game.restore(init, JSON.parse(JSON.stringify(g.snapshot())));
        checkInvariants(g, start, bank, `restored, seed ${seed} step ${step}`);
      }
    }
    st.maxSteps = Math.max(st.maxSteps, step);
    if (g.phase === 'over') st.finished++;
    else {
      st.unfinished.push(seed);
      if (process.env.SIM_DEBUG) {
        console.log(seed, JSON.stringify(rules), g.phase, g.turnNumber);
        console.log(g.players.map(p => `${p.id} ${p.cash} jail=${p.inJail} ${p.bankrupt ? 'OUT' : ''} deeds=${g.ownedBy(p.id).map(i => `${i}${g.owned[i].mortgaged ? 'm' : ''}${g.owned[i].houses || ''}`).join(',')}`).join('\n'));
        console.log(g.log.slice(-30).map(l => l.text).join('\n'));
      }
    }
    if (g.timeUp) st.byTime++;
    st.turns += g.turnNumber;
    st.bankruptcies += g.outOrder.length;
    st.houses += g.housesLeft < 32 ? 32 - g.housesLeft : 0;
    st.hotels += 12 - g.hotelsLeft;
  }
  return st;
}

if (process.argv[1]?.endsWith('sim.ts')) {
  const n = Number(process.argv[2] ?? 200);
  const t0 = Date.now();
  const st = simulate(n, Number(process.argv[3] ?? 1));
  console.log(JSON.stringify({ ...st, avgTurns: Math.round(st.turns / st.games), ms: Date.now() - t0 }, null, 1));
}
