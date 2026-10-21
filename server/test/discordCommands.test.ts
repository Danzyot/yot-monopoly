// The bot's slash commands (discordCommands.ts) with fake stores, the signed
// endpoint they arrive on, and registration (discordRegister.ts): the hash that
// keeps Discord from being asked again for the same commands.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-discord-commands-'));
process.env.RATE_LIMIT_OFF = '1';

const { default: express } = await import('express');
const cmd = await import('../src/discordCommands.ts');
const reg = await import('../src/discordRegister.ts');
const { mountInteractions } = await import('../src/routes/auth.ts');
const { chogOfTheDay } = await import('../../shared/chogs/daily.ts');
const { traitsOf } = await import('../../shared/chogs/traits.ts');
type Deps = import('../src/discordCommands.ts').SlashDeps;
type Interaction = import('../src/discordCommands.ts').CommandInteraction;
type Option = import('../src/discordCommands.ts').CommandOption;
type Snapshot = import('../src/discordCommands.ts').StatsSnapshot;
type Table = import('../src/activity.ts').ActivityTable;

const ORIGIN = 'https://choggames.com';
const NOW = 1_800_000_000_000;
const ME = { id: '111111111111111111', username: 'pete', global_name: 'Pete' };
const OTHER = { id: '222222222222222222', username: 'moxie' };
const BANNED = '333333333333333333';
const NEWBIE = { id: '444444444444444444', username: 'newbie' };

const snap = (id: string, name: string): Snapshot => ({
  id, name,
  monopoly: { games: 10, wins: 4, winRate: 0.4 },
  cards: null,
  achievements: [
    { earned: true, emoji: '🏆', name: 'First win', tier: 1, earnedAt: NOW - 5000 },
    { earned: true, emoji: '👑', name: 'Tycoon', tier: 3, earnedAt: NOW - 9000 },
    { earned: false, emoji: '🔒', name: 'Locked one', tier: 3, earnedAt: null },
  ],
  games: 10,
});

const table = (t: Partial<Table> & { code: string }): Table => ({
  private: false, status: 'lobby', players: 2, maxPlayers: 6, createdAt: NOW - 60_000, startedAt: null,
  occupied: true, restricted: false, ...t,
});

let statsOn = true;
function deps(over: Partial<Deps> = {}): Deps {
  const snaps: Record<string, Snapshot> = {
    [`dc_${ME.id}`]: snap(`dc_${ME.id}`, 'Pete *the* Great'),
    [`dc_${OTHER.id}`]: snap(`dc_${OTHER.id}`, 'Moxie'),
    [`dc_${BANNED}`]: snap(`dc_${BANNED}`, 'Cheater'),
  };
  return {
    origin: () => ORIGIN,
    statsPublic: () => statsOn,
    banned: id => id === `dc_${BANNED}`,
    snapshot: id => (statsOn && id !== `dc_${BANNED}` ? snaps[id] ?? null : null),
    cardPath: s => `/api/players/${s.id}/card.png?v=${s.games}`,
    leaders: game => Array.from({ length: 14 }, (_, i) => ({
      id: i === 1 ? `dc_${BANNED}` : `p${i}`, name: `${game}-player-${i}`, games: 20 - i, wins: 10 - (i % 10), points: 100 - i,
    })),
    tables: game => (game === 'monopoly'
      ? [
        table({ code: 'OPEN1' }),
        table({ code: 'PRIV1', private: true }),
        table({ code: 'GATED', restricted: true }),
        table({ code: 'EMPTY', occupied: false }),
        table({ code: 'FULL1', players: 6 }),
        table({ code: 'PLAY1', status: 'playing', startedAt: NOW - 1000 }),
      ]
      : [table({ code: 'CARD1', maxPlayers: 4, players: 3 })]),
    now: () => NOW,
    ...over,
  };
}

const ix = (name: string, options: Option[] = [], extra: Partial<Interaction> = {}): Interaction => ({
  type: 2, application_id: 'app1', token: 'tok', guild_id: 'g1',
  member: { user: ME },
  data: { name, options },
  ...extra,
});

beforeEach(() => { statsOn = true; });

// ---- handlers ---------------------------------------------------------------------------------

