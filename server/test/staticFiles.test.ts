import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { pickEncoding, staticClient } from '../src/staticFiles.ts';

test('precompressed copies: Brotli first, then gzip, only when accepted and present', () => {
  const both = () => true;
  assert.equal(pickEncoding('gzip, deflate, br', both), 'br');
  assert.equal(pickEncoding('gzip, deflate', both), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip', both), 'gzip');
  assert.equal(pickEncoding('br', s => s === '.gz'), null);
  assert.equal(pickEncoding(undefined, both), null);
  assert.equal(pickEncoding('identity', both), null);
});

test('the static client sends the .br copy with the real type, and caches hashed assets for good', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'yot-dist-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'app-abc.js'), 'console.log(1)');
  writeFileSync(join(dist, 'assets', 'app-abc.js.br'), 'BROTLI');
  writeFileSync(join(dist, 'plain.css'), 'body{}');
  const app = express();
  app.use(staticClient(dist));
  const server = createServer(app).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  try {
    const br = await fetch(`${base}/assets/app-abc.js?v=1`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(br.headers.get('content-encoding'), 'br');
    assert.match(br.headers.get('content-type') ?? '', /javascript/);
    assert.match(br.headers.get('cache-control') ?? '', /immutable/);
    assert.match(br.headers.get('vary') ?? '', /Accept-Encoding/i);
    const raw = await fetch(`${base}/assets/app-abc.js`, { headers: { 'accept-encoding': 'identity' } });
    assert.equal(raw.headers.get('content-encoding'), null);
    assert.equal(await raw.text(), 'console.log(1)');
    const css = await fetch(`${base}/plain.css`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(css.headers.get('content-encoding'), null);
    assert.equal(await css.text(), 'body{}');
    const escape = await fetch(`${base}/..%2fsecret.js`, { headers: { 'accept-encoding': 'br' } });
    assert.notEqual(escape.status, 200);
  } finally {
    server.close();
  }
});
