// Serving the built client. The build (client/vite.config.ts, precompress)
// writes a Brotli (.br) and gzip (.gz) copy next to every file worth
// compressing: the scripts, the styles and the 3D models. Here a request
// whose browser accepts one gets that copy, so a first visit downloads a
// third of the JavaScript and roughly half of most models, with no CPU spent
// compressing per request. Vite's hashed /assets/ files never change under
// the same name, so browsers keep them for a year without asking again.

import express, { type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};

/** Which precompressed copy (if any) to send for a path, given the request's Accept-Encoding. */
export function pickEncoding(accept: string | undefined, has: (suffix: '.br' | '.gz') => boolean): 'br' | 'gzip' | null {
  // "br;q=1.0, gzip, deflate" → the codings with a q above zero.
  const ok = new Set((accept ?? '').toLowerCase().split(',').flatMap(part => {
    const [name, ...params] = part.trim().split(';').map(x => x.trim());
    const q = params.find(p => p.startsWith('q='));
    return name && (!q || Number(q.slice(2)) > 0) ? [name] : [];
  }));
  const takes = (enc: string) => ok.has(enc);
  if (takes('br') && has('.br')) return 'br';
  if (takes('gzip') && has('.gz')) return 'gzip';
  return null;
}

export function staticClient(dist: string): RequestHandler[] {
  const root = normalize(dist + sep);
  // Which precompressed copies exist, looked up once per path.
  const known = new Map<string, { br: boolean; gz: boolean }>();
  const variants = (file: string) => {
    let v = known.get(file);
    if (!v) {
      v = { br: existsSync(file + '.br'), gz: existsSync(file + '.gz') };
      if (known.size < 5_000) known.set(file, v);
    }
    return v;
  };
  const precompressed: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const type = TYPES[extname(req.path)];
    if (!type) return next();
    let rel: string;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) return next();
    const v = variants(file);
    const enc = pickEncoding(req.headers['accept-encoding'], s => (s === '.br' ? v.br : v.gz));
    res.vary('Accept-Encoding');
    if (!enc) return next();
    // serve-static keeps a Content-Type that is already set, so the .br file goes out as JavaScript (or a model).
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Encoding', enc);
    const q = req.url.indexOf('?');
    req.url = req.path + (enc === 'br' ? '.br' : '.gz') + (q === -1 ? '' : req.url.slice(q));
    next();
  };
  const serve = express.static(dist, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, path) => {
      if (path.startsWith(join(root, 'assets') + sep)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  });
  return [precompressed, serve];
}