test('/play: three game buttons on the public origin, live counts from public tables only', async () => {
  const r = await cmd.handleCommand(ix('play'), deps());
  assert.ok(!r.ephemeral);
  const urls = r.components![0].components.map(b => b.url);
  assert.deepEqual(urls, [`${ORIGIN}/monopoly`, `${ORIGIN}/cards`, `${ORIGIN}/poker`]);
  const fields = r.embeds![0].fields!;
  // OPEN1 is the only open public Monopoly lobby (PRIV1, GATED, EMPTY and FULL1 are not), PLAY1 is playing.
  assert.match(fields[0].value, /1 table playing · 1 lobby with seats free/);
  assert.match(fields[1].value, /0 tables playing · 1 lobby/);
});

test('/stats: defaults to the caller, public, with the card as the image and the profile link', async () => {
  const r = await cmd.handleCommand(ix('stats'), deps());
  assert.ok(!r.ephemeral);
  const e = r.embeds![0];
  assert.equal(e.url, `${ORIGIN}/u/dc_${ME.id}`);
  assert.equal(e.image!.url, `${ORIGIN}/api/players/dc_${ME.id}/card.png?v=10`);
  assert.match(e.fields![0].value, /\*\*10\*\* games · \*\*4\*\* wins · \*\*40%\*\* win rate/);
  assert.equal(e.fields![1].value, 'Not played yet');
  // Rarest first, locked badges left out.
  assert.equal(e.fields![2].value, '👑 Tycoon\n🏆 First win');
  assert.match(e.fields![2].name, /2 earned/);
  // Nothing private rides along.
  const json = JSON.stringify(r);
  assert.ok(!/0x[0-9a-f]{40}/i.test(json), 'no wallet address');
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(json), 'no IP address');
  // Never pings anyone.
  assert.deepEqual(cmd.messageBody(r).allowed_mentions, { parse: [] });
  assert.equal(cmd.messageBody(r).flags, undefined);
});

test('/stats user: another player; a newcomer gets an ephemeral "has not played yet"', async () => {
  const other = await cmd.handleCommand(ix('stats', [{ name: 'user', type: 6, value: OTHER.id }], {
    data: { name: 'stats', options: [{ name: 'user', type: 6, value: OTHER.id }], resolved: { users: { [OTHER.id]: OTHER } } },
  }), deps());
  assert.equal(other.embeds![0].title, 'Moxie');

  const newbie = await cmd.handleCommand(ix('stats', [{ name: 'user', type: 6, value: NEWBIE.id }]), deps());
  assert.ok(newbie.ephemeral);
  assert.match(newbie.content!, /has not finished a game/);
  assert.equal(cmd.messageBody(newbie).flags, 64);

  const me = await cmd.handleCommand(ix('stats'), deps({ snapshot: () => null }));
  assert.ok(me.ephemeral);
  assert.match(me.content!, /You have not finished a game/);
});

test('/stats: a banned player gets nothing, and neither does a banned caller', async () => {
  const r = await cmd.handleCommand(ix('stats', [{ name: 'user', type: 6, value: BANNED }]), deps());
  assert.ok(r.ephemeral);
  assert.ok(!r.embeds);
  assert.ok(!/ban/i.test(r.content!), 'does not say why');

  for (const name of ['stats', 'play', 'chog', 'tables']) {
    const b = await cmd.handleCommand(ix(name, [], { member: { user: { id: BANNED, username: 'x' } } }), deps());
    assert.ok(b.ephemeral, name);
    assert.ok(!b.embeds, name);
  }
});

test('/stats and /leaderboard follow the leaderboard switch', async () => {
  statsOn = false;
  for (const name of ['stats', 'leaderboard']) {
    const r = await cmd.handleCommand(ix(name), deps());
    assert.ok(r.ephemeral, name);
    assert.match(r.content!, /switched off/);
  }
});

test('/leaderboard: top 10, banned players left out, the game picked', async () => {
  const r = await cmd.handleCommand(ix('leaderboard', [{ name: 'game', type: 3, value: 'cards' }]), deps());
  assert.ok(!r.ephemeral);
  const lines = r.embeds![0].description!.split('\n');
  assert.equal(lines.length, 10);
  assert.match(r.embeds![0].title!, /Cards/);
  assert.match(lines[0], /^🥇 \[cards-player-0\]\(https:\/\/choggames\.com\/u\/p0\)/);
  assert.ok(!r.embeds![0].description!.includes(BANNED));
  // Second place is the next unbanned player.
  assert.match(lines[1], /cards-player-2/);

  const mono = await cmd.handleCommand(ix('leaderboard'), deps());
  assert.match(mono.embeds![0].title!, /Monopoly/);
});

