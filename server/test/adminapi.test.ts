// Round-trips through the real HTTP endpoints.
//
// The unit tests all passed while saving a prop firm silently did nothing:
// the handler listed the fields it forwarded by hand and had never been
// updated for `firms`, so an edit returned 200 with the old list. Only a
// test that goes over the wire catches that, so this one does.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8100 + Math.floor(process.pid % 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'chog-api-'));

// Discord sign-in is the only way in, and this test cannot complete an OAuth
// round trip. Instead the server is given a known signing secret and the test
// mints its own token with the server's own signer — so the token is exactly
// what a real Discord sign-in would produce, not a test-only bypass.
const SECRET = 'test-secret-for-adminapi';
process.env.CHOG_SECRET = SECRET;
process.env.DATA_DIR = DATA;
const { signToken, withAdminFlag } = await import('../src/auth.ts');

let srv: ChildProcess;
let token = '';

before(async () => {
  srv = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'index.ts')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, RATE_LIMIT_OFF: '1', CHOG_SECRET: SECRET },
    stdio: 'ignore',
    detached: true,
  });
  // Wait for it to answer rather than sleeping a fixed amount.
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.ok) break;
    } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  // With no ADMIN_DISCORD_IDS set every account is the operator, which is
  // what a local server does anyway.
  // withAdminFlag is what real sign-in applies; with no ADMIN_DISCORD_IDS set
  // every account is the operator, which is what a local server does anyway.
  token = signToken(withAdminFlag({
    id: 'd_operator', name: 'Danz', avatar: '🙂', provider: 'discord',
    discord: { id: '340404007639973888', username: 'danzyot' },
  }));
  assert.ok(token, 'signed in');
});

after(() => {
  // Kill the process group: the spawned node has a tsx loader under it.
  try { process.kill(-srv.pid!, 'SIGKILL'); } catch { /* already gone */ }
  rmSync(DATA, { recursive: true, force: true });
});

const admin = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, {
  ...init,
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
});

test('editing the prop firms actually saves them', async () => {
  const before = await admin('/api/admin/promo').then(r => r.json() as Promise<{ promo: Record<string, unknown> }>);
  const firms = [
    { id: 'lucid', name: 'Lucid Trading', offer: '50% OFF', url: 'https://lucidtrading.com/ref/test', accent: 'purple' },
    { id: 'newone', name: 'Brand New Firm', offer: '25% OFF', url: 'https://example.test/new', accent: 'blue' },
  ];
  const saved = await admin('/api/admin/promo', {
    method: 'PUT',
    body: JSON.stringify({ ...before.promo, enabled: true, firms, railEnabled: false, code: 'LUCID2' }),
  }).then(r => r.json() as Promise<{ promo: { firms: { name: string; offer: string }[]; railEnabled: boolean; code: string } }>);

  assert.equal(saved.promo.firms.length, 2, 'the response carries the edited list, not the old one');
  assert.equal(saved.promo.firms[0].offer, '50% OFF', 'an edited offer sticks');
  assert.equal(saved.promo.firms[1].name, 'Brand New Firm', 'an added firm sticks');
  assert.equal(saved.promo.railEnabled, false, 'the rail toggle sticks');
  assert.equal(saved.promo.code, 'LUCID2');

  // And it is still there on a fresh read, not just in the reply.
  const reread = await admin('/api/admin/promo')
    .then(r => r.json() as Promise<{ promo: { firms: unknown[]; railEnabled: boolean } }>);
  assert.equal(reread.promo.firms.length, 2);
  assert.equal(reread.promo.railEnabled, false);
});

test('the advert is governed by its own enabled flag, and nothing else', async () => {
  // There used to be a second switch for this in the feature list, which
  // meant an advert could be written, enabled, and still invisible. The
  // flag that sits next to the copy is now the only one.
  const pub = await fetch(`${BASE}/api/promo`)
    .then(r => r.json() as Promise<{ promo: { firms: { name: string }[] } | null }>);
  assert.ok(pub.promo, 'enabled means advertised');
  assert.deepEqual(pub.promo!.firms.map(f => f.name), ['Lucid Trading', 'Brand New Firm']);

  await admin('/api/admin/promo', { method: 'PUT', body: JSON.stringify({ enabled: false }) });
  const off = await fetch(`${BASE}/api/promo`).then(r => r.json() as Promise<{ promo: unknown }>);
  assert.equal(off.promo, null, 'and switching it off is enough');
});

