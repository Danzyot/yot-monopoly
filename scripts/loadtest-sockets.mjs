// 500 simultaneous websockets against a running server.
//
//   node scripts/loadtest-sockets.mjs [--url http://127.0.0.1:8080] [--clients 500]
//
// Opens every connection in one burst, holds them all open, drives a real
// tournament through them, and reports what actually happened: how many
// connected, how long it took, socket round-trip latency under load, whether
// anything dropped, and how much traffic the server pushed out.
//
// Run against a server started with RATE_LIMIT_OFF=1 and a known LUCID_SECRET:
//
//   LUCID_SECRET=loadtest RATE_LIMIT_OFF=1 npm run dev -w server
//   LUCID_SECRET=loadtest npm run loadtest
//
// Discord is the only way into this site, and a load test cannot complete five
// hundred OAuth round trips, so the identities are signed here with the
// server's own scheme against a shared secret. They are exactly the tokens a
// real sign-in mints — no test-only door is left in the app itself.
import { createHmac } from 'node:crypto';
import { io } from 'socket.io-client';

const SECRET = process.env.LUCID_SECRET;
if (!SECRET) {
  console.error('Set LUCID_SECRET to the same value the server is running with.');
  process.exit(1);
}
const b64 = buf => Buffer.from(buf).toString('base64url');
function mintToken(id, name, isAdmin = false) {
  const payload = b64(JSON.stringify({
    id, name, avatar: '\u{1F916}', provider: 'discord', isAdmin,
    discord: { id: String(Math.abs(hash(id))), username: name },
    iat: Date.now(),
  }));
  return `${payload}.${b64(createHmac('sha256', SECRET).update(payload).digest())}`;
}
const hash = str => {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
};

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const BASE = arg('url', 'http://127.0.0.1:8080');
const CLIENTS = Number(arg('clients', 500));
const HOLD_MS = Number(arg('hold', 60_000));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => {
  if (!a.length) return 0;
  const x = [...a].sort((m, n) => m - n);
  return x[Math.min(x.length - 1, Math.floor(x.length * p))];
};

