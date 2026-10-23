// Demo sign-in exists so the room can be shown to someone before there is a
// Discord application to sign in with. The property that matters is that it
// leaves nothing behind: turning the flag off has to log every demo visitor
// out, not merely hide the button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-demo-'));
process.env.CHOG_SECRET = 'demo-test-secret';
delete process.env.ADMIN_DISCORD_IDS;

const { demoMode, makeDemoProfile, signToken, verifyToken } = await import('../src/auth.ts');

test('the demo is off unless it is asked for by name', () => {
  delete process.env.DEMO_MODE;
  assert.equal(demoMode(), false);
  process.env.DEMO_MODE = 'true';
  assert.equal(demoMode(), false, 'only the exact value counts');
  process.env.DEMO_MODE = '1';
  assert.equal(demoMode(), true);
});

test('a demo profile cannot be made while it is off', () => {
  delete process.env.DEMO_MODE;
  assert.throws(() => makeDemoProfile('Visitor'), /not enabled/);
});

test('a name is still a name', () => {
  process.env.DEMO_MODE = '1';
  assert.throws(() => makeDemoProfile('a'), /at least 2/);
  assert.equal(makeDemoProfile('  RiverQueen  ').name, 'RiverQueen');
  assert.equal(makeDemoProfile('RiverQueen').provider, 'demo');
});

test('turning the demo off logs the demo visitors out', () => {
  process.env.DEMO_MODE = '1';
  const token = signToken(makeDemoProfile('Visitor'));
  assert.equal(verifyToken(token)?.provider, 'demo', 'valid while the demo is on');

  delete process.env.DEMO_MODE;
  assert.equal(
    verifyToken(token), null,
    'and refused the moment it is off — the session must not outlive the flag',
  );
});

test('a real Discord session is unaffected either way', () => {
  const discord = signToken({
    id: 'dc_1', name: 'Operator', avatar: '♠️', provider: 'discord',
    discord: { id: '123456789012345678', username: 'tester' },
  });
  delete process.env.DEMO_MODE;
  assert.equal(verifyToken(discord)?.provider, 'discord');
  process.env.DEMO_MODE = '1';
  assert.equal(verifyToken(discord)?.provider, 'discord');
  delete process.env.DEMO_MODE;
});
