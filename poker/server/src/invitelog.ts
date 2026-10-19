// Who joined the Discord through whose invite.
//
// Discord does not say which invite a new member used. What it does say is
// how many times each invite has been used, so the bot keeps the counts, and
// when someone joins it asks again: the invite whose count went up is the one
// they came through, and its creator is who invited them. That is the whole
// trick every invite tracker uses; this file is the bookkeeping for it, kept
// free of any network code so the attribution can be tested on its own.
//
// The point, for a card room, is alts. A member who keeps inviting fresh
// Discord accounts — days old, no history — that then sign in to the site from
// the same browser is farming entries, and this is where that shows.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.ts';

const FILE = join(DATA_DIR, 'invites.json');
const KEEP = 5_000;

export interface InviteInfo {
  code: string;
  uses: number;
  maxUses: number;
  inviterId: string | null;
  inviterName: string | null;
}

export type JoinHow = 'invite' | 'vanity' | 'ambiguous' | 'unknown';

export interface InviteJoin {
  memberId: string;
  memberName: string;
  memberAvatar: string | null;
  // When the member's Discord account was made, read from their id. A fresh
  // account joining through a member's invite is the pattern being watched.
  accountCreatedAt: number;
  joinedAt: number;
  how: JoinHow;
  code: string | null;
  inviterId: string | null;
  inviterName: string | null;
  // For 'ambiguous': the invites that moved at once, so the operator can see
  // the two or three people it was one of.
  candidates?: { code: string; inviterId: string | null; inviterName: string | null }[];
}

// When a Discord account was created, from its id (a snowflake carries its own
// timestamp, counted from the first second of 2015).
export function accountCreatedAt(snowflake: string): number {
  try {
    return Number((BigInt(snowflake) >> 22n) + 1_420_070_400_000n);
  } catch {
    return 0;
  }
}

export const DAY_MS = 86_400_000;
// Younger than this when they joined is "a fresh account".
export const YOUNG_ACCOUNT_DAYS = 30;

export function accountAgeDays(j: Pick<InviteJoin, 'accountCreatedAt' | 'joinedAt'>): number {
  return Math.max(0, Math.floor((j.joinedAt - j.accountCreatedAt) / DAY_MS));
}

// "3d old", or "under a day old" — "0d old" reads like a mistake.
export function ageText(days: number): string {
  return days < 1 ? 'under a day old' : `${days}d old`;
}

export function isYoung(j: Pick<InviteJoin, 'accountCreatedAt' | 'joinedAt'>): boolean {
  return j.accountCreatedAt > 0 && j.joinedAt - j.accountCreatedAt < YOUNG_ACCOUNT_DAYS * DAY_MS;
}

// Which invite a join used, from the counts before and after it.
//
// `deleted` is invites Discord removed in the last few seconds. A single-use
// invite (or one that just hit its limit) is deleted by the very join that
// used it, so it is gone from the "after" list instead of showing a higher
// count — without this, every one-use invite would read as "unknown".
export function attributeJoin(
  before: Map<string, InviteInfo>,
  after: Map<string, InviteInfo>,
  deleted: InviteInfo[],
  vanity: { before: number | null; after: number | null },
): Pick<InviteJoin, 'how' | 'code' | 'inviterId' | 'inviterName' | 'candidates'> {
  const moved = [...after.values()].filter(i => i.uses > (before.get(i.code)?.uses ?? 0));
  if (moved.length === 1) {
    const i = moved[0];
    return { how: 'invite', code: i.code, inviterId: i.inviterId, inviterName: i.inviterName };
  }
  if (moved.length > 1) {
    return {
      how: 'ambiguous', code: null, inviterId: null, inviterName: null,
      candidates: moved.map(i => ({ code: i.code, inviterId: i.inviterId, inviterName: i.inviterName })),
    };
  }
  // Nothing went up. An invite that vanished since the last look, and was one
  // use away from its limit, is the one.
  // An unlimited invite that disappears was deleted by a moderator or ran out
  // of time, not used up, so it says nothing about this join.
  const usedUp = deleted.filter(d => !after.has(d.code) && d.maxUses > 0 && d.uses + 1 >= d.maxUses);
  if (usedUp.length === 1) {
    const i = usedUp[0];
    return { how: 'invite', code: i.code, inviterId: i.inviterId, inviterName: i.inviterName };
  }
  if (vanity.before !== null && vanity.after !== null && vanity.after > vanity.before) {
    return { how: 'vanity', code: null, inviterId: null, inviterName: null };
  }
  return { how: 'unknown', code: null, inviterId: null, inviterName: null };
}

let joins: InviteJoin[] = [];

export function loadInviteLog(): void {
  try {
    if (!existsSync(FILE)) return;
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    if (Array.isArray(parsed)) joins = (parsed as InviteJoin[]).filter(j => typeof j?.memberId === 'string');
  } catch (e) {
    console.error('Could not load the invite log:', e);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function save(): void {
  if (saveTimer) return;
  // Joins come in bursts when an invite is posted somewhere; one write a
  // second is plenty.
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(joins));
      renameSync(tmp, FILE);
    } catch (e) {
      console.error('Could not save the invite log:', e);
    }
  }, 1_000);
  saveTimer.unref?.();
}

export function recordJoin(j: InviteJoin): void {
  joins.push(j);
  if (joins.length > KEEP) joins = joins.slice(-KEEP);
  save();
}

export function inviteJoins(): readonly InviteJoin[] {
  return joins;
}

// Every join this member is on either side of: the people they invited, and
// the join where they were invited themselves.
export function joinsInvolving(discordId: string): { invited: InviteJoin[]; invitedBy: InviteJoin[] } {
  return {
    invited: joins.filter(j => j.inviterId === discordId && j.memberId !== discordId),
    invitedBy: joins.filter(j => j.memberId === discordId && !!j.inviterId),
  };
}

// For tests.
export function resetInviteLog(): void {
  joins = [];
}
