// Community features: host transfer, Discord join requirements, public profiles.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_GRACE_MS, Registry, type Room, type RoomHooks } from '../src/rooms.ts';
import {
  checkRequirements, resolveRequirements, setMembershipLookup, setRolesLookup, type MembershipLookup,
} from '../src/requirements.ts';
import { takeSeat } from '../src/seating.ts';
import { buildProfile } from '../src/profiles.ts';
import type { GameRecord } from '../src/stats.ts';
import type { JoinRequirements, PlayerProfile } from '../../shared/types.ts';

const hooks = (): RoomHooks & { events: string[]; changes: number } => {
  const h = {
    events: [] as string[], changes: 0,
    onChange() { h.changes++; }, onEvent(_r: Room, t: string) { h.events.push(t); }, onFinished() {},
  };
  return h;
};
const m = (id: string, name = id) => ({ id, name, avatar: '🙂' });

// ---- host transfer ------------------------------------------------------------

test('host transfer: host or operator hands over to a seated, connected human', () => {
  const h = hooks();
  const reg = new Registry(h, 1e9);
  const r = reg.create('a');
  r.join(m('a', 'Alice')); r.join(m('b', 'Bob')); r.join(m('c', 'Cleo'));
  r.addBot('a', false);
  const bot = r.seats.find(s => s.isBot)!;

  assert.throws(() => r.transferHost('b', 'c', false), /host/, 'only the host may hand over');
  assert.throws(() => r.transferHost('a', bot.id, false), /bot/);
  assert.throws(() => r.transferHost('a', 'zed', false), /Not in this room/);
  assert.throws(() => r.transferHost('a', 'a', false), /already the host/);
  r.setConnected('c', false);
  assert.throws(() => r.transferHost('a', 'c', false), /not at the table/);
  r.setConnected('c', true);

  r.transferHost('a', 'b', false);
  assert.equal(r.hostId, 'b');
  assert.ok(h.events.includes('Bob is now the host (handed over by Alice)'));
  assert.throws(() => r.addBot('a', false), /host/, 'the old host lost host powers');

  // Operators can move it too, and it works mid-game (host keeps kick powers).
  r.start('b', false);
  r.transferHost('a', 'c', true);
  assert.equal(r.hostId, 'c');
  assert.ok(h.events.includes('Cleo is now the host (handed over by an operator)'));
  assert.doesNotThrow(() => r.kick('c', 'a', false));
  r.dispose();
});

test('host transfer: leaving passes it to the longest-seated connected human', () => {
  const h = hooks();
  const reg = new Registry(h, 1e9);
  const lobby = reg.create('a');
  lobby.join(m('a', 'Alice')); lobby.join(m('b', 'Bob')); lobby.join(m('c', 'Cleo'));
  lobby.setConnected('b', false);
  lobby.leave('a');
  assert.equal(lobby.hostId, 'c', 'Bob is seated longer but away');
  assert.ok(h.events.includes('Cleo is now the host (Alice left)'));
  lobby.dispose();

  const game = reg.create('a');
  game.join(m('a', 'Alice')); game.join(m('b', 'Bob')); game.join(m('c', 'Cleo'));
  game.start('a', false);
  game.leave('a');
  assert.equal(game.hostId, 'b');
  assert.ok(game.game!.player('a').bankrupt, 'leaving mid-game still forfeits');
  // Someone who left can never be handed the room back automatically.
  game.leave('b');
  assert.equal(game.hostId, 'c');
  game.dispose();
});

