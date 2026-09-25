// Turning VPN users away at the door.
//
// This is the only piece of the site that can refuse someone before they have
// done anything, so the whole design is about being able to UNDO it in a
// hurry. A misfiring block during a live tournament locks out the field, and
// the thing you would reach for to switch it off is behind the same block.
//
// So, in order:
//   - It is OFF unless switched on. Shipping it changes nothing.
//   - A bypass key in the URL sets a cookie that exempts that browser, which
//     is how the operator gets back in when everything else is shut.
//   - Named addresses are never blocked.
//   - /api/health is never blocked, so "is the server even up" is answerable.
//   - The offline lists answer instantly and never fail. The optional API is
//     not on this path at all.
import type express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isInfraPeer } from './net.ts';
import { classify, type VpnKind } from './vpn.ts';
import { vpnBlockOn } from './vpnsetting.ts';

const COOKIE = 'wawa_vpn_bypass';
// Long enough that an operator is not re-doing it every session, short enough
// that a leaked link stops working.
const BYPASS_DAYS = 30;

// The stored switch, with the environment able to force it off. See
// vpnsetting.ts for why the override only goes one way.
export function blockEnabled(): boolean {
  return vpnBlockOn();
}

// Addresses that are never turned away, whatever the lists say. The operator's
// own connection belongs here if they use a VPN themselves.
function allowedAddresses(): Set<string> {
  return new Set(
    (process.env.VPN_ALLOW_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  );
}

// The cookie is signed rather than a bare flag, so it cannot simply be set by
// hand from a browser console to walk through the door.
function bypassSecret(): string | null {
  return process.env.VPN_BYPASS_KEY?.trim() || null;
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

function validBypassCookie(raw: string | undefined, secret: string): boolean {
  if (!raw) return false;
  const [expiry, mac] = raw.split('.');
  if (!expiry || !mac) return false;
  const until = Number(expiry);
  if (!Number.isFinite(until) || until < Date.now()) return false;
  const want = sign(expiry, secret);
  // Same length by construction, but compare in constant time anyway rather
  // than leaking how much of a guess was right.
  if (mac.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(want));
}

function issueBypass(req: express.Request, res: express.Response, secret: string): void {
  const until = Date.now() + BYPASS_DAYS * 86_400_000;
  const value = `${until}.${sign(String(until), secret)}`;
  res.cookie(COOKIE, value, {
    httpOnly: true, sameSite: 'lax',
    // Secure in production, where this is always https. Pinned to the actual
    // request instead of hard-coded true so the escape hatch can be rehearsed
    // against a local server — the one place you want to find out it works.
    secure: req.secure,
    maxAge: BYPASS_DAYS * 86_400_000,
  });
}

// Read one cookie without taking a dependency for it.
function cookie(req: express.Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const DENIED_PAGE = (kind: VpnKind) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Access denied</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#0b0e14; color:#e9edf4; font:16px/1.6 system-ui, -apple-system, sans-serif; padding:24px; }
  main { max-width:30rem; text-align:center; }
  h1 { font-size:1.4rem; margin:0 0 12px; }
  p { color:#9aa5b8; margin:0 0 10px; }
  code { background:#151a24; border:1px solid #262f40; border-radius:6px; padding:1px 6px; font-size:0.9em; }
</style>
</head><body><main>
<h1>Access denied</h1>
<p>This site is not available over a ${kind === 'vpn' ? 'VPN' : 'hosting or datacenter'} connection.</p>
<p>Turn off your VPN or proxy and reload the page.</p>
<p>If you are not using one, contact the tournament host and quote <code>${kind}</code>.</p>
</main></body></html>`;

// Everything the gate decided, so the caller can log it rather than guess.
export interface GateDecision {
  blocked: boolean;
  kind: VpnKind | null;
  reason: 'off' | 'infra' | 'allowlisted' | 'bypass' | 'exempt-path' | 'clean' | 'blocked';
}

export function decide(req: express.Request, ip: string | null): GateDecision {
  if (!blockEnabled()) return { blocked: false, kind: null, reason: 'off' };
  // Health has to answer even when the door is shut, or there is no way to
  // tell a blocked site from a dead one.
  if (req.path === '/api/health') return { blocked: false, kind: null, reason: 'exempt-path' };
  // Our own proxy is not a player, and a private address has no verdict.
  if (isInfraPeer(ip)) return { blocked: false, kind: null, reason: 'infra' };
  if (ip && allowedAddresses().has(ip)) return { blocked: false, kind: null, reason: 'allowlisted' };

  const secret = bypassSecret();
  if (secret && validBypassCookie(cookie(req, COOKIE), secret)) {
    return { blocked: false, kind: null, reason: 'bypass' };
  }

  const { kind } = classify(ip);
  if (!kind) return { blocked: false, kind: null, reason: 'clean' };
  return { blocked: true, kind, reason: 'blocked' };
}

// The middleware. `clientIp` is passed in rather than read here because the
// server already knows how to count proxy hops properly and this must use the
// same answer — blocking on the proxy's own address would turn everyone away.
export function vpnGate(clientIp: (req: express.Request) => string | null) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // The way back in. Checked before anything else so it works from a
    // blocked connection, which is the only time it is needed.
    const secret = bypassSecret();
    const offered = typeof req.query.vpnbypass === 'string' ? req.query.vpnbypass : null;
    if (secret && offered) {
      const a = Buffer.from(offered);
      const b = Buffer.from(secret);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        issueBypass(req, res, secret);
        // Redirect so the key does not stay in the address bar, in history,
        // or in a screenshot of a shared screen.
        res.redirect(302, req.path);
        return;
      }
    }

    const d = decide(req, clientIp(req));
    if (!d.blocked) { next(); return; }
    // An API caller gets JSON; a browser gets the page. Handing a React app
    // HTML in place of its data produces a confusing crash rather than a
    // clear refusal.
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io')) {
      res.status(403).json({ error: `Access denied: this site is not available over a ${d.kind} connection.` });
      return;
    }
    res.status(403).type('html').send(DENIED_PAGE(d.kind ?? 'vpn'));
  };
}
