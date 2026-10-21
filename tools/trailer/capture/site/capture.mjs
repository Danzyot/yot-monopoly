// Frame-sequence captures of the local Chog Games site for the trailer.
//   node capture.mjs [home hub poker-lobby poker-table cards-table monopoly-game dailies-phone home-phone]
// Needs servers.sh to have started the hub (8611) and poker (8612). Every page runs on a frozen
// clock: each frame advances page time (timers, animation frames, CSS animations) by exactly
// 1/24 s, so motion is even however long a screenshot takes. Frames go to OUT/<name>/0000.png...
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { launch, ctx, BASE, POKER, OUT, S, sleep, freeze, step, waitScene, asYot, ease, easeSine } from './lib.mjs';

const CAP = new URL('.', import.meta.url).pathname;
const FPS = 24;
const ALL = ['home', 'hub', 'poker-lobby', 'poker-table', 'cards-table', 'monopoly-game', 'dailies-phone', 'home-phone'];
const want = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Record `n` frames: before each, `before(i)` may scroll, move the mouse or click; then time moves 1/24 s. */
async function record(p, name, n, before = async () => {}, { still = 0 } = {}) {
  const dir = `${OUT}/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await before(i);
    await step(p);
    await p.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.png` });
    if (i % 12 === 11) log(name, `${i + 1}/${n}`, `${((Date.now() - t0) / (i + 1) / 1000).toFixed(2)} s/frame`);
  }
  copyFileSync(`${dir}/${String(Math.min(n - 1, still)).padStart(4, '0')}.png`, `${OUT}/${name}.png`);
  const errs = p.errors.filter(e => !/ERR_CERT|ERR_NAME|net::ERR_/.test(e));
  if (errs.length) log(name, 'page errors:', errs.slice(0, 5).join(' | '));
  log(name, 'done', n, 'frames');
}
const scrollTo = (p, y) => p.evaluate(y => window.scrollTo(0, y), Math.round(y));
const lerp = (a, b, t) => a + (b - a) * t;
/** Eased value over frames [a, b]. */
const span = (i, a, b, f = ease) => f(Math.min(1, Math.max(0, (i - a) / (b - a))));
async function settle(p, ms = 2500) {
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.evaluate(() => Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r; })))).catch(() => {});
  await p.evaluate(() => document.fonts.ready).catch(() => {});
  await sleep(ms);
}
const top = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + scrollY : null; }, sel);
const bottom = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().bottom + scrollY : null; }, sel);
const maxScroll = p => p.evaluate(() => document.documentElement.scrollHeight - innerHeight);

