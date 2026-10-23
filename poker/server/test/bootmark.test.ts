// Proving DATA_DIR survives a restart, which no other check can tell you.
//
// "Is it set" passes for a path inside the container. "Can it be written to"
// passes for any writable directory, and an ephemeral one is perfectly
// writable — until the deploy that discards it. The mark left here is the only
// thing that distinguishes a volume from a directory, and it is what turns
// "my settings keep resetting" into a line in the deploy log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR ??= mkdtempSync(join(tmpdir(), 'chog-boot-'));
const { recordBoot } = await import('../src/bootmark.ts');
const { configReport } = await import('../src/startupcheck.ts');

const fresh = () => mkdtempSync(join(tmpdir(), 'chog-bootdir-'));

test('the first boot in a directory cannot prove anything, and says so', () => {
  const dir = fresh();
  const m = recordBoot(dir);
  assert.equal(m.boots, 1);
  assert.equal(m.noRecordFound, true);
  assert.equal(m.previousBootAt, null);
  rmSync(dir, { recursive: true, force: true });
});

test('a second boot in the same directory proves it persisted', () => {
  const dir = fresh();
  recordBoot(dir);
  const m = recordBoot(dir);
  assert.equal(m.boots, 2);
  assert.equal(m.noRecordFound, false);
  assert.ok(m.previousBootAt && m.previousBootAt > 0);
  rmSync(dir, { recursive: true, force: true });
});

test('a wiped directory looks like a first boot again — which is the whole signal', () => {
  const dir = fresh();
  recordBoot(dir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const m = recordBoot(dir);
  assert.equal(m.noRecordFound, true, 'the mark is gone, so it reports as unproven');
  assert.equal(m.boots, 1, 'and the count restarts, which is the tell');
  rmSync(dir, { recursive: true, force: true });
});

test('a corrupt mark is treated as no mark rather than trusted', () => {
  const dir = fresh();
  writeFileSync(join(dir, 'boot.json'), 'not json at all');
  const m = recordBoot(dir);
  assert.equal(m.noRecordFound, true);
  rmSync(dir, { recursive: true, force: true });
});

test('the report warns on an unproven directory and confirms a proven one', () => {
  const env = {
    DATA_DIR: '/data', ADMIN_DISCORD_IDS: '123456789012345678',
    PUBLIC_URL: 'https://poker.example.com',
    DISCORD_CLIENT_ID: '1274819260077576364', DISCORD_CLIENT_SECRET: 's',
    DISCORD_BOT_TOKEN: 'b', DISCORD_GUILD_ID: '1274819260077576364',
    DISCORD_INVITE_URL: 'https://discord.gg/x',
  };
  const writable = () => ({ writable: true });

  const unproven = configReport(env, writable, { boots: 1, previousBootAt: null, noRecordFound: true });
  assert.ok(unproven.warnings.some(w => /no record of a previous boot/i.test(w)));
  assert.equal(unproven.ok, true, 'a first deploy is not a failure, only unproven');

  const proven = configReport(env, writable, { boots: 7, previousBootAt: Date.now() - 60_000, noRecordFound: false });
  assert.deepEqual(proven.warnings, [], 'a proven volume nags about nothing');
  assert.ok(proven.notes.some(n => /persistence confirmed/.test(n)));

  const broken = configReport(env, writable, { boots: 1, previousBootAt: null, noRecordFound: true, error: 'EACCES' });
  assert.equal(broken.ok, false, 'a directory that refuses the mark is a problem, not a warning');
  assert.ok(broken.problems.some(p => /EACCES/.test(p)));
});
