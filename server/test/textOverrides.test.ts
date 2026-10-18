import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-text-'));
process.env.DEMO_MODE = '1';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const t = await import('../src/textOverrides.ts');
const { mountTextOverrides } = await import('../src/routes/textOverrides.ts');

const player = signToken({ id: 'demo_x', name: 'Pleb', avatar: '🎩', provider: 'demo' });

let server: Server;
let base = '';
before(async () => {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  mountTextOverrides(app);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

async function put(body: unknown, token: string | null = player) {
  const res = await fetch(`${base}/api/text-overrides`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as { error?: string; overrides?: Record<string, string> } };
}
const get = async () => (await (await fetch(`${base}/api/text-overrides`)).json() as { overrides: Record<string, string> }).overrides;

test('GET is public and starts empty', async () => {
  assert.deepEqual(await get(), {});
});

test('PUT needs a signed-in player', async () => {
  const r = await put({ original: 'Play now', text: 'Go' }, null);
  assert.equal(r.status, 401);
  assert.deepEqual(await get(), {});
});

test('set, read back, persist to disk, and reset', async () => {
  const r = await put({ original: '  Roll   the dice ', text: ' Throw them ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.overrides, { 'Roll the dice': 'Throw them' }, 'whitespace is normalised on both sides');
  assert.deepEqual(await get(), { 'Roll the dice': 'Throw them' });

  const file = join(process.env.DATA_DIR!, 'text-overrides.json');
  assert.ok(existsSync(file));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'Roll the dice': 'Throw them' });

  // A restart reads it back.
  t.loadTextOverrides();
  assert.deepEqual(t.getTextOverrides(), { 'Roll the dice': 'Throw them' });

  assert.equal((await put({ original: 'Roll the dice', text: null })).status, 200);
  assert.deepEqual(await get(), {}, 'null resets');
  await put({ original: 'A', text: 'B' });
  await put({ original: 'A', text: '' });
  assert.deepEqual(await get(), {}, 'empty resets');
  await put({ original: 'A', text: 'B' });
  await put({ original: 'A', text: 'A' });
  assert.deepEqual(await get(), {}, 'setting the original back clears the override');
});

test('validation: plain text, length cap, types', async () => {
  const bad = [
    { original: 'Hi', text: '<b>Bold</b>' },
    { original: '<script>', text: 'x' },
    { original: 'Hi', text: 'x'.repeat(t.MAX_TEXT_LEN + 1) },
    { original: 'y'.repeat(t.MAX_TEXT_LEN + 1), text: 'x' },
    { original: '', text: 'x' },
    { original: '   ', text: 'x' },
    { original: 42, text: 'x' },
    { original: 'Hi', text: { a: 1 } },
    {},
  ];
  for (const body of bad) {
    const r = await put(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.body.error);
  }
  assert.deepEqual(await get(), {});
  assert.equal((await put({ original: 'Hi', text: 'x'.repeat(t.MAX_TEXT_LEN) })).status, 200);
  await put({ original: 'Hi', text: null });
});

test('the number of edits is capped, but existing ones can still change', async () => {
  for (let i = 0; i < t.MAX_OVERRIDES; i++) t.setTextOverride(`orig ${i}`, `new ${i}`);
  const full = await put({ original: 'one too many', text: 'x' });
  assert.equal(full.status, 400);
  assert.match(full.body.error ?? '', /Too many/);
  assert.equal((await put({ original: 'orig 0', text: 'changed' })).status, 200);
  for (let i = 0; i < t.MAX_OVERRIDES; i++) t.setTextOverride(`orig ${i}`, null);
  assert.deepEqual(await get(), {});
});

test('reloading from disk keeps valid rows', () => {
  t.setTextOverride('Good', 'Fine');
  t.loadTextOverrides();
  assert.deepEqual(t.getTextOverrides(), { Good: 'Fine' });
  t.setTextOverride('Good', null);
});

test('PUT is refused outside demo mode, GET still serves what is stored', async () => {
  t.setTextOverride('Stored', 'Kept');
  process.env.DEMO_MODE = '0';
  try {
    assert.equal((await put({ original: 'Stored', text: 'Hacked' })).status, 404);
    assert.deepEqual(await get(), { Stored: 'Kept' });
  } finally {
    process.env.DEMO_MODE = '1';
  }
  t.setTextOverride('Stored', null);
});
