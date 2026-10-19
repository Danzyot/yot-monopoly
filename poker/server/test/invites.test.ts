// Invite tracking: which invite a new member used, and who made it.
//
// The attribution is plain arithmetic and is tested as such first. Then the
// whole path is run against a stand-in Discord that speaks the real gateway
// protocol over a real WebSocket — hello, identify, heartbeat, a member
// joining — because the part most likely to be wrong is the part that only
// exists on the wire.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import type { Duplex } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8600 + (process.pid % 300);
const GUILD = '900000000000000001';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'invites-'));
process.env.DISCORD_API_BASE = `http://127.0.0.1:${PORT}`;
process.env.DISCORD_BOT_TOKEN = 'test-token';
process.env.DISCORD_GUILD_ID = GUILD;
process.env.DISCORD_AUDIT_CHANNEL_ID = 'audit-chan';

const { attributeJoin, accountCreatedAt, isYoung, inviteJoins, resetInviteLog } = await import('../src/invitelog.ts');
type InviteInfo = import('../src/invitelog.ts').InviteInfo;

const inv = (code: string, uses: number, inviterId: string | null, maxUses = 0): InviteInfo =>
  ({ code, uses, maxUses, inviterId, inviterName: inviterId ? `U${inviterId.slice(-2)}` : null });
const map = (...l: InviteInfo[]) => new Map(l.map(i => [i.code, i]));
const NO_VANITY = { before: null, after: null };

// ---------- attribution ----------

test('the invite whose count went up is the one, and its creator is the inviter', () => {
  const r = attributeJoin(map(inv('a', 3, '11'), inv('b', 7, '22')), map(inv('a', 3, '11'), inv('b', 8, '22')), [], NO_VANITY);
  assert.equal(r.how, 'invite');
  assert.equal(r.code, 'b');
  assert.equal(r.inviterId, '22');
});

test('an invite made since the last look, already used once, still counts', () => {
  const r = attributeJoin(map(inv('a', 3, '11')), map(inv('a', 3, '11'), inv('new', 1, '33')), [], NO_VANITY);
  assert.equal(r.inviterId, '33');
});

test('a one-use invite is deleted by the join that uses it, and is still found', () => {
  const one = inv('once', 0, '44', 1);
  const r = attributeJoin(map(inv('a', 3, '11'), one), map(inv('a', 3, '11')), [one], NO_VANITY);
  assert.equal(r.how, 'invite');
  assert.equal(r.inviterId, '44');
});

test('an unlimited invite a moderator deleted says nothing about the join', () => {
  const gone = inv('gone', 5, '55', 0);
  const r = attributeJoin(map(gone), map(), [gone], NO_VANITY);
  assert.equal(r.how, 'unknown');
});

test('two invites moving at once is reported as one of them, not guessed', () => {
  const r = attributeJoin(map(inv('a', 1, '11'), inv('b', 1, '22')), map(inv('a', 2, '11'), inv('b', 2, '22')), [], NO_VANITY);
  assert.equal(r.how, 'ambiguous');
  assert.deepEqual(r.candidates!.map(c => c.inviterId).sort(), ['11', '22']);
  assert.equal(r.inviterId, null);
});

test('the vanity link is named as that, with nobody blamed', () => {
  const r = attributeJoin(map(inv('a', 1, '11')), map(inv('a', 1, '11')), [], { before: 10, after: 11 });
  assert.equal(r.how, 'vanity');
  assert.equal(r.inviterId, null);
});

test('an account\'s age is read from its id', () => {
  // Discord's own documented example: 175928847299117063 → 2016-04-30T11:18:25.796Z.
  assert.equal(new Date(accountCreatedAt('175928847299117063')).toISOString(), '2016-04-30T11:18:25.796Z');
  assert.equal(accountCreatedAt('not a number'), 0);
  const now = Date.now();
  assert.equal(isYoung({ accountCreatedAt: now - 3 * 86_400_000, joinedAt: now }), true);
  assert.equal(isYoung({ accountCreatedAt: now - 400 * 86_400_000, joinedAt: now }), false);
});

// ---------- the stand-in Discord ----------

// A Discord id made at a given time, so a test can make a "fresh" account.
const idAt = (ms: number) => String((BigInt(ms) - 1_420_070_400_000n) << 22n);

let invites: InviteInfo[] = [];
const posted: string[] = [];
let sockets: Duplex[] = [];
let lastIdentify: { intents?: number; token?: string } | null = null;
let onIdentify: (sock: Duplex) => void = () => {};
let srv: Server;

function sendFrame(sock: Duplex, payload: unknown, opcode = 0x1) {
  const data = opcode === 0x8 ? (payload as Buffer) : Buffer.from(JSON.stringify(payload));
  const head = data.length < 126
    ? Buffer.from([0x80 | opcode, data.length])
    : Buffer.from([0x80 | opcode, 126, data.length >> 8, data.length & 255]);
  sock.write(Buffer.concat([head, data]));
}
const closeWith = (sock: Duplex, code: number) => {
  const b = Buffer.alloc(2); b.writeUInt16BE(code);
  sendFrame(sock, b, 0x8);
  setTimeout(() => sock.destroy(), 50);
};

