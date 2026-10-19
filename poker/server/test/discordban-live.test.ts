// The Discord ban, end to end, against a stand-in Discord on loopback.
//
// Discord cannot be reached from the test machine, so the stand-in speaks its
// dialect: the same paths, the same error bodies ({ code, message }) and the
// same shapes for guilds, roles and members. The two failures reported from
// the live site are what these pin: a reason with an em dash or an emoji
// never left the machine, and every refusal was reported as "needs Ban
// Members" whatever Discord had actually said.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const GUILD = '900000000000000001';
const BOT = '900000000000000002';
const OWNER = '900000000000000003';
const LOW = '900000000000000004';   // plain member
const HIGH = '900000000000000005';  // holds a role above the bot's
const GONE = '900000000000000006';  // not in the server
const OTHER_BOT = '900000000000000007'; // a different app's bot, also in the server

type Reply = { status: number; body?: unknown };
let banReply: Reply = { status: 204 };
let mfa = 0;
let botTimedOutUntil: string | null = null;
const VERIFY = '900000000000000100';
const CAT = '900000000000000101';
let verifyOverwrites: { id: string; type: 0 | 1; allow: string; deny: string }[] = [];
// The bot's own application, as GET /applications/@me reports it.
let appEndpoint: string | null = null;
let appKey = 'a'.repeat(64);
let selfDelayMs = 0;
let lastBan: { path: string; auth: string | undefined; reason: string | undefined; body: string } | null = null;

const roles = [
  // @everyone can view, post and embed, as in any real server; Ban Members
  // comes only from the bot's own role.
  { id: GUILD, name: '@everyone', permissions: String((1n << 10n) | (1n << 11n) | (1n << 14n)), position: 0 },
  { id: 'r-mod', name: 'Poker Bot', permissions: String(1n << 2n), position: 5 },
  { id: 'r-vip', name: 'VIP', permissions: '0', position: 9 },
  { id: 'r-verified', name: 'Verified', permissions: '0', position: 2 },
  { id: 'r-giveaway', name: 'Giveaways', permissions: '0', position: 12 },
];
const members: Record<string, string[]> = {
  [BOT]: ['r-mod'], [OWNER]: [], [LOW]: ['r-verified'], [HIGH]: ['r-vip'], [OTHER_BOT]: ['r-giveaway'],
};

function send(res: ServerResponse, r: Reply) {
  res.statusCode = r.status;
  if (r.body !== undefined) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(r.body)); }
  else res.end();
}

const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/self/api/discord/interactions' && req.method === 'GET') {
    setTimeout(() => send(res, { status: 200, body: { instance: 'THIS-SERVER' } }), selfDelayMs);
    return;
  }
  if (req.url === '/elsewhere/api/discord/interactions' && req.method === 'GET') {
    return send(res, { status: 200, body: { instance: 'SOME-OTHER-SERVER' } });
  }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const url = req.url ?? '';
    const auth = req.headers.authorization;
    if (auth !== 'Bot test-token' && auth !== 'Bot other-token') return send(res, { status: 401, body: { message: '401: Unauthorized', code: 0 } });
    // Which bot the token belongs to decides everything below it.
    const self = auth === 'Bot other-token' ? { id: OTHER_BOT, username: 'WAWA Giveaways' } : { id: BOT, username: 'PokerBot' };
    if (url === '/users/@me') return send(res, { status: 200, body: self });
    if (url === '/applications/@me') {
      return send(res, { status: 200, body: { id: '900000000000000999', name: 'Chekr Poker', verify_key: appKey, interactions_endpoint_url: appEndpoint } });
    }
    if (url === `/guilds/${GUILD}`) return send(res, { status: 200, body: { id: GUILD, name: 'WAWA', owner_id: OWNER, roles, mfa_level: mfa } });
    if (url === `/guilds/${GUILD}/channels`) {
      return send(res, { status: 200, body: [
        { id: CAT, name: 'Poker', type: 4, permission_overwrites: [] },
        { id: VERIFY, name: 'poker-verify', type: 0, parent_id: CAT, permission_overwrites: verifyOverwrites },
      ] });
    }
    const m = url.match(new RegExp(`^/guilds/${GUILD}/members/(\\d+)$`));
    if (m) {
      const r = members[m[1]];
      const extra = m[1] === BOT && botTimedOutUntil ? { communication_disabled_until: botTimedOutUntil } : {};
      return r ? send(res, { status: 200, body: { roles: r, ...extra } }) : send(res, { status: 404, body: { message: 'Unknown Member', code: 10007 } });
    }
    if (url.startsWith(`/guilds/${GUILD}/bans/`) && req.method === 'PUT') {
      lastBan = {
        path: url, auth: req.headers.authorization,
        reason: req.headers['x-audit-log-reason'] as string | undefined, body,
      };
      return send(res, banReply);
    }
    if (url.startsWith('/guilds/')) return send(res, { status: 404, body: { message: 'Unknown Guild', code: 10004 } });
    send(res, { status: 404, body: { message: 'Not Found', code: 0 } });
  });
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
const port = (srv.address() as { port: number }).port;

