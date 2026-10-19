// Importing a library from a sibling deployment.
//
// The route is admin-only, but "only an operator can reach it" is not a reason
// to let it fetch anything at all: this is a server making requests to an
// address a human typed, which is the exact shape of an SSRF, and the cloud
// metadata endpoint is one typo away. The guard is tested here because it is
// the part with no visible symptom when it stops working.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-import-'));
delete process.env.ALLOW_PRIVATE_IMPORT;

const { importFrom } = await import('../src/music.ts');

const refused = async (from: string, why: RegExp) => {
  await assert.rejects(() => importFrom(from), why, `${from} should have been refused`);
};

test('only http and https can be imported from', async () => {
  await refused('ftp://example.com', /http and https/);
  await refused('file:///etc/passwd', /http and https/);
  await refused('gopher://example.com', /http and https/);
});

test('nonsense is rejected before anything is fetched', async () => {
  await refused('not a url', /not a URL/);
  await refused('', /not a URL/);
});

test('private and link-local addresses are refused', async () => {
  // The last one is the cloud metadata service: on a hosted box it answers
  // instance credentials, so it is the address that matters most here.
  for (const host of [
    'http://localhost:8080',
    'http://127.0.0.1',
    'http://10.0.0.7',
    'http://192.168.1.5',
    'http://172.16.0.9',
    'http://172.31.255.1',
    'http://box.local',
    'http://169.254.169.254/latest/meta-data',
  ]) {
    await refused(host, /private network/);
  }
});

test('addresses just outside the private ranges are still allowed through', async () => {
  // 172.15 and 172.32 sit either side of the 172.16–172.31 block; a sloppy
  // prefix match on "172." would swallow them and quietly break importing
  // from a perfectly ordinary public host.
  for (const host of ['http://172.15.0.1', 'http://172.32.0.1', 'http://11.0.0.1']) {
    await assert.rejects(
      () => importFrom(host),
      (e: Error) => !/private network/.test(e.message),
      `${host} is public and must not be refused as private`,
    );
  }
});
