// One sign-in across Chog Games.
//
// The hub (choggames.com) and this room are two services sharing one Discord
// application and one token secret (hub: APP_SECRET; here: CHOG_SECRET, or
// APP_SECRET when that is the only one set). A player who signs in on the hub
// arrives here with the hub's token in `#dtoken=`, and it has to be accepted
// as if this room had minted it — and refused the moment the secrets differ,
// because the secret is the only thing doing any vouching. There is no
// TRUST_HUB_TOKENS switch: compatibility is the format plus the key.
//
// The hub's signer below is a copy of server/src/auth.ts in the hub (the
// lines that matter), not an import: the two codebases deploy separately and
// this test is the thing that notices if either side drifts.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET = 'shared-across-chog-games';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'chog-hub-'));
process.env.CHOG_SECRET = SECRET;
process.env.ADMIN_DISCORD_IDS = '340404007639973888';

const { verifyToken } = await import('../src/auth.ts');
const { hubOrigins, hubUrl, isHubOrigin, HUB_READABLE } = await import('../src/hub.ts');

// ---- the hub's signer, verbatim in spirit (hub server/src/auth.ts) --------
const b64url = (buf: Buffer) => buf.toString('base64url');
function hubSignToken(profile: Record<string, unknown>, secret: string): string {
  const mac = (s: string) => b64url(createHmac('sha256', Buffer.from(secret, 'utf8')).update(s).digest());
  // The hub strips isAdmin from the payload on purpose.
  const payload = b64url(Buffer.from(JSON.stringify({ ...profile, isAdmin: undefined, iat: Date.now() })));
  return `${payload}.${mac(payload)}`;
}

const OPERATOR = {
  id: 'dc_340404007639973888', name: 'Danz', avatar: 'https://cdn.discordapp.com/avatars/x/y.png',
  provider: 'discord', discord: { id: '340404007639973888', username: 'danzyot' },
};
const PLAYER = {
  id: 'dc_999000111', name: 'Rando', avatar: '🎩',
  provider: 'discord', discord: { id: '999000111', username: 'rando' },
};

test('a token the hub signed with the shared secret signs you in here', () => {
  const p = verifyToken(hubSignToken(PLAYER, SECRET));
  assert.ok(p, 'accepted');
  assert.equal(p.id, 'dc_999000111');
  assert.equal(p.name, 'Rando');
  assert.equal(p.provider, 'discord');
  assert.equal(p.discord?.id, '999000111');
  assert.equal(p.isAdmin, false);
});

test('operator rights come from ADMIN_DISCORD_IDS, not from the hub token', () => {
  // The hub never writes isAdmin into a token; this room derives it anyway.
  const p = verifyToken(hubSignToken(OPERATOR, SECRET));
  assert.equal(p?.isAdmin, true);
});

test('a hub token signed with a different secret is refused', () => {
  assert.equal(verifyToken(hubSignToken(OPERATOR, 'the-hub-has-a-different-APP_SECRET')), null);
  assert.equal(verifyToken(hubSignToken(PLAYER, SECRET + ' ')), null, 'even one byte off');
});

test('a hub demo token is refused unless this room is also a demo', () => {
  const demo = { id: 'demo_abc', name: 'Guest', avatar: '🎩', provider: 'demo' };
  assert.equal(verifyToken(hubSignToken(demo, SECRET)), null);
});

// ---- which browsers may read the public endpoints -------------------------

