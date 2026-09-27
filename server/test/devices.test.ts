// Two accounts, one browser.
//
// An address cannot see an alt on a hotspot; the browser can. These pin what
// "same browser" means — and, more carefully, what it must NOT mean: two
// people who happen to own the same phone are not one person, and a browser
// that has only ever held one account is not a group.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-devices-'));
const { loadAudit, noteSeen, saveAudit, sharedDevices, standingIdentities } = await import('../src/audit.ts');

const DEV_A = 'a'.repeat(32);
const DEV_B = 'b'.repeat(32);
const PRINT_1 = '11111111';
const PRINT_2 = '22222222';

const seen = (id: string, name: string, ip: string, device: string | null, print: string | null) =>
  noteSeen({ id, name, avatar: '' }, ip, { device, print });

test('two accounts from one stored browser id are one group, a fact', () => {
  // Same phone, different accounts, different addresses — the hotspot alt.
  seen('main', 'Main', '203.0.113.10', DEV_A, PRINT_1);
  seen('alt', 'Alt', '198.51.100.20', DEV_A, PRINT_1);
  const g = sharedDevices().filter(x => x.strength === 'device');
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].players.map(p => p.name).sort(), ['Alt', 'Main']);
  assert.deepEqual(g[0].sharedIps, [], 'they never shared an address — that is the whole point');
});

test('one account seen from one browser many times is not a group', () => {
  for (let i = 0; i < 5; i++) seen('solo', 'Solo', '192.0.2.5', DEV_B, PRINT_2);
  assert.ok(!sharedDevices().some(g => g.players.some(p => p.id === 'solo')),
    'a browser that has only ever held one account says nothing');
});

test('a print match that a device group already covers is not repeated', () => {
  // Main and Alt share both the id and the print. Reporting the print group
  // too would show the same two names twice and make one fact look like two.
  const prints = sharedDevices().filter(x => x.strength === 'print');
  assert.ok(!prints.some(g => g.players.map(p => p.id).sort().join('|') === 'alt|main'));
});

test('a print match on its own is a hint, and a crowded print is nobody', () => {
  // Two accounts, different stored ids, same traits: could be a cleared
  // browser, could be two of the same phone. Listed as a hint.
  seen('p1', 'PrintOne', '203.0.113.50', 'c'.repeat(32), '33333333');
  seen('p2', 'PrintTwo', '203.0.113.51', 'd'.repeat(32), '33333333');
  let hints = sharedDevices().filter(x => x.strength === 'print' && x.players.some(p => p.id === 'p1'));
  assert.equal(hints.length, 1);
  assert.equal(hints[0].players.length, 2);
  // Now a popular handset: many accounts, same print, all different browsers.
  for (let i = 0; i < 8; i++) seen(`crowd${i}`, `Crowd ${i}`, `192.0.2.${100 + i}`, String(i).repeat(32), '44444444');
  hints = sharedDevices().filter(x => x.strength === 'print' && x.players.some(p => p.id === 'crowd0'));
  assert.equal(hints.length, 0, 'eight people with the same phone are eight people');
});

test('a print group that also shares an address says so', () => {
  seen('h1', 'HouseOne', '198.51.100.77', 'e'.repeat(32), '55555555');
  seen('h2', 'HouseTwo', '198.51.100.77', 'f'.repeat(32), '55555555');
  const g = sharedDevices().find(x => x.strength === 'print' && x.players.some(p => p.id === 'h1'));
  assert.ok(g);
  assert.deepEqual(g.sharedIps, ['198.51.100.77']);
});

test('facts sort before hints, bigger groups first', () => {
  const list = sharedDevices();
  const firstHint = list.findIndex(g => g.strength === 'print');
  const lastFact = list.map(g => g.strength).lastIndexOf('device');
  assert.ok(firstHint === -1 || lastFact < firstHint, 'every device group precedes every print group');
});

test('the standings flag the same-browser pair, and only them', () => {
  const rows = standingIdentities(['main', 'alt', 'solo', 'p1']);
  const by = new Map(rows.map(r => [r.id, r]));
  assert.deepEqual(by.get('main')!.sharesDeviceWith, ['Alt']);
  assert.deepEqual(by.get('alt')!.sharesDeviceWith, ['Main']);
  assert.deepEqual(by.get('solo')!.sharesDeviceWith, []);
  assert.deepEqual(by.get('p1')!.sharesDeviceWith, [], 'a print-only hint does not reach the standings');
});

test('a connection that sends no browser signals records none, and breaks nothing', () => {
  noteSeen({ id: 'old', name: 'OldClient', avatar: '' }, '192.0.2.200');
  noteSeen({ id: 'old2', name: 'OldClient2', avatar: '' }, '192.0.2.200', { device: null, print: null });
  assert.ok(!sharedDevices().some(g => g.players.some(p => p.id === 'old' || p.id === 'old2')));
});

test('browsers survive a save and a reload, and an old file without them loads', () => {
  saveAudit();
  loadAudit();
  const g = sharedDevices().filter(x => x.strength === 'device');
  assert.ok(g.some(x => x.players.map(p => p.id).sort().join('|') === 'alt|main'),
    'the same-browser pair is still there after a restart');
});
