// Who may host a tournament: operators and Chog Genesis holders.
// Minimal version; owner-approved hosts arrive with the hosting-rights work.
import { adminDiscordIds, adminModeConfigured, isProduction } from './auth.ts';
import { isChogHolder } from './wallet/holders.ts';

/** Operators by id, the way auth.ts decides it for a session (withAdminFlag). */
function isAdminId(playerId: string): boolean {
  if (!adminModeConfigured()) return !isProduction();
  return playerId.startsWith('dc_') && adminDiscordIds().has(playerId.slice(3));
}

export function canHost(playerId: string): boolean {
  return isAdminId(playerId) || isChogHolder(playerId);
}