test('host transfer: a host away for over 2 minutes mid-game is replaced', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const h = hooks();
    const reg = new Registry(h, 1e9);
    const r = reg.create('a');
    r.join(m('a', 'Alice')); r.join(m('b', 'Bob')); r.join(m('c', 'Cleo'));
    r.start('a', false);
    r.setConnected('b', false); // longest-seated after Alice, but also away
    r.setConnected('a', false);
    mock.timers.tick(HOST_GRACE_MS - 1_000);
    assert.equal(r.hostId, 'a', 'a short absence keeps the host');
    // Coming back in time resets the clock.
    r.setConnected('a', true);
    r.setConnected('a', false);
    mock.timers.tick(HOST_GRACE_MS - 1_000);
    assert.equal(r.hostId, 'a');
    mock.timers.tick(2_000);
    assert.equal(r.hostId, 'c');
    assert.ok(h.events.includes('Cleo is now the host (Alice was away for over 2 minutes)'));
    assert.ok(h.changes > 0, 'the change is broadcast');
    r.dispose();

    // With nobody else around, the room waits and hands over when someone returns.
    const q = reg.create('x');
    q.join(m('x', 'Xena')); q.join(m('y', 'Yuri'));
    q.start('x', false);
    q.setConnected('y', false);
    q.setConnected('x', false);
    mock.timers.tick(HOST_GRACE_MS + 5_000);
    assert.equal(q.hostId, 'x');
    q.setConnected('y', true);
    assert.equal(q.hostId, 'y');
    q.dispose();
  } finally {
    mock.timers.reset();
  }
});

test('host transfer: a restored room hands over if its host never comes back', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 5_000_000 });
  try {
    const reg = new Registry(hooks(), 1e9);
    const r = reg.create('a');
    r.join(m('a')); r.join(m('b')); r.join(m('c')); r.join(m('d'));
    r.start('a', false);
    r.leave('d'); // left for good: remembered across the restart
    const snap = JSON.parse(JSON.stringify(reg.snapshot()));
    r.dispose();
    assert.deepEqual(snap[0].departed, ['d']);

    // Everyone comes back disconnected; the host's 2-minute clock starts at boot.
    const h = hooks();
    const reg2 = new Registry(h, 1e9);
    assert.equal(reg2.restore(snap), 1);
    const r2 = reg2.get(r.code)!;
    assert.equal(r2.hostId, 'a');
    r2.join(m('c'));
    mock.timers.tick(HOST_GRACE_MS + 1_000);
    assert.equal(r2.hostId, 'c', 'longest-seated connected human');
    r2.dispose();

    // Snapshots written before these fields existed still load.
    const legacy = JSON.parse(JSON.stringify(snap));
    delete legacy[0].requirements; delete legacy[0].departed;
    const reg3 = new Registry(hooks(), 1e9);
    assert.equal(reg3.restore(legacy), 1);
    const r3 = reg3.get(r.code)!;
    assert.equal(r3.requirements, null);
    assert.equal(r3.hostId, 'a');
    r3.dispose();
  } finally {
    mock.timers.reset();
  }
});

// ---- Discord requirements ---------------------------------------------------------

const GUILD = '123456789012345678';
const ROLE = '987654321098765432';
const player = (id: string, extra: Partial<PlayerProfile> = {}): PlayerProfile =>
  ({ id: `dc_${id}`, name: id, avatar: '🙂', provider: 'discord', discord: { id, username: id }, ...extra });
const memberReq: JoinRequirements = { guildId: GUILD, member: true, roleId: null, roleName: null };
const roleReq: JoinRequirements = { guildId: GUILD, member: true, roleId: ROLE, roleName: 'VIP' };

/** Discord as seen by the stub: who is in the server, and with which roles. */
function stubDiscord(people: Record<string, string[] | 'unknown' | 'down'>): { calls: number } {
  const seen = { calls: 0 };
  const lookup: MembershipLookup = async (id, guildId) => {
    seen.calls++;
    assert.equal(guildId, GUILD);
    const p = people[id];
    if (p === 'down') throw new Error('network');
    if (p === 'unknown') return { member: false, roleIds: [], authoritative: false };
    if (!p) return { member: false, roleIds: [], authoritative: true };
    return { member: true, roleIds: p, authoritative: true };
  };
  setMembershipLookup(lookup);
  return seen;
}

