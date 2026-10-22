// Seeds the local poker (port 8612, CHOG_SECRET=trailercap) with a lobby's worth of
// tournaments and keeps bot players connected and playing. Prints the hero token and
// the showcase table id to poker-state.json. Runs until killed.
import { createHmac } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { io } = createRequire('/home/user/yot-monopoly/poker/package.json')('socket.io-client');
const BASE = 'http://127.0.0.1:8612';
const SECRET = 'trailercap';
const b64 = buf => Buffer.from(buf).toString('base64url');
const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
function mint(id, name, avatar) {
  const payload = b64(JSON.stringify({ id, name, avatar, provider: 'discord', discord: { id: String(100000000000 + hash(id)), username: name.toLowerCase().replace(/\W/g, '') }, iat: Date.now() }));
  return `${payload}.${b64(createHmac('sha256', SECRET).update(payload).digest())}`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, opts = {}, token) {
  const r = await fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: ${body.error ?? r.status}`);
  return body;
}
const NAMES = ['Lil Chog', 'Chogzilla', 'Monad Mike', 'Chogfather', 'PurpleRain', 'Spiky', 'Merlot', 'Cosmo', 'Whiskers', 'Sir Deed', 'Captain Cash', 'Zorp',
  'Shade', 'Chef Gusto', 'NeonNina', 'RiverRat', 'BluffDaddy', 'AceOfChogs', 'Kitty Kicker', 'Big Blind Bo', 'Nutz', 'TiltProof', 'ChipLeader', 'Gm Gary',
  'Rugpull Rick', 'MoonBag', 'Pocket Kings', 'Lady Luck', 'Dealer Dan', 'Snap Call', 'Turbo Tom', 'Felt Queen', 'Straddle', 'Sharky', 'Runner', 'Wawa Will'];
const AV = ['🐸', '🦄', '🐙', '🦊', '🐼', '🐯', '🐵', '🦁', '🐨', '🐻', '🐧', '👾', '🤖', '🍕', '🌶️', '💜', '🎩', '🍀', '🔥', '⚡'];
const players = NAMES.map((n, i) => ({ id: `dc_trailer_${i}`, name: n, token: mint(`dc_trailer_${i}`, n, AV[i % AV.length]) }));
const host = { id: 'dc_trailer_host', name: 'Chog Club', token: mint('dc_trailer_host', 'Chog Club', '💜') };
const hero = { id: 'dc_trailer_yot', name: 'ChogFan', token: mint('dc_trailer_yot', 'ChogFan', '😎') };

function connect(p) {
  return new Promise(res => {
    const s = io(BASE, { auth: { token: p.token }, transports: ['websocket'] });
    s.on('connect', () => res(s));
    s.on('connect_error', e => { console.error('connect_error', p.name, e.message); res(s); });
  });
}
// A player who plays a believable, slow-ish game: mostly checks and calls, some raises, few folds.
function play(s, style = 'normal', speed = [900, 2200]) {
  const tableOf = new Set();
  s.on('tourney:assigned', ({ tableId }) => { if (!tableOf.has(tableId)) { tableOf.add(tableId); s.emit('table:join', tableId); } });
  let lastKey = '';
  const raisedHand = new Set();
  s.on('table:state', v => {
    if (!v.myLegal) return;
    const key = `${v.id}:${v.handNumber}:${v.street}:${v.actionStarted}`;
    if (key === lastKey) return; lastKey = key;
    const l = v.myLegal; const r = Math.random();
    const me = v.seats?.[l.seat]; const stack = me?.stack ?? 10000;
    let move;
    if (style === 'shove') move = l.canRaise ? { type: 'allin', amount: l.maxRaiseTo } : { type: 'call' };
    else if (l.toCall === 0) {
      const hk = `${v.handNumber}:${v.street}`;
      if (l.canRaise && r < 0.3 && !raisedHand.has(hk)) {
        raisedHand.add(hk);
        const want = Math.round((l.myBet + Math.max(l.pot, 100) * (0.4 + Math.random() * 0.3)) / 50) * 50;
        move = { type: 'raise', amount: Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, want), l.myBet + Math.floor(stack * 0.2)) };
        if (move.amount < l.minRaiseTo) move = { type: 'check' };
      } else move = { type: 'check' };
    } else if (l.toCall > stack * 0.25 || (l.toCall > l.pot * 0.6 && r < 0.4)) move = { type: 'fold' };
    else move = { type: 'call' };
    const sp = typeof speed === 'function' ? speed() : speed;
    setTimeout(() => s.emit('table:action', { tableId: v.id, ...move }), sp[0] + Math.random() * (sp[1] - sp[0]));
  });
  return s;
}
async function tourney(cfg) {
  const { id } = await api('/api/tournaments', { method: 'POST', body: JSON.stringify({
    startingStack: 10000, levelMinutes: 20, structure: 'regular', minPlayers: 2, lateRegMinutes: 30,
    approveRegistrations: false, breakEveryLevels: 0, seatsPerTable: 6, maxReentries: 0, actionSeconds: 30, ...cfg }) }, host.token);
  return id;
}
async function register(sockets, tid) { for (const s of sockets) { s.emit('tourney:sub', tid); s.emit('tourney:register', tid); } await sleep(1500); }

const hostSock = await connect(host);
const now = Date.now();
// Upcoming events with people registered.
const up1 = await tourney({ name: 'Friday Night Chog Showdown', scheduledStart: Date.parse('2026-10-24T00:00:00Z'), maxPlayers: 120, startingStack: 20000 });
const up2 = await tourney({ name: 'Purple Hour Deepstack', scheduledStart: Date.parse('2026-10-23T01:00:00Z'), structure: 'deep', startingStack: 30000 });
const up3 = await tourney({ name: 'Sunday Chog Classic', scheduledStart: Date.parse('2026-10-25T22:00:00Z') });
const socks = [];
for (const p of players) socks.push(await connect(p));
await register(socks.slice(0, 27), up1);
await register(socks.slice(9, 21), up2);
await register(socks.slice(20, 28), up3);

// Two quick finished events for the results list (bots shove until one is left).
for (const [name, grp] of [['Chog Club Turbo #41', socks.slice(28, 31)], ['Late Night Chogs', socks.slice(31, 34)]]) {
  const tid = await tourney({ name, structure: 'turbo', levelMinutes: 1, startingStack: 1000, lateRegMinutes: 0, actionSeconds: 5 });
  grp.forEach(s => play(s, 'shove', [100, 300]));
  await register(grp, tid);
  hostSock.emit('tourney:start', tid);
  await sleep(800); grp.forEach(s => s.emit('tourney:join', tid));
}

// A running multi-table event (bots only) and the showcase table with the hero.
const live = await tourney({ name: 'Chog Weekly Freeroll', seatsPerTable: 6, lateRegMinutes: 60 });
const liveGrp = socks.slice(0, 12);
liveGrp.forEach(s => play(s, 'normal', [1500, 4000]));
await register(liveGrp, live);
hostSock.emit('tourney:start', live);
await sleep(800); liveGrp.forEach(s => s.emit('tourney:join', live));

const show = await tourney({ name: 'Chog Club Sit & Go', seatsPerTable: 6, lateRegMinutes: 0, levelMinutes: 30, startingStack: 10000 });
const heroSock = await connect(hero);
const showGrp = [heroSock, ...socks.slice(12, 17)];
// The showcase pace comes from the capture script (env SHOW_SPEED); default steady.
// The capture script writes poker-speed ("min,max" ms) to pace the table to its frame rate.
const speedFile = new URL('./poker-speed', import.meta.url);
const speed = () => { try { return readFileSync(speedFile, 'utf8').trim().split(',').map(Number); } catch { return [1400, 2600]; } };
showGrp.forEach(s => play(s, 'normal', speed));
let showTable = null;
heroSock.on('tourney:assigned', ({ tableId }) => { showTable = tableId; });
await register(showGrp, show);
// Hold the start until the capture script asks for it (touch poker-go), so the browser sees the deal.
const state = { heroToken: hero.token, show, live, up1, up2, up3, showTable: null };
writeFileSync(new URL('./poker-state.json', import.meta.url), JSON.stringify(state, null, 1));
console.log('seeded', state);
const { existsSync, rmSync } = await import('node:fs');
const go = new URL('./poker-go', import.meta.url);
while (!existsSync(go)) await sleep(500);
rmSync(go);
hostSock.emit('tourney:start', show);
await sleep(800); showGrp.forEach(s => s.emit('tourney:join', show));
for (let i = 0; i < 40 && !showTable; i++) await sleep(250);
state.showTable = showTable;
writeFileSync(new URL('./poker-state.json', import.meta.url), JSON.stringify(state, null, 1));
console.log('show table', showTable);
setInterval(() => {}, 1 << 30);
