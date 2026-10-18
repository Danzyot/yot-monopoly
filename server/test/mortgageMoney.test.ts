// Mortgage interest is 10%, rounded up to the next whole dollar, in integer
// maths: 100 * 1.1 is 110.00000000000001 in floating point and used to cost $111.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interestOn, mortgageInterest, mortgageValue, unmortgageCost, type SpaceDef } from '../../shared/board.ts';
import { liftCost } from '../../shared/holdings.ts';
import { scripted } from './helpers.ts';

const deed = (mortgage: number): SpaceDef => ({ kind: 'property', name: 'Test', price: mortgage * 2 }) as SpaceDef;
const own = (owner: string, houses = 0, mortgaged = false) => ({ owner, houses, mortgaged });

test('lifting a mortgage costs principal plus 10% rounded up, with no float overcharge', () => {
  const cases: [number, number][] = [[50, 55], [100, 110], [110, 121], [200, 220], [30, 33], [75, 83], [175, 193], [1, 2]];
  for (const [mortgage, cost] of cases) {
    const s = deed(mortgage);
    assert.equal(mortgageValue(s), mortgage);
    assert.equal(unmortgageCost(s), cost, `$${mortgage} mortgage`);
    assert.equal(liftCost([s], 0, own('p0', 0, true)), cost);
    assert.equal(mortgageInterest(s), cost - mortgage);
  }
  // Exhaustive: interest is exactly ceil(v/10), via integers.
  for (let v = 1; v <= 2000; v++) assert.equal(interestOn(v), Math.floor((v + 9) / 10), `$${v}`);
});

test('engine: unmortgaging $50, $100, $110, $200 and odd mortgages charges exact amounts', () => {
  const { g, act } = scripted(2, { auctions: false });
  const p = g.player('p0');
  const lift = (space: number) => {
    g.owned[space] = own('p0', 0, true);
    const before = p.cash;
    act('p0', { type: 'unmortgage', space });
    return before - p.cash;
  };
  const byMortgage = (m: number) => {
    const i = g.spaces.findIndex((s, k) => s.price !== undefined && mortgageValue(s) === m && !g.owned[k]);
    assert.ok(i >= 0, `a deed with a $${m} mortgage`);
    return i;
  };
  assert.equal(lift(byMortgage(50)), 55);
  assert.equal(lift(byMortgage(100)), 110);
  assert.equal(lift(byMortgage(200)), 220);
  assert.equal(lift(byMortgage(175)), 193);
  assert.equal(lift(byMortgage(30)), 33);
});

test('engine: trade interest on received mortgaged deeds is 10% rounded up per deed', () => {
  const { g, act } = scripted(2, { auctions: false });
  g.owned[39] = own('p0', 0, true); // mortgage 200 -> interest 20
  g.owned[37] = own('p0', 0, true); // mortgage 175 -> interest 18 (17.5 rounded up)
  g.owned[1] = own('p0', 0, true);  // mortgage 30  -> interest 3
  const side = (cash: number, spaces: number[] = []) => ({ cash, spaces, jailCards: 0 });
  act('p0', { type: 'proposeTrade', to: 'p1', give: side(0, [1, 37, 39]), get: side(0) });
  act('p1', { type: 'acceptTrade', id: g.trades[0].id });
  assert.equal(g.player('p1').cash, 1500 - 20 - 18 - 3);
});
