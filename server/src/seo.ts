// What crawlers and link previews see. The app is a single page, so without
// this every address would answer with the same title and description, and an
// unknown address would look like the home page to a search engine. Here the
// built index.html is sent with each route's own title, description, canonical
// link, Open Graph / Twitter tags and structured data (from shared/seo.ts),
// unknown paths get status 404 and noindex, and robots.txt and sitemap.xml
// list the public pages.
import type express from 'express';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { pickEncoding } from './staticFiles.ts';
import { SHARE_IMAGE, SHARE_IMAGE_SIZE, SITE_NAME, SITE_URL, routeMeta, sitemapPaths, type RouteMeta } from '../../shared/seo.ts';

/** Fills in what only the server knows for a page (a profile's name, numbers and card); returns the meta as it is otherwise. */
export type MetaEnricher = (meta: RouteMeta) => RouteMeta;

/** The site's canonical origin: PUBLIC_URL when it is a plain http(s) origin, else choggames.com. */
export function siteOrigin(env: string | undefined = process.env.PUBLIC_URL): string {
  const v = env?.trim().replace(/\/+$/, '');
  return v && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v) ? v : SITE_URL;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** JSON inside <script>: nothing in it can close the tag. */
const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

function structuredData(meta: RouteMeta, origin: string): unknown[] {
  const url = origin + meta.path;
  const image = origin + SHARE_IMAGE;
  if (meta.path === '/') {
    return [{
      '@context': 'https://schema.org', '@type': 'WebSite',
      name: SITE_NAME, url: `${origin}/`, description: meta.description, image,
    }];
  }
  if (meta.game) {
    return [{
      '@context': 'https://schema.org', '@type': 'VideoGame',
      name: meta.game.name, url, description: meta.description, image,
      genre: meta.game.genre, gamePlatform: 'Web browser', applicationCategory: 'Game',
      playMode: 'MultiPlayer', isAccessibleForFree: true,
      publisher: { '@type': 'Organization', name: SITE_NAME, url: `${origin}/` },
    }];
  }
  return [];
}

/** The <head> tags for one route. */
export function headTags(meta: RouteMeta, origin = siteOrigin()): string {
  const url = origin + meta.path;
  const image = origin + (meta.image?.path ?? SHARE_IMAGE);
  const size = meta.image ?? SHARE_IMAGE_SIZE;
  const alt = meta.image?.alt ?? `${SITE_NAME}: Monopoly, Cards and Poker`;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex" />' : '',
    meta.status === 200 ? `<link rel="canonical" href="${esc(url)}" />` : '',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="${size.width}" />`,
    `<meta property="og:image:height" content="${size.height}" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(alt)}" />`,
    ...structuredData(meta, origin).map(jsonLd),
  ];
  return tags.filter(Boolean).join('\n    ');
}

const START = '<!--seo-->';
const END = '<!--/seo-->';

/**
 * index.html with one route's tags in place of the default block between
 * <!--seo--> and <!--/seo--> (index.html). Without the markers only the title is swapped.
 */
export function renderIndex(template: string, path: string, origin = siteOrigin(), enrich?: MetaEnricher): { html: string; status: number } {
  const base = routeMeta(path);
  let meta = base;
  try { if (enrich) meta = enrich(base); } catch (e) { console.error('[seo] could not enrich', path, e); }
  const tags = headTags(meta, origin);
  const a = template.indexOf(START);
  const b = template.indexOf(END);
  const html = a !== -1 && b > a
    ? template.slice(0, a) + START + '\n    ' + tags + '\n    ' + template.slice(b)
    : template.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  return { html, status: meta.status };
}

export function robotsTxt(origin = siteOrigin()): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /r/',
    'Disallow: /cards/r/',
    'Disallow: /u/',
    'Disallow: /wallet',
    'Disallow: /sso',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(origin = siteOrigin()): string {
  const urls = sitemapPaths().map(p => `  <url><loc>${esc(origin + p)}</loc><changefreq>${p === '/' || p === '/tournaments' || p === '/leaderboard' ? 'daily' : 'weekly'}</changefreq><priority>${p === '/' ? '1.0' : '0.7'}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** robots.txt and sitemap.xml. Mounted before the static files. */
export function mountCrawlerFiles(app: express.Express): void {
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(robotsTxt());
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.type('application/xml').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(sitemapXml());
  });
}

/**
 * The app's page for every other GET: index.html with that route's meta, 404 for unknown paths.
 * Sent Brotli- or gzip-compressed to browsers that take it (it is the first thing a visit waits
 * for); each page's compressed copies are kept, as the same few pages are asked for again and again.
 */
export function spaHandler(indexFile: string, enrich?: MetaEnricher): express.RequestHandler {
  let template: string | null = null;
  const packed = new Map<string, { br?: Buffer; gzip?: Buffer }>();
  return (req, res) => {
    template ??= readFileSync(indexFile, 'utf8');
    const { html, status } = renderIndex(template, req.path, siteOrigin(), enrich);
    // Always revalidated (it names the current hashed bundles); Express's ETag makes that a 304.
    res.status(status).type('html').setHeader('Cache-Control', 'no-cache');
    res.vary('Accept-Encoding');
    const enc = pickEncoding(req.headers['accept-encoding'], () => html.length >= 1024);
    if (!enc) { res.send(html); return; }
    let copies = packed.get(html);
    if (!copies) {
      // Profiles and rooms make every address its own page: keep the latest few hundred.
      if (packed.size >= 300) packed.clear();
      packed.set(html, copies = {});
    }
    const body = copies[enc] ??= enc === 'br'
      ? brotliCompressSync(html, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } })
      : gzipSync(html, { level: 9 });
    res.setHeader('Content-Encoding', enc);
    res.send(body);
  };
}