process.env.DISCORD_API_BASE = `http://127.0.0.1:${port}`;
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.DISCORD_GUILD_ID = GUILD;
const {
  auditReasonHeader, banAbility, banFromGuild, channelAccess, checkBanSetup, checkInteractions, checkVerifyChannel, discordErrorText,
  discordPublicKeys,
  explainBanRefusal,
} = await import('../src/discord.ts');

test.after(() => srv.close());

test('a reason with an em dash or an emoji now reaches Discord, encoded', async () => {
  banReply = { status: 204 };
  // Both of these threw "Cannot convert argument to a ByteString" inside
  // fetch, before any request was made.
  // Read through a function: the request handler assigns lastBan, which the
  // checker cannot see from here and would otherwise narrow to null.
  const seen = () => lastBan as NonNullable<typeof lastBan> | null;
  for (const reason of ['multi-accounting — 3 alts', 'alt of Nimbu 🎲']) {
    lastBan = null;
    await banFromGuild(LOW, reason);
    const got = seen();
    assert.ok(got, `the request for "${reason}" was actually sent`);
    assert.equal(decodeURIComponent(got.reason!), `Poker ban: ${reason}`, 'Discord decodes it back to exactly what was typed');
    assert.match(got.reason!, /^[\x20-\x7e]+$/, 'and on the wire it is plain ASCII');
    assert.equal(got.path, `/guilds/${GUILD}/bans/${LOW}`);
    assert.equal(got.auth, 'Bot test-token');
    assert.deepEqual(JSON.parse(got.body), { delete_message_seconds: 0 }, 'bans, deletes nothing');
  }
});

test('the audit reason fits Discord\'s 512 and is never cut mid-escape', () => {
  for (const long of ['🎲'.repeat(400), 'é'.repeat(400), 'x'.repeat(900), 'a🎲'.repeat(300)]) {
    const h = auditReasonHeader(long);
    assert.ok(h.length <= 512, `${h.length} > 512`);
    assert.doesNotThrow(() => decodeURIComponent(h), 'a cut through %F0%9F… would not decode');
    assert.ok(long.startsWith(decodeURIComponent(h)), 'what survives is a prefix of what was typed');
  }
  // Newlines would let a reason inject a second header line.
  assert.ok(!decodeURIComponent(auditReasonHeader('a\r\nX-Evil: 1')).includes('\n'));
});

test('a refusal carries Discord\'s own code and words, and the right fix', async () => {
  banReply = { status: 403, body: { message: 'Missing Permissions', code: 50013 } };
  await assert.rejects(banFromGuild(HIGH, 'Alt accounts'), (e: Error) => {
    assert.match(e.message, /403\/50013/);
    assert.match(e.message, /Missing Permissions/);
    assert.match(e.message, /highest role/, 'names the role order, not just the permission');
    return true;
  });
  banReply = { status: 403, body: { message: 'Two factor is required for this operation', code: 60003 } };
  await assert.rejects(banFromGuild(LOW, 'Alt accounts'), /60003[\s\S]*two-factor/);
  banReply = { status: 403, body: { message: 'Missing Access', code: 50001 } };
  await assert.rejects(banFromGuild(LOW, 'Alt accounts'), /50001[\s\S]*DISCORD_GUILD_ID/);
});

