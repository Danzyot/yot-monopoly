// Small HTTP helpers shared by the route files.
import type express from 'express';
import { verifyToken } from './auth.ts';
import { findBan, banMessage } from './bans.ts';
import { logGameEvent } from './eventlog.ts';
import type { PlayerProfile } from '../../shared/types.ts';

/** The origin the visitor is actually browsing on. */
export function requestBase(req: express.Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

export function authed(req: express.Request): PlayerProfile | null {
  const header = req.headers.authorization;
  return verifyToken(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
}

/** Operator-only routes: 401 without a session, 403 for non-operators or banned. */
export function requireAdmin(req: express.Request, res: express.Response): PlayerProfile | null {
  const p = authed(req);
  if (!p) { res.status(401).json({ error: 'Sign in first' }); return null; }
  const ban = findBan({ id: p.id, discordId: p.discord?.id, ip: req.ip });
  if (ban) { res.status(403).json({ error: banMessage(ban) }); return null; }
  if (!p.isAdmin) { res.status(403).json({ error: 'Operators only' }); return null; }
  return p;
}

/** Every operator action lands in the durable log under "admin". */
export function adminLog(by: PlayerProfile, text: string): void {
  logGameEvent('admin', 'Operator actions', `${by.name} (${by.discord?.username ?? by.id}): ${text}`);
}

export function fail(res: express.Response, e: unknown, status = 400): void {
  res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
}

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 20_000;
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 60_000).unref();

/** In-memory per-IP limiter; bounded so a flood cannot become a memory leak. */
export function rateLimit(max: number, windowMs: number): express.RequestHandler {
  return (req, res, next) => {
    if (process.env.RATE_LIMIT_OFF === '1') return next();
    const key = `${req.ip}:${max}:${req.baseUrl}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      if (buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      res.setHeader('Retry-After', Math.ceil((b.resetAt - now) / 1000));
      res.status(429).json({ error: 'Too many requests — slow down' });
      return;
    }
    next();
  };
}
