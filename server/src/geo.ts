// Country lookup for the audit view, done entirely on this server.
//
// A third-party geo API would mean shipping players' IP addresses to someone
// else every time the operator opens the audit page; the offline database
// keeps that data here. Only the country tables are needed — the Docker build
// deletes the (much larger) city tables, and country lookups still work.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface GeoLookup { lookup(ip: string): { country?: string } | null }
let geo: GeoLookup | null = null;
try {
  geo = require('geoip-lite') as GeoLookup;
} catch {
  console.warn('geoip-lite unavailable — audit rows will show no country');
}

// ISO codes are unfriendly in a review screen; names are what the operator
// actually reads. Only the countries likely to show up need spelling out —
// anything else falls back to its code, which is still useful.
const NAMES: Record<string, string> = {
  AE: 'UAE', AR: 'Argentina', AT: 'Austria', AU: 'Australia', BE: 'Belgium',
  BG: 'Bulgaria', BR: 'Brazil', CA: 'Canada', CH: 'Switzerland', CL: 'Chile',
  CN: 'China', CO: 'Colombia', CY: 'Cyprus', CZ: 'Czechia', DE: 'Germany',
  DK: 'Denmark', EE: 'Estonia', EG: 'Egypt', ES: 'Spain', FI: 'Finland',
  FR: 'France', GB: 'United Kingdom', GR: 'Greece', HK: 'Hong Kong',
  HR: 'Croatia', HU: 'Hungary', ID: 'Indonesia', IE: 'Ireland', IL: 'Israel',
  IN: 'India', IS: 'Iceland', IT: 'Italy', JP: 'Japan', KE: 'Kenya',
  KR: 'South Korea', LT: 'Lithuania', LU: 'Luxembourg', LV: 'Latvia',
  MA: 'Morocco', MT: 'Malta', MX: 'Mexico', MY: 'Malaysia', NG: 'Nigeria',
  NL: 'Netherlands', NO: 'Norway', NZ: 'New Zealand', PE: 'Peru',
  PH: 'Philippines', PL: 'Poland', PT: 'Portugal', RO: 'Romania',
  RS: 'Serbia', RU: 'Russia', SA: 'Saudi Arabia', SE: 'Sweden',
  SG: 'Singapore', SI: 'Slovenia', SK: 'Slovakia', TH: 'Thailand',
  TR: 'Türkiye', TW: 'Taiwan', UA: 'Ukraine', US: 'United States',
  VN: 'Vietnam', ZA: 'South Africa',
};

const cache = new Map<string, string | null>();

// Country for an address, or null when it cannot be placed (private ranges,
// unknown blocks). Cached: the same handful of addresses is looked up on
// every audit refresh.
export function countryOf(ip: string): string | null {
  if (!ip) return null;
  const hit = cache.get(ip);
  if (hit !== undefined) return hit;
  let name: string | null = null;
  try {
    // Strip an IPv6-mapped IPv4 prefix and any port.
    const clean = ip.replace(/^::ffff:/, '').replace(/^\[|\]$/g, '').split('%')[0];
    const code = geo?.lookup(clean)?.country;
    if (code) name = NAMES[code] ?? code;
  } catch { /* malformed address — treated as unknown */ }
  cache.set(ip, name);
  return name;
}
