// The home page's Chog of the Day (shared/chogs/daily.ts): one token per UTC day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chogOfTheDay } from '../../shared/chogs/daily.ts';
import { CHOG_SUPPLY, isChogTokenId } from '../../shared/chogs/traits.ts';

test('Chog of the Day: the same all UTC day, a new one at UTC midnight', () => {
  const morning = Date.UTC(2026, 9, 20, 0, 0, 1);
  const night = Date.UTC(2026, 9, 20, 23, 59, 59);
  assert.equal(chogOfTheDay(morning), chogOfTheDay(night));
  assert.notEqual(chogOfTheDay(night), chogOfTheDay(night + 2_000));
  assert.equal(chogOfTheDay(new Date(morning)), chogOfTheDay(morning));
});

test('Chog of the Day: every token once in a full cycle, each a real token', () => {
  const start = Date.UTC(2026, 0, 1);
  const seen = new Set<number>();
  for (let d = 0; d < CHOG_SUPPLY; d++) {
    const id = chogOfTheDay(start + d * 86_400_000);
    assert.ok(isChogTokenId(id), String(id));
    seen.add(id);
  }
  assert.equal(seen.size, CHOG_SUPPLY);
  // Neighbouring days are far apart in the collection.
  assert.ok(Math.abs(chogOfTheDay(start) - chogOfTheDay(start + 86_400_000)) > 10);
});
