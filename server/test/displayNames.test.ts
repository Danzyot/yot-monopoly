// The welcome tour's server half: choosing a name (POST /api/auth/name), the
// next sign-in keeping it, and /api/auth/me saying whether the player is new.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Storage and the secret are read at import time.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-names-'));
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { makeDiscordProfile, signToken, verifyToken } = await import('../src/auth.ts');
const { authRoutes, NEW_PLAYER_MS } = await import('../src/routes/auth.ts');
const { recordConnection } = await import('../src/connections.ts');
const { addBan } = await import('../src/bans.ts');
const { chosenName, loadDisplayNames, resetDisplayNames, withChosenName } = await import('../src/displayNames.ts');

let server: Server;
let base = '';
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes());
  server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const tokenFor = (id: string, name = 'Discordy') => signToken(makeDiscordProfile({ id, username: name }));
const post = (token: string | null, body: unknown) => fetch(`${base}/api/auth/name`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
});

test('POST /api/auth/name: a cleaned name and a fresh token carrying it', async () => {
  resetDisplayNames();
  const res = await post(tokenFor('1001'), { name: '  Ｍｏｘｉｅ​  the   Chog  ' });
  assert.equal(res.status, 200);
  const body = await res.json() as { token: string; profile: { id: string; name: string } };
  assert.equal(body.profile.name, 'Moxie the Chog');
  assert.equal(body.profile.id, 'dc_1001');
  assert.equal(verifyToken(body.token)?.name, 'Moxie the Chog');
  assert.equal(chosenName('dc_1001'), 'Moxie the Chog');
});

test('POST /api/auth/name: refused signed out, blank, or banned', async () => {
  resetDisplayNames();
  assert.equal((await post(null, { name: 'Somebody' })).status, 401);
  const blank = await post(tokenFor('1002'), { name: ' ㅤ ' });
  assert.equal(blank.status, 400);
  assert.match(((await blank.json()) as { error: string }).error, /at least 2/);
  assert.equal(chosenName('dc_1002'), null);
  addBan({ kind: 'player', value: 'dc_1003', name: 'Bad', reason: 'test', by: 'test' });
  assert.equal((await post(tokenFor('1003'), { name: 'New Me' })).status, 403);
  assert.equal(chosenName('dc_1003'), null, 'a banned account cannot rename');
});

test('the next sign-in keeps the chosen name; accounts without one keep Discord\'s', async () => {
  resetDisplayNames();
  await post(tokenFor('1004'), { name: 'Chosen' });
  assert.equal(withChosenName(makeDiscordProfile({ id: '1004', username: 'discord_name' })).name, 'Chosen');
  assert.equal(withChosenName(makeDiscordProfile({ id: '1005', username: 'discord_name' })).name, 'discord_name');
});

test('chosen names survive a restart', async () => {
  resetDisplayNames();
  await post(tokenFor('1006'), { name: 'Kept' });
  await new Promise(r => setTimeout(r, 2_100)); // the store writes on a two-second debounce
  resetDisplayNames();
  loadDisplayNames();
  assert.equal(chosenName('dc_1006'), 'Kept');
});

test('GET /api/auth/me: newPlayer until the account is a few days old', async () => {
  const me = async (token: string) => (await (await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { newPlayer: boolean };
  const fresh = tokenFor('1007');
  assert.equal((await me(fresh)).newPlayer, true, 'never connected yet');
  recordConnection({ id: 'dc_1007', name: 'Discordy', avatar: '🎩' }, null);
  assert.equal((await me(fresh)).newPlayer, true, 'first seen just now');

  const realNow = Date.now;
  Date.now = () => realNow() - NEW_PLAYER_MS - 60_000;
  try { recordConnection({ id: 'dc_1008', name: 'Old Timer', avatar: '🎩' }, null); } finally { Date.now = realNow; }
  assert.equal((await me(tokenFor('1008'))).newPlayer, false);
});
