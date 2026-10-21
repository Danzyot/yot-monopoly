// Deleting a player's data (erase.ts, DELETE /api/admin/players/:id): what is
// theirs goes, finished games keep everyone else's places under a "Deleted
// player" placeholder that never gets a profile or leaderboard row, bans stay,
// and it is refused while they are seated or playing a running tournament.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-erase-'));

const { writeJson } = await import('../src/jsonstore.ts');
const { erasePlayer, EraseRefused } = await import('../src/erase.ts');
const { DELETED_NAME, isDeletedId } = await import('../src/deleted.ts');
const { recordConnection, getAccount, loadAccounts } = await import('../src/connections.ts');
const { allResults, leaderboard, loadResults, recordResult } = await import('../src/stats.ts');
const { allCardsResults, cardsLeaderboard, loadCardsResults } = await import('../src/cards/stats.ts');
const { cardsDailyAttempt, loadCardsDaily } = await import('../src/cards/daily.ts');
const { buildProfile } = await import('../src/profiles.ts');
const { chosenName, setChosenName } = await import('../src/displayNames.ts');
const { approveHost, isApprovedHost, resetHostsForTest } = await import('../src/hosting.ts');
const { linkWallet, walletsOf, resetWalletsForTest } = await import('../src/wallet/store.ts');
const { addBan, isBanned } = await import('../src/bans.ts');
const { FriendStore } = await import('../src/friends.ts');
const { emailRecord, recordDiscordEmail, setTopics } = await import('../src/email/store.ts');
type Deps = import('../src/erase.ts').EraseDeps;

const ME = 'dc_4242424242';
const PAL = 'dc_7777777777';
const DAY = '2026-10-20';

function seed() {
  loadAccounts();
  recordConnection({ id: ME, name: 'Gone Soon', avatar: '🙂' }, '203.0.113.9');
  recordConnection({ id: PAL, name: 'Pal', avatar: '😀' }, '203.0.113.10');
  loadResults();
  recordResult({
    code: 'MONO1', mapId: 'classic', themeId: 'classic', startedAt: 1, endedAt: 2, turns: 40,
    places: [
      { id: ME, name: 'Gone Soon', isBot: false, netWorth: 3000, character: 'hat', avatar: '🙂' },
      { id: PAL, name: 'Pal', isBot: false, netWorth: 0, character: 'dog', avatar: '😀' },
    ],
  });
  writeJson('cards-results.json', [{
    game: 'cards', code: 'CARD1', startedAt: 1, endedAt: 2, rounds: 3, match: 'single', targetScore: 0,
    places: [
      { id: PAL, name: 'Pal', isBot: false, score: 0, avatar: '😀' },
      { id: ME, name: 'Gone Soon', isBot: false, score: 12, avatar: '🙂' },
    ],
  }]);
  loadCardsResults();
  writeJson('cards-daily.json', {
    salt: 'x'.repeat(32),
    attempts: [
      { date: DAY, id: ME, name: 'Gone Soon', code: 'D1', startedAt: 1, endedAt: 2 },
      { date: DAY, id: PAL, name: 'Pal', code: 'D2', startedAt: 1, endedAt: 2 },
    ],
  });
  loadCardsDaily();
  setChosenName(ME, 'Gone Soon');
  resetHostsForTest();
  approveHost(ME, 'Gone Soon', 'op');
  resetWalletsForTest();
  linkWallet('0x000000000000000000000000000000000000dEaD', ME);
  recordDiscordEmail(ME, 'gone@example.com', true);
  setTopics(ME, { digest: true });
  recordDiscordEmail(PAL, 'pal@example.com', true);
}

function friendStore() {
  const s = new FriendStore({
    account: id => ({ name: id, avatar: '' }), banned: () => false,
    presence: () => ({ online: false }), joinable: () => false,
  }, null);
  s.request(ME, PAL);
  s.accept(PAL, ME);
  s.request('dc_9', ME);
  return s;
}

