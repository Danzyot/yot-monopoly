// Table-graphics library: image sniffing, storage, and theme sanitizing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'wawa-graphics-'));
const {
  addGraphic, graphicFilePath, listGraphics, loadGraphics, removeGraphic,
  sanitizeTheme, sniffImage,
} = await import('../src/graphics.ts');

const png = () => Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n'), Buffer.alloc(64, 3)]);

test('image sniffing accepts real containers and rejects junk', () => {
  assert.equal(sniffImage(png()), 'png');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)])), 'jpg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFFxxxxWEBP'), Buffer.alloc(32)])), 'webp');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)])), 'gif');
  assert.equal(sniffImage(Buffer.from('<svg onload=alert(1)></svg>')), null, 'svg (scriptable) refused');
  assert.equal(sniffImage(Buffer.from('ID3not-an-image-its-audio')), null);
});

test('add, list, serve and remove an image', () => {
  loadGraphics();
  const row = addGraphic('  Wawa Logo  ', png());
  assert.equal(row.name, 'Wawa Logo');
  assert.match(row.file, /^[0-9a-f]{16}\.png$/);
  assert.equal(listGraphics().length, 1);
  assert.ok(graphicFilePath(row.file));
  assert.equal(graphicFilePath('../../etc/passwd'), null, 'traversal refused');
  assert.equal(removeGraphic(row.id), true);
  assert.equal(graphicFilePath(row.file), null);
});

test('themes off the wire are pinned to presets and safe urls', () => {
  assert.equal(sanitizeTheme(null), null);
  assert.equal(sanitizeTheme({ felt: 'chog' }), null, 'default look stores as no theme');
  assert.deepEqual(sanitizeTheme({ felt: 'midnight' }),
    { felt: 'midnight', logoUrl: null, backgroundUrl: null });
  assert.deepEqual(
    sanitizeTheme({ felt: 'nope', logoUrl: '/graphics/lib/aabbccddeeff0011.png' }),
    { felt: 'chog', logoUrl: '/graphics/lib/aabbccddeeff0011.png', backgroundUrl: null },
    'unknown felt falls back; our own urls pass');
  assert.equal(
    sanitizeTheme({ felt: 'chog', logoUrl: 'javascript:alert(1)' }),
    null, 'unsafe url dropped, leaving the default look');
  assert.deepEqual(
    sanitizeTheme({ felt: 'wine', backgroundUrl: 'https://example.com/bg.png' })?.backgroundUrl,
    'https://example.com/bg.png', 'plain https urls pass');
});
