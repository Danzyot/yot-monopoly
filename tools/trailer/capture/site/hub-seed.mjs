// Puts some life on the local hub (8611): Monopoly and Cards tables open and playing, hosted by
// demo players and filled with the server's own bots, so the home page shows live table counts.
import { createRequire } from 'node:module';
const { io } = createRequire('/home/user/yot-monopoly/server/package.json')('socket.io-client');
const BASE = 'http://127.0.0.1:8611';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function login(name) {
  const r = await fetch(BASE + '/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  const b = await r.json(); if (!r.ok) throw new Error(JSON.stringify(b)); return b.token;
}
const call = (s, ev, p = {}) => new Promise(res => s.emit(ev, p, res));
async function sock(name) {
  const token = await login(name);
  const s = io(BASE, { auth: { token }, transports: ['websocket'] });
  await new Promise(r => s.on('connect', r));
  return s;
}
const plan = [
  ['Lil Chog', 'mono', 3, true], ['Chogzilla', 'mono', 4, true], ['Monad Mike', 'mono', 1, false],
  ['Chogfather', 'cards', 3, true], ['NeonNina', 'cards', 5, true], ['RiverRat', 'cards', 2, false],
];
for (const [name, game, bots, start] of plan) {
  const s = await sock(name);
  const pre = game === 'mono' ? 'room' : 'cards';
  const c = await call(s, `${pre}:create`);
  if (game === 'cards') await call(s, 'cards:configure', { rules: { match: 'points', targetScore: 500 } });
  for (let i = 0; i < bots; i++) await call(s, `${pre}:addBot`, {});
  if (start) await call(s, `${pre}:start`);
  console.log(name, game, c.code, start ? 'started' : 'lobby');
  await sleep(300);
}
setInterval(() => {}, 1 << 30);
