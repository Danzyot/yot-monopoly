// Player hosts, piece by piece: the signed question to the hub (with the hub
// mocked), its cache and its failure mode, the limits on what a player host
// may open, and the short list of things they may do to their own event.
// hostingapi.test.ts drives the same rules over HTTP and sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SECRET = 'shared-hub-and-poker-secret';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-hosting-'));
process.env.CHOG_SECRET = SECRET;
process.env.HUB_URL = 'https://hub.test';

const hosting = await import('../src/hosting.ts');
const { mayRunTable } = await import('../src/sockets.ts');
const { registry } = await import('../src/registry.ts');
import type { TournamentConfig } from '../../shared/types.ts';

// ---- a fake hub ------------------------------------------------------------------

let now = 1_700_000_000_000;
hosting.configureHosting({ now: () => now });

/** Answers like the hub does, checking the signature the way the hub does. */
function fakeHub(answers: Record<string, 'admin' | 'holder' | 'approved' | null>, opts: { down?: boolean; status?: number } = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const id = url.searchParams.get('id') ?? '';
    calls.push(id);
    if (opts.down) throw new TypeError('fetch failed');
    const headers = new Headers(init?.headers);
    const ts = headers.get('x-chog-timestamp') ?? '';
    const expect = createHmac('sha256', Buffer.from(SECRET, 'utf8'))
      .update(`svc:hosting:can-host:${id}:${ts}`).digest('base64url');
    assert.equal(url.origin + url.pathname, 'https://hub.test/api/hosting/can-host');
    if (headers.get('x-chog-signature') !== expect) return new Response('{"error":"bad"}', { status: 401 });
    if (opts.status) return new Response('{}', { status: opts.status });
    const reason = answers[id] ?? null;
    return Response.json({ canHost: reason !== null, reason });
  }) as typeof fetch;
  return { impl, calls };
}

test('requireHost asks the hub, signed, and believes its answer', async () => {
  hosting.clearHostCache();
  const hub = fakeHub({ dc_holder: 'holder', dc_approved: 'approved' });
  hosting.configureHosting({ fetch: hub.impl });
  assert.deepEqual(await hosting.hubCanHost('dc_holder'), { canHost: true, reason: 'holder' });
  assert.deepEqual(await hosting.hubCanHost('dc_approved'), { canHost: true, reason: 'approved' });
  assert.deepEqual(await hosting.hubCanHost('dc_rando'), { canHost: false, reason: null });
  assert.deepEqual(hub.calls, ['dc_holder', 'dc_approved', 'dc_rando']);
});

test('answers are cached for a minute, yes or no', async () => {
  hosting.clearHostCache();
  const hub = fakeHub({ dc_holder: 'holder' });
  hosting.configureHosting({ fetch: hub.impl });
  await hosting.hubCanHost('dc_holder');
  await hosting.hubCanHost('dc_rando');
  now += hosting.HOST_CACHE_MS - 1_000;
  await hosting.hubCanHost('dc_holder');
  await hosting.hubCanHost('dc_rando');
  assert.equal(hub.calls.length, 2, 'inside the minute: no new questions');
  now += 2_000;
  await hosting.hubCanHost('dc_holder');
  assert.equal(hub.calls.length, 3, 'after it: asked again (a Chog may have been sold)');
});

test('a hub that is down, erroring or refusing our signature is a "no" with a reason, not cached', async () => {
  hosting.clearHostCache();
  const down = fakeHub({ dc_holder: 'holder' }, { down: true });
  hosting.configureHosting({ fetch: down.impl });
  const r = await hosting.hubCanHost('dc_holder');
  assert.equal(r.canHost, false, 'fail closed');
  assert.equal(r.error, hosting.HUB_UNREACHABLE);
  await hosting.hubCanHost('dc_holder');
  assert.equal(down.calls.length, 2, 'a failure is not remembered');

  hosting.configureHosting({ fetch: fakeHub({ dc_holder: 'holder' }, { status: 500 }).impl });
  assert.equal((await hosting.hubCanHost('dc_holder')).error, hosting.HUB_UNREACHABLE);

  // The hub answers 401 when the secrets differ; that is a "no" too.
  const wrong = (async (input: string | URL | Request, init?: RequestInit) => {
    const sig = new Headers(init?.headers).get('x-chog-signature');
    const ts = new Headers(init?.headers).get('x-chog-timestamp');
    const id = new URL(String(input)).searchParams.get('id');
    const otherHub = createHmac('sha256', 'the-hub-has-another-secret').update(`svc:hosting:can-host:${id}:${ts}`).digest('base64url');
    return sig === otherHub ? Response.json({ canHost: true, reason: 'holder' }) : new Response('{}', { status: 401 });
  }) as typeof fetch;
  hosting.configureHosting({ fetch: wrong });
  const refused = await hosting.hubCanHost('dc_holder');
  assert.equal(refused.canHost, false);
  assert.ok(refused.error);

  // Back up: the next ask goes through.
  hosting.configureHosting({ fetch: fakeHub({ dc_holder: 'holder' }).impl });
  assert.equal((await hosting.hubCanHost('dc_holder')).canHost, true);
});

