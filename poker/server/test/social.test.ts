import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Tournament, type TournamentCallbacks } from '../src/tournament/tournament.ts';
import type { SocialRequirements, TournamentConfig } from '../../shared/types.ts';

const noopCb: TournamentCallbacks = {
  broadcastTable: () => {},
  tableChat: () => {},
  tableEvent: () => {},
  broadcastTourney: () => {},
  tourneyChat: () => {},
  assigned: () => {},
  lobbyChanged: () => {},
};

function makeT(social: SocialRequirements | null): Tournament {
  const config: TournamentConfig = {
    name: 'Test', startingStack: 5000, levelMinutes: 5, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15, approveRegistrations: false, buyIn: 100,
    breakEveryLevels: 0, seatsPerTable: 9, social, maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  return new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
}

const FULL_REQ: SocialRequirements = {
  xUrl: 'https://x.com/wawa',
  igUrl: 'https://instagram.com/wawa',
  discordInviteUrl: 'https://discord.gg/wawa',
  discordGuildId: '12345678901234567',
  discordRoleId: null,
  discordRoleName: null,
  requireDiscord: true,
};

test('no requirements → registration is open', () => {
  const t = makeT(null);
  t.assertRequirementsMet({ id: 'p1' }, true);
  t.register({ id: 'p1', name: 'P1', avatar: '🙂' });
  assert.equal(t.players.size, 1);
});

test('unmet X follow blocks registration', () => {
  const t = makeT(FULL_REQ);
  assert.throws(() => t.assertRequirementsMet({ id: 'p1' }, false), /Follow the host on X/);
});

test('confirmations unlock steps in order', () => {
  const t = makeT(FULL_REQ);
  t.confirmSocial('p1', { x: true });
  assert.throws(() => t.assertRequirementsMet({ id: 'p1' }, false), /Instagram/);
  t.confirmSocial('p1', { ig: true });
  assert.throws(() => t.assertRequirementsMet({ id: 'p1' }, false), /Join the Discord/);
  t.confirmSocial('p1', { discordJoined: true });
  // Discord auth NOT configured → honor mode passes without a linked account.
  t.assertRequirementsMet({ id: 'p1' }, false);
});

test('requireDiscord with auth configured demands a linked account', () => {
  const t = makeT(FULL_REQ);
  t.confirmSocial('p1', { x: true, ig: true, discordJoined: true });
  assert.throws(() => t.assertRequirementsMet({ id: 'p1' }, true), /Connect your Discord/);
  // Linked but membership unverified with a guild id set → still blocked.
  assert.throws(
    () => t.assertRequirementsMet({ id: 'p1', discord: { id: '42', username: 'ace' } }, true),
    /membership could not be verified/,
  );
  // Verified member → passes.
  t.confirmSocial('p1', { discordVerified: true });
  t.assertRequirementsMet({ id: 'p1', discord: { id: '42', username: 'ace' } }, true);
});

test('social progress reflected in view', () => {
  const t = makeT(FULL_REQ);
  t.confirmSocial('p1', { x: true, discordVerified: true });
  const v = t.view('p1', true);
  assert.equal(v.mySocial.x, true);
  assert.equal(v.mySocial.ig, false);
  assert.equal(v.mySocial.discordJoined, true); // verified implies joined
  assert.equal(v.mySocial.discordVerified, true);
  assert.equal(v.mySocial.discordLinked, true);
  assert.ok(v.social);
});

test('discord identity lands in standings after register', () => {
  const t = makeT(null);
  t.register({ id: 'p1', name: 'P1', avatar: '🙂', discord: { id: '42', username: 'ace' }, discordVerified: true });
  t.register({ id: 'p2', name: 'P2', avatar: '🙃' });
  const v = t.view(null);
  const p1 = v.standings.find(s => s.id === 'p1')!;
  assert.equal(p1.discordTag, 'ace');
  assert.equal(p1.discordVerified, true);
  const p2 = v.standings.find(s => s.id === 'p2')!;
  assert.equal(p2.discordTag, null);
});
