// Before the hub (8611) starts on a fresh data dir: a fixed session secret (so the capture can sign
// in as "ChogFan" with a stable id) and today's (and any earlier) daily results for a crowd of players,
// ChogFan included, so the dailies page reads like a live site. Usage: node main-seed.mjs <dataDir>
// Prints nothing; token() is exported for the capture scripts.
import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const SECRET = Buffer.from('chog-trailer-capture-secret-0001');
const b64 = b => Buffer.from(b).toString('base64url');
export function token(id, name, avatar = '😎') {
  const payload = b64(JSON.stringify({ id, name, avatar, provider: 'demo', iat: Date.now() }));
  return `${payload}.${b64(createHmac('sha256', SECRET).update(payload).digest())}`;
}
export const YOT = { id: 'demo_yot_trailer', name: 'ChogFan', avatar: '😎' };
const EPOCH = Date.parse('2026-10-21T00:00:00Z');
function seed(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'secret.key'), SECRET);
  const now = Date.now();
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  const days = [];
  for (let t = Math.max(EPOCH, today - 6 * 864e5); t <= today; t += 864e5) days.push(t);
  const crowd = ['Lil Chog', 'Chogzilla', 'Monad Mike', 'Chogfather', 'NeonNina', 'RiverRat', 'BluffDaddy', 'Spiky', 'Merlot', 'Cosmo',
    'Whiskers', 'Sir Deed', 'Captain Cash', 'Felt Queen', 'Snap Call', 'MoonBag', 'Lady Luck', 'Turbo Tom', 'Kitty Kicker', 'Gm Gary']
    .map((n, i) => ({ id: `demo_crowd_${i}`, name: n, avatar: ['🐸', '🦄', '🐙', '🦊', '🐼', '🐯', '🐵', '🦁', '🐨', '🐻'][i % 10] }));
  let rnd = 7; const R = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const pick = a => a[Math.floor(R() * a.length)];
  const mono = [], cards = [], poker = [];
  for (const d of days) {
    const date = new Date(d).toISOString().slice(0, 10);
    const isToday = d === today;
    // How far into the day we are: earlier days had everyone, today a fair share so far.
    const span = isToday ? Math.max(30 * 60e3, now - d - 5 * 60e3) : 20 * 3600e3;
    const people = crowd.filter(() => R() < (isToday ? 0.75 : 0.6));
    for (const p of [YOT, ...people]) {
      const start = d + 5 * 60e3 + Math.floor(R() * span * 0.9);
      // Monopoly: 20 turns against three bots.
      const won = p === YOT || R() < 0.25;
      mono.push({ date, id: p.id, name: p.name, avatar: p.avatar, code: 'DLY' + Math.floor(R() * 90 + 10), startedAt: start, endedAt: start + 9 * 60e3 + Math.floor(R() * 8 * 60e3),
        result: won ? { won: true, turns: 12 + Math.floor(R() * 8), netWorth: 2400 + Math.floor(R() * 2200), place: 1, botsOut: 3 }
          : { won: false, turns: 20, netWorth: 900 + Math.floor(R() * 2600), place: 1 + Math.floor(R() * 4), botsOut: Math.floor(R() * 3) } });
      // Cards: one deal.
      const cw = p === YOT || R() < 0.45;
      cards.push({ date, id: p.id, name: p.name, avatar: p.avatar, code: 'DLC' + Math.floor(R() * 90 + 10), startedAt: start + 3600e3 * 0.3, endedAt: start + 3600e3 * 0.3 + 4 * 60e3,
        result: cw ? { won: true, turns: 7 + Math.floor(R() * 7), points: 40 + Math.floor(R() * 160), handPoints: 0, cards: 0, oppCards: 8 + Math.floor(R() * 14) }
          : { won: false, turns: 9 + Math.floor(R() * 6), points: 0, handPoints: 5 + Math.floor(R() * 60), cards: 1 + Math.floor(R() * 5), oppCards: 4 + Math.floor(R() * 12) } });
      // Poker: ten hands, 0-10 points each.
      const skill = p === YOT ? 0.97 : 0.45 + R() * 0.5;
      const answers = Array.from({ length: 10 }, () => ({ choice: pick(['fold', 'call', 'raise']), points: R() < skill ? 10 : pick([0, 3, 6, 8]), ms: 3000 + Math.floor(R() * 14000) }));
      const pend = start + 2 * 3600e3 + answers.reduce((s, a) => s + a.ms + 4000, 0);
      if (pend < now) poker.push({ date, id: p.id, name: p.name, avatar: p.avatar, startedAt: start + 2 * 3600e3, endedAt: pend, answers, servedAt: null });
    }
  }
  const salt = () => randomBytes(24).toString('hex');
  writeFileSync(join(dir, 'monopoly-daily.json'), JSON.stringify({ salt: salt(), attempts: mono }));
  writeFileSync(join(dir, 'cards-daily.json'), JSON.stringify({ salt: salt(), attempts: cards }));
  writeFileSync(join(dir, 'poker-daily.json'), JSON.stringify({ salt: salt(), runs: poker }));
}
if (process.argv[2]) seed(process.argv[2]);
