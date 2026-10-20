// What a player host (a Chog Genesis holder, or a player an operator
// approved on Chog Games) may open. Operators have none of these limits. The
// server enforces them (server/src/hosting.ts); the create forms read the same
// numbers so they never offer what the server would clamp.
export const PLAYER_HOST_LIMITS = {
  /** Live or upcoming tournaments at a time (registering, running, on break, paused). */
  tournaments: 1,
  /** Open cash tables at a time. */
  cashTables: 2,
  maxPlayers: 100,
  startingStack: 50_000,
  levelMinutes: 20,
  lateRegMinutes: 60,
  joinMinutes: 30,
  maxReentries: 2,
  betCapMinutes: 60,
  /** How far ahead a scheduled start may be. */
  scheduleAheadMs: 7 * 24 * 3_600_000,
} as const;
