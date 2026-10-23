import { execSync } from 'node:child_process';
const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(root + '/playwright/index.mjs');
export const S = '/tmp/chog-trailer';
export const OUT = S + '/bl/screens';
export const BASE = 'http://localhost:8611';
export const POKER = 'http://localhost:8612';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function launch(gl = true) {
  return chromium.launch({ args: gl ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [] });
}
export async function ctx(browser, { phone = false, storage } = {}) {
  const c = await browser.newContext({
    ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }),
    timezoneId: 'America/New_York', locale: 'en-US',
    ...(storage ? { storageState: storage } : {}),
  });
  // The hub reads poker's public lobby from poker.choggames.com: send it to the local poker.
  await c.route(/^https:\/\/poker\.choggames\.com\//, async route => {
    const u = new URL(route.request().url());
    const r = await fetch(POKER + u.pathname + u.search, { method: route.request().method(), headers: { accept: 'application/json' } }).catch(() => null);
    if (!r) return route.abort();
    const body = Buffer.from(await r.arrayBuffer());
    route.fulfill({ status: r.status, body, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'access-control-allow-origin': '*' } });
  });
  // No external fonts/analytics hang ups: let them through but don't wait on them.
  await c.addInitScript(() => {
    try { if (location.port === '8611') localStorage.setItem('yot:hints', JSON.stringify(['welcome', 'raise', 'build', 'trade'])); } catch {}
    // No player name beside the header avatar, and the home page without its own trailer and video loop.
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = 'header .me > .hide-sm, header .profile-name, .home-loop, section.trailer { display: none !important; }';
      document.head.appendChild(st);
    });
    window.__glctx = [];
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      const g = orig.call(this, type, ...a);
      if (g && /webgl/.test(type) && !window.__glctx.includes(g)) window.__glctx.push(g);
      return g;
    };
  });
  const page = await c.newPage();
  page.setDefaultTimeout(60_000);
  page.errors = [];
  page.on('pageerror', e => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(`console: ${m.text().slice(0, 200)}`); });
  return page;
}
export const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
export const easeSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
export async function signIn(p, name = 'ChogFan') {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.click('header >> text=Sign in');
  await p.fill('input[placeholder="Your name"]', name);
  await p.click('button:has-text("Play!")');
  await p.waitForFunction(() => !document.querySelector('input[placeholder="Your name"]'));
  await sleep(1000);
}
/** Freeze page time; afterwards step() advances it by one 24 fps frame and runs one animation frame. */
export async function freeze(p) {
  const p0 = await p.evaluate(() => performance.now());
  await p.clock.install();
  await p.evaluate(p0 => { const fp = performance.now.bind(performance); performance.now = () => fp() + p0; }, p0);
  const now = await p.evaluate(() => Date.now());
  await p.clock.pauseAt(now + 50);
  await p.evaluate(() => {
    window.__rafq = new Map(); let id = 1;
    window.requestAnimationFrame = cb => { const i = id++; window.__rafq.set(i, cb); return i; };
    window.cancelAnimationFrame = i => { window.__rafq.delete(i); };
    // CSS animations and transitions: held, and moved on by step() with the clock.
    window.__animSeen = new WeakSet();
    for (const a of document.getAnimations()) { a.pause(); window.__animSeen.add(a); }
    document.documentElement.style.scrollBehavior = 'auto';
  });
}
export async function step(p, ms = 1000 / 24, rafs = 1) {
  await p.clock.runFor(ms);
  for (let k = 0; k < rafs; k++) await p.evaluate(() => {
    const q = [...window.__rafq.values()]; window.__rafq.clear();
    const t = performance.now();
    for (const cb of q) { try { cb(t); } catch (e) { console.error(e); } }
  });
  await p.evaluate(ms => {
    for (const a of document.getAnimations()) {
      try {
        if (!window.__animSeen.has(a)) { window.__animSeen.add(a); a.pause(); a.currentTime = 0; continue; }
        if (a.playState !== 'paused') { if (a.playState === 'running') a.pause(); else continue; }
        const end = a.effect?.getComputedTiming().endTime ?? Infinity;
        const next = (Number(a.currentTime) || 0) + ms;
        if (Number.isFinite(end) && next >= end) a.finish(); else a.currentTime = next;
      } catch {}
    }
  }, ms);
  await glSync(p);
}
export async function glSync(p) {
  await p.evaluate(() => {
    const px = new Uint8Array(4);
    for (const g of window.__glctx || []) { try { if (!g.isContextLost()) g.readPixels(0, 0, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); } catch {} }
  });
}

/** Wait until the 3D canvas has drawn something (a clip of the centre stops being flat black). */
export async function waitScene(p, { x = 760, y = 340, w = 400, h = 300, min = 12000, max = 180000 } = {}) {
  const t0 = Date.now();
  let last = 0;
  while (Date.now() - t0 < max) {
    const buf = await p.screenshot({ type: 'jpeg', quality: 60, clip: { x, y, width: w, height: h } });
    last = buf.length;
    if (last > min) return last;
    await sleep(2000);
  }
  throw new Error('scene never drew (last clip ' + last + ' bytes)');
}
import { token as hubToken, YOT } from './main-seed.mjs';
/** Signed in as Yot (fixed id, the one the dailies seed knows) on the hub, before any page script runs. */
export async function asYot(p) {
  await p.context().addInitScript(([t, id]) => { try { if (location.port === '8611') { localStorage.setItem('yot:token', t); localStorage.setItem('yot:welcome-seen', JSON.stringify([id])); } } catch {} }, [hubToken(YOT.id, YOT.name, YOT.avatar), YOT.id]);
}
