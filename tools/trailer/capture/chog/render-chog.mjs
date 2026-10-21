// Render the 3D Chog trailer frames from client/.film/chog (Vite dev server + headless Chromium).
//   node render-chog.mjs <query> <outDir> <seconds> [fps=24] [w] [h] [frames=all|list like 0,24,47]
// e.g. node render-chog.mjs "mode=run" $S/bl/out/frames/nft-run 4
//      node render-chog.mjs "mode=turn&token=824" $S/bl/out/frames/nft-turn-824 2
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { createServer } = await import('/home/user/yot-monopoly/node_modules/vite/dist/node/index.js');

const [query, out, seconds, fpsArg, wArg, hArg, only] = process.argv.slice(2);
const fps = Number(fpsArg || 24);
const turn = /mode=turn/.test(query);
const w = Number(wArg || (turn ? 1080 : 1920)), h = Number(hArg || (turn ? 1080 : 1080));
const PORT = Number(process.env.FILM_PORT || 5197);

const server = await createServer({ configFile: '/home/user/yot-monopoly/client/.film/chog/vite.config.mjs', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
await server.listen();
let b;
try {
  b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  pg.on('pageerror', e => console.log('pageerror', e.message));
  pg.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log('console', m.type(), m.text().slice(0, 300)); });
  const t0 = Date.now();
  await pg.goto(`http://127.0.0.1:${PORT}/?${query}&w=${w}&h=${h}`);
  await pg.waitForFunction(() => window.ready, null, { timeout: 120000 });
  await pg.evaluate(() => window.ready);
  console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's', JSON.stringify(await pg.evaluate(() => window.fit ?? null)));
  mkdirSync(out, { recursive: true });
  const n = Math.round(Number(seconds) * fps);
  const frames = only ? only.split(',').map(Number) : [...Array(n).keys()];
  for (const f of frames) {
    const url = await pg.evaluate(t => { window.draw(t); return document.querySelector('canvas').toDataURL('image/png'); }, f / fps);
    writeFileSync(join(out, String(f).padStart(4, '0') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    if (f % 24 === 0) console.log('frame', f, ((Date.now() - t0) / 1000).toFixed(1), 's');
  }
  console.log('done', frames.length, 'frames ->', out);
} finally {
  if (b) await b.close();
  await server.close();
}