async function api(path, opts = {}, token) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${body.error ?? res.status}`);
  return body;
}

async function main() {
  console.log(`Opening ${CLIENTS} simultaneous websockets against ${BASE}\n`);

  const host = { token: mintToken('dc_loadhost', 'LoadHost', true) };

  // Mint every identity up front so the burst is pure websocket work.
  const tokens = [];
  for (let i = 0; i < CLIENTS; i++) tokens.push(mintToken(`dc_load${i}`, `Load${i}`));

  const stats = {
    connected: 0, failed: 0, disconnects: 0, reconnects: 0,
    events: 0, connectMs: [],
  };
  const socks = [];
  const t0 = Date.now();

  // One burst — no stagger. This is the thundering herd on purpose.
  await Promise.all(tokens.map(token => new Promise(resolve => {
    const started = Date.now();
    const sock = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: true });
    let first = true;
    sock.on('connect', () => {
      if (first) {
        first = false;
        stats.connected++;
        stats.connectMs.push(Date.now() - started);
        resolve();
      } else {
        stats.reconnects++;
      }
    });
    sock.on('disconnect', () => { stats.disconnects++; });
    sock.on('connect_error', () => {
      if (first) { first = false; stats.failed++; resolve(); }
    });
    // Count everything the server pushes, to size the outbound traffic.
    sock.onAny(() => { stats.events++; });
    socks.push(sock);
    setTimeout(resolve, 30_000); // never hang the run on one bad socket
  })));

  const connectElapsed = Date.now() - t0;
  const live = () => socks.filter(s => s.connected).length;
  console.log(`connected ${stats.connected}/${CLIENTS} in ${connectElapsed}ms ` +
    `(failed ${stats.failed})`);
  console.log(`connect time  p50 ${pct(stats.connectMs, .5)}ms  ` +
    `p95 ${pct(stats.connectMs, .95)}ms  max ${Math.max(...stats.connectMs, 0)}ms`);
  console.log(`concurrently open right now: ${live()}`);

  const health0 = await api('/api/health');
  console.log(`server sees ${health0.connections} connections, rss ${health0.rssMb}MB\n`);

  // Put real traffic through them: every client registers and plays.
  const { id: tid } = await api('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({
      name: `Socket load ${CLIENTS}`, startingStack: 10_000, levelMinutes: 3,
      structure: 'turbo', maxPlayers: 1000, minPlayers: 2, lateRegMinutes: 0,
      approveRegistrations: false, breakEveryLevels: 0, seatsPerTable: 9, maxReentries: 0,
    }),
  }, host.token);

  const tableOf = new Map();
  socks.forEach((sock, i) => {
    sock.on('tourney:assigned', ({ tableId }) => {
      const prev = tableOf.get(i);
      if (prev && prev !== tableId) sock.emit('table:leave', prev);
      tableOf.set(i, tableId);
      sock.emit('table:join', tableId);
    });
    sock.on('table:state', v => {
      if (!v.myLegal || v.id !== tableOf.get(i)) return;
      const l = v.myLegal;
      const r = Math.random();
      const move = r < 0.12 && l.canRaise ? { type: 'allin', amount: l.maxRaiseTo }
        : l.canCheck ? { type: 'check' }
        : r < 0.6 ? { type: 'call' }
        : { type: 'fold' };
      setTimeout(() => sock.emit('table:action', { tableId: v.id, ...move }), 200 + Math.random() * 800);
    });
    sock.emit('tourney:sub', tid);
    sock.emit('tourney:register', tid);
  });

  await sleep(4000);
  const reg = await api(`/api/lobby`);
  console.log(`registered via sockets: ${reg.tournaments.find(t => t.id === tid)?.players ?? '?'}`);
  socks[0].emit('tourney:start', tid); // any client can ask; only the host is obeyed
  await api(`/api/health`);
  const startSock = io(BASE, { auth: { token: host.token }, transports: ['websocket'] });
  await sleep(500);
  startSock.emit('tourney:start', tid);
  await sleep(3000);

  // ---- sustained measurement while all 500 stay connected ----
  const rtt = [];
  const lag = [];
  let lastLag = Date.now();
  const lagTimer = setInterval(() => {
    const n = Date.now(); lag.push(n - lastLag - 100); lastLag = n;
  }, 100);
  const eventsAtStart = stats.events;
  const holdStart = Date.now();

  while (Date.now() - holdStart < HOLD_MS) {
    // Probe from a handful of random clients, not just one.
    await Promise.all(Array.from({ length: 5 }, () => new Promise(resolve => {
      const sock = socks[Math.floor(Math.random() * socks.length)];
      if (!sock.connected) return resolve();
      const s = Date.now();
      const timer = setTimeout(resolve, 5000);
      sock.emit('net:ping', () => { clearTimeout(timer); rtt.push(Date.now() - s); resolve(); });
    })));
    await sleep(700);
  }
  clearInterval(lagTimer);

  const heldSec = (Date.now() - holdStart) / 1000;
  const health = await api('/api/health');
  const integrity = await api('/api/admin/integrity', {}, host.token).catch(() => null);

  console.log(`\n--- held ${live()} sockets open for ${Math.round(heldSec)}s ---`);
  console.log(`socket RTT    p50 ${pct(rtt, .5)}ms  p95 ${pct(rtt, .95)}ms  max ${Math.max(...rtt, 0)}ms  (${rtt.length} probes)`);
  console.log(`loop lag      p50 ${pct(lag, .5)}ms  p95 ${pct(lag, .95)}ms  max ${Math.max(...lag, 0)}ms`);
  console.log(`events pushed to clients: ${stats.events - eventsAtStart} ` +
    `(${Math.round((stats.events - eventsAtStart) / heldSec)}/s across all sockets)`);
  console.log(`unexpected disconnects: ${stats.disconnects}, reconnects: ${stats.reconnects}`);
  console.log(`server: ${health.connections} connections, ${health.tables} tables, ` +
    `${health.playersInPlay} in play, rss ${health.rssMb}MB`);
  if (integrity) {
    const r = integrity.tournaments[0];
    console.log(`integrity: ok=${integrity.ok}` +
      (r ? ` alive=${r.alive} tables=${r.tables} spread=${r.spread} seatless=${r.seatless.length} dup=${r.duplicated.length}` : ''));
  }

  const verdict = stats.connected === CLIENTS && stats.disconnects === 0 && (integrity?.ok !== false);
  console.log(`\n${verdict ? 'PASS' : 'CHECK THE WARNINGS ABOVE'}`);

  for (const s of socks) s.close();
  startSock.close();
  process.exit(verdict ? 0 : 1);
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });
