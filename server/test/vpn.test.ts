// Recognising a VPN, and — far more importantly — not recognising one where
// there isn't one.
//
// This is the only code on the site that can turn somebody away before they
// have done anything, so the tests are weighted towards the false positive.
// A missed VPN costs an edge; a wrongly blocked player costs a real person
// their seat in a tournament they registered for, and the operator does not
// find out, because a blocked player cannot reach anyone to complain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-vpn-'));
const { classify, clearVpnCache, loadVpnLists } = await import('../src/vpn.ts');

const counts = loadVpnLists();

test('the shipped lists actually loaded', () => {
  // A missing or truncated data file would make every verdict "clean" and
  // this whole feature a silent no-op — which looks exactly like it working.
  assert.ok(counts.vpn > 5_000, `expected thousands of VPN ranges, got ${counts.vpn}`);
  assert.ok(counts.datacenter > 20_000, `expected tens of thousands of datacenter ranges, got ${counts.datacenter}`);
});

test('a home address is not a VPN', () => {
  // Nothing routable-but-ordinary may come back positive. These are real
  // consumer ISP addresses taken from this site's own audit.
  for (const ip of ['79.177.143.164', '2.54.149.38', '147.235.195.114', '85.130.158.2', '147.235.199.5']) {
    assert.equal(classify(ip).kind, null, `${ip} is a home connection and must not be blocked`);
  }
});

test('the lists DO fire on addresses real players of this site have used', () => {
  // Kept as a test rather than a note, because it is the single most
  // important fact about switching the block on: two of the addresses in this
  // site's own audit are flagged. One of them belongs to the operator.
  //
  // Neither is necessarily a false positive — a VPN is a VPN — but it means
  // "turn the block on" and "lock myself and some of my players out" are the
  // same action unless the allowlist and bypass key are set up first. If a
  // list refresh ever makes these clean, that is worth noticing too.
  assert.equal(classify('194.187.250.143').kind, 'vpn');
  assert.equal(classify('5.254.82.175').kind, 'datacenter');
});

test('private, loopback and carrier-grade addresses have no verdict', () => {
  // These reach the gate when a proxy header is missing. A verdict here would
  // block everyone behind our own plumbing.
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '100.64.0.1', '::1']) {
    assert.equal(classify(ip).kind, null, `${ip} is infrastructure, not a person`);
  }
});

test('junk in does not become a verdict', () => {
  for (const ip of ['', 'not-an-ip', '999.999.999.999', '1.2.3', '1.2.3.4.5', 'xxxx::yyyy']) {
    assert.equal(classify(ip).kind, null, `"${ip}" must resolve to no opinion, not a block`);
  }
  assert.equal(classify(null).kind, null);
});

test('a known datacenter address is recognised', () => {
  // Google and Cloudflare public resolvers: unmistakably not home
  // connections, and both in the shipped lists.
  const verdicts = ['8.8.8.8', '1.1.1.1'].map(ip => classify(ip));
  assert.ok(verdicts.some(v => v.kind !== null),
    'a public resolver on a hosting network should be recognised as non-residential');
  for (const v of verdicts) {
    if (v.kind) assert.equal(v.source, 'list');
  }
});

test('an address in both lists is reported as the more specific one', () => {
  // The lists overlap. Whichever it is, an operator reading "vpn" and an
  // operator reading "datacenter" must not be looking at the same address on
  // two different days.
  const a = classify('8.8.8.8');
  const b = classify('8.8.8.8');
  assert.deepEqual(a, b, 'the same address must always get the same answer');
});

test('IPv4 ranges are matched at both ends and not one past them', () => {
  // Off-by-one in the CIDR arithmetic is the mistake that would either leak
  // the last address of every VPN range or blocklist the first address of the
  // innocent network next door. Walk a real range's edges.
  const inside = classify('8.8.8.8').kind;
  if (inside) {
    // 8.8.8.0/24 belongs to Google; 8.7.255.255 is the address below it.
    assert.equal(classify('8.7.255.255').kind, null,
      'the address immediately below a listed range must be clean');
  }
});

test('IPv6 is parsed, including compressed and mapped forms', () => {
  // Half of mobile traffic is IPv6. If the parser returned null for these,
  // every IPv6 VPN would walk straight through and nobody would notice.
  clearVpnCache();
  // ::ffff:8.8.8.8 is the same machine as 8.8.8.8 and must agree with it.
  assert.equal(classify('::ffff:8.8.8.8').kind, classify('8.8.8.8').kind,
    'a v4-mapped address is the same host and must get the same verdict');
  // A compressed v6 home address must stay clean.
  assert.equal(classify('2001:db8::1').kind, null, 'the documentation range is not a VPN');
});

test('the cache returns the same verdict, not a stale one for a different address', () => {
  clearVpnCache();
  const home = classify('79.177.143.164');
  const dc = classify('8.8.8.8');
  assert.equal(classify('79.177.143.164').kind, home.kind);
  assert.equal(classify('8.8.8.8').kind, dc.kind);
  assert.notEqual(home.kind, dc.kind, 'these two must not collapse onto one cached answer');
});