test('the hub is the default allowed origin; HUB_ORIGINS adds the Railway one', () => {
  delete process.env.HUB_URL;
  delete process.env.HUB_ORIGINS;
  assert.equal(hubUrl(), 'https://choggames.com');
  assert.equal(isHubOrigin('https://choggames.com'), true);
  assert.equal(isHubOrigin('https://poker.choggames.com'), false, 'not even our own sibling by accident');
  assert.equal(isHubOrigin('https://evil.example'), false);
  assert.equal(isHubOrigin(undefined), false);

  process.env.HUB_ORIGINS = 'https://yot-monopoly-production.up.railway.app, staging.choggames.com/';
  assert.deepEqual([...hubOrigins()].sort(), [
    'https://choggames.com',
    'https://staging.choggames.com',
    'https://yot-monopoly-production.up.railway.app',
  ]);

  process.env.HUB_URL = 'off';
  assert.equal(hubUrl(), null, 'a standalone room has no hub');
  assert.equal(isHubOrigin('https://choggames.com'), false);
  delete process.env.HUB_URL;
  delete process.env.HUB_ORIGINS;
});

test('only the leaderboard and finished results are readable cross-origin', () => {
  assert.equal(HUB_READABLE.test('/api/leaderboard'), true);
  assert.equal(HUB_READABLE.test('/api/results/abc123'), true);
  for (const p of ['/api/config', '/api/lobby', '/api/health', '/api/auth/me', '/api/admin/health', '/api/results/', '/api/results/a/b']) {
    assert.equal(HUB_READABLE.test(p), false, p);
  }
});

// ---- over the wire, as production --------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8500 + Math.floor(process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'chog-hub-http-'));
let srv: ChildProcess;

before(async () => {
  srv = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'index.ts')], {
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: DATA, RATE_LIMIT_OFF: '1', CHOG_SECRET: SECRET,
      NODE_ENV: 'production', HUB_ORIGINS: 'https://hub-staging.up.railway.app',
    },
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) break;
    } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
});

after(() => {
  try { process.kill(-srv.pid!, 'SIGKILL'); } catch { /* already gone */ }
  rmSync(DATA, { recursive: true, force: true });
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
});

const acao = (r: Response) => r.headers.get('access-control-allow-origin');

test('production CORS: the hub may read the leaderboard, nobody else may', async () => {
  assert.equal(acao(await fetch(`${BASE}/api/leaderboard`, { headers: { origin: 'https://choggames.com' } })), 'https://choggames.com');
  assert.equal(acao(await fetch(`${BASE}/api/leaderboard`, { headers: { origin: 'https://hub-staging.up.railway.app' } })), 'https://hub-staging.up.railway.app');
  assert.equal(acao(await fetch(`${BASE}/api/leaderboard`, { headers: { origin: 'https://evil.example' } })), null);
  // Not even the hub gets anything that is not on the list.
  assert.equal(acao(await fetch(`${BASE}/api/config`, { headers: { origin: 'https://choggames.com' } })), null);
  assert.equal(acao(await fetch(`${BASE}/api/lobby`, { headers: { origin: 'https://choggames.com' } })), null);
  // A preflight for a read is answered; nothing else is promised.
  const pre = await fetch(`${BASE}/api/leaderboard`, { method: 'OPTIONS', headers: { origin: 'https://choggames.com' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
});

test('/api/config names the hub and /api/health reports the volume', async () => {
  const cfg = await (await fetch(`${BASE}/api/config`)).json() as { hubUrl?: string | null };
  assert.equal(cfg.hubUrl, 'https://choggames.com');
  const health = await (await fetch(`${BASE}/api/health`)).json() as { ok: boolean; persistentDisk?: boolean };
  assert.equal(health.ok, true);
  assert.equal(health.persistentDisk, true, 'DATA_DIR is set and exists');
});

test('/api/auth/me answers with the server-side profile for a hub token', async () => {
  const r = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${hubSignToken(OPERATOR, SECRET)}` } });
  assert.equal(r.status, 200);
  const { profile } = await r.json() as { profile: { id: string; isAdmin: boolean } };
  assert.equal(profile.id, OPERATOR.id);
  assert.equal(profile.isAdmin, true, 'the client learns it is the operator from here, not the payload');
  const bad = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${hubSignToken(OPERATOR, 'wrong')}` } });
  assert.equal(bad.status, 401);
});
