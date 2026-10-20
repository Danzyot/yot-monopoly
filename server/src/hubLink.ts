// Server-to-server requests from Chog Poker to this hub. Poker runs as its own
// Railway service and shares one secret with the hub (the hub's APP_SECRET is
// poker's CHOG_SECRET). A request carries a player id, a millisecond timestamp
// and an HMAC-SHA256 of both under that secret; nothing else vouches for it.
//
//   sig = hex(HMAC-SHA256(secret, `hub-link:${id}:${ts}`))
//
// A timestamp more than HUB_LINK_MAX_SKEW_MS away from now is refused, so a
// captured request stops working within a minute. Poker's counterpart is
// poker/server/src/hubLink.ts; the two must sign the same string.
//
// Only APP_SECRET counts: the generated secret.key on the data volume is this
// service's alone, so with APP_SECRET unset nothing can be shared and every
// request is refused.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const HUB_LINK_MAX_SKEW_MS = 60_000;

function sharedSecret(): string | null {
  const s = process.env.APP_SECRET;
  return s && s.length > 0 ? s : null;
}

export function hubLinkConfigured(): boolean {
  return sharedSecret() !== null;
}

export function signHubLink(id: string, ts: number, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(`hub-link:${id}:${ts}`).digest('hex');
}

export type HubLinkCheck = { ok: true; id: string } | { ok: false; status: number; error: string };

/** Checks `id`, `ts` and `sig` from a request's query. */
export function verifyHubLink(q: { id?: unknown; ts?: unknown; sig?: unknown }, now = Date.now()): HubLinkCheck {
  const secret = sharedSecret();
  if (!secret) return { ok: false, status: 503, error: 'APP_SECRET is not set, so there is no shared secret' };
  const id = typeof q.id === 'string' ? q.id : '';
  const ts = typeof q.ts === 'string' && /^\d{1,16}$/.test(q.ts) ? Number(q.ts) : NaN;
  const sig = typeof q.sig === 'string' ? q.sig : '';
  if (!id || id.length > 80 || !Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) {
    return { ok: false, status: 400, error: 'id, ts and sig are required' };
  }
  if (Math.abs(now - ts) > HUB_LINK_MAX_SKEW_MS) return { ok: false, status: 401, error: 'Stale request' };
  const expect = Buffer.from(signHubLink(id, ts, secret), 'hex');
  const got = Buffer.from(sig, 'hex');
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return { ok: false, status: 401, error: 'Bad signature' };
  return { ok: true, id };
}