test('requirements: members sit, everyone else watches with a clear reason', async () => {
  const stub = stubDiscord({ mem: [], vip: [ROLE], ghost: 'unknown', slow: 'down' });
  try {
    const reg = new Registry(hooks(), 1e9);
    const r = reg.create('dc_host');
    r.join(m('dc_host'));
    assert.throws(() => r.setRequirements('dc_mem', false, memberReq), /host/);
    r.setRequirements('dc_host', false, memberReq);
    assert.deepEqual(r.view().requirements, memberReq);
    assert.deepEqual(r.summary().requirements, memberReq, 'the room list shows the badge');

    assert.deepEqual(await takeSeat(r, player('mem'), false), { seated: true, blocked: null });

    const out = await takeSeat(r, player('stranger'), false);
    assert.equal(out.seated, false);
    assert.equal(out.blocked?.missing, 'member');
    assert.match(out.blocked!.message, /not in our Discord server/);
    assert.equal(r.seat('dc_stranger'), undefined);

    const ghost = await takeSeat(r, player('ghost'), false);
    assert.equal(ghost.blocked?.missing, 'unverifiable');
    const slow = await takeSeat(r, player('slow'), false);
    assert.equal(slow.blocked?.missing, 'unverifiable', 'Discord failing is never read as "not a member"');

    const demo = await takeSeat(r, { id: 'demo_x', name: 'x', avatar: '🙂', provider: 'demo' }, false);
    assert.equal(demo.blocked?.missing, 'discord');

    // Operators are never gated, and Discord is not even asked.
    const before = stub.calls;
    assert.equal((await takeSeat(r, player('boss', { isAdmin: true }), false)).seated, true);
    assert.equal(stub.calls, before);

    // Spectating stays open: asking to watch never consults Discord.
    assert.deepEqual(await takeSeat(r, player('stranger'), true), { seated: false, blocked: null });
    assert.equal(stub.calls, before);

    // Reclaiming your own seat is never gated (reconnects must not depend on Discord).
    setMembershipLookup(async () => ({ member: false, roleIds: [], authoritative: true }));
    assert.equal((await takeSeat(r, player('mem'), false)).seated, true);
    r.dispose();
  } finally {
    setMembershipLookup(null);
  }
});

test('requirements: a role requirement needs the role, verified authoritatively', async () => {
  stubDiscord({ mem: [], vip: [ROLE] });
  try {
    const reg = new Registry(hooks(), 1e9);
    const r = reg.create('dc_host');
    r.join(m('dc_host'));
    r.setRequirements('dc_host', false, roleReq);
    const noRole = await takeSeat(r, player('mem'), false);
    assert.equal(noRole.blocked?.missing, 'role');
    assert.match(noRole.blocked!.message, /VIP/);
    assert.equal((await takeSeat(r, player('vip'), false)).seated, true);

    // A sign-in snapshot says "member" but carries no roles: that is unverifiable, not a pass.
    setMembershipLookup(async () => ({ member: true, roleIds: [], authoritative: false }));
    assert.equal((await checkRequirements(player('snap'), roleReq))?.missing, 'unverifiable');
    assert.equal(await checkRequirements(player('snap'), memberReq), null, 'a positive snapshot is enough for membership');
    r.dispose();
  } finally {
    setMembershipLookup(null);
  }
});

test('requirements: a full room or a started game is not worth asking Discord about', async () => {
  const stub = stubDiscord({});
  try {
    const reg = new Registry(hooks(), 1e9);
    const r = reg.create('dc_host');
    r.join(m('dc_host')); r.join(m('dc_b'));
    r.setRequirements('dc_host', false, memberReq);
    r.start('dc_host', false);
    assert.deepEqual(await takeSeat(r, player('late'), false), { seated: false, blocked: null });
    assert.equal(stub.calls, 0);
    assert.throws(() => r.setRequirements('dc_host', false, null), /started/);
    r.dispose();
  } finally {
    setMembershipLookup(null);
  }
});