function deps(over: Partial<Deps> = {}): Deps & { forgotten: string[][]; changed: string[][] } {
  const forgotten: string[][] = [];
  const changed: string[][] = [];
  return {
    seatedAt: () => [],
    tournaments: { forgetPlayer: (id, to, name) => { forgotten.push([id, to, name]); return 1; } },
    friends: friendStore(),
    friendsChanged: ids => changed.push(ids),
    forgotten, changed, ...over,
  };
}

test('deleting a player removes what is theirs and anonymises shared games', () => {
  seed();
  addBan({ kind: 'player', value: ME, name: 'Gone Soon', reason: 'spam', by: 'op' });
  const d = deps();
  const r = erasePlayer(ME, d);

  assert.ok(isDeletedId(r.placeholder));
  assert.deepEqual(
    { ...r, placeholder: 'x' },
    {
      id: ME, placeholder: 'x', name: 'Gone Soon', account: true, monopolyGames: 1, cardsGames: 1, dailyAttempts: 1,
      tournaments: 1, wallets: 1, friends: 1, chosenName: true, host: true, email: true,
    },
  );
  assert.deepEqual(d.forgotten, [[ME, r.placeholder, DELETED_NAME]]);
  assert.deepEqual(d.changed, [[PAL]]);
  assert.equal(d.friends!.forget(ME).length, 0, 'no friendships left');
  assert.equal((d.friends as InstanceType<typeof FriendStore>).view('dc_9').outgoing.length, 0, 'requests to them dropped');

  // Gone: account, name, host approval, wallets, daily attempt. Kept: the ban, and Pal's things.
  assert.equal(getAccount(ME), null);
  assert.ok(getAccount(PAL));
  assert.equal(chosenName(ME), null);
  assert.equal(isApprovedHost(ME), false);
  assert.equal(walletsOf(ME).length, 0);
  assert.equal(cardsDailyAttempt(DAY, ME), undefined);
  assert.ok(cardsDailyAttempt(DAY, PAL));
  assert.ok(isBanned({ id: ME }), 'bans survive');
  assert.equal(emailRecord(ME), null, 'the email address and choices go');
  assert.equal(emailRecord(PAL)?.email, 'pal@example.com');

  // Shared games: their place is the placeholder; Pal's is untouched.
  const mono = allResults()[0].places;
  assert.deepEqual(mono[0], { id: r.placeholder, name: DELETED_NAME, isBot: false, netWorth: 3000, character: 'hat' });
  assert.equal(mono[1].id, PAL);
  const cards = allCardsResults()[0].places;
  assert.equal(cards[1].id, r.placeholder);
  assert.equal(cards[1].name, DELETED_NAME);
  assert.equal(cards[1].score, 12);
  assert.equal('avatar' in cards[1], false);

  // Nothing public is built for the placeholder.
  assert.equal(buildProfile(ME, allResults()), null);
  assert.equal(buildProfile(r.placeholder, allResults()), null);
  assert.ok(leaderboard().every(row => row.id !== r.placeholder && row.id !== ME));
  assert.ok(cardsLeaderboard().every(row => row.id !== r.placeholder && row.id !== ME));
  assert.ok(leaderboard().some(row => row.id === PAL));
});

test('refused while seated or in a running tournament, and nothing changes', () => {
  seed();
  assert.throws(() => erasePlayer(ME, deps({ seatedAt: () => ['Monopoly ABCDE'] })), (e: Error) => e instanceof EraseRefused && /ABCDE/.test(e.message));
  assert.throws(
    () => erasePlayer(ME, deps({ tournaments: { forgetPlayer: () => { throw new Error('They are playing in "Cup"'); } } })),
    (e: Error) => e instanceof EraseRefused && /Cup/.test(e.message),
  );
  assert.ok(getAccount(ME));
  assert.equal(allResults().at(-1)!.places[0].id, ME);
  assert.equal(chosenName(ME), 'Gone Soon');
});

test('bad ids are refused', () => {
  assert.throws(() => erasePlayer('../etc', deps()), EraseRefused);
  assert.throws(() => erasePlayer('', deps()), EraseRefused);
});
