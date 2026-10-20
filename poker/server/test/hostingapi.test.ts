// Player hosts over the wire: the real server, a stand-in hub that checks
// signatures the way the hub does, and real socket clients. Covers who may
// create, the limits, the hub going down, and what a host may and may not do
// to their own event once it exists.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { io, type Socket } from 'socket.io-client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUB_PORT = 8671;
const PORT = 8672;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(join(tmpdir(), 'chog-hostingapi-'));
const SECRET = 'shared-across-chog-games-hosting';
process.env.CHOG_SECRET = SECRET;
process.env.DATA_DIR = DATA;
process.env.ADMIN_DISCORD_IDS = '111111';
const { signToken, withAdminFlag } = await import('../src/auth.ts');

const who = (discordId: string, name: string) => signToken(withAdminFlag({
  id: `dc_${discordId}`, name, avatar: '🙂', provider: 'discord', discord: { id: discordId, username: name.toLowerCase() },
}));
const OP = who('111111', 'Op');
const HOLDER = who('222222', 'Holder');
const RANDO = who('333333', 'Rando');
const APPROVED = who('444444', 'Approved');
const PLAYER2 = who('666666', 'Second');
const PLAYER3 = who('777777', 'Third');

// ---- the stand-in hub: the hub's rule, the hub's signature check ----------------

const hubSays: Record<string, 'holder' | 'approved'> = { dc_222222: 'holder', dc_444444: 'approved' };
let hubDown = false;
const hubAsked: string[] = [];
let hub: Server;
let srv: ChildProcess;

before(async () => {
  hub = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://hub');
    const id = url.searchParams.get('id') ?? '';
    hubAsked.push(id);
    if (hubDown) { res.writeHead(502).end(); return; }
    const ts = String(req.headers['x-chog-timestamp'] ?? '');
    const expect = createHmac('sha256', Buffer.from(SECRET, 'utf8')).update(`svc:hosting:can-host:${id}:${ts}`).digest('base64url');
    if (url.pathname !== '/api/hosting/can-host' || req.headers['x-chog-signature'] !== expect || Math.abs(Date.now() - Number(ts)) > 60_000) {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"bad signature"}');
      return;
    }
    const reason = hubSays[id] ?? null;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ canHost: !!reason, reason }));
  });
  await new Promise<void>(r => hub.listen(HUB_PORT, '127.0.0.1', () => r()));

  srv = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'index.ts')], {
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: DATA, RATE_LIMIT_OFF: '1', CHOG_SECRET: SECRET,
      ADMIN_DISCORD_IDS: '111111', HUB_URL: `http://127.0.0.1:${HUB_PORT}`, DISCORD_ANNOUNCE_CHANNEL_ID: '',
    },
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) break;
    } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
});

const sockets: Socket[] = [];
after(() => {
  for (const s of sockets) s.close();
  try { process.kill(-srv.pid!, 'SIGKILL'); } catch { /* already gone */ }
  hub.close();
  rmSync(DATA, { recursive: true, force: true });
});

