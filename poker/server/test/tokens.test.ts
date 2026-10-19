// What a session token is allowed to prove.
//
// Two things were wrong here and both are the kind that never show up in
// ordinary use: `iat` was stamped into every token and never read, so a token
// was valid forever; and `isAdmin` was believed straight off the payload, so
// removing someone from ADMIN_DISCORD_IDS did not actually remove them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-tok-'));
process.env.CHOG_SECRET = 'token-test-secret';
process.env.ADMIN_DISCORD_IDS = '340404007639973888';

const { signToken, verifyToken, withAdminFlag } = await import('../src/auth.ts');

const OPERATOR = {
  id: 'dc_op', name: 'Danz', avatar: '♠️', provider: 'discord' as const,
  discord: { id: '340404007639973888', username: 'danzyot' },
};
const PLAYER = {
  id: 'dc_p', name: 'Rando', avatar: '♠️', provider: 'discord' as const,
  discord: { id: '999000111', username: 'rando' },
};

test('a token signed with another key is refused', () => {
  const good = signToken(withAdminFlag(OPERATOR));
  const tampered = `${good.slice(0, good.lastIndexOf('.'))}.deadbeef`;
  assert.equal(verifyToken(tampered), null);
});

test('the operator list decides, not the token', () => {
  // A correctly signed token that simply asserts it is an operator. The claim
  // has to count for nothing on its own — this is the whole point.
  const liar = signToken({ ...PLAYER, isAdmin: true });
  assert.equal(verifyToken(liar)?.isAdmin, false, 'claiming it does not make it so');

  const real = signToken(withAdminFlag(OPERATOR));
  assert.equal(verifyToken(real)?.isAdmin, true, 'the listed operator still gets in');
});

test('dropping someone from the operator list takes their rights away now', () => {
  const token = signToken(withAdminFlag(OPERATOR));
  assert.equal(verifyToken(token)?.isAdmin, true);

  // The same token, after the operator list changes underneath it.
  process.env.ADMIN_DISCORD_IDS = '111111111111111111';
  assert.equal(
    verifyToken(token)?.isAdmin, false,
    'their existing token must stop carrying operator rights immediately',
  );
  process.env.ADMIN_DISCORD_IDS = '340404007639973888';
});

test('a session does not last forever', () => {
  const realNow = Date.now;
  try {
    // Mint one, then come back to it two months later.
    const token = signToken(withAdminFlag(OPERATOR));
    assert.ok(verifyToken(token), 'valid today');
    Date.now = () => realNow() + 60 * 24 * 60 * 60 * 1000;
    assert.equal(verifyToken(token), null, 'and refused once it is stale');
  } finally {
    Date.now = realNow;
  }
});

test('a token with no issue time at all is refused', () => {
  // Hand-rolled to look like an old token from before `iat` was checked.
  const b64 = (b: Buffer) => b.toString('base64url');
  const payload = b64(Buffer.from(JSON.stringify({ ...OPERATOR, isAdmin: true })));
  const sig = b64(createHmac('sha256', 'token-test-secret').update(payload).digest());
  assert.equal(verifyToken(`${payload}.${sig}`), null);
});
