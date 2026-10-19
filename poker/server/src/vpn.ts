// Is this address a VPN, a proxy, or a datacenter?
//
// What this can and cannot do, so nobody is surprised later:
//
// It reliably catches COMMERCIAL VPNs and hosting networks — NordVPN, Proton,
// Mullvad, a box on DigitalOcean. Those live on ranges that belong to
// providers, and a home connection is never on one.
//
// It does NOT catch residential proxies, which route through real ISP
// addresses on real home connections and are indistinguishable from a genuine
// player by address alone. They cost a few dollars. So this raises the floor
// against the casual and the careless; it is not a wall against somebody
// determined, and it must never be treated as proof of anything on its own.
//
// The data is two pairs of published range lists, checked into the repo
// rather than fetched at boot: an event must not depend on somebody else's
// server being up, and a build must not fail because GitHub is having a bad
// afternoon. scripts/refresh-vpn-lists.sh brings them up to date.
//
// The lists are kept SEPARATE because they are not nested — two thirds of the
// known-VPN ranges do not appear in the datacenter list at all, so checking
// only the broader-sounding one would miss most commercial VPNs.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalisePeer } from './net.ts';

const __dir = dirname(fileURLToPath(import.meta.url));
// NOT under server/data: that path is the runtime state directory and is
// gitignored, so the lists would never have reached a deploy — and an empty
// list blocks nobody while the boot log still says the door is shut.
const DATA = join(__dir, '..', 'vpn-ranges');

export type VpnKind = 'vpn' | 'datacenter';
export interface VpnVerdict {
  kind: VpnKind | null;
  // Where the answer came from, so a surprising block can be explained.
  source: 'list' | 'api' | 'none';
}

// ---------- parsing ----------

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255 || p === '') return null;
    n = (n * 256) + b;
  }
  return n;
}

