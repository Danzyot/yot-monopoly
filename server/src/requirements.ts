// Discord requirements for taking a seat in a room: membership of the site's
// Discord server and/or holding one of its roles. Watching is never gated.
//
// Identities (and their OAuth tokens) live in memory only, so after a restart
// the bot is the only thing that can still answer "is this person a member".
// Every failure therefore says which of three things is true — not in the
// server, lacks the role, or we genuinely could not tell — because telling
// someone who IS a member "join the server" is how support threads start.

import { botEnabled, defaultGuildId, defaultInviteUrl, fetchGuildRoles, guildMembership, type MembershipInfo } from './discord.ts';
import type { DiscordGateInfo, JoinRequirements, PlayerProfile, RequirementFailure } from '../../shared/types.ts';

export type MembershipLookup = (discordUserId: string, guildId: string) => Promise<MembershipInfo>;
export type RolesLookup = (guildId: string) => Promise<{ id: string; name: string }[]>;

/** How long a Discord lookup may take before we call it unverifiable. */
const LOOKUP_TIMEOUT_MS = 6_000;
const ROLES_CACHE_MS = 5 * 60_000;

// ---- dev-only fake Discord ---------------------------------------------------
// DEMO_MODE has no Discord at all, which makes the gate impossible to try out
// locally. DEV_FAKE_DISCORD=1 (honoured ONLY together with DEMO_MODE, and never
// with NODE_ENV=production) fakes a server with two roles and decides each
// player's membership from their demo name: "member…" is a member, "vip…" a
// member with the VIP role, "unknown…" cannot be verified, anyone else is not
// in the server.
const FAKE_GUILD = '100000000000000001';
const FAKE_ROLES = [{ id: '200000000000000001', name: 'VIP' }, { id: '200000000000000002', name: 'Regular' }];

export function devFakeDiscord(): boolean {
  // Same test as auth.ts demoMode(), read directly: importing auth.ts creates the
  // login secret on disk, and rooms.ts (and its tests) import this module.
  return process.env.DEV_FAKE_DISCORD === '1' && process.env.DEMO_MODE === '1' && process.env.NODE_ENV !== 'production';
}

const fakeNames = new Map<string, string>();

async function fakeMembership(discordUserId: string): Promise<MembershipInfo> {
  const name = (fakeNames.get(discordUserId) ?? '').toLowerCase();
  if (name.startsWith('unknown')) return { member: false, roleIds: [], authoritative: false };
  if (name.startsWith('vip')) return { member: true, roleIds: [FAKE_ROLES[0].id], authoritative: true };
  if (name.startsWith('member')) return { member: true, roleIds: [], authoritative: true };
  return { member: false, roleIds: [], authoritative: true };
}

// ---- injectable lookups (tests stub these) ------------------------------------

let membershipLookup: MembershipLookup | null = null;
let rolesLookup: RolesLookup | null = null;

/** Replace the Discord membership check (tests). Pass null to restore the real one. */
export function setMembershipLookup(fn: MembershipLookup | null): void {
  membershipLookup = fn;
}

/** Replace the guild-roles lookup (tests). Pass null to restore the real one. */
export function setRolesLookup(fn: RolesLookup | null): void {
  rolesLookup = fn;
  rolesCache = null;
}

function lookupMembership(discordUserId: string, guildId: string): Promise<MembershipInfo> {
  if (membershipLookup) return membershipLookup(discordUserId, guildId);
  if (devFakeDiscord()) return fakeMembership(discordUserId);
  return guildMembership(discordUserId, guildId);
}

/** The server a room may be gated on: the site's own, or none. */
export function gateGuildId(): string | null {
  if (devFakeDiscord()) return FAKE_GUILD;
  return defaultGuildId();
}

/** Roles can only be listed and checked reliably through the bot. */
function rolesAvailable(): boolean {
  return !!rolesLookup || devFakeDiscord() || botEnabled();
}

let rolesCache: { at: number; guildId: string; roles: { id: string; name: string }[] } | null = null;

/** The guild's roles, cached briefly: every lobby that opens the picker asks. */
export async function guildRoles(guildId: string): Promise<{ id: string; name: string }[]> {
  if (rolesCache && rolesCache.guildId === guildId && Date.now() - rolesCache.at < ROLES_CACHE_MS) return rolesCache.roles;
  const roles = rolesLookup ? await rolesLookup(guildId)
    : devFakeDiscord() ? FAKE_ROLES
    : (await fetchGuildRoles(guildId)).map(r => ({ id: r.id, name: r.name }));
  rolesCache = { at: Date.now(), guildId, roles };
  return roles;
}