test('a reply that is not one of the three reasons is not a yes', async () => {
  hosting.clearHostCache();
  hosting.configureHosting({ fetch: (async () => Response.json({ canHost: true, reason: 'because' })) as typeof fetch });
  assert.deepEqual(await hosting.hubCanHost('dc_x'), { canHost: false, reason: null });
});

test('HUB_URL=off: only operators host here', async () => {
  hosting.clearHostCache();
  process.env.HUB_URL = 'off';
  const hub = fakeHub({ dc_holder: 'holder' });
  hosting.configureHosting({ fetch: hub.impl });
  const r = await hosting.hubCanHost('dc_holder');
  assert.equal(r.canHost, false);
  assert.equal(r.error, hosting.NO_HUB);
  assert.equal(hub.calls.length, 0);
  process.env.HUB_URL = 'https://hub.test';
});

// ---- limits ---------------------------------------------------------------------

test('a player host may run one live tournament and two cash tables', () => {
  const L = hosting.PLAYER_HOST_LIMITS;
  const live = (tournaments: { hostId: string; state: string }[], cashTables: { hostId: string | null; closed: boolean }[]) => ({ tournaments, cashTables });
  assert.doesNotThrow(() => hosting.assertUnderHostLimit('tournament', 'me', live([{ hostId: 'me', state: 'finished' }, { hostId: 'me', state: 'cancelled' }, { hostId: 'you', state: 'running' }], [])));
  for (const state of ['registering', 'running', 'break', 'paused']) {
    assert.throws(() => hosting.assertUnderHostLimit('tournament', 'me', live([{ hostId: 'me', state }], [])), /1 tournament at a time/, state);
  }
  const open = Array.from({ length: L.cashTables }, () => ({ hostId: 'me', closed: false }));
  assert.throws(() => hosting.assertUnderHostLimit('cash', 'me', live([], open)), /2 cash tables at a time/);
  assert.doesNotThrow(() => hosting.assertUnderHostLimit('cash', 'me', live([], [{ hostId: 'me', closed: false }, { hostId: 'me', closed: true }, { hostId: 'you', closed: false }])));
});

const bigConfig = (): TournamentConfig => ({
  name: 'Big', startingStack: 100_000_000, levelMinutes: 60, structure: 'deep', maxPlayers: 1_000, minPlayers: 100,
  lateRegMinutes: 240, joinMinutes: 240, betCapMinutes: 240, approveRegistrations: true, buyIn: 0, breakEveryLevels: 6,
  seatsPerTable: 9, maxReentries: 10, prizeText: '1st: a Chog', rabbitHunting: false, displayMode: 'chips',
  customLevels: [{ isBreak: false, sb: 25, bb: 50, ante: 0, minutes: 0 }],
  social: { xUrl: null, igUrl: null, discordInviteUrl: null, discordGuildId: '123456', discordRoleId: '654321', discordRoleName: 'VIP', requireDiscord: true },
});

test('a player host\'s tournament is clamped and loses the operator-only parts', () => {
  const L = hosting.PLAYER_HOST_LIMITS;
  const c = hosting.clampPlayerTournament(bigConfig());
  assert.equal(c.playerHosted, true);
  assert.equal(c.maxPlayers, L.maxPlayers);
  assert.equal(c.minPlayers, L.maxPlayers, 'never more than the field');
  assert.equal(c.startingStack, L.startingStack);
  assert.equal(c.levelMinutes, L.levelMinutes);
  assert.equal(c.lateRegMinutes, L.lateRegMinutes);
  assert.equal(c.joinMinutes, L.joinMinutes);
  assert.equal(c.maxReentries, L.maxReentries);
  assert.equal(c.betCapMinutes, L.betCapMinutes);
  assert.equal(c.customLevels, null, 'no never-ending custom schedule');
  assert.equal(c.social, null, 'no Discord role gating');
  assert.equal(c.approveRegistrations, false);
  assert.equal(c.prizeText, '1st: a Chog', 'the prize line is theirs to write');
  // Small values are left alone.
  const small = hosting.clampPlayerTournament({ ...bigConfig(), maxPlayers: 12, minPlayers: 2, levelMinutes: 8, startingStack: 10_000 });
  assert.deepEqual([small.maxPlayers, small.minPlayers, small.levelMinutes, small.startingStack], [12, 2, 8, 10_000]);
});

