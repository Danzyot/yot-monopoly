// The Chog Games hub this room belongs to (choggames.com). The hub and this
// service are two Railway services sharing one Discord application and one
// token secret, so a player signed in on the hub is signed in here: the hub's
// /sso bounces the browser back with the same `#dtoken=` the Discord callback
// uses, and verifyToken accepts it because the HMAC key is the same. Nothing
// here trusts the hub by name — only the shared secret does any vouching.

/** The hub's public URL, for the header link and "Sign in via Chog Games".
 *  HUB_URL=off hides both (a standalone deployment). */
export function hubUrl(): string | null {
  const raw = process.env.HUB_URL;
  if (raw === undefined) return 'https://choggames.com';
  const v = raw.trim().replace(/\/+$/, '');
  if (!v || /^(off|0|false|none)$/i.test(v)) return null;
  try {
    const u = new URL(/^https?:\/\//.test(v) ? v : `https://${v}`);
    return u.origin;
  } catch {
    return null;
  }
}

/** Origins allowed to read this room's public, read-only endpoints from a
 *  browser: the hub itself plus HUB_ORIGINS (comma separated — the hub's
 *  Railway domain during cutover, a staging hub). */
export function hubOrigins(): Set<string> {
  const out = new Set<string>();
  const hub = hubUrl();
  if (hub) out.add(hub);
  for (const raw of (process.env.HUB_ORIGINS ?? '').split(/[\s,]+/)) {
    const v = raw.trim().replace(/\/+$/, '');
    if (!v) continue;
    try { out.add(new URL(/^https?:\/\//.test(v) ? v : `https://${v}`).origin); } catch { /* skip junk */ }
  }
  return out;
}

export function isHubOrigin(origin: string | undefined): boolean {
  return !!origin && hubOrigins().has(origin);
}

/** The read-only endpoints the hub may read from a browser: the all-time
 *  leaderboard and a finished tournament's results (profiles), and the
 *  tournament list (the hub's /poker page: live, upcoming, just finished —
 *  what this room's own home page shows anyone). Nothing that writes, and
 *  nothing that needs a token. */
export const HUB_READABLE = /^\/api\/(leaderboard|lobby|results\/[^/]+)$/;
