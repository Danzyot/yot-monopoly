// What a deleted player (erase.ts) becomes in finished games other people
// played: a placeholder id of its own per deletion (so their old games do not
// pool into one "Deleted player" with everyone else's) that no profile,
// leaderboard row or card is ever built for.
import { randomBytes } from 'node:crypto';

export const DELETED_PREFIX = 'deleted-';
export const DELETED_NAME = 'Deleted player';

export const isDeletedId = (id: string) => id.startsWith(DELETED_PREFIX);

export function newDeletedId(): string {
  return `${DELETED_PREFIX}${randomBytes(6).toString('hex')}`;
}
