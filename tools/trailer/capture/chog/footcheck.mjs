import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { createServer } = await import('/home/user/yot-monopoly/node_modules/vite/dist/node/index.js');
const server = await createServer({ configFile: '/home/user/yot-monopoly/client/.film/chog/vite.config.mjs', server: { port: 5197, strictPort: true, host: '127.0.0.1' } });
await server.listen();
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 480, height: 270 } });
await pg.goto('http://127.0.0.1:5197/?mode=run&w=480&h=270');
await pg.waitForFunction(() => window.ready); await pg.evaluate(() => window.ready);
const rows = await pg.evaluate(() => {
  const out = []; const a = window.dbg.actors[0];
  for (let i = 0; i < 20; i++) {
    const t = i / 48; window.draw(t);
    const p = a.rig.footL.getWorldPosition(new a.rig.footL.position.constructor());
    const r = a.rig.footR.getWorldPosition(new a.rig.footR.position.constructor());
    out.push([t.toFixed(3), p.y.toFixed(4), (p.z - window.dbg.floorZ()).toFixed(4), r.y.toFixed(4), (r.z - window.dbg.floorZ()).toFixed(4)].join(' '));
  }
  return out;
});
console.log('t  Ly  Lz-floor  Ry  Rz-floor\n' + rows.join('\n'));
await b.close(); await server.close();
