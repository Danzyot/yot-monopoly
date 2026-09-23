import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// Storage and operator identity are read at import time.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-graphics-'));
process.env.DEMO_MODE = '1';
process.env.ADMIN_DISCORD_IDS = '999';
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const { signToken } = await import('../src/auth.ts');
const g = await import('../src/graphics.ts');
const { mountGraphics } = await import('../src/routes/graphics.ts');
const { Room } = await import('../src/rooms.ts');
const { sanitizeTableStyle, cleanAssetUrl } = await import('../../shared/tableStyles.ts');

// Smallest real files of each kind: the magic bytes are what count.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(12)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const hooks = { onChange() {}, onEvent() {}, onFinished() {} };
const room = new Room('ROOMA', 'host', hooks);
const broadcasts: string[] = [];
const sockets = {
  registry: { rooms: new Map([[room.code, room]]) },
  broadcast: (r: { code: string }) => { broadcasts.push(r.code); },
} as unknown as Parameters<typeof mountGraphics>[1];

const op = signToken({ id: 'dc_999', name: 'Op', avatar: '🎩', provider: 'discord', discord: { id: '999', username: 'op' } });
const pleb = signToken({ id: 'demo_x', name: 'Pleb', avatar: '🎩', provider: 'demo' });

let server: Server;
let base = '';
before(async () => {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  mountGraphics(app, sockets);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const upload = (body: Buffer, token = op, name = 'Logo') =>
  fetch(`${base}/api/admin/graphics?name=${encodeURIComponent(name)}`, {
    method: 'POST', body, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
  });

test('sniffs real images by magic bytes, never by name', () => {
  assert.equal(g.sniffImage(PNG), 'png');
  assert.equal(g.sniffImage(JPG), 'jpg');
  assert.equal(g.sniffImage(WEBP), 'webp');
  assert.equal(g.sniffImage(GIF), 'gif');
  assert.equal(g.sniffImage(SVG), null, 'SVG can carry script');
  assert.equal(g.sniffImage(Buffer.from('hello')), null);
});

test('operators upload, list, rename and delete; the public sees only names and URLs', async () => {
  assert.equal((await upload(PNG, pleb)).status, 403, 'not an operator');
  assert.equal((await fetch(`${base}/api/admin/graphics`)).status, 401, 'not signed in');
  assert.equal((await upload(SVG)).status, 400);
  assert.equal((await upload(Buffer.alloc(0))).status, 400);

  const res = await upload(PNG, op, 'Club crest');
  assert.equal(res.status, 200);
  const row = await res.json() as { id: string; file: string; url: string; name: string; type: string };
  assert.match(row.file, /^[0-9a-f]{16}\.png$/);
  assert.equal(row.url, `/graphics/lib/${row.file}`);
  assert.equal(row.name, 'Club crest');
  assert.ok(existsSync(join(g.GRAPHICS_DIR, row.file)));

  const pub = await (await fetch(`${base}/api/graphics`)).json() as Record<string, unknown>[];
  assert.deepEqual(pub, [{ id: row.id, name: 'Club crest', url: row.url }], 'public list leaks nothing else');

  const file = await fetch(`${base}${row.url}`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('cache-control') ?? '', /max-age=31536000/);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

  const renamed = await fetch(`${base}/api/admin/graphics/${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ name: '  Crest v2 ' }),
    headers: { Authorization: `Bearer ${op}`, 'Content-Type': 'application/json' },
  });
  assert.equal((await renamed.json() as { name: string }).name, 'Crest v2');

  // A room using the image drops it when the image is deleted.
  room.style = sanitizeTableStyle({ table: 'walnut', boardLogoUrl: row.url, backgroundUrl: row.url });
  const del = await fetch(`${base}/api/admin/graphics/${row.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${op}` } });
  assert.deepEqual(await del.json(), { ok: true, rooms: 1 });
  assert.deepEqual(room.style, { table: 'walnut', boardLogoUrl: null, backgroundUrl: null });
  assert.deepEqual(broadcasts, ['ROOMA']);
  assert.equal((await fetch(`${base}${row.url}`)).status, 404);
  assert.ok(!existsSync(join(g.GRAPHICS_DIR, row.file)));
});

test('only server-minted, listed file names are served', async () => {
  const row = await (await upload(GIF)).json() as { file: string };
  for (const path of ['../secret.key', '..%2Fsecret.key', 'index.json', `${row.file.slice(0, 16)}.svg`, 'aaaaaaaaaaaaaaaa.png']) {
    assert.equal((await fetch(`${base}/graphics/lib/${path}`)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/graphics/lib/${row.file}`)).status, 200);
});

test('uploads over 8 MB are refused', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(g.MAX_GRAPHIC_BYTES)]);
  const res = await upload(big);
  assert.equal(res.status, 413);
});

test('the library survives a restart', async () => {
  const before = g.listGraphics().map(r => r.id);
  g.loadGraphics();
  assert.deepEqual(g.listGraphics().map(r => r.id), before);
});

test('table styles are pinned to known presets and safe URLs', () => {
  assert.deepEqual(sanitizeTableStyle(null), { table: 'edition', boardLogoUrl: null, backgroundUrl: null });
  assert.deepEqual(sanitizeTableStyle({ table: 'nope', boardLogoUrl: 'javascript:alert(1)', backgroundUrl: 'http://x.test/a.png' }),
    { table: 'edition', boardLogoUrl: null, backgroundUrl: null });
  assert.equal(cleanAssetUrl('/graphics/lib/0123456789abcdef.webp'), '/graphics/lib/0123456789abcdef.webp');
  assert.equal(cleanAssetUrl('/graphics/lib/../../secret.key'), null);
  assert.equal(cleanAssetUrl('/graphics/lib/0123456789abcdef.svg'), null);
  assert.equal(cleanAssetUrl('https://cdn.example.com/bg.jpg'), 'https://cdn.example.com/bg.jpg');
  assert.equal(cleanAssetUrl('https://user:pw@example.com/a.png'), null);
  assert.equal(cleanAssetUrl('https://example.com/a.png") ; x('), null, 'nothing that could break out of CSS url()');
  assert.equal(cleanAssetUrl('data:image/png;base64,AAAA'), null);
});

test('rooms: only the host or an operator styles the table, and it survives a restart', () => {
  const r = new Room('ROOMB', 'host', hooks);
  r.join({ id: 'host', name: 'Host', avatar: '🙂' });
  r.join({ id: 'guest', name: 'Guest', avatar: '🙂' });
  assert.throws(() => r.setStyle('guest', false, { table: 'felt' }), /host/);
  r.setStyle('guest', true, { table: 'felt', boardLogoUrl: 'https://example.com/logo.png' });
  assert.deepEqual(r.view().style, { table: 'felt', boardLogoUrl: 'https://example.com/logo.png', backgroundUrl: null });
  const back = Room.restore(r.snapshot(), hooks);
  assert.deepEqual(back.view().style, r.view().style);
  // Snapshots written before styles existed restore with the default look.
  const { style: _gone, ...old } = r.snapshot();
  assert.equal(Room.restore(old, hooks).style.table, 'edition');
  r.start('host', false);
  assert.throws(() => r.setStyle('host', false, { table: 'carbon' }), /started/);
  r.dispose();
  back.dispose();
});