function readFrames(sock: Duplex, onMsg: (m: { op: number; d: unknown }) => void) {
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      buf = buf.subarray(off + 4 + len);
      if (opcode === 0x1) onMsg(JSON.parse(data.toString()));
      if (opcode === 0x8) sock.end();
    }
  });
}

before(async () => {
  srv = createServer((req, res) => {
    const j = (s: number, b?: unknown) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(b === undefined ? '' : JSON.stringify(b)); };
    if (req.url === '/gateway/bot') return j(200, { url: `ws://127.0.0.1:${PORT}` });
    if (req.url === `/guilds/${GUILD}/invites`) {
      return j(200, invites.map(i => ({
        code: i.code, uses: i.uses, max_uses: i.maxUses,
        inviter: i.inviterId ? { id: i.inviterId, username: i.inviterName } : undefined,
      })));
    }
    if (req.url === `/guilds/${GUILD}/vanity-url`) return j(403, { message: 'Missing Access', code: 50001 });
    if (req.url === '/channels/audit-chan/messages' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => { posted.push(body); j(200, { id: '1' }); });
      return;
    }
    j(404, { message: 'Not Found', code: 0 });
  });
  srv.on('upgrade', (req, sock) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.push(sock);
    readFrames(sock, m => {
      if (m.op === 1) sendFrame(sock, { op: 11, d: null, s: null, t: null });
      if (m.op === 2) { lastIdentify = m.d as typeof lastIdentify; onIdentify(sock); }
    });
    sendFrame(sock, { op: 10, d: { heartbeat_interval: 30_000 }, s: null, t: null });
  });
  await new Promise<void>(r => srv.listen(PORT, '127.0.0.1', () => r()));
});

after(async () => {
  const { stopGateway } = await import('../src/discordgateway.ts');
  stopGateway();
  for (const s of sockets) s.destroy();
  srv.close();
});

const waitFor = async (cond: () => boolean, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 20));
  }
};

test('live: the bot asks for member joins, hears one, and names who invited them', async () => {
  const { startGateway, stopGateway, gatewayStatus } = await import('../src/discordgateway.ts');
  resetInviteLog();
  invites = [inv('friendly', 4, '111111111111111111'), inv('farm', 2, '222222222222222222')];
  let seq = 0;
  onIdentify = sock => sendFrame(sock, { op: 0, t: 'READY', s: ++seq, d: { session_id: 'sess', resume_gateway_url: `ws://127.0.0.1:${PORT}` } });
  startGateway();
  await waitFor(() => gatewayStatus().state === 'ready', 'ready');
  assert.ok(lastIdentify, 'it identified');
  assert.equal(lastIdentify!.token, 'test-token');
  assert.ok((lastIdentify!.intents! & (1 << 1)) !== 0, 'asks for member joins (Server Members Intent)');
  assert.ok((lastIdentify!.intents! & (1 << 6)) !== 0, 'asks for invite events');
  await waitFor(() => gatewayStatus().invitesTracked === 2, 'the invite counts');

  // A two-day-old account joins through the "farm" invite.
  const fresh = idAt(Date.now() - 2 * 86_400_000);
  invites = [inv('friendly', 4, '111111111111111111'), inv('farm', 3, '222222222222222222')];
  const sock = sockets.at(-1)!;
  sendFrame(sock, {
    op: 0, t: 'GUILD_MEMBER_ADD', s: ++seq,
    d: { guild_id: GUILD, joined_at: new Date().toISOString(), user: { id: fresh, username: 'altacct', avatar: null } },
  });
  await waitFor(() => inviteJoins().length === 1, 'the join to be logged');
  const j = inviteJoins()[0];
  assert.equal(j.memberId, fresh);
  assert.equal(j.how, 'invite');
  assert.equal(j.code, 'farm');
  assert.equal(j.inviterId, '222222222222222222');

  // A fresh account through a member's invite is posted to the audit channel.
  await waitFor(() => posted.length === 1, 'the audit post');
  assert.match(posted[0], /altacct/);
  assert.match(posted[0], /2 days old/);

  // A join in some other server the bot is in is none of this site's business.
  sendFrame(sock, {
    op: 0, t: 'GUILD_MEMBER_ADD', s: ++seq,
    d: { guild_id: '999', user: { id: idAt(Date.now()), username: 'elsewhere' } },
  });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(inviteJoins().length, 1);
  stopGateway();
});

test('live: without Server Members Intent the status says exactly which switch to turn on', async () => {
  const { startGateway, stopGateway, gatewayStatus } = await import('../src/discordgateway.ts');
  onIdentify = sock => closeWith(sock, 4014);
  startGateway();
  await waitFor(() => gatewayStatus().state === 'failed', 'the failure');
  assert.match(gatewayStatus().detail, /Server Members Intent/);
  assert.match(gatewayStatus().detail, /Developer Portal/);
  stopGateway();
});
