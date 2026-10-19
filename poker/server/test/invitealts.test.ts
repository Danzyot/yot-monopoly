// What the invite log adds to the alt picture: the ban screen's suspected
// alts and the audit's Discord invites tab.
//
// A friend's invite is not evidence, so an account linked ONLY by an invite
// is listed when the account that joined was fresh. An account already
// linked by browser or address just gains a "Discord invite" chip. And an
// invited account that never signed in to the site is still listed, by its
// Discord id, so it can be banned before it ever plays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tp-invitealts-'));
const { noteSeen, suspectedAlts } = await import('../src/audit.ts');
const { recordJoin, accountCreatedAt } = await import('../src/invitelog.ts');
const { inviteReport } = await import('../src/invitereport.ts');
const { addBan } = await import('../src/bans.ts');

const DAY = 86_400_000;
const idAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);
const now = Date.now();
const MAIN = idAt(now - 900 * DAY);
const FRESH_SITE = idAt(now - 3 * DAY);     // fresh, signed in to the site
const FRESH_DISCORD = idAt(now - 1 * DAY);  // fresh, never signed in
const FRIEND = idAt(now - 700 * DAY);       // old account, a real friend
const SHARED = idAt(now - 500 * DAY);       // old, but on the main's browser

const seen = (discordId: string, name: string, ip: string, device: string) =>
  noteSeen({ id: `dc_${discordId}`, name, avatar: '🙂', discord: { id: discordId, username: name.toLowerCase() } },
    ip, { device, print: null });
const joined = (memberId: string, name: string, inviterId: string) => recordJoin({
  memberId, memberName: name, memberAvatar: null, accountCreatedAt: accountCreatedAt(memberId),
  joinedAt: now, how: 'invite', code: 'abc', inviterId, inviterName: 'Main',
});

seen(MAIN, 'Main', '203.0.113.10', 'a'.repeat(32));
seen(FRESH_SITE, 'FreshAlt', '198.51.100.7', 'f'.repeat(32));
seen(FRIEND, 'Friend', '192.0.2.50', 'g'.repeat(32));
seen(SHARED, 'SharedPC', '198.51.100.8', 'a'.repeat(32));
joined(FRESH_SITE, 'FreshAlt', MAIN);
joined(FRESH_DISCORD, 'DiscordOnly', MAIN);
joined(FRIEND, 'Friend', MAIN);
joined(SHARED, 'SharedPC', MAIN);

test('fresh accounts they invited are listed; an old friend is not', () => {
  const alts = suspectedAlts(`dc_${MAIN}`);
  const names = alts.map(a => a.name);
  assert.ok(names.includes('FreshAlt'));
  assert.ok(names.includes('DiscordOnly'), 'listed even though they never signed in here');
  assert.ok(!names.includes('Friend'), 'a two-year-old account they invited is just a friend');
  const fresh = alts.find(a => a.name === 'FreshAlt')!;
  assert.equal(fresh.strength, 'invite');
  assert.match(fresh.reasons[0], /joined the Discord through their invite · account 3d old/);
});

test('a Discord-only alt carries its Discord id, so it can be banned here and on Discord', () => {
  const d = suspectedAlts(`dc_${MAIN}`).find(a => a.name === 'DiscordOnly')!;
  assert.equal(d.id, FRESH_DISCORD);
  assert.equal(d.discordId, FRESH_DISCORD);
  assert.match(d.reasons[0], /never signed in here/);
  addBan({ kind: 'player', scope: 'lifetime', gameId: null, gameName: '', value: FRESH_DISCORD, name: 'DiscordOnly', reason: '', by: 'Op', discordBanned: false });
  assert.equal(suspectedAlts(`dc_${MAIN}`).find(a => a.name === 'DiscordOnly')!.alreadyBanned, true);
});

test('an account already linked by browser keeps that and gains a chip', () => {
  const s = suspectedAlts(`dc_${MAIN}`).find(a => a.name === 'SharedPC')!;
  assert.equal(s.strength, 'browser', 'browser still ranks first');
  assert.deepEqual(s.reasons, ['same browser', 'Discord invite']);
  assert.equal(suspectedAlts(`dc_${MAIN}`)[0].name, 'SharedPC', 'and is listed first');
});

test('the invited side sees the inviter too', () => {
  const alts = suspectedAlts(`dc_${FRESH_SITE}`);
  const m = alts.find(a => a.name === 'Main')!;
  assert.ok(m, 'the fresh account\'s inviter is listed on its ban screen');
  assert.match(m.reasons[0], /invited them to the Discord · their account was 3d old/);
});

test('the audit tab flags fresh joins and same-browser joins, and ranks the inviter', () => {
  const r = inviteReport();
  const byName = new Map(r.joins.map(j => [j.memberName, j]));
  assert.match(byName.get('FreshAlt')!.flags.join(), /fresh account \(3d old\)/);
  assert.match(byName.get('SharedPC')!.flags.join(), /same browser as the inviter on the site/);
  assert.equal(byName.get('Friend')!.flags.length, 0, 'nothing to say about an old friend');
  assert.match(byName.get('DiscordOnly')!.flags.join(), /banned/);
  assert.equal(byName.get('FreshAlt')!.member?.id, `dc_${FRESH_SITE}`, 'linked to the site account');
  assert.equal(r.inviters[0].inviterId, MAIN);
  assert.equal(r.inviters[0].invited, 4);
  assert.equal(r.inviters[0].fresh, 2);
  assert.equal(r.inviters[0].flagged, 3);
});
