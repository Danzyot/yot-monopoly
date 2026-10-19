// The audit's view of the invite log: every join, who brought them in, and
// what makes it look like one person behind two accounts.
//
// The log itself only knows Discord. What makes an invite suspicious is mostly
// what the SITE knows — the invited account signing in from the inviter's
// browser, or from their address — so that is joined in here, live, every
// time the page is opened. A member who joins today and first plays next week
// is flagged next week without anything having to remember to re-check them.
import { playerRows, suspectedAlts } from './audit.ts';
import { banAt } from './bans.ts';
import { accountAgeDays, ageText, inviteJoins, isYoung, type InviteJoin } from './invitelog.ts';

export interface SiteAccount { id: string; name: string; avatar: string }

export interface InviteRow extends InviteJoin {
  ageDays: number;
  young: boolean;
  member: SiteAccount | null;
  inviter: SiteAccount | null;
  flags: string[];
}

export interface InviterRow {
  inviterId: string;
  inviterName: string;
  inviter: SiteAccount | null;
  invited: number;
  fresh: number;
  flagged: number;
  banned: boolean;
}

export function inviteReport(limit = 500): { joins: InviteRow[]; inviters: InviterRow[]; total: number } {
  const rows = playerRows();
  const byDiscord = new Map<string, SiteAccount>();
  for (const r of rows) {
    if (r.discordVerifiedId && !byDiscord.has(r.discordVerifiedId)) {
      byDiscord.set(r.discordVerifiedId, { id: r.id, name: r.name, avatar: r.avatar });
    }
  }
  const banned = (discordId: string | null, site: SiteAccount | null) =>
    (!!site && !!banAt('player', site.id)) || (!!discordId && (!!banAt('player', discordId) || !!banAt('player', `dc_${discordId}`)));

  // suspectedAlts scans every player; ask once per inviter, not once per join.
  const altsOf = new Map<string, Map<string, string>>();
  const altMap = (siteId: string) => {
    let m = altsOf.get(siteId);
    if (!m) {
      m = new Map(suspectedAlts(siteId).filter(a => a.strength !== 'invite').map(a => [a.id, a.strength]));
      altsOf.set(siteId, m);
    }
    return m;
  };

  const all = inviteJoins();
  const joins: InviteRow[] = all.map(j => {
    const member = byDiscord.get(j.memberId) ?? null;
    const inviter = j.inviterId ? byDiscord.get(j.inviterId) ?? null : null;
    const flags: string[] = [];
    const young = isYoung(j);
    if (young && j.inviterId) flags.push(`fresh account (${ageText(accountAgeDays(j))})`);
    if (member && inviter) {
      const s = altMap(inviter.id).get(member.id);
      if (s === 'browser') flags.push('same browser as the inviter on the site');
      else if (s === 'address') flags.push('same address as the inviter on the site');
    }
    if (j.inviterId && banned(j.inviterId, inviter)) flags.push('inviter is banned');
    if (banned(j.memberId, member)) flags.push('banned');
    return { ...j, ageDays: accountAgeDays(j), young, member, inviter, flags };
  });

  const per = new Map<string, InviterRow>();
  for (const r of joins) {
    if (!r.inviterId) continue;
    const row = per.get(r.inviterId) ?? {
      inviterId: r.inviterId, inviterName: r.inviterName ?? r.inviterId, inviter: r.inviter,
      invited: 0, fresh: 0, flagged: 0, banned: banned(r.inviterId, r.inviter),
    };
    row.invited += 1;
    if (r.young) row.fresh += 1;
    if (r.flags.some(f => f.startsWith('same ') || f.startsWith('fresh'))) row.flagged += 1;
    per.set(r.inviterId, row);
  }
  const inviters = [...per.values()]
    .sort((a, b) => b.flagged - a.flagged || b.fresh - a.fresh || b.invited - a.invited)
    .slice(0, 200);

  return { joins: joins.slice(-limit).reverse(), inviters, total: all.length };
}
