// A window onto what the proxies in front of us actually send (ported from
// poker/server/src/ipdebug.ts; GET /api/admin/ipdebug).
//
// Three explanations have been offered for why the recorded addresses look
// wrong — an unrecognised internal range, Railway's public edge, a VPN — and
// each was reasoning from a screenshot rather than from the traffic. Two were
// wrong. The chain is knowable, so it should be read rather than guessed at.
//
// This keeps the last few connections' raw headers in memory only: never
// written to disk, never in the audit, bounded so it cannot grow. It is
// operator-only, because it is a list of who connected from where.

export interface IpSample {
  at: number;
  who: string | null;          // player name, when signed in
  forwardedFor: string | null; // the raw chain, exactly as delivered
  realIp: string | null;
  envoyExternal: string | null;
  cfConnecting: string | null;
  peer: string | null;         // the socket's own view of who called
  resolved: string | null;     // what our code decided from all of the above
}

const MAX = 40;
const samples: IpSample[] = [];

const one = (v: string | string[] | undefined): string | null => {
  if (v === undefined) return null;
  return Array.isArray(v) ? v.join(', ') : v;
};

export function noteIpSample(
  headers: Record<string, string | string[] | undefined>,
  peer: string | null,
  resolved: string | null,
  who: string | null,
): void {
  samples.push({
    at: Date.now(),
    who,
    forwardedFor: one(headers['x-forwarded-for']),
    realIp: one(headers['x-real-ip']),
    envoyExternal: one(headers['x-envoy-external-address']),
    cfConnecting: one(headers['cf-connecting-ip']),
    peer,
    resolved,
  });
  if (samples.length > MAX) samples.splice(0, samples.length - MAX);
}

export function ipSamples(): IpSample[] {
  return [...samples].reverse(); // newest first
}

// Is the hop count still right?
//
// TRUSTED_PROXY_HOPS is load-bearing: get it wrong and every player is filed
// under whichever proxy they arrived through, which is how this started and
// why it went unnoticed for so long — nothing said anything, the addresses
// just quietly stopped being people. The number of proxies in front is not
// ours to control, and it changed once already when a custom domain was added.
//
// The proxy states the caller in X-Real-Ip on every request, so there is a
// second opinion available for free. It is not used to resolve the address —
// a header can be forged, and the resolver's spoof resistance comes from
// counting from the observed end — but disagreement is a reliable smoke alarm.
// Steady disagreement means the count no longer matches reality.
export function hopCountHealth(): {
  samples: number; disagreeing: number; healthy: boolean; hint: string;
} {
  const withBoth = samples.filter(s => s.realIp && s.resolved);
  const bad = withBoth.filter(s => s.realIp !== s.resolved);
  const healthy = bad.length === 0;
  return {
    samples: withBoth.length,
    disagreeing: bad.length,
    healthy,
    hint: withBoth.length === 0
      ? 'No connections recorded yet.'
      : healthy
        ? 'The address being recorded matches what the proxy reports. TRUSTED_PROXY_HOPS is correct.'
        : `${bad.length} of ${withBoth.length} connections resolved to something other than the address `
          + 'the proxy reports. TRUSTED_PROXY_HOPS is probably wrong for the current setup — compare '
          + '"forwardedFor" against "resolved" below and count again.',
  };
}
