// Server-to-server requests from this room to the Chog Games hub, signed with
// the secret the two services share (this room's CHOG_SECRET, or APP_SECRET,
// equals the hub's APP_SECRET). The hub's counterpart is server/src/hubLink.ts
// at the repo root; the two must sign the same string:
//
//   sig = hex(HMAC-SHA256(secret, `hub-link:${id}:${ts}`))
//
// sent as ?id=&ts=&sig= on a GET. The hub refuses a timestamp more than a
// minute from its own clock. Only a secret set in the environment counts: the
// generated secret.key on the data volume is this room's alone, so nothing
// signed with it could be checked by the hub.
import { createHmac } from 'node:crypto';
import { hubUrl } from './hub.ts';

export function hubLinkSecret(): string | null {
  const s = process.env.CHOG_SECRET ?? process.env.APP_SECRET;
  return s && s.length > 0 ? s : null;
}

/** Whether this room can ask the hub anything: a hub address and a shared secret. */
export function hubLinkConfigured(): boolean {
  return hubUrl() !== null && hubLinkSecret() !== null;
}

export function signHubLink(id: string, ts: number, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(`hub-link:${id}:${ts}`).digest('hex');
}

const HUB_TIMEOUT_MS = 8_000;

/**
 * GET `<HUB_URL><path>?id=…&ts=…&sig=…` and parse the JSON. Null on anything
 * short of a 200 with a JSON body — no hub configured, a timeout, a refusal —
 * so callers only ever decide between "the hub said" and "unknown".
 */
export async function hubGet(path: string, id: string): Promise<unknown | null> {
  const base = hubUrl();
  const secret = hubLinkSecret();
  if (!base || !secret) return null;
  const ts = Date.now();
  const q = new URLSearchParams({ id, ts: String(ts), sig: signHubLink(id, ts, secret) });
  try {
    const res = await fetch(`${base}${path}?${q}`, { signal: AbortSignal.timeout(HUB_TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`Hub ${path} answered ${res.status} for ${id}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`Hub ${path} unreachable:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}