test('a player host may schedule at most a week ahead', () => {
  const t0 = Date.now();
  assert.equal(hosting.playerScheduledStart(null, t0), null);
  assert.equal(hosting.playerScheduledStart(t0 + 3_600_000, t0), t0 + 3_600_000);
  assert.throws(() => hosting.playerScheduledStart(t0 + 8 * 24 * 3_600_000, t0), /7 days/);
});

// ---- who may do what ----------------------------------------------------------------

const operator = { id: 'dc_op', isAdmin: true };
const host = { id: 'dc_host', isAdmin: false };
const rando = { id: 'dc_rando', isAdmin: false };
const playerEvent = { hostId: 'dc_host', playerHosted: true };
const operatorEvent = { hostId: 'dc_host', playerHosted: false };

test('a player host can start, pause, resume and cancel their own event, and write its prizes', () => {
  for (const a of ['start', 'pause', 'resume', 'cancel', 'prize', 'schedule'] as const) {
    assert.equal(hosting.mayDirect(playerEvent, host, a), true, a);
  }
});

test('a player host cannot kick, approve, seat, reinstate, end early or edit the rest', () => {
  for (const a of ['kick', 'approve', 'seat', 'reinstate', 'people', 'endNow', 'settings'] as const) {
    assert.equal(hosting.mayDirect(playerEvent, host, a), false, a);
    assert.equal(hosting.mayDirect(playerEvent, operator, a), true, `${a}: operators can`);
  }
});

test('a host controls only their own events', () => {
  for (const a of ['start', 'pause', 'cancel', 'prize', 'kick'] as const) {
    assert.equal(hosting.mayDirect(playerEvent, rando, a), false, a);
    assert.equal(hosting.mayDirect({ hostId: null, playerHosted: true }, rando, a), false, a);
    assert.equal(hosting.mayDirect(playerEvent, { id: 'dc_rando', isAdmin: 1 as unknown as boolean }, a), false, 'truthy is not true');
  }
  // Operators can pause or close anything.
  assert.equal(hosting.mayDirect(playerEvent, operator, 'pause'), true);
  assert.equal(hosting.mayDirect(playerEvent, operator, 'cancel'), true);
  // An operator-made event keeps its host's full kit, as before player hosting.
  assert.equal(hosting.mayDirect(operatorEvent, host, 'kick'), true);
});

test('a player host cannot reverse turns or move chips at their own cash table', () => {
  assert.equal(mayRunTable('dc_host', host, true), false);
  assert.equal(mayRunTable('dc_host', operator, true), true);
  assert.equal(mayRunTable('dc_host', host, false), true, 'an operator-made table is unchanged');
});

// ---- results are not announced -------------------------------------------------------

test('a player-hosted tournament never posts to the Discord announce channel', () => {
  process.env.DISCORD_ANNOUNCE_CHANNEL_ID = '999888777';
  registry.emitter = {
    broadcastTable() {}, tableChat() {}, tableEvent() {}, tableReaction() {}, cashBust() {},
    broadcastTourney() {}, tourneyChat() {}, assigned() {}, tourneyFinished() {}, tourneyEliminated() {}, lobbyChanged() {},
  };
  const base = { ...bigConfig(), customLevels: null, social: null, minPlayers: 2 };
  const opT = registry.createTournament({ ...base, name: 'Operator night' }, { id: 'dc_op', name: 'Op' }, null, 'https://discord.com/api/webhooks/1/x');
  const playerT = registry.createTournament(
    hosting.clampPlayerTournament({ ...base, name: 'Holder night' }), { id: 'dc_host', name: 'Host' }, null, 'https://discord.com/api/webhooks/1/x');
  assert.deepEqual(registry.announceTarget(opT), { webhookUrl: 'https://discord.com/api/webhooks/1/x', channelId: '999888777' });
  assert.equal(registry.announceTarget(playerT), null);
  assert.equal(playerT.discordWebhookUrl, null, 'and no webhook is kept for it');
  const lobby = registry.lobbyView(0);
  assert.equal(lobby.tournaments.find(t => t.id === playerT.id)?.playerHosted, true);
  assert.equal(lobby.tournaments.find(t => t.id === opT.id)?.playerHosted, false);
  registry.deleteGame('tournament', opT.id);
  registry.deleteGame('tournament', playerT.id);
  delete process.env.DISCORD_ANNOUNCE_CHANNEL_ID;
});
