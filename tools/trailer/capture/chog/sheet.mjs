// Contact sheets and image conversion in headless Chromium (no PIL/ImageMagick here).
//   node sheet.mjs spec.json
// spec: { out, cols, cell:[w,h], pad, bg, checker, title, items:[{file,label}] }
//   or  { convert:[{file,out,size}] }  -> decode any image, write PNG (resized square if size)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const mime = f => ({ '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' })[extname(f)] || 'image/png';
const dataUrl = f => `data:${mime(f)};base64,${readFileSync(f).toString('base64')}`;
const b = await chromium.launch();
const pg = await b.newPage();
if (spec.convert) {
  for (const c of spec.convert) {
    const url = await pg.evaluate(async ({ src, size }) => {
      const img = new Image(); img.src = src; await img.decode();
      const w = size || img.naturalWidth, h = size || img.naturalHeight;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
      return cv.toDataURL('image/png');
    }, { src: dataUrl(c.file), size: c.size || 0 });
    mkdirSync(dirname(c.out), { recursive: true });
    writeFileSync(c.out, Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', c.out);
  }
} else {
  const items = spec.items.map(i => ({ src: dataUrl(i.file), label: i.label || '' }));
  const url = await pg.evaluate(async ({ items, cols, cell, pad, bg, checker, title }) => {
    const [cw, ch] = cell, lab = 22, top = title ? 40 : 0;
    const rows = Math.ceil(items.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = top + rows * (ch + lab + pad) + pad;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bg || '#222'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px sans-serif'; if (title) ctx.fillText(title, pad, 28);
    for (let i = 0; i < items.length; i++) {
      const x = pad + (i % cols) * (cw + pad), y = top + pad + Math.floor(i / cols) * (ch + lab + pad);
      if (checker) for (let yy = 0; yy < ch; yy += 16) for (let xx = 0; xx < cw; xx += 16) {
        ctx.fillStyle = ((xx + yy) / 16) % 2 ? '#9a9a9a' : '#cfcfcf'; ctx.fillRect(x + xx, y + yy, Math.min(16, cw - xx), Math.min(16, ch - yy));
      }
      const img = new Image(); img.src = items[i].src; await img.decode();
      const s = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.drawImage(img, x + (cw - w) / 2, y + (ch - h) / 2, w, h);
      ctx.fillStyle = '#eee'; ctx.font = '15px sans-serif'; ctx.fillText(items[i].label, x, y + ch + 17);
    }
    return cv.toDataURL('image/png');
  }, { items, cols: spec.cols, cell: spec.cell, pad: spec.pad ?? 10, bg: spec.bg, checker: !!spec.checker, title: spec.title });
  mkdirSync(dirname(spec.out), { recursive: true });
  writeFileSync(spec.out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', spec.out);
}
await b.close();
