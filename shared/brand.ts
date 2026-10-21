import { CARDS_GAME_NAME } from './cards/meta.ts';

// Who this deployment is. Everything the player reads by name comes from
// here, so rebranding the site is one file.
export const BRAND = {
  name: 'Chog Games',
  org: 'Chog',
  short: 'Chog',
  /** Prefix on the "Verify with a code" codes, e.g. MONO-AB12. */
  codePrefix: 'MONO-',
} as const;

// The hub's three games (the hub itself is /). Monopoly and Chog Cards are
// served by this server, each with its own home page at `path`;
// Chog Poker is its own app (poker/, its own Railway service) behind the same
// sign-in secret and Discord app, so a token from here is good there too.
export const GAMES = {
  monopoly: { name: 'Monopoly', path: '/monopoly' },
  cards: { name: CARDS_GAME_NAME, path: '/cards' },
  poker: { name: 'Poker', path: '/poker' },
} as const;

/** Where Chog Poker lives. Its client takes a sign-in as `#dtoken=<token>` (poker/client/src/auth.tsx). */
export const POKER_URL = 'https://poker.choggames.com';
