// Who connected from where. Every signed-in connection records the account,
// its Discord id, the address and the country, so an operator can find alt
// accounts (several accounts sharing an address) and ban by IP with evidence.
import { countryOf } from './geo.ts';
import { normaliseIp } from './bans.ts';
import { debouncedWriter, readJson } from './jsonstore.ts';

export interface AccountRow {
  id: string;
  name: string;
  discordId: string | null;
  discordName: string | null;
  avatar: string;
  firstSeen: number;
  lastSeen: number;
  ips: Record<string, { country: string | null; first: number; last: number; count: number }>;
}

const FILE = 'accounts.json';
let accounts: Record<string, AccountRow> = {};
const save = debouncedWriter(FILE, () => accounts);

export function loadAccounts(): void {
  accounts = readJson(FILE, {});
}

export function recordConnection(
  p: { id: string; name: string; avatar: string; discord?: { id: string; username: string } | null },
  rawIp: string | null,
): void {
  const now = Date.now();
  const row = accounts[p.id] ?? {
    id: p.id, name: p.name, discordId: null, discordName: null, avatar: p.avatar,
    firstSeen: now, lastSeen: now, ips: {},
  };
  row.name = p.name;
  row.avatar = p.avatar;
  row.discordId = p.discord?.id ?? row.discordId;
  row.discordName = p.discord?.username ?? row.discordName;
  row.lastSeen = now;
  const ip = normaliseIp(rawIp);
  if (ip) {
    const cell = row.ips[ip] ?? { country: countryOf(ip), first: now, last: now, count: 0 };
    cell.last = now;
    cell.count++;
    row.ips[ip] = cell;
    // Bound per-account history: keep the 50 most recent addresses.
    const keys = Object.keys(row.ips);
    if (keys.length > 50) {
      keys.sort((a, b) => row.ips[a].last - row.ips[b].last).slice(0, keys.length - 50).forEach(k => delete row.ips[k]);
    }
  }
  accounts[p.id] = row;
  save();
}

export function getAccount(id: string): AccountRow | null {
  return accounts[id] ?? null;
}

/** Accounts first seen at or after `since` (the home ticker counts them; it never names them). */
export function newAccounts(since: number): { id: string; firstSeen: number }[] {
  return Object.values(accounts).filter(a => a.firstSeen >= since).map(a => ({ id: a.id, firstSeen: a.firstSeen }));
}

/** Newest first, optionally filtered by name / id / Discord / IP substring. */
export function searchAccounts(q: string, limit = 200): AccountRow[] {
  const needle = q.trim().toLowerCase();
  return Object.values(accounts)
    .filter(a => !needle
      || a.name.toLowerCase().includes(needle)
      || a.id.toLowerCase().includes(needle)
      || (a.discordId ?? '').includes(needle)
      || (a.discordName ?? '').toLowerCase().includes(needle)
      || Object.keys(a.ips).some(ip => ip.includes(needle)))
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

/** Groups of 2+ accounts that have used the same address — likely alts. */
export function sharedIpGroups(): { ip: string; country: string | null; accounts: { id: string; name: string }[] }[] {
  const byIp = new Map<string, { country: string | null; accounts: { id: string; name: string }[] }>();
  for (const a of Object.values(accounts)) {
    for (const [ip, cell] of Object.entries(a.ips)) {
      const g = byIp.get(ip) ?? { country: cell.country, accounts: [] };
      g.accounts.push({ id: a.id, name: a.name });
      byIp.set(ip, g);
    }
  }
  return [...byIp.entries()]
    .filter(([, g]) => g.accounts.length > 1)
    .map(([ip, g]) => ({ ip, ...g }))
    .sort((a, b) => b.accounts.length - a.accounts.length);
}

export function forgetAccount(id: string): boolean {
  if (!accounts[id]) return false;
  delete accounts[id];
  save();
  return true;
}
