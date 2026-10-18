// Smoke test: play a few bot games in a real browser and look for trouble.
//
// For every board × theme it signs in (DEMO_MODE), creates a table, adds bots,
// starts, plays the given number of rounds (rolling, buying, ending turns,
// dropping out of auctions, tapping through mini-games), cycles the camera
// views and screenshots each one. It fails on any page error or console
// error, and prints the renderer's draw-call and triangle counts.
//
//   DEMO_MODE=1 DATA_DIR=$(mktemp -d) PORT=8090 node --import tsx server/src/index.ts &
//   node tools/e2e/smoke.mjs [--base http://localhost:8090] [--rounds 12] [--out /tmp/smoke]
//                            [--maps Classic,Speedway] [--editions Original,Chog] [--phone]
//
// Needs Playwright with Chromium: `npm i -g playwright && npx playwright install chromium`.
// Software GL works (slowly): the script already passes the flags for it.

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const BASE = arg('base', 'http://localhost:8090');
const ROUNDS = Number(arg('rounds', 12));
const OUT = arg('out', '/tmp/yot-smoke');
const MAPS = arg('maps', 'Classic,Speedway,Metropolis').split(',');
const EDITIONS = arg('editions', 'Original,Takeprofit,Chog').split(',');
const PHONE = process.argv.includes('--phone');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const viewport = PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } };
let failures = 0;

for (const map of MAPS) {
  for (const edition of EDITIONS) {
    const tag = `${map}-${edition}${PHONE ? '-phone' : ''}`;
    const page = await (await browser.newContext(viewport)).newPage();
    // Software GL on a busy box renders at a frame a second: give every click and wait room.
    page.setDefaultTimeout(90_000);
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
    try {
      await page.goto(`${BASE}/`);
      await page.click('text=Sign In to Play');
      await page.fill('input[placeholder="Your name"]', 'Smoke');
      await page.click('.modal button:has-text("Play")');
      await page.waitForSelector('text=Sign out');
      await page.click('text=Create Game');
      await page.waitForURL(/\/r\//, { waitUntil: 'commit' });
      await page.waitForTimeout(4000);
      await page.click(`button.map-card:has-text("${map}")`);
      await page.click(`button.bp-theme:has-text("${edition}")`);
      await page.click('text=+ Add bot');
      await page.click('text=+ Add bot');
      await page.click('text=Start Game');
      await page.waitForSelector('.actionbar');
      await page.goto(page.url() + '?perf');
      await page.waitForSelector('.actionbar');

      for (let r = 0; r < ROUNDS; r++) {
        for (const label of ['Roll', 'Buy it', 'End turn', 'Pay', 'Got it']) {
          const loc = page.locator(`.actionbar button:has-text("${label}"), .hint button:has-text("${label}")`);
          if (await loc.count()) { await loc.first().click({ force: true, timeout: 2000 }).catch(() => {}); break; }
        }
        const drop = page.locator('button:has-text("Drop out")');
        if (await drop.count()) await drop.first().click({ timeout: 1500 }).catch(() => {});
        const mg = page.locator('.mg button:not([disabled])');
        if (await mg.count()) await mg.first().click({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(1200);
      }
      await page.screenshot({ path: `${OUT}/${tag}-table.png`, timeout: 180000 });
      for (const view of ['follow', 'close', 'top']) {
        await page.keyboard.press('c');
        await page.waitForTimeout(6000);
        await page.screenshot({ path: `${OUT}/${tag}-${view}.png`, timeout: 180000 });
      }
      const perf = await page.evaluate(() => {
        const gl = window.__yotGl;
        return gl ? { calls: gl.info.render.calls, triangles: gl.info.render.triangles } : null;
      });
      const log = await page.locator('.log').innerText().catch(() => '');
      const turns = (log.match(/rolled/g) || []).length;
      console.log(`${tag}: ${turns} rolls, ${perf ? `${perf.calls} draw calls, ${perf.triangles} triangles` : 'no perf'}${errors.length ? `, ${errors.length} ERRORS` : ''}`);
      for (const e of errors) console.log(`  ${e}`);
      if (errors.length) failures++;
    } catch (e) {
      failures++;
      console.log(`${tag}: FAILED — ${e.message.split('\n')[0]}`);
      await page.screenshot({ path: `${OUT}/${tag}-failed.png`, timeout: 180000 }).catch(() => {});
    } finally {
      await page.context().close();
    }
  }
}
await browser.close();
console.log(failures ? `${failures} scene(s) had problems; screenshots in ${OUT}` : `all clean; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
