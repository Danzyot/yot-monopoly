// Where the client's address comes from, and what counts as the same address.
//
// Both of these were wrong in ways that quietly defeated the moderation tools:
// the socket read the FIRST entry of X-Forwarded-For, which is written by the
// client, and ban matching compared addresses as raw strings, so a different
// spelling of the same address did not match.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-ip-'));
const { addBan, isBanned, normaliseIp } = await import('../src/bans.ts');

test('one address has one spelling', () => {
  // Leading zeros, in every quantity.
  assert.equal(normaliseIp('010.0.0.1'), '10.0.0.1');
  assert.equal(normaliseIp('10.000.000.001'), '10.0.0.1');
  assert.equal(normaliseIp('0192.0168.001.001'), '192.168.1.1');
  // IPv4 dressed as IPv6, brackets, zone index.
  assert.equal(normaliseIp('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(normaliseIp('[2001:db8::1]'), '2001:db8::1');
  assert.equal(normaliseIp('fe80::1%eth0'), 'fe80::1');
  // IPv6 written long, written short, written loudly.
  assert.equal(normaliseIp('2001:0db8:0000:0000:0000:0000:0000:0001'), '2001:db8::1');
  assert.equal(normaliseIp('2001:DB8::1'), '2001:db8::1');
  assert.equal(normaliseIp('0:0:0:0:0:0:0:1'), '::1');
});

test('nonsense is left alone rather than guessed at', () => {
  // A wrong guess here is a ban on the wrong machine.
  assert.equal(normaliseIp('203.0.113.7.'), '203.0.113.7.');
  assert.equal(normaliseIp('999.1.1.1'), '999.1.1.1');
  assert.equal(normaliseIp('not-an-address'), 'not-an-address');
  assert.equal(normaliseIp(''), '');
  assert.equal(normaliseIp(null), '');
});

test('a ban follows the machine, not the spelling', () => {
  addBan({ kind: 'ip', value: '198.51.100.9', name: '', reason: 'flooding', by: 'Operator' });
  for (const spelling of [
    '198.51.100.9',
    '0198.051.100.009',
    '::ffff:198.51.100.9',
    '[::ffff:198.51.100.9]',
  ]) {
    assert.equal(isBanned({ id: 'x', ip: spelling }), true, `${spelling} is the same machine`);
  }
  assert.equal(isBanned({ id: 'x', ip: '198.51.100.10' }), false, 'and the neighbour is not');
});

test('an IPv6 ban survives being rewritten', () => {
  addBan({ kind: 'ip', value: '2001:0DB8:0000:0000:0000:0000:0000:00AB', name: '', reason: '', by: 'Operator' });
  assert.equal(isBanned({ id: 'y', ip: '2001:db8::ab' }), true);
  assert.equal(isBanned({ id: 'y', ip: '[2001:db8::ab]' }), true);
  assert.equal(isBanned({ id: 'y', ip: '2001:db8::ac' }), false);
});

// ---- who is allowed to tell us the client's address ----

const { isLocalPeer } = await import('../src/sockets.ts');

test('only a proxy on our own network gets to rewrite the address', () => {
  // Railway, Caddy, nginx, a sidecar — all reach us privately.
  for (const local of [
    '127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3',
    '192.168.0.9', '172.16.0.1', '172.31.255.254', 'fd00::1',
  ]) {
    assert.equal(isLocalPeer(local), true, `${local} is a proxy on our side`);
  }
  // A visitor reaching the box directly. Their X-Forwarded-For is just typing,
  // so it has to be ignored in favour of the address we can actually see.
  for (const public_ of [
    '203.0.113.7', '8.8.8.8', '172.32.0.1', '2001:db8::1', '',
  ]) {
    assert.equal(isLocalPeer(public_ || null), false, `${public_ || '(none)'} is not a proxy`);
  }
});
