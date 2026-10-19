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

function makeT(social: SocialRequirements): Tournament {
  const config: TournamentConfig = {
    name: 'RoleTest', startingStack: 5000, levelMinutes: 5, structure: 'regular',
    maxPlayers: 100, minPlayers: 2, lateRegMinutes: 15, approveRegistrations: false, buyIn: 100,
    breakEveryLevels: 0, seatsPerTable: 9, social, maxReentries: 0, prizeText: null, rabbitHunting: false, displayMode: 'chips',
  };
  return new Tournament(config, { id: 'host', name: 'Host' }, noopCb);
}

const ROLE_REQ: SocialRequirements = {
  xUrl: null, igUrl: null,
  discordInviteUrl: 'https://discord.gg/lucid',
  discordGuildId: '12345678901234567',
  discordRoleId: '99999999999999999',
  discordRoleName: 'VIP',
  requireDiscord: true,
};

test('role requirement blocks until verified', () => {
  const t = makeT(ROLE_REQ);
  const player = { id: 'p1', discord: { id: '42', username: 'ace' } };
  t.confirmSocial('p1', { discordJoined: true, discordVerified: true });
  assert.throws(() => t.assertRequirementsMet(player, true), /VIP role/);
  t.confirmSocial('p1', { discordRoleOk: true });
  t.assertRequirementsMet(player, true);
});

test('role progress surfaces in the view', () => {
  const t = makeT(ROLE_REQ);
  t.confirmSocial('p1', { discordVerified: true, discordRoleOk: true });
  const v = t.view('p1', true);
  assert.equal(v.mySocial.discordRoleOk, true);
  assert.equal(v.social?.discordRoleName, 'VIP');
});
