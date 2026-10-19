// Who this deployment is. Everything the player reads by name comes from
// here, so rebranding is one file rather than a search across the tree —
// which is how the original ended up with its name in forty places.
export const BRAND = {
  // Full name, for titles and formal copy.
  name: 'Chog Poker',
  // The hub this room is one game of (choggames.com), and the browser-tab
  // title that says so. The hub's address itself comes from HUB_URL.
  hub: 'Chog Games',
  title: 'Chog Poker · Chog Games',
  // The organisation behind it.
  org: 'Chog',
  // Short form for tight spaces (the header on a phone).
  short: 'Chog',
  // What a suspension calls the place, in each scope.
  room: 'the Chog Poker Room',
  tournaments: 'Chog poker tournaments',
} as const;
