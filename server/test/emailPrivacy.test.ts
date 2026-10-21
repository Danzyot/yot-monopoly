// A player's email address never leaves the server through a public door. The
// real server is started on a data volume where one player has an address on
// file, has finished games, badges and a Daily attempt, and then every public
// answer about them is read (profile, players, achievements, the share card,
// the activity feed, leaderboards, tournaments, the bot's /stats) as a stranger,
// as another player and as themselves: the address appears in none of them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = mkdtempSync(join(tmpdir(), 'yot-email-privacy-'));
const SECRET = 'privacy-test-secret';
process.env.APP_SECRET = SECRET;
process.env.ADMIN_DISCORD_IDS = '999999';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'yot-email-privacy-self-'));

const { signToken, makeDiscordProfile } = await import('../src/auth.ts');

const CANARY = 'leak-canary@example.com';
const ME = '111111';
const OTHER = '222222';
const now = Date.now();

const write = (name: string, data: unknown) => writeFileSync(join(DATA, name), JSON.stringify(data));
write('email.json', { [`dc_${ME}`]: { email: CANARY, verified: true, updatedAt: now, topics: { announcements: true, digest: true }, consentAt: {} } });
write('accounts.json', {
  [`dc_${ME}`]: { id: `dc_${ME}`, name: 'Canary', discordId: ME, discordName: 'canary', avatar: '🙂', firstSeen: now - 86_400_000, lastSeen: now, ips: {} },
  [`dc_${OTHER}`]: { id: `dc_${OTHER}`, name: 'Other', discordId: OTHER, discordName: 'other', avatar: '😀', firstSeen: now - 86_400_000, lastSeen: now, ips: {} },
});
write('results.json', [{
  code: 'MONO1', mapId: 'classic', themeId: 'classic', startedAt: now - 3_600_000, endedAt: now - 60_000, turns: 40,
  places: [
    { id: `dc_${ME}`, name: 'Canary', isBot: false, netWorth: 3000, character: 'chog', avatar: '🙂' },
    { id: `dc_${OTHER}`, name: 'Other', isBot: false, netWorth: 0, character: 'chog', avatar: '😀' },
  ],
}]);
write('cards-results.json', [{
  game: 'cards', code: 'CARD1', startedAt: now - 3_600_000, endedAt: now - 30_000, rounds: 3, match: 'single', targetScore: 0,
  places: [
    { id: `dc_${ME}`, name: 'Canary', isBot: false, score: 0, avatar: '🙂' },
    { id: `dc_${OTHER}`, name: 'Other', isBot: false, score: 12, avatar: '😀' },
  ],
}]);

const keys = generateKeyPairSync('ed25519');
const publicHex = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = createServer();
    s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

let child: ChildProcess;
let base = '';
let output = '';

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port), DATA_DIR: DATA, APP_SECRET: SECRET, ADMIN_DISCORD_IDS: '999999', DISCORD_PUBLIC_KEY: publicHex,
      DEMO_MODE: '1', RATE_LIMIT_OFF: '1', NODE_ENV: 'test', RESEND_API_KEY: '', DISCORD_BOT_TOKEN: '', DISCORD_CLIENT_ID: '', DISCORD_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', d => { output += String(d); });
  child.stderr!.on('data', d => { output += String(d); });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`server did not start:\n${output}`);
    await new Promise(r => setTimeout(r, 200));
  }
});

after(() => {
  child?.kill();
});

const tokens = {
  stranger: null,
  other: signToken(makeDiscordProfile({ id: OTHER, username: 'other' })),
  self: signToken(makeDiscordProfile({ id: ME, username: 'canary' })),
};

const PUBLIC = [
  `/api/players/dc_${ME}`,
  `/api/players/dc_${ME}/cards`,
  `/api/players/dc_${ME}/achievements`,
  `/api/players/dc_${ME}/card.png`,
  `/api/tournaments/player/dc_${ME}`,
  '/api/activity',
  '/api/leaderboard',
  '/api/cards/leaderboard',
  '/api/cards/daily',
  '/api/cards/daily/history',
  '/api/tournaments/next',
  '/api/config',
  `/api/friends/status/dc_${ME}`,
  '/api/friends',
  '/api/auth/me',
];

const leaks = (body: Buffer) => {
  const s = body.toString('latin1').toLowerCase();
  return s.includes(CANARY) || s.includes('leak-canary') || s.includes(Buffer.from(CANARY).toString('base64').toLowerCase());
};

test('the profile, players, achievements, card, activity and leaderboards never carry the address', async () => {
  let checked = 0;
  for (const [who, token] of Object.entries(tokens)) {
    for (const path of PUBLIC) {
      const res = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(!leaks(body), `${path} as ${who} (HTTP ${res.status}) leaks the address`);
      if (res.ok) checked++;
    }
  }
  // The profile really is there (so the check above read real answers).
  const prof = await (await fetch(`${base}/api/players/dc_${ME}`)).json() as { profile: { name: string } | null };
  assert.equal(prof.profile?.name, 'Canary');
  assert.ok(checked > 30, `only ${checked} answered`);
});

test('another player cannot read it from the settings endpoint; the owner can', async () => {
  const theirs = await (await fetch(`${base}/api/email/prefs`, { headers: { Authorization: `Bearer ${tokens.other}` } })).json() as { email: string | null };
  assert.equal(theirs.email, null);
  assert.equal((await fetch(`${base}/api/email/prefs`)).status, 401);
  const mine = await (await fetch(`${base}/api/email/prefs`, { headers: { Authorization: `Bearer ${tokens.self}` } })).json() as { email: string | null };
  assert.equal(mine.email, CANARY);
});

test('the dashboard Email tab and the players list refuse non-operators', async () => {
  for (const path of ['/api/admin/email', '/api/admin/email/export.csv', `/api/admin/accounts/dc_${ME}`, '/api/admin/accounts?q=canary']) {
    const res = await fetch(base + path, { headers: { Authorization: `Bearer ${tokens.other}` } });
    assert.equal(res.status, 403, path);
    assert.ok(!leaks(Buffer.from(await res.arrayBuffer())), path);
  }
});

test("the bot's /stats replies never carry the address", async () => {
  const ask = async (caller: string, target?: string) => {
    const body = Buffer.from(JSON.stringify({
      type: 2, id: '1', application_id: '1', token: 't', guild_id: '1',
      data: {
        name: 'stats',
        ...(target && { options: [{ name: 'user', type: 6, value: target }], resolved: { users: { [target]: { id: target, username: 'canary' } } } }),
      },
      member: { user: { id: caller, username: caller === ME ? 'canary' : 'other' } },
    }));
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(null, Buffer.concat([Buffer.from(ts), body]), keys.privateKey).toString('hex');
    const res = await fetch(`${base}/api/discord/interactions`, {
      method: 'POST', body, headers: { 'content-type': 'application/json', 'x-signature-ed25519': sig, 'x-signature-timestamp': ts },
    });
    assert.equal(res.status, 200);
    return Buffer.from(await res.arrayBuffer());
  };
  const self = await ask(ME);
  const other = await ask(OTHER, ME);
  for (const b of [self, other]) assert.ok(!leaks(b));
  assert.match(other.toString('utf8'), /Canary/, 'the reply is about the player');
});

test('the server log never prints the address', () => {
  assert.ok(!output.toLowerCase().includes('leak-canary'), output);
});
