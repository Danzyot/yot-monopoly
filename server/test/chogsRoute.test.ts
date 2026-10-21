// GET /api/chogs/:id: one token's traits for the home page's Chog of the Day
// (the page itself does not ship the trait table).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { mountChogs } from '../src/routes/chogs.ts';
import { chogCard } from '../../shared/chogs/card.ts';
import { chogOfTheDay } from '../../shared/chogs/daily.ts';
import { BACKGROUND_COLORS, CHOG_SUPPLY, traitsOf } from '../../shared/chogs/traits.ts';
import { CHOG_SUPPLY as META_SUPPLY, chogName } from '../../shared/chogs/meta.ts';

test('the card: the token, its traits and its frame colour', () => {
  for (let id = 1; id <= CHOG_SUPPLY; id++) {
    const card = chogCard(id);
    assert.ok(card, String(id));
    assert.deepEqual(card.traits, traitsOf(id));
    const bg = card.traits.Background;
    assert.equal(card.background, (bg && BACKGROUND_COLORS[bg]) || '#eaa2f6');
  }
  assert.equal(chogCard(0), null);
  assert.equal(chogCard(CHOG_SUPPLY + 1), null);
  // The trait-free constants agree with the table's.
  assert.equal(META_SUPPLY, CHOG_SUPPLY);
  assert.equal(chogName(7), 'Chog #7');
});

test('GET /api/chogs/:id answers with the card, cached a day; anything else is a 404', async () => {
  const app = express();
  mountChogs(app);
  const server = createServer(app).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  try {
    const id = chogOfTheDay();
    const res = await fetch(`${base}/api/chogs/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('cache-control') ?? '', /public, max-age=86400/);
    assert.deepEqual(await res.json(), JSON.parse(JSON.stringify(chogCard(id))));
    for (const bad of ['0', String(CHOG_SUPPLY + 1), 'abc', '1.5', '-3', '0x10', '123456']) {
      const r = await fetch(`${base}/api/chogs/${bad}`);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(await r.json(), { error: 'No such Chog' });
    }
  } finally {
    server.close();
  }
});
