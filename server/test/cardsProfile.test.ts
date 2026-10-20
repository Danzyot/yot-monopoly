// The Cards half of a public profile (GET /api/players/:id/cards): matches,
// wins, points and recent results from the Cards results store, for players
// who never touched Monopoly as much as for those who did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-cards-profile-'));

const { default: express } = await import('express');
const { mountCardsProfile } = await import('../src/routes/cardsProfile.ts');
const { buildCardsProfile, cardsLeaderboard, loadCardsResults, recordCardsResult } = await import('../src/cards/stats.ts');
const { CardsRegistry } = await import('../src/cards/rooms.ts');
const { cardsBotAction } = await import('../src/cards/bot.ts');
const { setFeatures } = await import('../src/features.ts');
const { seeded } = await import('./cardsHelpers.ts');
type Record_ = import('../src/cards/stats.ts').CardsRecord;
type CardsRoom = InstanceType<typeof CardsRegistry>['rooms'] extends Map<string, infer R> ? R : never;

const place = (id: string, score: number, isBot = false, extra: Partial<Record_['places'][number]> = {}) =>
  ({ id, name: id.toUpperCase(), isBot, score, ...extra });
const rec = (code: string, endedAt: number, places: Record_['places'], match: 'single' | 'points' = 'single'): Record_ =>
  ({ game: 'cards', code, startedAt: endedAt - 60_000, endedAt, rounds: match === 'single' ? 1 : 3, match, targetScore: 200, places });

test('buildCardsProfile: games, wins, points like the leaderboard, score and the latest matches first', () => {
  const records: Record_[] = [
    rec('AAAAA', 1_000, [place('ann', 120, false, { avatar: '🦊', character: 'chog' }), place('ben', 0), place('bot1', 0, true)]),
    rec('BBBBB', 2_000, [place('ben', 90), place('ann', 30, false, { left: true })], 'points'),
    rec('CCCCC', 3_000, [place('ann', 50, false, { avatar: '🐸' }), place('bot1', 0, true), place('bot2', 0, true)]),
  ];
  const ann = buildCardsProfile('ann', records)!;
  assert.equal(ann.games, 3);
  assert.equal(ann.wins, 2);
  assert.equal(ann.winRate, 2 / 3);
  assert.equal(ann.rankedGames, 2, 'a match against bots alone is not ranked');
  assert.equal(ann.points, 2 + 0, 'a point per opponent beaten, ranked matches only');
  assert.equal(ann.score, 200);
  assert.equal(ann.avatar, '🐸', 'the latest avatar');
  assert.equal(ann.firstGameAt, 1_000);
  assert.equal(ann.lastGameAt, 3_000);
  assert.deepEqual(ann.recent.map(g => g.code), ['CCCCC', 'BBBBB', 'AAAAA'], 'latest first');
  assert.deepEqual(ann.recent[1], {
    code: 'BBBBB', endedAt: 2_000, place: 2, of: 2, rounds: 3, match: 'points', targetScore: 200, score: 30, left: true,
    character: null, opponents: [{ id: 'ben', name: 'BEN', isBot: false, place: 1 }],
  });
  assert.equal(ann.recent[2].character, 'chog');

  const ben = buildCardsProfile('ben', records)!;
  assert.equal(ben.games, 2);
  assert.equal(ben.wins, 1);
  assert.equal(ben.points, 1 + 1);
  assert.equal(ben.avatar, '🃏', 'no avatar recorded');
  assert.equal(buildCardsProfile('bot1', records), null, 'bots have no profile');
  assert.equal(buildCardsProfile('nobody', records), null);
  assert.equal(buildCardsProfile('ann', []), null);

  const many = Array.from({ length: 30 }, (_, i) => rec(`M${i}`, 10_000 + i, [place('ann', i), place('ben', 0)]));
  const busy = buildCardsProfile('ann', many)!;
  assert.equal(busy.games, 30);
  assert.equal(busy.recent.length, 20, 'only the latest twenty matches are listed');
  assert.equal(busy.recent[0].code, 'M29');
});

let server: HttpServer;
let base = '';
before(async () => {
  loadCardsResults();
  const app = express();
  mountCardsProfile(app);
  await new Promise<void>(r => { server = app.listen(0, '127.0.0.1', () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** A real match between two people (and a bot), played to its end and recorded as the server does. */
function playMatch(): CardsRoom {
  const reg = new CardsRegistry({ onChange() {}, onEvent() {}, onFinished(r) { recordCardsResult(r); } }, 1e9, { rng: seeded(4) });
  const r = reg.create('dc_cardsonly');
  r.join({ id: 'dc_cardsonly', name: 'Cardsy', avatar: '🃏' });
  r.join({ id: 'dc_friend', name: 'Friend', avatar: '🙂' });
  r.addBot('dc_cardsonly', false);
  r.start('dc_cardsonly', false);
  for (let i = 0; i < 5_000 && r.status === 'playing'; i++) {
    const g = r.game!;
    let moved = false;
    for (const pl of g.players) {
      const a = cardsBotAction(g, pl.id);
      if (!a) continue;
      try { r.act(pl.id, a, true); moved = true; break; } catch { /* another seat */ }
    }
    if (!moved) break;
  }
  assert.equal(r.game!.phase, 'over', 'the match ended');
  reg.delete(r.code);
  return r;
}

test('GET /api/players/:id/cards: a Cards-only player has a profile, an unknown one gets null', async () => {
  setFeatures({ leaderboard: true });
  const room = playMatch();
  const res = await fetch(`${base}/api/players/dc_cardsonly/cards`);
  assert.equal(res.status, 200);
  const { profile } = await res.json() as { profile: ReturnType<typeof buildCardsProfile> };
  assert.ok(profile, 'played a match: has a profile');
  assert.equal(profile.name, 'Cardsy');
  assert.equal(profile.games, 1);
  assert.equal(profile.rankedGames, 1, 'two people at the table');
  assert.equal(profile.recent[0].code, room.code);
  assert.equal(profile.recent[0].of, 3);
  const row = cardsLeaderboard().find(x => x.id === 'dc_cardsonly')!;
  assert.equal(profile.points, row.points, 'the same points as the Cards leaderboard');
  assert.equal(profile.wins, row.wins);

  assert.deepEqual(await (await fetch(`${base}/api/players/dc_stranger/cards`)).json(), { profile: null });
  assert.deepEqual(await (await fetch(`${base}/api/players/${encodeURIComponent('bad id!')}/cards`)).json(), { profile: null });

  setFeatures({ leaderboard: false });
  const off = await fetch(`${base}/api/players/dc_cardsonly/cards`);
  assert.equal(off.status, 404, 'on the leaderboard switch, like the Monopoly profile');
  setFeatures({ leaderboard: true });
});