test('/tables: public open tables with join links; none says so', async () => {
  const r = await cmd.handleCommand(ix('tables'), deps());
  const json = JSON.stringify(r);
  assert.ok(json.includes(`${ORIGIN}/r/OPEN1`));
  assert.ok(json.includes(`${ORIGIN}/cards/r/CARD1`));
  for (const hidden of ['PRIV1', 'GATED', 'EMPTY', 'FULL1']) assert.ok(!json.includes(hidden), hidden);
  assert.deepEqual(r.components![0].components.map(b => b.label), ['Join OPEN1', 'Join CARD1']);

  const none = await cmd.handleCommand(ix('tables'), deps({ tables: () => [] }));
  assert.match(none.embeds![0].description!, /No public table/);
  assert.ok(!none.ephemeral);
});

test('/chog: a token by id, the Chog of the Day without one, and a bad id', async () => {
  const r = await cmd.handleCommand(ix('chog', [{ name: 'id', type: 4, value: 42 }]), deps());
  const e = r.embeds![0];
  assert.equal(e.title, 'Chog #42');
  assert.equal(e.image!.url, `${ORIGIN}/chogs/42.webp`);
  assert.match(e.url!, /^https:\/\/opensea\.io\/item\/monad\/0x[0-9a-f]+\/42$/);
  const t = traitsOf(42)!;
  assert.ok(e.fields!.some(f => f.name === 'Tier' && f.value === t.Tier));

  const day = await cmd.handleCommand(ix('chog'), deps());
  assert.match(day.embeds![0].title!, new RegExp(`Chog of the Day: Chog #${chogOfTheDay(NOW)}$`));

  const bad = await cmd.handleCommand(ix('chog', [{ name: 'id', type: 4, value: 99999 }]), deps());
  assert.ok(bad.ephemeral);
});

test('/daily: refused cleanly without the feature, shown with it', async () => {
  const none = await cmd.handleCommand(ix('daily'), deps());
  assert.ok(none.ephemeral);
  const r = await cmd.handleCommand(ix('daily'), deps({ daily: async () => ({ title: 'Daily Challenge', description: 'Win in 5 rounds', path: '/cards/daily' }) }));
  assert.ok(!r.ephemeral);
  assert.equal(r.components![0].components[0].url, `${ORIGIN}/cards/daily`);
});

test('an unknown command is answered, ephemerally', async () => {
  const r = await cmd.handleCommand(ix('nope'), deps());
  assert.ok(r.ephemeral);
  assert.match(r.content!, /don't know that command/);
});

test('a command that throws is an ephemeral apology, not a crash', async () => {
  const r = await cmd.handleCommand(ix('leaderboard'), deps({ leaders: () => { throw new Error('boom'); } }));
  assert.ok(r.ephemeral);
});

test('names cannot inject markdown, links or mentions', () => {
  assert.equal(cmd.safeName('[x](https://evil) @everyone *b*'), '\\[x\\]\\(https://evil\\) \\@everyone \\*b\\*');
  assert.equal(cmd.plainName('a‮b\n c'), 'ab c');
  assert.equal(cmd.plainName('x'.repeat(40), 10).length, 10);
});

test('rate limit: a few commands per user, then an ephemeral "slow down"', async () => {
  const limiter = cmd.createUserLimiter(3, 10_000);
  let now = NOW;
  const d = deps({ now: () => now });
  for (let i = 0; i < 3; i++) assert.ok(!(await cmd.handleCommand(ix('play'), d, { limiter })).ephemeral);
  const slow = await cmd.handleCommand(ix('play'), d, { limiter });
  assert.ok(slow.ephemeral);
  assert.match(slow.content!, /Slow down/);
  // Someone else is not held up, and the window passes.
  assert.ok(!(await cmd.handleCommand(ix('play', [], { member: { user: OTHER } }), d, { limiter })).ephemeral);
  now += 10_001;
  assert.ok(!(await cmd.handleCommand(ix('play'), d, { limiter })).ephemeral);
});

test('slow commands are deferred, then the reply edits the original message', async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: init.body as string | undefined });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  let release!: () => void;
  const slow = new Promise<void>(r => { release = r; });
  const d = deps({ daily: async () => { await slow; return { title: 'Today', description: 'Go', path: '/cards' }; } });

  const first = await cmd.answerCommand(ix('daily'), d, { deferAfterMs: 20, fetchImpl });
  assert.deepEqual(first, { type: 5 });
  release();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, 'https://discord.com/api/v10/webhooks/app1/tok/messages/@original');
  assert.match(calls[0].body!, /Today/);

  // A fast one goes straight back.
  const fast = await cmd.answerCommand(ix('play'), deps(), { deferAfterMs: 1000, fetchImpl });
  assert.equal(fast.type, 4);
});

