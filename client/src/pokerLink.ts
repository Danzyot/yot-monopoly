// Chog Poker is its own site (shared/brand.ts POKER_URL) behind the same
// sign-in secret and Discord app as this one, so a signed-in player can walk
// over without signing in again: the poker client reads `#dtoken=<token>` off
// the URL on any route, keeps it and clears the hash (poker/client/src/auth.tsx,
// the same hash its own Discord callback uses). Signed out, it is just the link.
// A demo-mode token only works there if poker runs in demo mode too.
//
// The hand-off also runs the other way: poker's "Sign in via Chog Games" button
// sends the browser to /sso?return=<poker URL> (pages/Sso.tsx), which signs the
// player in here if need be and sends them back with the token.
import { POKER_URL } from '../../shared/brand.ts';
import { getToken } from './api.ts';

/** `url` with the sign-in on its hash (any hash it had is replaced; a bare origin gets its slash). */
export function withToken(url: string, token: string): string {
  const u = new URL(url);
  u.hash = `dtoken=${encodeURIComponent(token)}`;
  return u.href;
}

/**
 * Click handler for links to poker (their href is the bare POKER_URL). On a plain click by a
 * signed-in player it goes there carrying the sign-in. The token never sits in the page's links,
 * so copying, dragging or sharing the link can't hand someone the account; middle-click or
 * modifier-click opens the plain link and poker asks them to sign in.
 */
export function openPoker(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }, signedIn: boolean): void {
  const token = signedIn ? getToken() : null;
  if (!token || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  location.assign(withToken(POKER_URL, token));
}

/**
 * Where /sso may send a player back to: poker (the host of POKER_URL), or this
 * site itself. Anything else — another host, a non-web scheme, an unparsable
 * string — is null, so a crafted link cannot carry a token away.
 */
export function safeReturnUrl(raw: string | null, origin = location.origin): string | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw, origin); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  const poker = new URL(POKER_URL);
  const ok = u.origin === origin
    || (u.protocol === 'https:' && (u.host === poker.host || u.host === 'poker.choggames.com'));
  return ok ? u.href : null;
}
