// Hosting rights: who may host on Poker (its tables and its tournaments).
// Hub tournaments (Cards) are for operators only and do not ask here.
// The single source of truth for the whole site: hub code imports canHost
// from here, and poker asks the hub over a signed request (routes/hosting.ts).
//
// A player may host when they are an operator (ADMIN_DISCORD_IDS), hold a
// Chog Genesis in a verified wallet, or have been approved by an operator in
// the dashboard. The approved list is one small JSON file on the data volume
// (hosts.json), like wallets.json beside it.
import { isAdminId } from './auth.ts';
import { readJson, writeJson } from './jsonstore.ts';
import { HOLDINGS_TTL_MS, isChogHolder, verifyWallet } from './wallet/holders.ts';
import { allLinks, getHoldings, walletsOf } from './wallet/store.ts';

const FILE = 'hosts.json';

export type HostReason = 'admin' | 'holder' | 'approved';

export interface ApprovedHost {
  /** Profile id (`dc_<discord id>`). */
  id: string;
  /** Display name when approved, for the list; may be empty for someone never seen. */
  name: string;
  /** Operator who approved them. */
  addedBy: string;
  addedAt: number;
}

let hosts: ApprovedHost[] = [];
let loaded = false;

export function loadHosts(): void {
  const raw = readJson<{ hosts?: unknown }>(FILE, {});
  hosts = Array.isArray(raw.hosts)
    ? (raw.hosts as Partial<ApprovedHost>[])
      .filter(h => h && typeof h.id === 'string' && validId(h.id))
      .map(h => ({ id: h.id!, name: String(h.name ?? '').slice(0, 40), addedBy: String(h.addedBy ?? '').slice(0, 40), addedAt: Number(h.addedAt) || 0 }))
    : [];
  loaded = true;
}

function ready() {
  if (!loaded) loadHosts();
}

function save() {
  writeJson(FILE, { hosts });
}

/**
 * A profile id from what an operator typed: a profile id (`dc_…`, or `demo_…` on a demo
 * deployment) or a bare Discord user id. Throws with a message the dashboard can show.
 */
export function normalizeHostId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (/^\d{5,25}$/.test(s)) return `dc_${s}`;
  if (/^dc_\d{5,25}$/.test(s) || /^demo_[\w-]{1,40}$/.test(s)) return s;
  throw new Error('That is not a Discord id or a player id');
}

function validId(id: string): boolean {
  try { return normalizeHostId(id) === id; } catch { return false; }
}

export function listApprovedHosts(): ApprovedHost[] {
  ready();
  return [...hosts].sort((a, b) => b.addedAt - a.addedAt);
}

export function isApprovedHost(playerId: string): boolean {
  ready();
  return hosts.some(h => h.id === playerId);
}

/** Adds (or renames) an approved host. Returns the stored row. */
export function approveHost(rawId: unknown, name: string, by: string, now = Date.now()): ApprovedHost {
  ready();
  const id = normalizeHostId(rawId);
  const existing = hosts.find(h => h.id === id);
  if (existing) {
    if (name) existing.name = name.slice(0, 40);
    save();
    return existing;
  }
  const row: ApprovedHost = { id, name: name.slice(0, 40), addedBy: by.slice(0, 40), addedAt: now };
  hosts.push(row);
  save();
  return row;
}

/** True when someone was removed. */
export function revokeHost(rawId: unknown): boolean {
  ready();
  let id: string;
  try { id = normalizeHostId(rawId); } catch { return false; }
  const before = hosts.length;
  hosts = hosts.filter(h => h.id !== id);
  if (hosts.length === before) return false;
  save();
  return true;
}

/** Why this player may host, or null when they may not. Operator first, then holder, then approved. */
export function hostingReason(playerId: string): HostReason | null {
  if (!playerId) return null;
  if (isAdminId(playerId)) return 'admin';
  if (isChogHolder(playerId)) return 'holder';
  if (isApprovedHost(playerId)) return 'approved';
  return null;
}

/** May this player host on Poker? Operators, Chog Genesis holders and approved hosts may. */
export function canHost(playerId: string): boolean {
  return hostingReason(playerId) !== null;
}

/**
 * isChogHolder answers from the cache without regard to age, so a Chog sold last week would still
 * count. When someone's hosting rights are asked about, re-read any stale wallet in the background:
 * the next ask (poker caches for a minute) gets the fresh answer.
 */
export function refreshHoldingsInBackground(playerId: string, now = Date.now()): void {
  for (const link of walletsOf(playerId)) {
    const h = getHoldings(link.address);
    if (h && now - h.checkedAt < HOLDINGS_TTL_MS) continue;
    void verifyWallet(link).catch(() => {});
  }
}

export interface HolderHost {
  id: string;
  /** Chogs across the account's wallets, from the last reading. */
  chogs: number;
  /** Oldest reading among the wallets that hold, so a stale one is visible. */
  checkedAt: number;
}

/** Accounts that may host because a linked wallet holds a Chog (cache only). */
export function holderHosts(): HolderHost[] {
  const byOwner = new Map<string, HolderHost>();
  for (const link of allLinks()) {
    const h = getHoldings(link.address);
    if (!h || h.balance <= 0) continue;
    const row = byOwner.get(link.owner) ?? { id: link.owner, chogs: 0, checkedAt: h.checkedAt };
    row.chogs += h.balance;
    row.checkedAt = Math.min(row.checkedAt, h.checkedAt);
    byOwner.set(link.owner, row);
  }
  return [...byOwner.values()].sort((a, b) => b.chogs - a.chogs);
}

/** Test hook: forget everything in memory (the file is left alone). */
export function resetHostsForTest(): void {
  hosts = [];
  loaded = true;
}