// Full 128 bits as a BigInt. Handles '::' compression and a trailing IPv4.
function v6ToBig(ip: string): bigint | null {
  let s = ip;
  // A v6 address may end in dotted-quad form (::ffff:1.2.3.4).
  const tail = s.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4ToInt(tail[1]);
    if (n === null) return null;
    const hi = (n >>> 16) & 0xffff;
    const lo = n & 0xffff;
    s = `${s.slice(0, tail.index)}:${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':').filter(x => x !== '') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':').filter(x => x !== '') : []) : [];
  const groups = halves.length === 2
    ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest]
    : head;
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

// A parsed list: start/end pairs, sorted by start, so a lookup is a binary
// search rather than a walk over sixty thousand ranges on every request.
interface V4List { starts: Uint32Array; ends: Uint32Array }
interface V6List { starts: bigint[]; ends: bigint[] }

function parseV4(lines: string[]): V4List {
  const rows: [number, number][] = [];
  for (const line of lines) {
    const [addr, bitsRaw] = line.split('/');
    const start = v4ToInt(addr);
    if (start === null) continue;
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const size = bits === 0 ? 4294967296 : 2 ** (32 - bits);
    rows.push([start, start + size - 1]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const starts = new Uint32Array(rows.length);
  const ends = new Uint32Array(rows.length);
  rows.forEach(([s, e], i) => { starts[i] = s; ends[i] = e; });
  return { starts, ends };
}

function parseV6(lines: string[]): V6List {
  const rows: [bigint, bigint][] = [];
  for (const line of lines) {
    const [addr, bitsRaw] = line.split('/');
    const start = v6ToBig(addr);
    if (start === null) continue;
    const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) continue;
    const span = (1n << BigInt(128 - bits)) - 1n;
    rows.push([start, start + span]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return { starts: rows.map(r => r[0]), ends: rows.map(r => r[1]) };
}

function readList(file: string): string[] {
  const path = join(DATA, file);
  if (!existsSync(path)) {
    console.warn(`VPN list missing: ${file} — those addresses will not be recognised`);
    return [];
  }
  return readFileSync(path, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

// ---------- the lists ----------

interface Loaded { v4: V4List; v6: V6List }
const lists: Record<VpnKind, Loaded> = {
  // Order matters for reporting only: an address in both is called a VPN,
  // which is the more specific and more useful thing to tell an operator.
  vpn: { v4: { starts: new Uint32Array(), ends: new Uint32Array() }, v6: { starts: [], ends: [] } },
  datacenter: { v4: { starts: new Uint32Array(), ends: new Uint32Array() }, v6: { starts: [], ends: [] } },
};
let loaded = false;

export function loadVpnLists(): { vpn: number; datacenter: number } {
  lists.vpn = { v4: parseV4(readList('vpn-v4.txt')), v6: parseV6(readList('vpn-v6.txt')) };
  lists.datacenter = {
    v4: parseV4(readList('datacenter-v4.txt')),
    v6: parseV6(readList('datacenter-v6.txt')),
  };
  loaded = true;
  cache.clear();
  return {
    vpn: lists.vpn.v4.starts.length + lists.vpn.v6.starts.length,
    datacenter: lists.datacenter.v4.starts.length + lists.datacenter.v6.starts.length,
  };
}

// Rightmost range whose start is <= n, then one containment test. Ranges from
// these sources can overlap, so a hit is also checked against the few
// preceding rows — a wide /12 sitting before a narrow /24 would otherwise
// hide it.
const BACKTRACK = 64;

function inV4(list: V4List, n: number): boolean {
  let lo = 0; let hi = list.starts.length - 1; let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list.starts[mid] <= n) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  for (let i = found; i >= 0 && i > found - BACKTRACK; i--) {
    if (list.ends[i] >= n) return true;
  }
  return false;
}

function inV6(list: V6List, n: bigint): boolean {
  let lo = 0; let hi = list.starts.length - 1; let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list.starts[mid] <= n) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  for (let i = found; i >= 0 && i > found - BACKTRACK; i--) {
    if (list.ends[i] >= n) return true;
  }
  return false;
}

// ---------- the question everyone actually asks ----------

const cache = new Map<string, VpnVerdict>();
const CACHE_MAX = 20_000;

// Purely the offline lists. Synchronous, so it can sit in front of a page
// load without holding the response open.
export function classify(ip: string | null): VpnVerdict {
  if (!loaded) loadVpnLists();
  const a = normalisePeer(ip ?? null);
  if (!a) return { kind: null, source: 'none' };
  const hit = cache.get(a);
  if (hit) return hit;

  let kind: VpnKind | null = null;
  const n4 = v4ToInt(a);
  if (n4 !== null) {
    if (inV4(lists.vpn.v4, n4)) kind = 'vpn';
    else if (inV4(lists.datacenter.v4, n4)) kind = 'datacenter';
  } else {
    const n6 = v6ToBig(a);
    if (n6 !== null) {
      if (inV6(lists.vpn.v6, n6)) kind = 'vpn';
      else if (inV6(lists.datacenter.v6, n6)) kind = 'datacenter';
    }
  }
  const verdict: VpnVerdict = { kind, source: kind ? 'list' : 'none' };
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(a, verdict);
  return verdict;
}

// ---------- the optional second opinion ----------

// proxycheck.io, only when a key is set. The offline lists are the primary
// check and work alone; this catches some of what they cannot see.
//
// It is deliberately NOT on the page-load path — a third party having a slow
// afternoon must not become this site having a slow afternoon. It runs after
// the fact, from the audit, and its answers land in the same cache the
// blocker reads, so a confirmed proxy is shut out from the next request on.
export function apiConfigured(): boolean {
  return !!process.env.PROXYCHECK_API_KEY?.trim();
}

export async function askProxycheck(ip: string): Promise<VpnVerdict> {
  const key = process.env.PROXYCHECK_API_KEY?.trim();
  const a = normalisePeer(ip);
  if (!key || !a) return { kind: null, source: 'none' };
  try {
    const url = `https://proxycheck.io/v2/${encodeURIComponent(a)}?key=${encodeURIComponent(key)}&vpn=1&asn=0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return { kind: null, source: 'none' };
    const body = await res.json() as Record<string, { proxy?: string; type?: string }>;
    const row = body[a];
    if (row?.proxy !== 'yes') return { kind: null, source: 'none' };
    // Their `type` distinguishes VPN from a hosting box; anything else they
    // call a proxy is recorded as a VPN, which is the stricter reading.
    const kind: VpnKind = /hosting|business/i.test(row.type ?? '') ? 'datacenter' : 'vpn';
    const verdict: VpnVerdict = { kind, source: 'api' };
    cache.set(a, verdict);
    return verdict;
  } catch {
    // A refusal, a timeout, an outage: the offline lists already had their
    // say, and a third party being unreachable must never turn into players
    // being turned away.
    return { kind: null, source: 'none' };
  }
}

// Exported for the tests, which need a clean slate between cases.
export function clearVpnCache(): void { cache.clear(); }
