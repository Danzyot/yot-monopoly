import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-bans-'));
const { addBan, findBan, removeBan, normaliseIp, listBans } = await import('../src/bans.ts');
const { clientIp, trustedProxyHops } = await import('../src/ip.ts');

test('IP spellings fold to one address', () => {
  assert.equal(normaliseIp('::ffff:010.000.0.1'), '10.0.0.1');
  assert.equal(normaliseIp('[2001:0db8:0000:0000:0000:0000:0000:0001]'), '2001:db8::1');
});

test('lifetime, room and temporary bans', () => {
  addBan({ kind: 'player', value: 'dc_1', name: 'A', reason: 'x', by: 'op' });
  addBan({ kind: 'ip', value: '1.2.3.4', name: 'B', reason: '', by: 'op', scope: 'room', gameId: 'ROOM1' });
  addBan({ kind: 'player', value: 'dc_2', name: 'C', reason: '', by: 'op', expiresAt: Date.now() - 1 });
  assert.ok(findBan({ id: 'dc_1' }));
  assert.equal(findBan({ ip: '1.2.3.4' }), null, 'room bans do not reach the rest of the site');
  assert.ok(findBan({ ip: '::ffff:1.2.3.4' }, 'ROOM1'));
  assert.equal(findBan({ id: 'dc_2' }), null, 'an already-expired ban never applies');
  assert.equal(listBans().length, 2);
  assert.ok(removeBan('player', 'dc_1'));
  assert.equal(findBan({ id: 'dc_1' }), null);
});

/** Run with TRUSTED_PROXY_HOPS set (undefined: unset), then put it back. */
function withHops(hops: string | undefined, fn: () => void) {
  const before = process.env.TRUSTED_PROXY_HOPS;
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = hops;
  try { fn(); } finally {
    if (before === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = before;
  }
}

test('client IP comes from the trusted end of X-Forwarded-For', () => withHops('1', () => {
  // Public peer: the header is typed input and ignored.
  assert.equal(clientIp('6.6.6.6', '8.8.8.8'), '8.8.8.8');
  // Behind one proxy: the right-most public entry, not the spoofable left one.
  assert.equal(clientIp('6.6.6.6, 9.9.9.9', '10.0.0.2'), '9.9.9.9');
}));

// As poker found on live traffic (poker/server/test/proxyhops.test.ts): the
// custom domain's edge sits in front of Railway, so the player is one in from the end.
const PLAYER = '79.107.1.2', EDGE = '172.71.150.4', RAILWAY = '10.1.2.3';

test('client IP: unset means two hops, the custom-domain edge plus Railway', () => withHops(undefined, () => {
  assert.equal(trustedProxyHops(), 2);
  assert.equal(clientIp(`${PLAYER}, ${EDGE}`, RAILWAY), PLAYER, 'the player, not the edge');
  assert.equal(clientIp(`1.2.3.4, ${PLAYER}, ${EDGE}`, RAILWAY), PLAYER, 'a typed prefix is ignored');
  // Straight at *.up.railway.app (no edge): too short for two hops, so the proxy's own word, then the peer.
  assert.equal(clientIp(PLAYER, RAILWAY, { 'x-envoy-external-address': PLAYER }), PLAYER);
  assert.equal(clientIp(PLAYER, RAILWAY), RAILWAY, 'never the typed value');
}));
