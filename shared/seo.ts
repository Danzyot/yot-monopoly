// What each public page is called, for search engines and link previews.
//
// The server writes these into index.html before sending it (server/src/seo.ts),
// so a crawler or a Discord/X preview that never runs our JavaScript still gets
// the right title, description, share image and canonical link. The client
// keeps document.title and the same tags in step on in-app navigation
// (client/src/routeMeta.ts). The sitemap lists the `sitemap: true` pages.
//
// Routes are matched generically: an exact path, a path with `:params`, or a
// `/*` prefix. A path nothing here matches is a 404 (the server still sends
// the app, with status 404 and noindex, and the app shows its not-found page).
// Adding a page to the app? Add it here too, or crawlers are told it is missing.

/** The canonical origin. PUBLIC_URL on the server can override it (server/src/seo.ts). */
export const SITE_URL = 'https://choggames.com';
export const SITE_NAME = 'Chog Games';
/** 1200×630, made from the hub's art (client/public/brand/og.jpg). */
export const SHARE_IMAGE = '/brand/og.jpg';
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** The Chog Genesis collection, linked from the footer and the legal pages. */
export const OPENSEA_URL = 'https://opensea.io/collection/chog-genesis';

export interface RouteMeta {
  /** The full <title>. */
  title: string;
  description: string;
  /** The canonical path (no origin), e.g. "/cards". */
  path: string;
  /** Keep out of search results (private, per-player or one-off pages). */
  noindex?: boolean;
  /** 404 for paths no page answers. */
  status: 200 | 404;
  /** A game page: the server adds VideoGame structured data. */
  game?: { name: string; genre: string[] };
  /** This page's own share image (a player's card) in place of SHARE_IMAGE. */
  image?: ShareImage;
}

export interface ShareImage {
  /** Site-relative, e.g. "/api/players/dc_1/card.png?v=a". */
  path: string;
  width: number;
  height: number;
  alt: string;
}

