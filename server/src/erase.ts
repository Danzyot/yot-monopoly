// Deleting a player's data (Dashboard → Players → an account → Delete player
// data; DELETE /api/admin/players/:id). What is theirs alone goes: the
// connection history (addresses, first and last seen), linked wallets and any
// pending wallet check, friends and friend requests, the chosen name, Daily
// Challenge attempts, host approval and chat mute. In finished games and
// tournaments other people played, they become "Deleted player" under a fresh
// placeholder id (deleted.ts), so everyone else's results, points and brackets
// stay as they were; no profile, card or leaderboard row is built for it.
//
// Kept on purpose: bans (so deleting cannot be used to come straight back) and
// the operator and game event logs (disputes). Refused while they are seated at
// a live table or playing in a running tournament.
import { isMuted, setMute } from './chat.ts';
import { forgetAccount, getAccount } from './connections.ts';
import { DELETED_NAME, newDeletedId } from './deleted.ts';
import { forgetChosenName } from './displayNames.ts';
import { revokeHost } from './hosting.ts';
import { clearCardCache } from './playerCard.ts';
import { anonymizeResults } from './stats.ts';
import { anonymizeCardsResults } from './cards/stats.ts';
import { eraseCardsDaily } from './cards/daily.ts';
import { erasePokerDaily } from './poker/daily.ts';
import { cancelSelfTx } from './wallet/selftx.ts';
import { unlinkWallet, walletsOf } from './wallet/store.ts';

export interface EraseDeps {
  /** Live tables they are seated at, as "Monopoly ABCDE" / "Cards ABCDE". */
  seatedAt(id: string): string[];
  tournaments: { forgetPlayer(id: string, to: string, name: string): number };
  friends: { forget(id: string): string[] } | null;
  /** Tell their old friends' tabs the list changed. */
  friendsChanged?(ids: string[]): void;
}

export interface EraseReport {
  id: string;
  /** What they appear as in other people's games from now on. */
  placeholder: string;
  name: string | null;
  account: boolean;
  monopolyGames: number;
  cardsGames: number;
  dailyAttempts: number;
  tournaments: number;
  wallets: number;
  friends: number;
  chosenName: boolean;
  host: boolean;
}

export class EraseRefused extends Error {}

let deps: EraseDeps | null = null;

/** index.ts hands over the live stores once they exist. */
export function configureErase(d: EraseDeps): void {
  deps = d;
}

export function erasePlayer(id: string, d: EraseDeps | null = deps): EraseReport {
  if (!d) throw new Error('Not ready yet — try again in a moment');
  if (!/^[\w-]{1,64}$/.test(id)) throw new EraseRefused('That is not a player id');
  const seated = d.seatedAt(id);
  if (seated.length) throw new EraseRefused(`They are seated at ${seated.join(', ')} — end the game or remove them first`);

  const placeholder = newDeletedId();
  // The tournaments first: the one step that can still refuse (a running event).
  let tournaments: number;
  try {
    tournaments = d.tournaments.forgetPlayer(id, placeholder, DELETED_NAME);
  } catch (e) {
    throw new EraseRefused(e instanceof Error ? e.message : String(e));
  }

  const name = getAccount(id)?.name ?? null;
  let wallets = 0;
  for (const w of walletsOf(id)) if (unlinkWallet(w.address, id)) wallets++;
  cancelSelfTx(id);
  const friendIds = d.friends?.forget(id) ?? [];
  if (friendIds.length) d.friendsChanged?.(friendIds);
  const report: EraseReport = {
    id, placeholder, name,
    monopolyGames: anonymizeResults(id, placeholder),
    cardsGames: anonymizeCardsResults(id, placeholder),
    dailyAttempts: eraseCardsDaily(id) + erasePokerDaily(id),
    tournaments,
    wallets,
    friends: friendIds.length,
    chosenName: forgetChosenName(id),
    host: revokeHost(id),
    account: forgetAccount(id),
  };
  if (isMuted(id)) setMute(id, '', 0, 'erase');
  clearCardCache();
  return report;
}