test('an error with no JSON body still says what it can', () => {
  assert.match(discordErrorText(502, null, 'ban'), /Discord refused to ban them \(Discord 502\)/);
  assert.match(discordErrorText(401, null, 'ban'), /token was rejected/);
});

test('role order decides, and the owner cannot be banned', () => {
  const base = { guildId: GUILD, ownerId: OWNER, roles, bot: { id: BOT, roleIds: ['r-mod'] } };
  assert.equal(banAbility({ ...base, target: { id: LOW, roleIds: ['r-verified'] } }).canBanTarget, true);
  const high = banAbility({ ...base, target: { id: HIGH, roleIds: ['r-vip'] } });
  assert.equal(high.canBanTarget, false);
  assert.match(high.reason!, /"VIP" is above the bot's highest role "Poker Bot"/);
  assert.match(banAbility({ ...base, target: { id: OWNER, roleIds: [] } }).reason!, /own the server/);
  assert.equal(banAbility({ ...base, target: { id: GONE, roleIds: null } }).canBanTarget, true, 'a non-member is banned by id');
  const level = banAbility({ ...base, target: { id: 'x', roleIds: ['r-mod'] } });
  assert.equal(level.canBanTarget, false, 'level with the bot is not below it');
  const noPerm = banAbility({ ...base, bot: { id: BOT, roleIds: [] }, target: { id: LOW, roleIds: [] } });
  assert.equal(noPerm.hasBanMembers, false);
  const admin = banAbility({ ...base, roles: [...roles, { id: 'r-admin', name: 'Admin', permissions: String(1n << 3n), position: 20 }],
    bot: { id: BOT, roleIds: ['r-admin'] }, target: { id: HIGH, roleIds: ['r-vip'] } });
  assert.equal(admin.canBanTarget, true, 'Administrator implies Ban Members');
});

test('the setup check names the exact blocker, live', async () => {
  mfa = 0;
  const ok = await checkBanSetup(LOW);
  assert.ok(ok.every(l => l.ok), JSON.stringify(ok));

  const high = await checkBanSetup(HIGH);
  const bad = high.find(l => !l.ok);
  assert.ok(bad, 'the VIP member is flagged');
  assert.match(bad!.detail, /"VIP".*above.*"Poker Bot"/);

  const owner = await checkBanSetup(OWNER);
  assert.match(owner.find(l => !l.ok)!.detail, /own the server/);

  const gone = await checkBanSetup(GONE);
  assert.ok(gone.every(l => l.ok), 'not in the server is not a problem');

  mfa = 1;
  const twofa = await checkBanSetup(null);
  assert.match(twofa.find(l => !l.ok)!.detail, /2FA/);
  mfa = 0;
});

test('a wrong server id or token is reported as that, not as permissions', async () => {
  process.env.DISCORD_GUILD_ID = '111111111111111111';
  const g = await checkBanSetup(null);
  assert.match(g.find(l => !l.ok)!.detail, /10004/);
  process.env.DISCORD_GUILD_ID = GUILD;

  process.env.DISCORD_BOT_TOKEN = 'wrong';
  const t = await checkBanSetup(null);
  assert.match(t.find(l => !l.ok)!.detail, /token was rejected/);
  process.env.DISCORD_BOT_TOKEN = 'test-token';
});

test('a token for a DIFFERENT bot is named, with its roles, not blamed on role order', async () => {
  // The operator gave Ban Members to PokerBot and dragged its role up. The
  // token in the deployment is WAWA Giveaways' — a different application,
  // in the same server, holding a role with no permissions. Every settings
  // page they check looks right; Discord says "Missing Permissions".
  process.env.DISCORD_BOT_TOKEN = 'other-token';
  try {
    const lines = await checkBanSetup(LOW);
    const who = lines.find(l => l.label === 'Bot this site uses')!;
    assert.match(who.detail, /WAWA Giveaways/, 'the bot the token actually signs in as is named');
    const bad = lines.find(l => !l.ok)!;
    assert.equal(bad.label, 'Ban Members permission');
    assert.match(bad.detail, /WAWA Giveaways holds Giveaways \(#12\)/);
    assert.match(bad.detail, /not on THIS bot in THIS server/);
    const why = await explainBanRefusal(LOW);
    assert.match(why!, /^Ban Members permission — WAWA Giveaways/, 'the toast leads with the actual cause');
  } finally {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
  }
});

test('a timed-out bot is caught — Discord calls that "Missing Permissions" too', async () => {
  botTimedOutUntil = new Date(Date.now() + 3_600_000).toISOString();
  try {
    const bad = (await checkBanSetup(LOW)).find(l => !l.ok)!;
    assert.equal(bad.label, 'Bot is not timed out');
    assert.match(bad.detail, /timed out until/);
  } finally {
    botTimedOutUntil = null;
  }
  const past = new Date(Date.now() - 60_000).toISOString();
  botTimedOutUntil = past;
  try {
    assert.ok((await checkBanSetup(LOW)).every(l => l.ok), 'an expired timeout is no timeout');
  } finally {
    botTimedOutUntil = null;
  }
});

test('the refusal names both role lists in order, so the operator can see the one above', async () => {
  const why = await explainBanRefusal(HIGH);
  assert.match(why!, /Can ban this player/);
  assert.match(why!, /"VIP" is above the bot's highest role "Poker Bot"/);
  assert.match(why!, /Bot PokerBot: Poker Bot \(#5\)\. Player: VIP \(#9\)\./);
});

test('when every check passes the explanation says so rather than inventing a cause', async () => {
  const why = await explainBanRefusal(LOW);
  assert.match(why!, /every check passes for PokerBot/);
});

// ---- the verify channel: "Missing Access" when posting the panel ----

const VIEW = String(1n << 10n);
const SENDP = String(1n << 11n);
const EMBED = String(1n << 14n);
const baseRoles = [
  { id: GUILD, name: '@everyone', permissions: String((1n << 10n) | (1n << 11n) | (1n << 14n)), position: 0 },
  { id: 'r-mod', name: 'Poker Bot', permissions: '0', position: 5 },
  { id: 'r-member', name: 'Members', permissions: '0', position: 1 },
];
const acc = (roleIds: string[], overwrites: { id: string; type: 0 | 1; allow: string; deny: string }[], memberId = BOT) =>
  channelAccess({ guildId: GUILD, ownerId: OWNER, roles: baseRoles, member: { id: memberId, roleIds }, overwrites });

test('a private channel hides itself from the bot unless the bot is let in', () => {
  // The usual staff-only setup: @everyone denied View Channel.
  const hidden = acc(['r-mod'], [{ id: GUILD, type: 0, allow: '0', deny: VIEW }]);
  assert.equal(hidden.view, false);
  assert.match(hidden.blocker.view!, /denies View Channel to @everyone and allows it to none of the bot's roles/);
  // Let the bot's role in, and it can see it again.
  const letIn = acc(['r-mod'], [{ id: GUILD, type: 0, allow: '0', deny: VIEW }, { id: 'r-mod', type: 0, allow: VIEW, deny: '0' }]);
  assert.equal(letIn.view, true);
  // Or the bot itself.
  assert.equal(acc(['r-mod'], [{ id: GUILD, type: 0, allow: '0', deny: VIEW }, { id: BOT, type: 1, allow: VIEW, deny: '0' }]).view, true);
});

test('a role the bot holds being denied is named', () => {
  const r = acc(['r-mod', 'r-member'], [{ id: 'r-member', type: 0, allow: '0', deny: VIEW }]);
  assert.equal(r.view, false);
  assert.match(r.blocker.view!, /denies View Channel to "Members", which the bot has/);
  // An allow on another of its roles wins over a deny on one: Discord unions them.
  const both = acc(['r-mod', 'r-member'], [{ id: 'r-member', type: 0, allow: '0', deny: VIEW }, { id: 'r-mod', type: 0, allow: VIEW, deny: '0' }]);
  assert.equal(both.view, true);
});

test('a setting on the bot itself beats its roles', () => {
  const r = acc(['r-mod'], [{ id: 'r-mod', type: 0, allow: VIEW, deny: '0' }, { id: BOT, type: 1, allow: '0', deny: VIEW }]);
  assert.equal(r.view, false);
  assert.match(r.blocker.view!, /setting for the bot itself/);
});

test('can see but not post, or post but not embed, is told apart', () => {
  const r = acc(['r-mod'], [{ id: GUILD, type: 0, allow: '0', deny: String((1n << 11n) | (1n << 14n)) }]);
  assert.equal(r.view, true);
  assert.equal(r.send, false);
  assert.match(r.blocker.send!, /Send Messages/);
  assert.match(r.blocker.embed!, /Embed Links/);
});

test('Administrator and the owner see everything', () => {
  const adminRoles = [...baseRoles, { id: 'r-admin', name: 'Admin', permissions: String(1n << 3n), position: 9 }];
  const r = channelAccess({ guildId: GUILD, ownerId: OWNER, roles: adminRoles, member: { id: BOT, roleIds: ['r-admin'] },
    overwrites: [{ id: GUILD, type: 0, allow: '0', deny: VIEW }] });
  assert.ok(r.view && r.send && r.embed);
});

test('the live check names the bot, the channel and the setting in the way', async () => {
  verifyOverwrites = [{ id: GUILD, type: 0, allow: '0', deny: VIEW }];
  try {
    const lines = await checkVerifyChannel(VERIFY);
    assert.match(lines.find(l => l.label === 'Bot this site uses')!.detail, /PokerBot/);
    const bad = lines.find(l => !l.ok)!;
    assert.match(bad.label, /PokerBot can see #poker-verify \(in the "Poker" category/);
    assert.match(bad.detail, /@everyone/);
  } finally {
    verifyOverwrites = [];
  }
});

test('the wrong bot is what the check shows, when it is the wrong bot', async () => {
  process.env.DISCORD_BOT_TOKEN = 'other-token';
  verifyOverwrites = [
    { id: GUILD, type: 0, allow: '0', deny: VIEW },
    { id: 'r-mod', type: 0, allow: VIEW, deny: '0' }, // PokerBot's role is let in; the giveaway bot's is not
  ];
  try {
    const lines = await checkVerifyChannel(VERIFY);
    assert.match(lines.find(l => l.label === 'Bot this site uses')!.detail, /WAWA Giveaways/);
    assert.match(lines.find(l => !l.ok)!.label, /^WAWA Giveaways can see/);
  } finally {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    verifyOverwrites = [];
  }
});

test('a channel id from somewhere else is called that, not a permission problem', async () => {
  const bad = (await checkVerifyChannel('123456789012345678')).find(l => !l.ok)!;
  assert.equal(bad.label, 'Verify channel');
  assert.match(bad.detail, /is not in "WAWA"/);
});

test('an open channel passes every line', async () => {
  verifyOverwrites = [];
  const lines = await checkVerifyChannel(VERIFY);
  assert.ok(lines.every(l => l.ok), JSON.stringify(lines));
});

// ---- the Verify button: "didn't respond in time" ----

const line = async (label: string) => (await checkInteractions(['self.example'], 'THIS-SERVER')).find(l => l.label === label)!;

test('no Interactions Endpoint URL is named as the cause of the timeout', async () => {
  process.env.DISCORD_PUBLIC_KEY = 'a'.repeat(64);
  appEndpoint = null;
  const l = await line('Verify button goes to');
  assert.equal(l.ok, false);
  assert.match(l.detail, /"Chekr Poker" has no Interactions Endpoint URL/);
  assert.match(l.detail, /didn't respond in time/);
});

test('an endpoint that reaches this very server passes, however it is spelled', async () => {
  // Called and identified by instance id, not by hostname: Railway only tells
  // an app about one of its domains.
  appEndpoint = `http://127.0.0.1:${port}/self/api/discord/interactions`;
  const l = await line('Verify button goes to');
  assert.equal(l.ok, true, l.detail);
  assert.match(l.detail, /this site \(answered in \d+ms\)/);
});

test('an endpoint that is another server is called that', async () => {
  appEndpoint = `http://127.0.0.1:${port}/elsewhere/api/discord/interactions`;
  const l = await line('Verify button goes to');
  assert.equal(l.ok, false);
  assert.match(l.detail, /not this site/);
});

test('an endpoint that does not answer is called that', async () => {
  appEndpoint = 'http://127.0.0.1:1/api/discord/interactions';
  const l = await line('Verify button goes to');
  assert.equal(l.ok, false);
  assert.match(l.detail, /did not answer/);
});

test('this site answering slower than Discord waits is a failure', async () => {
  appEndpoint = `http://127.0.0.1:${port}/self/api/discord/interactions`;
  selfDelayMs = 2700;
  try {
    const l = await line('Verify button goes to');
    assert.equal(l.ok, false);
    assert.match(l.detail, /Discord gives up at 3000ms/);
  } finally { selfDelayMs = 0; }
});

test('a public key from another application is caught, with the right one', async () => {
  appEndpoint = `http://127.0.0.1:${port}/self/api/discord/interactions`;
  process.env.DISCORD_PUBLIC_KEY = 'b'.repeat(64);
  const l = await line('Public key');
  assert.equal(l.ok, false);
  // "Add", not "set": with two applications sending here, replacing the key
  // would fix one and break the other.
  assert.match(l.detail, new RegExp(`"Chekr Poker"'s key is not among DISCORD_PUBLIC_KEY[\\s\\S]*Add it: ${'a'.repeat(64)}`));
  process.env.DISCORD_PUBLIC_KEY = 'a'.repeat(64);
  assert.equal((await line('Public key')).ok, true);
});

// ---- two applications, two keys ----

test('several public keys are read, in either variable, any separator, deduplicated', () => {
  const a = 'A'.repeat(64); const b = 'b'.repeat(64);
  process.env.DISCORD_PUBLIC_KEY = ` ${a}, ${b}\n${a} `;
  process.env.DISCORD_PUBLIC_KEYS = 'c'.repeat(64);
  try {
    assert.deepEqual(discordPublicKeys(), ['a'.repeat(64), b, 'c'.repeat(64)]);
  } finally {
    process.env.DISCORD_PUBLIC_KEY = 'a'.repeat(64);
    delete process.env.DISCORD_PUBLIC_KEYS;
  }
});

test('with forwarding on and one key, the main site\'s application is flagged', async () => {
  appEndpoint = `http://127.0.0.1:${port}/self/api/discord/interactions`;
  process.env.DISCORD_FORWARD_INTERACTIONS_URL = 'https://main.example/api/discord/interactions';
  try {
    process.env.DISCORD_PUBLIC_KEY = 'a'.repeat(64);
    const one = await line("Main site's interactions");
    assert.equal(one.ok, false);
    assert.match(one.detail, /Add its Public Key to DISCORD_PUBLIC_KEY, comma separated/);
    process.env.DISCORD_PUBLIC_KEY = `${'a'.repeat(64)},${'d'.repeat(64)}`;
    const two = await line("Main site's interactions");
    assert.equal(two.ok, true);
    assert.equal((await line('Public key')).ok, true, 'the bot\'s own key is still found among several');
  } finally {
    delete process.env.DISCORD_FORWARD_INTERACTIONS_URL;
    process.env.DISCORD_PUBLIC_KEY = 'a'.repeat(64);
  }
});
