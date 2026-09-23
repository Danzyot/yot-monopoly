import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-bans-'));
const { addBan, findBan, removeBan, normaliseIp, listBans } = await import('../src/bans.ts');
const { clientIp } = await import('../src/ip.ts');

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

test('client IP comes from the trusted end of X-Forwarded-For', () => {
  // Public peer: the header is typed input and ignored.
  assert.equal(clientIp('6.6.6.6', '8.8.8.8'), '8.8.8.8');
  // Behind one proxy: the right-most public entry, not the spoofable left one.
  assert.equal(clientIp('6.6.6.6, 9.9.9.9', '10.0.0.2'), '9.9.9.9');
});
