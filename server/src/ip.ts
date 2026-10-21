// The address to hold a player to (bans, the per-IP socket cap, the audit),
// read from the right-hand end of X-Forwarded-For so a visitor cannot choose
// it. Ported from the poker room, where the details were learned the hard way.
import { isInfraPeer, normalisePeer } from './net.ts';

// How many proxies sit in front of this server, each appending one entry to
// X-Forwarded-For.
export function trustedProxyHops(): number {
  // Default 2, as poker learned on live traffic: a custom domain on Railway
  // puts a public edge in front of Railway's own proxy, and at 1 every visit
  // was recorded as whichever edge carried it (a different country each time).
  // Direct *.up.railway.app access still resolves at 2: the short chain falls
  // through to the proxy's own statement of the caller. Check the count at
  // /api/admin/ipdebug (ipdebug.ts) rather than guessing.
  const raw = Number(process.env.TRUSTED_PROXY_HOPS ?? 2);
  if (!Number.isFinite(raw)) return 2;
  return Math.min(5, Math.max(1, Math.trunc(raw)));
}

// The address to hold a player to, from the right-hand end of the chain.
//
// X-Forwarded-For is appended to by each proxy, so the right-hand end is what
// our own infrastructure observed and the left-hand end is whatever the client
// typed. Reading [0] meant the address was chosen by the visitor: an IP ban was
// one header away from useless, the per-address socket cap could be side-
// stepped by rotating the value, and the audit recorded whatever they felt like
// claiming. Counting back by the number of hops we own lands on the entry
// written by the outermost proxy we trust — the one nobody outside can forge.
//
// Two guards: the header is only worth anything when the peer is one of our
// own proxies (a public peer means nothing is in front of us and the header is
// just typed input), and a chain shorter than the configured hop count means
// the configuration is wrong, so it falls back to the peer address, which is
// observed rather than claimed and therefore never a lie.
// Internal hops are stripped by recognising them, however many there are —
// their number is not something we are told, and adding a custom domain
// silently added one. Public-addressed proxies are then stepped back over by
// count. Spoof resistance: a proxy appends, so whatever a visitor types sits
// at the left and everything right of it was observed by us; a chain shorter
// than the configuration claims resolves to the peer, because a
// misconfiguration must never resolve to a value the visitor chose.
export function clientIp(
  header: string | string[] | undefined,
  peer: string | null,
  extra?: Record<string, string | string[] | undefined>,
): string | null {
  const fallback = normalisePeer(peer);
  if (!isInfraPeer(peer)) return fallback;

  const chain = (Array.isArray(header) ? header.join(',') : header ?? '')
    .split(',').map(x => normalisePeer(x)).filter((x): x is string => !!x);

  let end = chain.length - 1;
  while (end >= 0 && isInfraPeer(chain[end])) end -= 1;

  if (end >= 0) {
    const idx = end - (trustedProxyHops() - 1);
    if (idx >= 0) return chain[idx];
    // Shorter than configured: never resolve to a value the visitor chose;
    // fall through to what the proxy itself states, then the observed peer.
  }

  for (const name of ['x-envoy-external-address', 'cf-connecting-ip', 'x-real-ip']) {
    const v = extra?.[name];
    const one = normalisePeer(Array.isArray(v) ? v[0] : v ?? null);
    if (one && !isInfraPeer(one)) return one;
  }

  return fallback;
}
