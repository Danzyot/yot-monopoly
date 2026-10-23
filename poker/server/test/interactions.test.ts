import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'poker-interactions-'));
process.env.DISCORD_PUBLIC_KEY ??= '';
const { handleInteraction, validSignature } = await import('../src/interactions.ts');
const { startCode, codeStatus, normalizeCode, looksLikeCode } = await import('../src/verifycode.ts');
const { setFeatures } = await import('../src/features.ts');

const USER = { id: '123456789012345678', username: 'tester', global_name: 'Operator', avatar: 'abc' };

test('PING is answered with a pong', () => {
  const out = handleInteraction({ type: 1 });
  assert.deepEqual(out, { status: 200, body: { type: 1 } });
});

test('with code sign-in switched off, the button and the modal only say so', () => {
  setFeatures({ codeVerify: false });
  for (const i of [{ type: 3, data: { custom_id: 'poker_verify_button' } }, { type: 5, data: { custom_id: 'poker_verify_modal' } }]) {
    const body = handleInteraction(i)!.body as { type: number; data: { content: string; flags: number } };
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, 64);
    assert.match(body.data.content, /switched off/);
  }
  setFeatures({ codeVerify: true });
});

test('Verify button opens the code modal', () => {
  const out = handleInteraction({ type: 3, data: { custom_id: 'poker_verify_button' } });
  const body = out!.body as { type: number; data: { custom_id: string } };
  assert.equal(body.type, 9); // MODAL
  assert.equal(body.data.custom_id, 'poker_verify_modal');
});

test('another app\'s interaction is not claimed', () => {
  assert.equal(handleInteraction({ type: 3, data: { custom_id: 'wawa_verify_button' } }), null);
  assert.equal(handleInteraction({ type: 5, data: { custom_id: 'wawa_verify_modal' } }), null);
});

function submitModal(value: string) {
  return handleInteraction({
    type: 5,
    guild_id: '876543210987654321',
    data: { custom_id: 'poker_verify_modal', components: [{ components: [{ custom_id: 'code', value }] }] },
    member: { user: USER },
  });
}

test('a valid code is resolved for the clicking member', () => {
  process.env.DISCORD_PUBLIC_KEY = 'aa';
  const { code } = startCode();
  const out = submitModal(code);
  assert.match(String((out!.body as { data: { content: string } }).data.content), /verified as \*\*Operator\*\*/);

  const status = codeStatus(code);
  assert.equal(status.pending, false);
  assert.equal(status.resolution?.id, USER.id);
  assert.equal(status.resolution?.username, 'Operator');
  assert.match(String(status.resolution?.avatarUrl), /cdn\.discordapp\.com/);
});

test('the code is accepted without its prefix and case-insensitively', () => {
  process.env.DISCORD_PUBLIC_KEY = 'aa';
  const { code } = startCode();
  const bare = code.replace('POKER-', '').toLowerCase();
  submitModal(bare);
  assert.equal(codeStatus(code).resolution?.id, USER.id);
});

test('unknown and malformed codes are rejected distinctly', () => {
  const malformed = submitModal('hello there');
  assert.match(String((malformed!.body as { data: { content: string } }).data.content), /doesn't look like a poker code/);

  const unknown = submitModal('POKER-ZZZZ');
  assert.match(String((unknown!.body as { data: { content: string } }).data.content), /invalid or expired/);
});

test('another product\'s code prefix is never treated as a poker code', () => {
  assert.equal(looksLikeCode('WAWA-AB12'), false);
  const out = submitModal('WAWA-AB12');
  assert.match(String((out!.body as { data: { content: string } }).data.content), /doesn't look like a poker code/);
});

test('normalizeCode is idempotent', () => {
  assert.equal(normalizeCode('POKER-AB12'), 'POKER-AB12');
  assert.equal(normalizeCode('ab12'), 'POKER-AB12');
  assert.equal(normalizeCode(' poker-ab12 '), 'POKER-AB12');
});

test('signature verification accepts a real signature and rejects tampering', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const hex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const ts = '1700000000';
  const body = Buffer.from(JSON.stringify({ type: 1 }));
  const sig = edSign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString('hex');

  assert.equal(validSignature(hex, sig, ts, body), true);
  assert.equal(validSignature(hex, sig, ts, Buffer.from('{"type":3}')), false);
  assert.equal(validSignature(hex, sig, '1700000001', body), false);
  assert.equal(validSignature(hex, 'deadbeef', ts, body), false);
});

// Discord only ever says "could not be verified", so the endpoint's own probe
// has to name the missing piece. These pin the shape of that diagnosis.
test('a real signed PING verifies, and a forged one is refused with 401', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const hex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const body = Buffer.from(JSON.stringify({ type: 1 }));
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = edSign(null, Buffer.concat([Buffer.from(ts), body]), privateKey).toString('hex');

  assert.equal(validSignature(hex, sig, ts, body), true, 'Discord’s handshake passes');
  assert.equal(validSignature(hex, '00'.repeat(64), ts, body), false, 'a forged signature is rejected');
  // The two ways production breaks: no key, or the wrong string pasted in.
  assert.equal(validSignature('', sig, ts, body), false, 'no public key configured → cannot verify');
  assert.equal(validSignature('1391263041234567', sig, ts, body), false, 'app id pasted instead of key → cannot verify');
});

