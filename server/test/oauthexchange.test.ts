// The Discord code exchange, under the conditions of a registration rush.
//
// "Token exchange failed" kept reaching players and nothing said why, because
// the failing response's status and body were thrown away. These pin the
// behaviours that stop the two rush-time failures — Discord rate-limiting a
// burst of sign-ins from our one address, and a callback GET being replayed
// with its single-use code — and the messages that make the rest diagnosable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { completeOAuth } from '../src/discord.ts';

process.env.DISCORD_CLIENT_ID = 'cid';
process.env.DISCORD_CLIENT_SECRET = 'secret';

type Reply = { status: number; body: unknown };
function stubFetch(script: Record<string, Reply[]>) {
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    const key = Object.keys(script).find(k => u.includes(k));
    const queue = key ? script[key] : null;
    const r = queue && queue.length ? queue.shift()! : { status: 200, body: {} };
    return {
      ok: r.status < 400,
      status: r.status,
      headers: new Headers(r.status === 429 ? { 'retry-after': '0.1' } : {}),
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const ok = (id: string): Record<string, Reply[]> => ({
  'oauth2/token': [{ status: 200, body: { access_token: 'tok' } }],
  'users/@me/guilds': [{ status: 200, body: [] }],
  'users/@me': [{ status: 200, body: { id, username: 'player' } }],
});

test('a rate-limited exchange is retried, not shown to the player', async t => {
  const f = stubFetch({
    ...ok('u1'),
    'oauth2/token': [
      { status: 429, body: { message: 'rate limited' } },
      { status: 200, body: { access_token: 'tok' } },
    ],
  });
  t.after(f.restore);
  const who = await completeOAuth('code-429', 'https://x/cb');
  assert.equal(who.id, 'u1', 'the second attempt signed them in');
  assert.equal(f.calls.filter(u => u.includes('oauth2/token')).length, 2);
});

test('a replayed callback succeeds instead of failing on the spent code', async t => {
  const f = stubFetch(ok('u2'));
  t.after(f.restore);
  const first = await completeOAuth('code-replay', 'https://x/cb');
  // The same code arrives again — a refreshed tab, a link preview. Discord
  // would refuse it; the cache answers instead.
  const again = await completeOAuth('code-replay', 'https://x/cb');
  assert.deepEqual(again, first);
  assert.equal(f.calls.filter(u => u.includes('oauth2/token')).length, 1, 'Discord was asked once');
});

test('failures name their reason instead of a shrug', async t => {
  for (const [body, expect] of [
    [{ error: 'invalid_grant' }, /already used or expired/],
    [{ error: 'invalid_client' }, /misconfigured on our side/],
    [{ error: 'invalid_request', error_description: 'redirect_uri mismatch' }, /misconfigured for this domain/],
  ] as const) {
    const f = stubFetch({ 'oauth2/token': [{ status: 400, body }] });
    try {
      await assert.rejects(
        completeOAuth(`code-${JSON.stringify(body).length}-${Math.random()}`, 'https://x/cb'),
        expect,
      );
    } finally { f.restore(); }
  }
});
