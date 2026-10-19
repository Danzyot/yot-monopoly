// Banning someone here can also ban them from the Discord server.
//
// The property worth protecting is not that the ban works — it is that the
// UNBAN cannot overreach. Lifting a poker ban must never quietly readmit
// someone a moderator threw out of Discord by hand for something that had
// nothing to do with cards. That is why the row records what THIS site did,
// rather than asking Discord what it currently holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'wawa-dban-'));
const { addBan, banAt, listBans, removeBan } = await import('../src/bans.ts');

test('a ban remembers whether this site also banned them on Discord', () => {
  addBan({ kind: 'player', value: 'dc_111', name: 'Ann', reason: 'chip dumping', by: 'Dir', discordBanned: true });
  addBan({ kind: 'player', value: 'dc_222', name: 'Ben', reason: 'stalling', by: 'Dir' });

  assert.equal(banAt('player', 'dc_111')?.discordBanned, true);
  assert.equal(banAt('player', 'dc_222')?.discordBanned, undefined,
    'a ban that never touched Discord carries no claim that it did');
});

test('the flag survives being written out and read back', async () => {
  const rows = listBans();
  const ann = rows.find(b => b.value === 'dc_111');
  assert.equal(ann?.discordBanned, true, 'still set in the stored list');
});

test('banAt finds the exact row a delete would remove, by its own key', () => {
  addBan({
    kind: 'player', value: 'dc_333', name: 'Cal', reason: 'alt',
    by: 'Dir', scope: 'game', gameId: 't1', gameName: 'Sunday', discordBanned: true,
  });
  // Same person, different scope: these are different rows and must not be
  // confused, or lifting one would report the other's Discord state.
  assert.equal(banAt('player', 'dc_333'), null, 'a lifetime lookup does not find a game ban');
  assert.equal(banAt('player', 'dc_333', 'game', 'other')?.discordBanned, undefined);
  assert.equal(banAt('player', 'dc_333', 'game', 't1')?.discordBanned, true);
});

test('an address ban never claims a Discord ban, because an address has nobody behind it', () => {
  addBan({ kind: 'ip', value: '203.0.113.9', name: 'household', reason: '', by: 'Dir' });
  assert.equal(banAt('ip', '203.0.113.9')?.discordBanned, undefined);
});

test('lifting a ban this site did not place on Discord leaves Discord alone', () => {
  // Ben was banned here only. Whatever his standing is on Discord — including
  // a hand-placed ban for something unrelated — is not ours to undo.
  const before = banAt('player', 'dc_222');
  assert.equal(before?.discordBanned, undefined);
  assert.equal(removeBan('player', 'dc_222'), true);
  assert.equal(banAt('player', 'dc_222'), null);
  // The route reads the row BEFORE deleting and only calls Discord when the
  // flag was set; with it absent there is nothing for it to act on.
});

test('the row is readable before removal, which is what makes the lift possible', () => {
  const row = banAt('player', 'dc_111');
  assert.ok(row, 'still there to read');
  assert.equal(row.discordBanned, true);
  assert.equal(removeBan('player', 'dc_111'), true);
  assert.equal(banAt('player', 'dc_111'), null, 'and gone afterwards');
});

test('a later poker-only re-ban does not erase the record of the Discord ban', () => {
  // Re-banning replaces the row. If that wiped the flag, the eventual unban
  // would leave the person barred from Discord forever with nothing left
  // anywhere to say the site had put them there.
  addBan({ kind: 'player', value: 'dc_444', name: 'Dee', reason: 'first', by: 'Dir', discordBanned: true });
  addBan({ kind: 'player', value: 'dc_444', name: 'Dee', reason: 'second, poker only', by: 'Dir' });
  const row = banAt('player', 'dc_444');
  assert.equal(row?.reason, 'second, poker only', 'the newer note wins');
  assert.equal(row?.discordBanned, true, 'but the Discord ban is still on record');
});
