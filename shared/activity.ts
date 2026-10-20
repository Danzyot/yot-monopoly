// The home page's live ticker (GET /api/activity): what just happened across
// the site, built by server/src/activity.ts from the stores it already keeps
// (results, live tables, tournaments, sign-ups). Public information only:
// display names, never ids of private tables, addresses or anything an
// operator sees.

export type ActivityKind =
  /** Someone won a game (Monopoly or Cards). */
  | 'win'
  /** A public table just started. */
  | 'started'
  /** A public lobby with free seats. */
  | 'open'
  /** A tournament's champion. */
  | 'champion'
  /** A tournament under way. */
  | 'tournament'
  /** New players signed up. */
  | 'joined';

export type ActivityGame = 'monopoly' | 'cards' | 'tournament' | 'site';

export interface ActivityItem {
  /** Stable across polls, so the client can tell new items from old ones. */
  id: string;
  kind: ActivityKind;
  game: ActivityGame;
  /** The line as read: "Pete won on Metropolis". */
  text: string;
  /** When it happened (server clock, ms). */
  at: number;
  /** Where a tap goes (a profile, a table to watch, a tournament), when anywhere. */
  href?: string;
}

export interface ActivityFeed {
  items: ActivityItem[];
  /** Server clock when the list was built, for "2m ago". */
  now: number;
}