/** The player id in a profile path ("/u/:id"), or null for any other page. */
export function profileIdOf(path: string): string | null {
  const m = /^\/u\/([^/]+)$/.exec(cleanPath(path));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

interface Entry {
  /** "/cards", "/u/:id" or "/admin/*" (the prefix itself and anything under it). */
  pattern: string;
  /** Short page name; the title becomes "<name> · Chog Games". Omitted: the home page's title. */
  name?: string;
  title?: string;
  description: string;
  noindex?: boolean;
  /** Listed in sitemap.xml. */
  sitemap?: boolean;
  /** Canonical path: the request's own path when omitted for a param route, else the pattern. */
  canonical?: string;
  game?: { name: string; genre: string[] };
}

const HOME_DESCRIPTION = 'Play Monopoly, cards and poker with the Chog crew. Open a table, share the code and play with friends in your browser. Free, nothing to download.';

export const ROUTES: Entry[] = [
  { pattern: '/', title: `${SITE_NAME}: Monopoly, cards and poker with the Chog crew`, description: HOME_DESCRIPTION, sitemap: true },
  {
    pattern: '/monopoly', name: 'Monopoly', sitemap: true,
    description: 'Roll, trade and build on 3D Chog boards. Open a Monopoly table, share the code and play with friends or bots in your browser.',
    game: { name: 'Chog Games Monopoly', genre: ['Board game', 'Family'] },
  },
  {
    pattern: '/cards', name: 'Cards', sitemap: true,
    description: 'Match the colour or number, play your action cards and empty your hand first. A quick multiplayer card game with the Chog crew, in your browser.',
    game: { name: 'Cards', genre: ['Card game', 'Party'] },
  },
  {
    pattern: '/poker', name: 'Poker', sitemap: true,
    description: 'Texas Hold\'em tournaments with the Chog crew. Play chips only: no real money, nothing to buy.',
    game: { name: 'Poker', genre: ['Card game', 'Poker'] },
  },
  { pattern: '/tournaments', name: 'Tournaments', sitemap: true, description: 'Upcoming and finished Chog Games tournaments. Sign up, play your table and climb the bracket.' },
  { pattern: '/characters', name: 'Characters', sitemap: true, description: 'Meet the Chog crew: every character you can play as in Chog Games, with their outfits.' },
  { pattern: '/leaderboard', name: 'Leaderboard', sitemap: true, description: 'The top Chog Games players: wins, games played and recent results for Monopoly and Chog Cards.' },
  { pattern: '/terms', name: 'Terms of use', sitemap: true, description: 'The plain-language rules for using Chog Games: free to play, no money or gambling, be kind and play fair.' },
  { pattern: '/privacy', name: 'Privacy', sitemap: true, description: 'What Chog Games stores about you, why, who can see it and how to have it removed.' },
  { pattern: '/fair-play', name: 'Fair play', sitemap: true, description: 'One account each, no collusion, no bots, no bug abuse. How Chog Games keeps games and tournaments fair.' },
  // Below: real pages that are not for search results.
  { pattern: '/tournaments/new', name: 'New tournament', description: 'Set up a Chog Games tournament.', noindex: true },
  { pattern: '/tournaments/:id', name: 'Tournament', description: 'A Chog Games tournament: the tables, the standings and the results.' },
  { pattern: '/r/:code', name: 'Join the table', description: 'You are invited to a Monopoly table on Chog Games. Open the link to take a seat.', noindex: true },
  { pattern: '/cards/r/:code', name: 'Join the table', description: 'You are invited to a Cards table. Open the link to take a seat.', noindex: true },
  { pattern: '/u/:id', name: 'Player profile', description: 'A Chog Games player: their results, favourite characters and recent games.', noindex: true },
  { pattern: '/wallet', name: 'Link your wallet', description: 'Link a wallet to show you hold a Chog Genesis.', noindex: true },
  { pattern: '/settings', name: 'Settings', description: 'Your Chog Games settings: which emails you get.', noindex: true },
  { pattern: '/sso', name: 'Sign in', description: 'Sign in to Chog Games.', noindex: true },
  { pattern: '/admin/*', name: 'Dashboard', description: 'Chog Games operator dashboard.', noindex: true },
  // Pages other parts of the site may grow under these games.
  { pattern: '/monopoly/*', name: 'Monopoly', description: 'Monopoly on Chog Games.', noindex: true },
  { pattern: '/cards/*', name: 'Cards', description: 'Cards on Chog Games.', noindex: true },
  { pattern: '/poker/*', name: 'Poker', description: 'Poker on Chog Games.', noindex: true },
];

const NOT_FOUND: Omit<RouteMeta, 'path'> = {
  title: `Page not found · ${SITE_NAME}`,
  description: 'There is nothing at this address. Head back to Chog Games and pick a game.',
  noindex: true,
  status: 404,
};

/** "/cards/" → "/cards"; query and hash dropped. */
export function cleanPath(raw: string): string {
  let p = raw.split(/[?#]/)[0] || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
  return p;
}

function matches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => (seg.startsWith(':') ? b[i].length > 0 : seg === b[i]));
}

/** The page meta for a path. Exact and param routes beat `/*` prefixes. */
export function routeMeta(rawPath: string): RouteMeta {
  const path = cleanPath(rawPath);
  const hit = ROUTES.find(r => !r.pattern.endsWith('/*') && matches(r.pattern, path))
    ?? ROUTES.find(r => matches(r.pattern, path));
  if (!hit) return { ...NOT_FOUND, path };
  return {
    title: hit.title ?? `${hit.name} · ${SITE_NAME}`,
    description: hit.description,
    path: hit.canonical ?? path,
    noindex: hit.noindex,
    status: 200,
    game: hit.game,
  };
}

/** The paths sitemap.xml lists. */
export function sitemapPaths(): string[] {
  return ROUTES.filter(r => r.sitemap).map(r => r.pattern);
}
