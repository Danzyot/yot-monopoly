// Achievements: badges a player earns from their finished games. The server
// works them out from the results it already keeps (server/src/achievements.ts),
// so nothing here is tracked separately and a badge can be checked against the
// games on the profile. The profile shows them as a grid, the share card
// (/api/players/:id/card.png) shows the best few, and the client toasts any
// that a game just earned.

export type AchievementGroup = 'general' | 'monopoly' | 'cards' | 'tournaments' | 'chog';

export interface AchievementDef {
  id: string;
  name: string;
  /** The badge's face on the profile (the share card draws a medal instead). */
  emoji: string;
  /** A picture to show in place of the emoji on the site. */
  image?: string;
  /** How to earn it, in a line. */
  blurb: string;
  group: AchievementGroup;
  /** Bigger is rarer: the share card shows the highest tiers first. */
  tier: 1 | 2 | 3;
}

/** One badge as a player stands with it (GET /api/players/:id/achievements). */
export interface Achievement extends AchievementDef {
  earned: boolean;
  /** When it was earned (the game that did it); null while locked. */
  earnedAt: number | null;
  /** How far along a counting badge is; null for one-off badges. */
  progress: { have: number; need: number } | null;
}

export interface AchievementsReply {
  achievements: Achievement[];
  /** The server's clock, so "earned just now" does not depend on the browser's. */
  now: number;
}

/** Thresholds the server counts towards; shared so the blurbs cannot drift. */
export const ACH = {
  handGrenadeCards: 15,
  bigHaulPoints: 100,
  crowdOpponents: 3,
  oldGuardDays: 30,
} as const;

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- across the hub
  { id: 'first-game', name: 'Hatchling', emoji: '🐣', blurb: 'Finish your first game', group: 'general', tier: 1 },
  { id: 'games-10', name: 'Regular', emoji: '🎲', blurb: 'Finish 10 games', group: 'general', tier: 1 },
  { id: 'games-50', name: 'Chog Addict', emoji: '🕹️', blurb: 'Finish 50 games', group: 'general', tier: 2 },
  { id: 'games-100', name: 'Lifer', emoji: '💯', blurb: 'Finish 100 games', group: 'general', tier: 3 },
  { id: 'streak-3', name: 'On Fire', emoji: '🔥', blurb: 'Win 3 games in a row', group: 'general', tier: 2 },
  { id: 'streak-5', name: 'Unstoppable', emoji: '🌋', blurb: 'Win 5 games in a row', group: 'general', tier: 3 },
  { id: 'wins-25', name: 'Trophy Cabinet', emoji: '🏅', blurb: 'Win 25 games', group: 'general', tier: 3 },
  { id: 'both-games', name: 'Double Life', emoji: '🎭', blurb: 'Finish a game of Monopoly and a Cards match', group: 'general', tier: 1 },
  { id: 'beat-humans', name: 'People Person', emoji: '🤝', blurb: 'Win a game against two or more other people', group: 'general', tier: 2 },
  { id: 'old-guard', name: 'Old Guard', emoji: '📅', blurb: `Keep playing for ${ACH.oldGuardDays} days`, group: 'general', tier: 2 },
  // ---- Monopoly
  { id: 'mono-first-win', name: 'Chog Tycoon', emoji: '🎩', blurb: 'Win a game of Monopoly', group: 'monopoly', tier: 1 },
  { id: 'mono-every-board', name: 'Board Hopper', emoji: '🗺️', blurb: 'Win on every Monopoly board', group: 'monopoly', tier: 3 },
  { id: 'mono-landlord', name: 'Landlord', emoji: '🏘️', blurb: 'Own a whole colour set in a game', group: 'monopoly', tier: 1 },
  { id: 'mono-mogul', name: 'Mogul', emoji: '🏙️', blurb: 'Own three colour sets in one game', group: 'monopoly', tier: 2 },
  { id: 'mono-crowd', name: 'King of the Table', emoji: '👑', blurb: `Win a Monopoly game against ${ACH.crowdOpponents}+ opponents`, group: 'monopoly', tier: 2 },
  { id: 'mono-wins-10', name: 'Money Bags', emoji: '💸', blurb: 'Win 10 Monopoly games', group: 'monopoly', tier: 3 },
  // ---- Cards
  { id: 'cards-first-win', name: 'Card Shark', emoji: '🃏', blurb: 'Win a Cards match', group: 'cards', tier: 1 },
  { id: 'cards-hand-grenade', name: 'Hand Grenade', emoji: '💣', blurb: `Win a round while the others still hold ${ACH.handGrenadeCards}+ cards`, group: 'cards', tier: 2 },
  { id: 'cards-big-haul', name: 'Big Haul', emoji: '💰', blurb: `Score ${ACH.bigHaulPoints}+ points in a single round`, group: 'cards', tier: 2 },
  { id: 'cards-long-game', name: 'Long Game', emoji: '🎯', blurb: 'Win a first-to-points match', group: 'cards', tier: 2 },
  { id: 'cards-crowd', name: 'Circus Master', emoji: '🎪', blurb: `Win a Cards match against ${ACH.crowdOpponents}+ opponents`, group: 'cards', tier: 2 },
  { id: 'cards-wins-10', name: 'Deck Boss', emoji: '🎴', blurb: 'Win 10 Cards matches', group: 'cards', tier: 3 },
  // ---- tournaments
  { id: 'tourney-played', name: 'Bracket Chog', emoji: '🎟️', blurb: 'Play a tournament to the end', group: 'tournaments', tier: 1 },
  { id: 'tourney-final', name: 'Final Table', emoji: '🪑', blurb: 'Reach a tournament’s final table', group: 'tournaments', tier: 2 },
  { id: 'tourney-podium', name: 'Podium Chog', emoji: '🥉', blurb: 'Finish top three in a tournament', group: 'tournaments', tier: 2 },
  { id: 'tourney-champ', name: 'Champion', emoji: '🏆', blurb: 'Win a tournament', group: 'tournaments', tier: 3 },
  // ---- Chog holders
  { id: 'wallet', name: 'Chog Certified', emoji: '🔗', blurb: 'Link a wallet', group: 'chog', tier: 1 },
  { id: 'own-chog', name: 'That’s My Chog', emoji: '💜', image: '/faces/chog.webp', blurb: 'Play as your own NFT Chog', group: 'chog', tier: 2 },
  { id: 'own-chog-win', name: 'Chog of Destiny', emoji: '✨', blurb: 'Win as your own NFT Chog', group: 'chog', tier: 3 },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

/**
 * Earned first, newest first; then locked, closest to done first. Ties keep
 * the catalogue's order. The profile grid and the share card both use this.
 */
export function sortAchievements(list: readonly Achievement[]): Achievement[] {
  const order = new Map(ACHIEVEMENTS.map((a, i) => [a.id, i]));
  const ratio = (a: Achievement) => (a.progress ? a.progress.have / a.progress.need : 0);
  return [...list].sort((a, b) =>
    Number(b.earned) - Number(a.earned)
    || (a.earned ? (b.earnedAt ?? 0) - (a.earnedAt ?? 0) : ratio(b) - ratio(a))
    || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