export async function gateInfo(): Promise<DiscordGateInfo> {
  const guildId = gateGuildId();
  const info: DiscordGateInfo = { available: !!guildId, roles: null, rolesNote: null, inviteUrl: defaultInviteUrl() };
  if (!guildId) return info;
  if (!rolesAvailable()) {
    info.rolesNote = 'Role requirements need the Discord bot (DISCORD_BOT_TOKEN).';
    return info;
  }
  try {
    info.roles = await guildRoles(guildId);
  } catch (e) {
    info.rolesNote = e instanceof Error ? e.message : 'Could not list the server roles';
  }
  return info;
}

/**
 * Validate what a host asked for and turn it into stored requirements.
 * Throws a plain-English Error when it cannot be honoured.
 */
export async function resolveRequirements(raw: unknown): Promise<JoinRequirements | null> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { member?: unknown; roleId?: unknown };
  const roleId = typeof r.roleId === 'string' && r.roleId.trim() ? r.roleId.trim() : null;
  const member = r.member === true || !!roleId;
  if (!member) return null;
  const guildId = gateGuildId();
  if (!guildId) throw new Error('This site has no Discord server configured (DISCORD_GUILD_ID)');
  if (!roleId) return { guildId, member: true, roleId: null, roleName: null };
  if (!/^\d{5,25}$/.test(roleId)) throw new Error('Unknown role');
  if (!rolesAvailable()) throw new Error('Role requirements need the Discord bot');
  const role = (await guildRoles(guildId)).find(x => x.id === roleId);
  if (!role) throw new Error('That role no longer exists in the Discord server');
  return { guildId, member: true, roleId, roleName: role.name.slice(0, 60) };
}

/** Restore stored requirements from a snapshot, tolerating anything malformed. */
export function sanitizeRequirements(raw: unknown): JoinRequirements | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.guildId !== 'string' || !/^\d{5,25}$/.test(r.guildId)) return null;
  const roleId = typeof r.roleId === 'string' && /^\d{5,25}$/.test(r.roleId) ? r.roleId : null;
  return {
    guildId: r.guildId,
    member: true,
    roleId,
    roleName: roleId && typeof r.roleName === 'string' ? r.roleName.slice(0, 60) : null,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** Human-readable "what is required" line, used in messages and badges. */
export function describeRequirements(req: JoinRequirements): string {
  return req.roleId ? `the ${req.roleName ?? 'required'} role in our Discord server` : 'membership of our Discord server';
}

/**
 * Check a player against a room's requirements. Returns null when they may sit
 * down, or what is missing. Operators are never gated.
 */
export async function checkRequirements(
  profile: PlayerProfile, req: JoinRequirements | null,
): Promise<RequirementFailure | null> {
  if (!req || profile.isAdmin) return null;
  const inviteUrl = defaultInviteUrl();
  const fail = (missing: RequirementFailure['missing'], message: string): RequirementFailure =>
    ({ missing, message, requirements: req, inviteUrl });

  // Demo accounts have no Discord; under the dev fake, their id stands in for one.
  let discordId = profile.discord?.id ?? null;
  if (!discordId && devFakeDiscord()) {
    discordId = profile.id;
    fakeNames.set(profile.id, profile.name);
  }
  if (!discordId) {
    return fail('discord', `This table needs ${describeRequirements(req)}. Sign in with Discord to take a seat — you can still watch.`);
  }

  let info: MembershipInfo;
  try {
    info = await withTimeout(lookupMembership(discordId, req.guildId), LOOKUP_TIMEOUT_MS);
  } catch {
    return fail('unverifiable', 'Discord did not answer when we checked your membership. Wait a moment and press Check again.');
  }

  const unverifiable = () => fail('unverifiable', botEnabled() || membershipLookup || devFakeDiscord()
    // The bot is configured but could not see the member (e.g. it is not in the server).
    ? 'We could not check your Discord membership right now. Press Check again in a moment, or ask the host.'
    // No bot: only the player's own sign-in can show their servers, and that is
    // forgotten whenever the site restarts.
    : 'We could not check your Discord membership. Sign out, then sign in again with "Log in with Discord" (not the code) so we can see your servers, and press Check again.');

  if (!info.authoritative && !info.member) return unverifiable();
  if (!info.member) {
    return fail('member', 'You are not in our Discord server yet. Join it with the invite below, then press Check again.');
  }
  if (req.roleId) {
    // Only an authoritative lookup carries roles; a sign-in snapshot does not.
    if (!info.authoritative) return unverifiable();
    if (!info.roleIds.includes(req.roleId)) {
      return fail('role', `You are in our Discord server but do not have the ${req.roleName ?? 'required'} role. Ask a server admin for it, then press Check again.`);
    }
  }
  return null;
}
