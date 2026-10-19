// The winner-DM template. Split out of the dialog so it has no React import
// and can be tested directly — this is the one piece of text the site sends
// into someone's Discord inbox, and a broken template fails silently.
import { ordinal } from './format.ts';

export interface DmTarget {
  playerId: string;
  name: string;
  // Present when the DM is about a finish, so the draft can say so.
  place?: number | null;
  tournamentName?: string;
  prizeText?: string | null;
}

export function draftFor(t: DmTarget): string {
  if (!t.place || !t.tournamentName) return '';
  const congrats = t.place === 1
    ? `Congratulations ${t.name} — you won ${t.tournamentName}!`
    : `Congratulations ${t.name} — you finished ${ordinal(t.place)} in ${t.tournamentName}.`;
  const prize = t.prizeText ? `\n\nPrizes:\n${t.prizeText}` : '';
  return `${congrats}${prize}\n\nReply here to claim.`;
}