test('a deferred error replaces the public "thinking" message with an ephemeral follow-up', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url.replace('https://discord.com/api/v10', '')} ${init.body ?? ''}`);
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await cmd.finishDeferred(ix('x'), cmd.oops('nope'), fetchImpl);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^DELETE \/webhooks\/app1\/tok\/messages\/@original/);
  assert.match(calls[1], /^POST \/webhooks\/app1\/tok .*"flags":64/);
});

// ---- the signed endpoint ----------------------------------------------------------------------

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('hex');
let server: Server;
let base = '';

before(async () => {
  process.env.DISCORD_PUBLIC_KEY = PUBLIC_HEX;
  cmd.configureSlashCommands(deps());
  const app = express();
  mountInteractions(app);
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); });

function signed(body: unknown, opts: { badSig?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.from(ts + raw), privateKey).toString('hex');
  return fetch(`${base}/api/discord/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': opts.badSig ? sig.replace(/^./, c => (c === 'a' ? 'b' : 'a')) : sig,
      'x-signature-timestamp': ts,
    },
    body: raw,
  });
}

test('endpoint: a bad or missing signature is a 401 and runs nothing', async () => {
  const bad = await signed(ix('play'), { badSig: true });
  assert.equal(bad.status, 401);
  const none = await fetch(`${base}/api/discord/interactions`, { method: 'POST', body: JSON.stringify(ix('play')) });
  assert.equal(none.status, 401);
  // Signed over different bytes than were sent.
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.from(ts + JSON.stringify(ix('tables'))), privateKey).toString('hex');
  const swapped = await fetch(`${base}/api/discord/interactions`, {
    method: 'POST', headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts }, body: JSON.stringify(ix('play')),
  });
  assert.equal(swapped.status, 401);
});

test('endpoint: a signed command is answered; an unknown one ephemerally; the ping still pongs', async () => {
  const ok = await signed(ix('play'));
  assert.equal(ok.status, 200);
  const body = await ok.json() as { type: number; data: { embeds: unknown[]; flags?: number } };
  assert.equal(body.type, 4);
  assert.equal(body.data.embeds.length, 1);
  assert.equal(body.data.flags, undefined);

  const unknown = await (await signed(ix('frobnicate'))).json() as { type: number; data: { flags: number; content: string } };
  assert.equal(unknown.type, 4);
  assert.equal(unknown.data.flags, 64);

  const ping = await (await signed({ type: 1 })).json() as { type: number };
  assert.equal(ping.type, 1);
});

// ---- registration -----------------------------------------------------------------------------

const ENV = { appId: 'app1', botToken: 'bot-token', guildId: 'guild1', publicKey: PUBLIC_HEX };

test('hash: stable for the same commands whatever the key order, different when anything changes', () => {
  const defs = cmd.commandDefinitions({ statsPublic: true, daily: false });
  const scope = { appId: 'a', guildId: 'g' };
  const h = cmd.commandsHash(defs, scope);
  assert.equal(h, cmd.commandsHash(cmd.commandDefinitions({ statsPublic: true, daily: false }), scope));
  const shuffled = defs.map(d => Object.fromEntries(Object.entries(d).reverse())) as typeof defs;
  assert.equal(cmd.commandsHash(shuffled, { guildId: 'g', appId: 'a' }), h);
  assert.notEqual(cmd.commandsHash(cmd.commandDefinitions({ statsPublic: false, daily: false }), scope), h);
  assert.notEqual(cmd.commandsHash(cmd.commandDefinitions({ statsPublic: true, daily: true }), scope), h);
  assert.notEqual(cmd.commandsHash(defs, { appId: 'a', guildId: 'other' }), h);
});