const call = (path: string, token: string, body?: unknown) => fetch(`${BASE}${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const lobby = async () => (await (await fetch(`${BASE}/api/lobby`)).json()) as {
  tournaments: { id: string; name: string; state: string; maxPlayers: number; hasSocialReq: boolean; playerHosted: boolean; hostName: string }[];
  cashTables: { id: string; playerHosted: boolean; hostName: string }[];
};

async function connect(token: string): Promise<Socket> {
  const s = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

/** Emits and returns the error toast it caused, or null when none came. */
async function attempt(s: Socket, event: string, payload: unknown): Promise<string | null> {
  return new Promise(resolve => {
    const onToast = (t: { kind: string; text: string }) => {
      if (t.kind !== 'error') return;
      clearTimeout(timer);
      s.off('toast', onToast);
      resolve(t.text);
    };
    const timer = setTimeout(() => { s.off('toast', onToast); resolve(null); }, 600);
    s.on('toast', onToast);
    s.emit(event, payload);
  });
}

let holderCup = '';
let holderTable = '';

test('a player the hub does not vouch for cannot create anything', async () => {
  const t = await call('/api/tournaments', RANDO, { name: 'Rando Cup' });
  assert.equal(t.status, 403);
  assert.match((await t.json() as { error: string }).error, /Chog Genesis holders/);
  assert.equal((await call('/api/tables', RANDO, { name: 'Rando Table' })).status, 403);
  const me = await (await call('/api/hosting/me', RANDO)).json() as { canHost: boolean };
  assert.equal(me.canHost, false);
});

test('a holder can host: clamped, marked as player-hosted, no Discord extras', async () => {
  const res = await call('/api/tournaments', HOLDER, {
    name: 'Holder Cup', maxPlayers: 1000, levelMinutes: 60, approveRegistrations: true, prizeText: '1st: a Chog',
    customLevels: [{ sb: 25, bb: 50, ante: 0, minutes: 0 }],
    social: { discordGuildId: '123456789', discordRoleId: '987654321', discordRoleName: 'VIP', requireDiscord: true },
    discordWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
  });
  assert.equal(res.status, 200, await res.clone().text());
  holderCup = (await res.json() as { id: string }).id;
  const row = (await lobby()).tournaments.find(t => t.id === holderCup)!;
  assert.equal(row.playerHosted, true);
  assert.equal(row.hostName, 'Holder');
  assert.equal(row.maxPlayers, 100);
  assert.equal(row.hasSocialReq, false, 'no Discord role gating on a player event');
  const me = await (await call('/api/hosting/me', HOLDER)).json() as { canHost: boolean; reason: string };
  assert.deepEqual([me.canHost, me.reason], [true, 'holder']);
});

test('a player host gets one tournament and two cash tables at a time', async () => {
  const second = await call('/api/tournaments', HOLDER, { name: 'Holder Cup Two' });
  assert.equal(second.status, 400);
  assert.match((await second.json() as { error: string }).error, /1 tournament at a time/);
  const a = await call('/api/tables', HOLDER, { name: 'Holder Table A' });
  assert.equal(a.status, 200);
  holderTable = (await a.json() as { id: string }).id;
  assert.equal((await call('/api/tables', HOLDER, { name: 'Holder Table B' })).status, 200);
  const c = await call('/api/tables', HOLDER, { name: 'Holder Table C' });
  assert.equal(c.status, 400);
  assert.match((await c.json() as { error: string }).error, /2 cash tables at a time/);
  assert.equal((await lobby()).cashTables.find(t => t.id === holderTable)?.playerHosted, true);
});

test('operators have no limits and their events are not player-hosted', async () => {
  for (const name of ['Operator Night', 'Operator Night Two']) {
    const r = await call('/api/tournaments', OP, { name });
    assert.equal(r.status, 200);
  }
  const ops = (await lobby()).tournaments.filter(t => t.name.startsWith('Operator Night'));
  assert.deepEqual(ops.map(t => t.playerHosted), [false, false]);
  // The dashboard lists player-hosted events with their host, so they can be closed.
  const games = await (await call('/api/admin/games', OP)).json() as { tournaments: { id: string; playerHosted: boolean; hostName: string }[]; cashTables: { playerHosted: boolean }[] };
  assert.deepEqual(games.tournaments.filter(t => t.playerHosted).map(t => [t.id, t.hostName]), [[holderCup, 'Holder']]);
  assert.equal(games.cashTables.filter(t => t.playerHosted).length, 2);
  assert.equal((await call('/api/admin/games', HOLDER)).status, 403, 'hosts do not get the dashboard');
});

test('if the hub cannot be reached, hosting fails closed with a clear message', async () => {
  hubDown = true;
  const r = await call('/api/tournaments', APPROVED, { name: 'Approved Cup' });
  assert.equal(r.status, 503);
  assert.match((await r.json() as { error: string }).error, /Could not check your hosting rights/);
  // Operators do not depend on the hub.
  assert.equal((await call('/api/tables', OP, { name: 'Operator Table' })).status, 200);
  hubDown = false;
  const ok = await call('/api/tournaments', APPROVED, { name: 'Approved Cup' });
  assert.equal(ok.status, 200, 'an approved host, once the hub answers');
  // Answers are cached: asking again inside the minute does not reach the hub.
  const asked = hubAsked.length;
  await call('/api/hosting/me', APPROVED);
  assert.equal(hubAsked.length, asked);
});

test('a host runs their own event: start, pause, resume, prizes, start time — not kick', async () => {
  const host = await connect(HOLDER);
  const p1 = await connect(RANDO);
  const p2 = await connect(PLAYER2);
  const p3 = await connect(PLAYER3);
  const op = await connect(OP);
  for (const p of [p1, p2, p3]) assert.equal(await attempt(p, 'tourney:register', holderCup), null);

  assert.match(String(await attempt(host, 'tourney:kick', { id: holderCup, playerId: 'dc_333333' })), /Only an operator/);
  assert.match(String(await attempt(host, 'tourney:approveAll', holderCup)), /Only an operator/);
  assert.match(String(await attempt(host, 'tourney:settings', { id: holderCup, maxPlayers: 500 })), /Only an operator/);
  assert.match(String(await attempt(host, 'tourney:settings', { id: holderCup, prizeText: 'x', name: 'Renamed' })), /Only an operator/, 'one forbidden key spoils the batch');
  assert.equal(await attempt(host, 'tourney:settings', { id: holderCup, prizeText: '1st: two Chogs' }), null);
  assert.match(String(await attempt(host, 'tourney:settings', { id: holderCup, scheduledStart: Date.now() + 9 * 86_400_000 })), /7 days/);
  assert.equal(await attempt(host, 'tourney:settings', { id: holderCup, scheduledStart: Date.now() + 3_600_000 }), null);

  // Other players cannot touch it.
  assert.match(String(await attempt(p1, 'tourney:start', holderCup)), /tournament director/);
  assert.match(String(await attempt(p1, 'tourney:cancel', holderCup)), /tournament director/);

  assert.equal(await attempt(host, 'tourney:start', holderCup), null);
  const state = async () => (await lobby()).tournaments.find(t => t.id === holderCup)?.state;
  assert.equal(await state(), 'running');
  assert.equal(await attempt(host, 'tourney:pause', holderCup), null);
  assert.equal(await state(), 'paused');
  assert.equal(await attempt(host, 'tourney:resume', holderCup), null);
  assert.equal(await state(), 'running');
  assert.match(String(await attempt(host, 'tourney:endNow', holderCup)), /Only an operator/);

  // Operators can pause anything, and kick on a player-hosted event.
  assert.equal(await attempt(op, 'tourney:pause', holderCup), null);
  assert.equal(await state(), 'paused');
  assert.equal(await attempt(op, 'tourney:kick', { id: holderCup, playerId: 'dc_666666' }), null);

  assert.equal(await attempt(host, 'tourney:cancel', holderCup), null);
  assert.equal(await state(), undefined, 'cancelled events leave the lobby');

  // A host's own event is the only one they control.
  const opCup = (await lobby()).tournaments.find(t => t.name === 'Operator Night')!.id;
  assert.match(String(await attempt(host, 'tourney:pause', opCup)), /tournament director/);
  assert.match(String(await attempt(host, 'tourney:cancel', opCup)), /tournament director/);
});

test('a host can close their own cash table, nobody else\'s, and cannot change its settings', async () => {
  const host = await connect(HOLDER);
  const rando = await connect(RANDO);
  assert.match(String(await attempt(host, 'table:settings', { tableId: holderTable, actionSeconds: 60 })), /Only an operator/);
  assert.match(String(await attempt(rando, 'table:close', holderTable)), /Only the table host/);
  assert.match(String(await attempt(host, 'table:reverseTurn', holderTable)), /Only the host/);
  assert.equal(await attempt(host, 'table:close', holderTable), null);
  assert.equal((await lobby()).cashTables.some(t => t.id === holderTable), false);
  // With one closed, there is room for another.
  assert.equal((await call('/api/tables', HOLDER, { name: 'Holder Table C' })).status, 200);
});