const seqs = {
  // The hub's hero for a second, then an eased scroll down through the game cards.
  async home(b) {
    const p = await ctx(b); await asYot(p);
    await p.goto(BASE + '/'); await settle(p, 3500);
    await p.mouse.move(1900, 1070);
    await freeze(p);
    for (let k = 0; k < 6; k++) await step(p);
    const end = Math.min(await maxScroll(p), (await bottom(p, '.hub-dailies')) - 1080 * 0.6);
    await record(p, 'home', 5 * FPS, async i => { await scrollTo(p, lerp(0, end, span(i, 24, 5 * FPS - 1))); }, { still: 0 });
    await p.context().close();
  },
  // The three game cards, scrolled into view, a gentle drift while the pointer hovers along them.
  async hub(b) {
    const p = await ctx(b); await asYot(p);
    await p.goto(BASE + '/'); await settle(p, 3000);
    const y0 = (await top(p, '.hub-games')) - 230;
    await scrollTo(p, y0);
    const cards = await p.$$eval('.hub-game', els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.35 }; }));
    await p.mouse.move(cards[0].x - 260, cards[0].y + 40);
    await freeze(p);
    for (let k = 0; k < 6; k++) await step(p);
    const n = 3 * FPS;
    await record(p, 'hub', n, async i => {
      await scrollTo(p, y0 + 70 * span(i, 0, n - 1, easeSine));
      const drift = 70 * span(i, 0, n - 1, easeSine);
      // Pointer: onto Monopoly, across to Cards, on to Poker.
      const t = span(i, 6, n - 6, easeSine) * 2;
      const a = cards[Math.min(2, Math.floor(t))], c = cards[Math.min(2, Math.floor(t) + 1)];
      const f = t >= 2 ? 1 : ease(t - Math.floor(t));
      const enter = span(i, 0, 10);
      const x = lerp(cards[0].x - 260, lerp(a.x, c.x, f), enter), y = lerp(cards[0].y + 40, lerp(a.y, c.y, f), enter) - drift;
      await p.mouse.move(x, y);
    }, { still: Math.round(n * 0.2) });
    await p.context().close();
  },
  // Poker's home on the hub: live, upcoming and finished tournaments from the poker site.
  async 'poker-lobby'(b) {
    // Start the showcase table now so it is live in the list (and dealt by the time the table is shot).
    const st = JSON.parse(readFileSync(CAP + 'poker-state.json'));
    if (!st.showTable) writeFileSync(CAP + 'poker-go', '1');
    const p = await ctx(b); await asYot(p);
    await sleep(2500);
    await p.goto(BASE + '/poker'); await settle(p, 3500);
    await p.waitForSelector('text=Live now', { timeout: 30000 }).catch(() => log('poker-lobby: no Live now list'));
    await p.mouse.move(1900, 1070);
    await freeze(p);
    for (let k = 0; k < 6; k++) await step(p);
    const end = Math.min(await maxScroll(p), 470);
    const n = 3 * FPS;
    await record(p, 'poker-lobby', n, async i => { await scrollTo(p, lerp(0, end, span(i, 8, n - 1))); }, { still: n - 1 });
    await p.context().close();
  },
  // A hand at the Chog Club Sit & Go, Yot seated with five others; the table paced to the frame rate.
  async 'poker-table'(b) {
    let st = JSON.parse(readFileSync(CAP + 'poker-state.json'));
    if (!st.showTable) writeFileSync(CAP + 'poker-go', '1');
    for (let i = 0; i < 120 && !st.showTable; i++) { await sleep(500); st = JSON.parse(readFileSync(CAP + 'poker-state.json')); }
    const p = await ctx(b);
    await p.goto(POKER + '/#dtoken=' + encodeURIComponent(st.heroToken)); await settle(p, 1000);
    await p.goto(POKER + '/table/' + st.showTable); await settle(p, 1500);
    // Until the deal (the seating grace), then into a fresh hand's flop.
    log('poker-table: waiting for a deal');
    await p.waitForFunction(() => /Hand #\d+/.test(document.body.innerText), null, { timeout: 180000 });
    // The hand log in the side panel rather than an empty chat.
    await p.click('button:text-is("Hands")', { timeout: 5000 }).catch(() => log('poker: no Hands tab'));
    // Into a hand with the flop out, so the board has cards and the pot has chips.
    const street = () => p.evaluate(() => /\b(FLOP|TURN)\b/.test(document.body.innerText));
    for (let i = 0; i < 240 && !(await street()); i++) await sleep(500);
    await p.mouse.move(1900, 1070);
    // Pace: measure a frame, then have the players act every ~0.7-1.2 s of video.
    await freeze(p);
    for (let j = 0; j < 3; j++) { await step(p); await p.screenshot(); }
    const t = Date.now();
    for (let j = 0; j < 6; j++) { await step(p); await p.screenshot(); }
    const real = (Date.now() - t) / 6;
    const k = real / (1000 / FPS);
    writeFileSync(CAP + 'poker-speed', `${Math.round(700 * k)},${Math.round(1200 * k)}`);
    log('poker-table: frame', real.toFixed(0), 'ms real, bots paced at', readFileSync(CAP + 'poker-speed', 'utf8'));
    for (let j = 0; j < 12; j++) await step(p);
    const n = 4 * FPS;
    await record(p, 'poker-table', n, async () => {}, { still: Math.round(n * 0.75) });
    writeFileSync(CAP + 'poker-speed', '1400,2600');
    await p.context().close();
  },
  // Chog Cards against four bots: Yot plays a card, the bots answer.
  async 'cards-table'(b) {
    const p = await ctx(b); await asYot(p);
    await p.goto(BASE + '/cards'); await settle(p, 1500);
    await p.click('button.btn.primary.big');
    await p.waitForURL(/\/cards\/r\//);
    await p.waitForSelector('text=+ Add bot');
    await p.selectOption('label:has(span:text-is("Turn timer")) select', '0').catch(e => log('cards: timer', e.message));
    for (let i = 0; i < 4; i++) { await p.click('text=+ Add bot'); await sleep(800); }
    await sleep(1000);
    await p.click('text=Deal!');
    log('cards: waiting for the 3D table');
    await sleep(5000);
    // The characters and the room behind them (the felt in the middle is too plain to tell by).
    await waitScene(p, { x: 400, y: 120, w: 1100, h: 300, min: 25000, max: 600000 });
    // Our turn with something to play (bots wait for us: no turn timer).
    await p.waitForFunction(() => [...document.querySelectorAll('[aria-label$=", playable"]')].length > 0, null, { timeout: 300000 });
    await sleep(8000);
    await p.mouse.move(1900, 700);
    await freeze(p);
    for (let k = 0; k < 8; k++) await step(p);
    const n = 3 * FPS;
    await record(p, 'cards-table', n, async i => {
      if (i !== 10) return;
      const pick = await p.evaluate(() => {
        const els = [...document.querySelectorAll('[aria-label$=", playable"]')];
        const e = els.find(x => !/wild/i.test(x.getAttribute('aria-label'))) || els[0];
        if (!e) return null;
        e.setAttribute('data-cap-pick', '1');
        return e.getAttribute('aria-label');
      });
      log('cards: playing', pick);
      if (pick) await p.click('[data-cap-pick="1"]', { force: true, noWaitAfter: true, timeout: 10000 }).catch(e => log('cards click', e.message));
    }, { still: 40 });
    await p.context().close();
  },
  // Monopoly against three bots: Yot rolls, the dice tumble, the camera swoops in.
  async 'monopoly-game'(b) {
    const p = await ctx(b); await asYot(p);
    await p.goto(BASE + '/monopoly'); await settle(p, 1500);
    await p.click('button.mono-play');
    await p.waitForURL(/\/r\//);
    await p.waitForSelector('text=+ Add bot');
    for (let i = 0; i < 3; i++) { await p.click('text=+ Add bot'); await sleep(800); }
    await p.click('button[aria-controls="rules-body"]').catch(() => {});
    await sleep(500);
    await p.selectOption('label:has(span:text-is("Turn timer")) select', '0').catch(e => log('mono: timer', e.message));
    await sleep(800);
    await p.click('text=Start Game!');
    log('monopoly: waiting for our roll and the 3D board');
    await p.waitForSelector('text=Roll dice', { timeout: 400000 });
    await waitScene(p, { max: 400000 });
    await sleep(6000);
    await p.waitForSelector('text=Roll dice', { timeout: 400000 });
    await p.mouse.move(1900, 700);
    await freeze(p);
    for (let k = 0; k < 8; k++) await step(p);
    const n = 80;
    await record(p, 'monopoly-game', n, async i => {
      if (i === 6) await p.click('text=Roll dice', { force: true, noWaitAfter: true, timeout: 10000 }).catch(e => log('roll', e.message));
    }, { still: 30 });
    await p.context().close();
  },
  // The dailies on a phone: today's three, Yot's results and streak, the top three; a slow scroll.
  async 'dailies-phone'(b) {
    const p = await ctx(b, { phone: true }); await asYot(p);
    await p.goto(BASE + '/daily'); await settle(p, 3500);
    await freeze(p);
    for (let k = 0; k < 6; k++) await step(p);
    const end = Math.min(await maxScroll(p), (await bottom(p, '.dl-tiles')) + 20 - 844);
    const n = 4 * FPS;
    await record(p, 'dailies-phone', n, async i => { await scrollTo(p, lerp(0, end, span(i, 16, n - 1))); }, { still: 0 });
    await p.context().close();
  },
  // The hub on a phone: hero, then down to the game cards.
  async 'home-phone'(b) {
    const p = await ctx(b, { phone: true }); await asYot(p);
    await p.goto(BASE + '/'); await settle(p, 3500);
    await freeze(p);
    for (let k = 0; k < 6; k++) await step(p);
    const end = Math.min(await maxScroll(p), (await top(p, '.hub-cards')) - 70);
    const n = 3 * FPS;
    await record(p, 'home-phone', n, async i => { await scrollTo(p, lerp(0, end, span(i, 14, n - 1))); }, { still: 0 });
    await p.context().close();
  },
};

const b = await launch(true);
for (const name of want) {
  if (!seqs[name]) { log('unknown sequence', name); continue; }
  log('==', name);
  try { await seqs[name](b); } catch (e) { log(name, 'FAILED', e.message); }
}
await b.close();
