// The ban screen's "suspected alts": who else one account looks like.
//
// What must be true: a same-browser account is listed first; a shared small
// address lists its accounts; a crowded address (a carrier, a VPN exit)
// lists nobody, because banning everyone on it would suspend strangers; the
// account itself is never its own alt; and an alt already banned is marked,
// so the screen does not offer to ban it twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tp-alts-'));
const { noteSeen, suspectedAlts } = await import('../src/audit.ts');
const { addBan } = await import('../src/bans.ts');

const seen = (id: string, name: string, ip: string, device: string | null) =>
  noteSeen({ id, name, avatar: `https://cdn.example/${id}.png`, discord: id.startsWith('dc_') ? { id: id.slice(3), username: name.toLowerCase() } : null },
    ip, { device, print: null });

test('same browser first, then shared address; never the account itself', () => {
  seen('dc_1', 'Main', '203.0.113.10', 'a'.repeat(32));
  seen('dc_2', 'PhoneAlt', '198.51.100.99', 'a'.repeat(32)); // same phone, other network
  seen('dc_3', 'HouseAlt', '203.0.113.10', 'b'.repeat(32));  // same address, other browser
  seen('dc_4', 'Stranger', '192.0.2.44', 'c'.repeat(32));
  const alts = suspectedAlts('dc_1');
  assert.deepEqual(alts.map(a => a.name), ['PhoneAlt', 'HouseAlt']);
  assert.equal(alts[0].strength, 'browser');
  assert.deepEqual(alts[0].reasons, ['same browser']);
  assert.equal(alts[1].strength, 'address');
  assert.deepEqual(alts[1].reasons, ['same address 203.0.113.10']);
  assert.ok(!alts.some(a => a.id === 'dc_1'));
});

test('each alt carries what the screen shows: picture, name, Discord tag and id', () => {
  const a = suspectedAlts('dc_1')[0];
  assert.equal(a.avatar, 'https://cdn.example/dc_2.png');
  assert.equal(a.discordTag, 'phonealt');
  assert.equal(a.discordId, '2');
});

test('a crowded address lists nobody', () => {
  seen('dc_10', 'Commuter', '100.0.0.1', null);
  for (let i = 0; i < 9; i++) seen(`dc_${20 + i}`, `Carrier${i}`, '100.0.0.1', null);
  assert.deepEqual(suspectedAlts('dc_10'), [], 'nine strangers on a mobile network are not alts');
});

test('an alt already banned is marked, not offered again', () => {
  addBan({ kind: 'player', value: 'dc_3', name: 'HouseAlt', reason: 'test', by: 'Op' });
  const h = suspectedAlts('dc_1').find(a => a.id === 'dc_3')!;
  assert.equal(h.alreadyBanned, true);
  assert.equal(suspectedAlts('dc_1').find(a => a.id === 'dc_2')!.alreadyBanned, false);
});

test('an unknown account has no alts, and a lone account has none either', () => {
  assert.deepEqual(suspectedAlts('nobody'), []);
  assert.deepEqual(suspectedAlts('dc_4'), []);
});

// ---- a banned person cannot walk back in on the same Discord ----
const { findBan } = await import('../src/bans.ts');

test('a ban on a Discord account follows that Discord to any account and address', () => {
  addBan({ kind: 'player', value: 'dc_700000000000000001', name: 'Cheat', reason: 't', by: 'Op' });
  // The same Discord sign-in, from a new address.
  assert.ok(findBan({ id: 'dc_700000000000000001', discordId: '700000000000000001', ip: '8.8.4.4' }));
  // A fresh guest account that linked the same Discord: a different id.
  assert.ok(findBan({ id: 'g_fresh', discordId: '700000000000000001', ip: '8.8.4.4' }),
    'a new guest on the same Discord is the same person');
});

test('a banned guest that had Discord linked is caught when they sign in with that Discord', () => {
  addBan({ kind: 'player', value: 'g_oldguest', name: 'Guesty', reason: 't', by: 'Op', discordId: '700000000000000002' });
  assert.ok(findBan({ id: 'dc_700000000000000002', discordId: '700000000000000002', ip: '1.1.1.1' }));
});

test('nobody else is caught by it', () => {
  assert.equal(findBan({ id: 'dc_700000000000000003', discordId: '700000000000000003', ip: '9.9.9.9' }), null);
  assert.equal(findBan({ id: 'g_someone', discordId: null, ip: '9.9.9.9' }), null);
});