test('the promo endpoints stay operator-only', async () => {
  for (const [path, init] of [
    ['/api/admin/promo', undefined],
    ['/api/admin/promo', { method: 'PUT', body: '{}' }],
  ] as const) {
    const r = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
    assert.equal(r.status, 401, `${init?.method ?? 'GET'} ${path} needs a token`);
  }
});

test('a game still cannot be created nameless or with a taken name', async () => {
  const blank = await admin('/api/tables', { method: 'POST', body: JSON.stringify({ sb: 25, bb: 50 }) });
  assert.equal(blank.status, 400);

  const ok = await admin('/api/tables', { method: 'POST', body: JSON.stringify({ name: 'Round Trip', sb: 25, bb: 50 }) });
  assert.equal(ok.status, 200);

  const dupe = await admin('/api/tables', { method: 'POST', body: JSON.stringify({ name: '  round   trip ' }) });
  assert.equal(dupe.status, 400, 'case and spacing do not make it a different name');
});

// "Ban only the alts": the player the ban was started from is unticked on the
// ban screen. Their alts are banned; they are not — no account row, no
// address row, nothing that would catch them on their next visit.
test('banning only the alts leaves the player themselves alone', async () => {
  type Row = { kind: string; value: string; reason: string };
  const r = await admin('/api/admin/bans', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'ip', scope: 'lifetime', playerId: 'g_main', name: 'Main',
      alsoBan: ['g_alt1', 'g_alt2'], skipPrimary: true,
    }),
  });
  assert.equal(r.status, 200, 'no address on record for the main is fine: theirs is not being banned');
  const body = await r.json() as { ban: unknown; alsoBanned: string[] };
  assert.equal(body.ban, null, 'no row for the player or their address');
  assert.equal(body.alsoBanned.length, 2);

  const { bans } = await admin('/api/admin/bans').then(x => x.json() as Promise<{ bans: Row[] }>);
  const values = bans.map(b => b.value);
  assert.ok(values.includes('g_alt1') && values.includes('g_alt2'), 'both alts are banned');
  assert.ok(!values.includes('g_main'), 'the player is not');
  assert.ok(bans.every(b => b.kind === 'player'), 'and no address was banned');
  assert.match(bans.find(b => b.value === 'g_alt1')!.reason, /Suspected alt of Main/);
});

test('a player ban with the player unticked and the same account in the list still skips them', async () => {
  const r = await admin('/api/admin/bans', {
    method: 'POST',
    body: JSON.stringify({ kind: 'player', scope: 'lifetime', value: 'g_main2', name: 'Main2', alsoBan: ['g_main2', 'g_alt3'], skipPrimary: true }),
  });
  assert.equal(r.status, 200);
  const { bans } = await admin('/api/admin/bans').then(x => x.json() as Promise<{ bans: { value: string }[] }>);
  assert.ok(bans.some(b => b.value === 'g_alt3'));
  assert.ok(!bans.some(b => b.value === 'g_main2'));
});

test('unticking the player with no alt picked bans nobody, and says why', async () => {
  const r = await admin('/api/admin/bans', {
    method: 'POST',
    body: JSON.stringify({ kind: 'player', scope: 'lifetime', value: 'g_main3', name: 'Main3', alsoBan: [], skipPrimary: true }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json() as { error: string }).error, /Pick at least one alt/);
  const { bans } = await admin('/api/admin/bans').then(x => x.json() as Promise<{ bans: { value: string }[] }>);
  assert.ok(!bans.some(b => b.value === 'g_main3'));
});

test('with the player ticked, the usual ban still takes them and the alts', async () => {
  const r = await admin('/api/admin/bans', {
    method: 'POST',
    body: JSON.stringify({ kind: 'player', scope: 'lifetime', value: 'g_main4', name: 'Main4', alsoBan: ['g_alt4'] }),
  });
  assert.equal(r.status, 200);
  const { bans } = await admin('/api/admin/bans').then(x => x.json() as Promise<{ bans: { value: string }[] }>);
  assert.ok(bans.some(b => b.value === 'g_main4') && bans.some(b => b.value === 'g_alt4'));
});
