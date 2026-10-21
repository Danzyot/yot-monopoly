// Render a page (tools/trailer/card/*.html) frame by frame: serves the page's folder
// over http (so its fonts and images load), waits for window.ready, then for each frame
// awaits window.draw(t) and saves the canvas#c as a PNG (keeping its alpha), or, on a
// page that sets window.screenshot (DOM and CSS 3D pages), a screenshot of the viewport.
// A '#arg' after the page name is passed on in the URL for the page to read.
//   node render-canvas.mjs <page.html[#arg]> <out dir> <seconds> [fps]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename, join, extname } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const [page, out, seconds, fpsArg] = process.argv.slice(2);
const fps = Number(fpsArg || 24);
const root = dirname(page.split('#')[0]);
const types = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1920, height: 1080 } });
pg.on('pageerror', e => console.log('pageerror', e.message));
await pg.goto(`http://127.0.0.1:${port}/${basename(page)}`);
await pg.evaluate(() => window.ready);
const n = Math.round(Number(seconds) * fps);
for (let f = 0; f < n; f++) {
  const file = join(out, String(f).padStart(4, '0') + '.png');
  const url = await pg.evaluate(async t => { await window.draw(t); return window.screenshot ? null : document.getElementById('c').toDataURL('image/png'); }, f / fps);
  if (url) writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  else await pg.screenshot({ path: file });
}
console.log('frames', n, out);
await b.close();
server.close();
