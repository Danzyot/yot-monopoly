// Load test: one room, host + 7 bots (8 seats, host on autopilot), N spectators.
// Measures room:state count and size (payload and on the wire), server loop
// lag (/api/health) and ack round trips while the bots play.
//
//   DEMO_MODE=1 RATE_LIMIT_OFF=1 MAX_SOCKETS_PER_IP=200 DATA_DIR=$(mktemp -d) PORT=8302 node --import tsx server/src/index.ts &
//   node tools/perf/load.mjs [--base http://localhost:8302] [--spectators 40] [--seconds 60]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const BASE = arg('base', 'http://localhost:8302');
const SPECS = Number(arg('spectators', 40));
const SECONDS = Number(arg('seconds', 60));

async function token(name) {
  const r = await fetch(`${BASE}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  const j = await r.json();
  if (!j.token) throw new Error(JSON.stringify(j));
  return j;
}
function connect(tok) {
  return new Promise((res, rej) => {
    const s = io(BASE, { auth: { token: tok }, transports: ['websocket'], reconnection: false });
    s.once('connect', () => res(s));
    s.once('connect_error', rej);
  });
}
const call = (s, ev, p = {}) => new Promise((res, rej) => s.timeout(15000).emit(ev, p, (err, r) => err ? rej(err) : r.ok ? res(r) : rej(new Error(r.error))));

const stats = { states: 0, stateBytes: 0, maxState: 0, perSocketStates: [] };
function instrument(s, idx) {
  stats.perSocketStates[idx] = 0;
  s.io.engine.on('packet', p => {
    if (p.type === 'message' && typeof p.data === 'string' && p.data.startsWith('2["room:state"')) {
      stats.states++; stats.perSocketStates[idx]++;
      stats.stateBytes += p.data.length;
      stats.maxState = Math.max(stats.maxState, p.data.length);
    }
  });
}
const wire = s => s.io.engine.transport?.ws?._socket?.bytesRead ?? 0;

const host = await token('LoadHost');
const hs = await connect(host.token);
instrument(hs, 0);
const { code } = await call(hs, 'room:create');
await call(hs, 'room:configure', { mapId: arg('map', 'classic'), rules: { maxPlayers: 8 } });
for (let i = 0; i < 7; i++) await call(hs, 'room:addBot');
await call(hs, 'room:start');
await call(hs, 'room:autopilot', { id: host.profile.id, on: true });
console.log('room', code);

const specs = [];
const toks = Array.from({ length: SPECS }, () => ({ token: null }));
const joinT0 = Date.now();
const s0 = { ...stats };
await Promise.all(toks.map(async (t, i) => {
  const s = await connect(t.token);
  instrument(s, i + 1);
  specs.push(s);
  await call(s, 'room:join', { code, watch: true });
}));
const joinStates = stats.states - s0.states, joinBytes = stats.stateBytes - s0.stateBytes;
console.log(`join phase: ${SPECS} spectators in ${Date.now() - joinT0} ms, ${joinStates} room:state msgs delivered, ${(joinBytes / 1e6).toFixed(2)} MB payload`);

// Steady state.
const all = [hs, ...specs];
const wire0 = all.reduce((a, s) => a + wire(s), 0);
const st0 = stats.states, sb0 = stats.stateBytes;
const hostStates0 = stats.perSocketStates[0];
let lagMax = 0, lagSum = 0, lagN = 0;
const rtts = [];
const t0 = Date.now();
const poll = setInterval(async () => {
  try {
    const h = await (await fetch(`${BASE}/api/health`)).json();
    lagMax = Math.max(lagMax, h.loopLagMs); lagSum += h.loopLagMs; lagN++;
  } catch {}
}, 1000);
const pinger = setInterval(async () => {
  const a = Date.now();
  try { await call(specs[0], 'rooms:list'); rtts.push(Date.now() - a); } catch {}
}, 250);
await new Promise(r => setTimeout(r, SECONDS * 1000));
clearInterval(poll); clearInterval(pinger);
const secs = (Date.now() - t0) / 1000;
const states = stats.states - st0, bytes = stats.stateBytes - sb0;
const wireBytes = all.reduce((a, s) => a + wire(s), 0) - wire0;
const hostStates = stats.perSocketStates[0] - hostStates0;
rtts.sort((a, b) => a - b);
const pct = p => rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))];
console.log(JSON.stringify({
  spectators: SPECS, seconds: secs,
  roomStatePerSec: +(hostStates / secs).toFixed(2),
  avgStateBytes: Math.round(bytes / Math.max(1, states)), maxStateBytes: stats.maxState,
  payloadKBps: +(bytes / secs / 1024).toFixed(1),
  wireKBps: +(wireBytes / secs / 1024).toFixed(1),
  wirePerStateBytes: Math.round(wireBytes / Math.max(1, states)),
  loopLagMaxMs: lagMax, loopLagAvgMs: +(lagSum / Math.max(1, lagN)).toFixed(1),
  ackRttP50: pct(0.5), ackRttP99: pct(0.99), ackRttMax: rtts[rtts.length - 1],
}, null, 1));

for (const s of all) s.disconnect();
process.exit(0);