test('definitions: the leaderboard switch decides /stats and /leaderboard, the feature decides /daily', () => {
  const names = (f: { statsPublic: boolean; daily: boolean }) => cmd.commandDefinitions(f).map(d => d.name);
  assert.deepEqual(names({ statsPublic: true, daily: false }), ['play', 'stats', 'leaderboard', 'tables', 'chog']);
  assert.deepEqual(names({ statsPublic: false, daily: true }), ['play', 'tables', 'daily', 'chog']);
  for (const d of cmd.commandDefinitions({ statsPublic: true, daily: true })) {
    assert.match(d.name, /^[a-z]{1,32}$/);
    assert.ok(d.description.length >= 1 && d.description.length <= 100, d.name);
  }
});

function fakeDiscord(statuses: number[]) {
  const calls: { url: string; method: string; auth: string; body: unknown[] }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
    const status = statuses.shift() ?? 200;
    return new Response(status === 429 ? '{"retry_after":0.01}' : '[]', { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function memoryStore() {
  let s: Parameters<NonNullable<import('../src/discordRegister.ts').SyncOptions['store']>['write']>[0] | null = null;
  return { read: () => s, write: (v: NonNullable<typeof s>) => { s = v; } };
}

test('sync: a bulk overwrite of the guild commands, then skipped while unchanged', async () => {
  reg.resetCommandSync();
  const store = memoryStore();
  const d = fakeDiscord([]);
  const defs = cmd.commandDefinitions({ statsPublic: true, daily: false });
  const opts = { env: ENV, store, fetchImpl: d.fetchImpl, defs, sleep: async () => {} };

  const first = await reg.syncCommands(opts);
  assert.equal(first.state, 'registered');
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].method, 'PUT');
  assert.equal(d.calls[0].url, 'https://discord.com/api/v10/applications/app1/guilds/guild1/commands');
  assert.equal(d.calls[0].auth, 'Bot bot-token');
  assert.equal(d.calls[0].body.length, defs.length);

  const again = await reg.syncCommands(opts);
  assert.equal(again.state, 'unchanged');
  assert.equal(d.calls.length, 1, 'not sent again');

  const forced = await reg.syncCommands({ ...opts, force: true });
  assert.equal(forced.state, 'registered');
  assert.equal(d.calls.length, 2);

  // The switch flips: a new list, so it goes out.
  const fewer = await reg.syncCommands({ ...opts, defs: cmd.commandDefinitions({ statsPublic: false, daily: false }) });
  assert.equal(fewer.state, 'registered');
  assert.equal(d.calls.length, 3);
  assert.deepEqual(fewer.commands, ['/play', '/tables', '/chog']);
});

test('sync: failures are reported, not thrown, and not remembered as done', async () => {
  reg.resetCommandSync();
  const store = memoryStore();
  const defs = cmd.commandDefinitions({ statsPublic: true, daily: false });

  const denied = fakeDiscord([403]);
  const s = await reg.syncCommands({ env: ENV, store, fetchImpl: denied.fetchImpl, defs });
  assert.equal(s.state, 'failed');
  assert.match(s.message, /applications\.commands/);
  assert.equal(store.read(), null);

  // A 429 is waited out once.
  const limited = fakeDiscord([429, 200]);
  const s2 = await reg.syncCommands({ env: ENV, store, fetchImpl: limited.fetchImpl, defs, sleep: async () => {} });
  assert.equal(s2.state, 'registered');
  assert.equal(limited.calls.length, 2);

  const offline = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
  const s3 = await reg.syncCommands({ env: ENV, store: memoryStore(), fetchImpl: offline, defs });
  assert.equal(s3.state, 'failed');
  assert.match(s3.message, /ECONNRESET/);

  const unset = await reg.syncCommands({ env: { appId: 'a' }, store, defs });
  assert.equal(unset.state, 'not-configured');
  assert.match(unset.message, /DISCORD_BOT_TOKEN, DISCORD_GUILD_ID/);
});
