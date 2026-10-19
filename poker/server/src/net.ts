// Recognising our own plumbing, kept apart from the socket layer so the audit
// can use it too. It lives here rather than in sockets.ts only because
// sockets.ts imports the audit — putting it there would close a cycle.

// Addresses arrive in a few spellings. Node hands back IPv4 as `::ffff:1.2.3.4`
// on a dual-stack listener, IPv6 can be bracketed or carry a zone index, and
// none of that belongs in an audit row: left in, the same person is two rows
// and a ban on one misses the other.
export function normalisePeer(addr: string | null): string | null {
  if (!addr) return null;
  const a = addr.trim().replace(/^\[|\]$/g, '').split('%')[0].replace(/^::ffff:/i, '');
  return a || null;
}

// Is this address a piece of infrastructure rather than a person?
//
// 100.64.0.0/10 is the one that matters here: carrier-grade NAT (RFC 6598),
// reserved for provider infrastructure and never assigned to a home
// connection. It is what Railway's proxy talks to us from, and because it was
// missing from this list the proxy looked like a member of the public — so
// X-Forwarded-For was discarded and the proxy's own address went into the
// audit, collapsing every player onto a handful of rows.
export function isInfraPeer(addr: string | null): boolean {
  const a = normalisePeer(addr);
  if (!a) return false;
  if (a === '::1') return true;
  if (/^127\./.test(a)) return true;
  if (/^10\./.test(a)) return true;
  if (/^192\.168\./.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a)) return true; // CGNAT
  if (/^169\.254\./.test(a)) return true;                              // link-local
  if (/^f[cd]/i.test(a)) return true;                                  // unique-local v6
  if (/^fe80:/i.test(a)) return true;                                  // link-local v6
  return false;
}
