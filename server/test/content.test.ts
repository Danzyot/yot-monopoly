import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Storage and operator identity are read at import time.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-content-'));
process.env.ADMIN_DISCORD_IDS = '999';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const c = await import('../src/content.ts');
const { mountContent } = await import('../src/routes/content.ts');
const { resolveTheme, getTheme } = await import('../../shared/themes.ts');
const { getCharacter } = await import('../../shared/characters.ts');
const { MINIGAME_INFO } = await import('../../shared/minigames.ts');
const { scripted } = await import('./helpers.ts');

const op = signToken({ id: 'dc_999', name: 'Op', avatar: '🎩', provider: 'discord', discord: { id: '999', username: 'op' } });
const pleb = signToken({ id: 'dc_1', name: 'Pleb', avatar: '🎩', provider: 'discord', discord: { id: '1', username: 'pleb' } });

let server: Server;
let base = '';
before(async () => {
  const app = express();
  app.use(express.json());
  mountContent(app);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { c.resetContent(); server.close(); });

async function call(method: 'PUT' | 'DELETE', body: unknown, token: string | null = op) {
  const res = await fetch(`${base}/api/admin/content`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as { error?: string; overrides?: ReturnType<typeof c.getContent> } };
}
const getAll = async () => (await (await fetch(`${base}/api/content`)).json() as { overrides: ReturnType<typeof c.getContent> }).overrides;
const BOARDWALK = { kind: 'space', theme: 'classic', map: 'classic', index: 39 };

test('GET is public and starts empty', async () => {
  const o = await getAll();
  assert.deepEqual(o, { spaces: {}, cards: {}, editions: {}, characters: {}, minigames: {} });
});

test('non-operators and signed-out visitors are refused', async () => {
  assert.equal((await call('PUT', { item: BOARDWALK, text: 'Hacked' }, null)).status, 401);
  assert.equal((await call('PUT', { item: BOARDWALK, text: 'Hacked' }, pleb)).status, 403);
  assert.equal((await call('DELETE', {}, pleb)).status, 403);
  assert.deepEqual((await getAll()).spaces, {});
  assert.equal(resolveTheme('classic', 'classic').spaces[39].name, 'Boardwalk');
});

test('rename a space: stored, persisted, applied to the theme, and reset', async () => {
  const r = await call('PUT', { item: BOARDWALK, text: '  Yot‮   Walk ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.overrides?.spaces['classic:classic']?.['39'], 'Yot Walk', 'bidi stripped, whitespace collapsed');
  assert.equal(resolveTheme('classic', 'classic').spaces[39].name, 'Yot Walk');
  // Card text naming the space follows it.
  assert.ok(resolveTheme('classic', 'classic').chance.some(x => x.text === 'Advance to Yot Walk.'));
  // Other looks on the same board keep their own name.
  assert.equal(resolveTheme('tptv', 'classic').spaces[39].name, 'TPTV HQ');

  const file = join(process.env.DATA_DIR!, 'content-overrides.json');
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).spaces['classic:classic']['39'], 'Yot Walk');

  // A restart reads it back.
  c.loadContent();
  assert.equal(resolveTheme('classic', 'classic').spaces[39].name, 'Yot Walk');

  assert.equal((await call('PUT', { item: BOARDWALK, text: null })).status, 200);
  assert.equal(resolveTheme('classic', 'classic').spaces[39].name, 'Boardwalk');
  await call('PUT', { item: BOARDWALK, text: 'X Walk' });
  await call('PUT', { item: BOARDWALK, text: 'Boardwalk' });
  assert.deepEqual((await getAll()).spaces, {}, 'setting the default back clears the override');
});

test('validation: lengths, types, unknown items, bad placeholders', async () => {
  const bad = [
    { item: BOARDWALK, text: 'x'.repeat(33) },
    { item: BOARDWALK, text: 42 },
    { item: { ...BOARDWALK, index: 40 }, text: 'x' },
    { item: { ...BOARDWALK, index: -1 }, text: 'x' },
    { item: { ...BOARDWALK, map: 'nowhere' }, text: 'x' },
    { item: { ...BOARDWALK, theme: 'nope' }, text: 'x' },
    { item: { kind: 'card', theme: 'classic', map: 'classic', deck: 'chance', index: 99 }, text: 'x' },
    { item: { kind: 'card', theme: 'classic', map: 'classic', deck: 'luck', index: 0 }, text: 'x' },
    { item: { kind: 'card', theme: 'classic', map: 'classic', deck: 'chance', index: 0 }, text: 'Go to {40}.' },
    { item: { kind: 'card', theme: 'classic', map: 'classic', deck: 'chance', index: 0 }, text: 'Go to {here}.' },
    { item: { kind: 'edition', id: 'classic', field: 'currency' }, text: 'DOLLARS' },
    { item: { kind: 'edition', id: 'classic', field: 'palette' }, text: 'x' },
    { item: { kind: 'character', id: 'nobody', field: 'name' }, text: 'x' },
    { item: { kind: 'minigame', id: 'wheel', field: 'icon' }, text: 'x' },
    { item: { kind: 'rules' }, text: 'x' },
    {},
  ];
  for (const body of bad) {
    const r = await call('PUT', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.body.error);
  }
  assert.equal(c.cleanContent(BOARDWALK as never, 'a\u0000b⁦c'), 'a bc', 'control → space, isolates removed');
  assert.equal(c.cleanContent(BOARDWALK as never, '   '), null, 'blank means reset');
  assert.deepEqual(await getAll(), { spaces: {}, cards: {}, editions: {}, characters: {}, minigames: {} });
});

test('looks, characters and mini-games are patched in place, and reset per kind or all', async () => {
  assert.equal((await call('PUT', { item: { kind: 'edition', id: 'classic', field: 'name' }, text: 'Vintage' })).status, 200);
  assert.equal((await call('PUT', { item: { kind: 'edition', id: 'classic', field: 'currency' }, text: '€' })).status, 200);
  assert.equal((await call('PUT', { item: { kind: 'edition', id: 'classic', field: 'chance' }, text: 'Luck' })).status, 200);
  assert.equal((await call('PUT', { item: { kind: 'character', id: 'robot', field: 'name' }, text: 'Robby' })).status, 200);
  assert.equal((await call('PUT', { item: { kind: 'minigame', id: 'wheel', field: 'title' }, text: 'Big Wheel' })).status, 200);
  assert.equal(getTheme('classic').name, 'Vintage');
  const t = resolveTheme('classic', 'classic');
  assert.equal(t.currency, '€');
  assert.equal(t.deckNames.chance, 'Luck');
  assert.equal(t.spaces[7].name, 'Luck', 'Chance squares follow the deck name');
  assert.ok(t.chest.some(x => x.text === 'Bank error in your favour. Collect €200.'));
  assert.equal(getCharacter('robot').name, 'Robby');
  assert.equal(MINIGAME_INFO.wheel.title, 'Big Wheel');

  assert.equal((await call('DELETE', { kind: 'character' })).status, 200);
  assert.equal(getCharacter('robot').name, 'Robo');
  assert.equal(getTheme('classic').name, 'Vintage', 'other kinds untouched');
  assert.equal((await call('DELETE', { kind: 'bogus' })).status, 400);

  assert.equal((await call('DELETE', {})).status, 200);
  assert.equal(getTheme('classic').name, 'Original');
  assert.equal(resolveTheme('classic', 'classic').currency, '$');
  assert.equal(MINIGAME_INFO.wheel.title, 'Wheel Spin');
});

test('a bad row in the stored file is dropped, good ones kept', () => {
  writeFileSync(join(process.env.DATA_DIR!, 'content-overrides.json'), JSON.stringify({
    spaces: { 'classic:classic': { 39: 'Good Walk', 99: 'Off the board' }, 'nope:classic': { 1: 'x' } },
    cards: { 'classic:classic': { 'chance:0': 'Fine card.', 'luck:0': 'x' } },
    characters: { robot: { name: 'x'.repeat(200) } },
  }));
  c.loadContent();
  assert.deepEqual(c.getContent().spaces, { 'classic:classic': { 39: 'Good Walk' } });
  assert.deepEqual(c.getContent().cards, { 'classic:classic': { 'chance:0': 'Fine card.' } });
  assert.deepEqual(c.getContent().characters, {});
  c.resetContent();
});

test('the engine logs overridden space and card names', async () => {
  await call('PUT', { item: BOARDWALK, text: 'Yot Walk' });
  // Chance card 0 on Classic is "Advance to {39}."; rewrite it.
  await call('PUT', { item: { kind: 'card', theme: 'classic', map: 'classic', deck: 'chance', index: 0 }, text: 'Teleport to {39} at once.' });
  await call('PUT', { item: { kind: 'edition', id: 'classic', field: 'chance' }, text: 'Luck' });

  const { g, dice, act } = scripted();
  // Stack the Chance deck so card 0 comes up first.
  (g as unknown as { decks: { chance: number[] } }).decks.chance = [0, 1, 2];
  g.player('p0').position = 4;
  dice(1, 2); // 4 → 7 (Chance)
  act('p0', { type: 'roll' });
  const text = g.log.map(l => l.text).join('\n');
  assert.match(text, /drew Luck: “Teleport to Yot Walk at once\.”/);
  assert.match(text, /landed on Yot Walk/);
  c.resetContent();
});