test('requirements: hosts can only require what the site can check; they persist', async () => {
  const saved = process.env.DISCORD_GUILD_ID;
  try {
    delete process.env.DISCORD_GUILD_ID;
    assert.equal(await resolveRequirements({ member: false }), null);
    await assert.rejects(resolveRequirements({ member: true }), /no Discord server/);

    process.env.DISCORD_GUILD_ID = GUILD;
    setRolesLookup(async () => [{ id: ROLE, name: 'VIP' }]);
    assert.deepEqual(await resolveRequirements({ member: true }), memberReq);
    assert.deepEqual(await resolveRequirements({ roleId: ROLE }), roleReq, 'a role implies membership; its name comes from Discord');
    await assert.rejects(resolveRequirements({ roleId: '111111111111111111' }), /no longer exists/);
    await assert.rejects(resolveRequirements({ roleId: 'x' }), /Unknown role/);

    const reg = new Registry(hooks(), 1e9);
    const r = reg.create('a');
    r.join(m('a')); r.join(m('b'));
    r.setRequirements('a', false, roleReq);
    const snap = JSON.parse(JSON.stringify(reg.snapshot()));
    snap[0].requirements.roleId = 'not-a-snowflake';
    r.dispose();
    const reg2 = new Registry(hooks(), 1e9);
    reg2.restore(snap);
    assert.deepEqual(reg2.get(r.code)!.requirements, { guildId: GUILD, member: true, roleId: null, roleName: null },
      'a damaged role is dropped, membership kept');
    reg2.get(r.code)!.dispose();
  } finally {
    setRolesLookup(null);
    if (saved === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = saved;
  }
});

// ---- profiles -----------------------------------------------------------------------

const rec = (code: string, mapId: string, places: GameRecord['places'], endedAt = 1): GameRecord =>
  ({ code, mapId, themeId: 'classic', startedAt: endedAt - 1000, endedAt, turns: 30, places });
const P = (id: string, extra: Partial<GameRecord['places'][number]> = {}) =>
  ({ id, name: id.toUpperCase(), isBot: false, netWorth: 100, ...extra });
const BOT = (id: string) => ({ id, name: id, isBot: true, netWorth: 0 });

test('profiles: aggregate results, match leaderboard points, tolerate old records', () => {
  const records: GameRecord[] = [
    // Old record: no character, no avatar.
    rec('AAAAA', 'classic', [P('dc_1'), P('dc_2'), BOT('bot-1')], 10),
    rec('BBBBB', 'speed', [P('dc_2', { character: 'robo' }), P('dc_1', { character: 'cosmo', avatar: 'https://cdn.discordapp.com/a.png' })], 20),
    // Against bots only: in history, not in points.
    rec('CCCCC', 'speed', [P('dc_1', { character: 'cosmo' }), BOT('bot-2')], 30),
    rec('DDDDD', 'metro', [P('dc_3'), P('dc_1', { character: 'robo', name: 'Renamed' }), P('dc_2')], 40),
  ];
  const p = buildProfile('dc_1', records)!;
  assert.equal(p.name, 'Renamed', 'latest name');
  assert.equal(p.avatar, 'https://cdn.discordapp.com/a.png', 'latest known avatar');
  assert.equal(p.games, 4);
  assert.equal(p.wins, 2);
  assert.equal(p.winRate, 0.5);
  assert.equal(p.rankedGames, 3);
  // Same formula as the leaderboard: one point per opponent outlasted, ranked games only.
  assert.equal(p.points, 2 + 0 + 1);
  assert.deepEqual(p.favouriteMap, { id: 'speed', games: 2 });
  assert.deepEqual(p.favouriteCharacter, { id: 'cosmo', games: 2 });
  assert.deepEqual(p.recent.map(g => g.code), ['DDDDD', 'CCCCC', 'BBBBB', 'AAAAA'], 'newest first');
  const d = p.recent[0];
  assert.deepEqual([d.place, d.of, d.turns, d.character], [2, 3, 30, 'robo']);
  assert.deepEqual(d.opponents.map(o => [o.id, o.place]), [['dc_3', 1], ['dc_2', 3]]);
  assert.equal(p.recent[3].character, null);
  assert.equal(p.recent[3].opponents.find(o => o.isBot)?.id, 'bot-1');

  // Ties go to the most recently played.
  assert.deepEqual(buildProfile('dc_3', records)!.favouriteMap, { id: 'metro', games: 1 });
  assert.equal(buildProfile('dc_3', records)!.avatar, '🎩', 'no avatar recorded: a default');

  assert.equal(buildProfile('dc_nobody', records), null);
  assert.equal(buildProfile('bot-1', records), null, 'bots have no profile');
  assert.equal(buildProfile('../../etc', records), null);
  assert.deepEqual(Object.keys(p).sort(), ['avatar', 'favouriteCharacter', 'favouriteMap', 'games', 'id', 'name',
    'points', 'rankedGames', 'recent', 'winRate', 'wins'], 'only public game facts');
});
