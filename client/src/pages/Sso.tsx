// /sso?return=<url>: sign in here, carry on there. Poker's "Sign in via Chog
// Games" button lands on this page; a signed-in player is sent straight back
// to `return` with their token on the hash (#dtoken=, which poker reads on any
// route); anyone else gets the sign-in dialog first, and goes back the same way
// once it is done. Discord sign-in leaves and returns to this very URL, so the
// return address survives the round trip. Only poker and this site are valid
// return addresses (pokerLink.ts safeReturnUrl).
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { getToken } from '../api.ts';
import { BRAND, GAMES, POKER_URL } from '../../../shared/brand.ts';
import { safeReturnUrl, withToken } from '../pokerLink.ts';

export default function Sso() {
  const { profile, ready, openSignIn, signInOpen } = useAuth();
  const [params] = useSearchParams();
  const raw = params.get('return');
  const target = safeReturnUrl(raw);
  const toPoker = !!target && new URL(target).host === new URL(POKER_URL).host;
  const [asked, setAsked] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => { document.title = `Sign in · ${BRAND.name}`; return () => { document.title = BRAND.name; }; }, []);

  useEffect(() => {
    if (!ready || !target) return;
    const token = getToken();
    if (profile && token) {
      setLeaving(true);
      location.replace(withToken(target, token));
    } else if (!profile && !asked) {
      // Once: closing the dialog leaves the button below rather than reopening it.
      setAsked(true);
      openSignIn();
    }
  }, [ready, profile, target, asked, openSignIn]);

  if (!target) {
    return (
      <div className="page center-msg sso-page">
        <h2>That link can’t be used</h2>
        <p className="muted">{raw ? `Sign-ins are only handed to ${GAMES.poker.name} or this site, not to other addresses.` : 'This page needs to know where to send you back to.'}</p>
        <div className="row center wrap">
          <Link className="btn primary" to="/">Home</Link>
          <a className="btn" href={POKER_URL}>{GAMES.poker.name}</a>
        </div>
      </div>
    );
  }

  const where = toPoker ? GAMES.poker.name : BRAND.name;
  return (
    <div className="page center-msg sso-page" aria-live="polite">
      {leaving || (profile && ready) ? (
        <p className="muted">Signed in as <b>{profile?.name}</b> — taking you to {where}…</p>
      ) : !ready ? (
        <p className="muted">Checking your sign-in…</p>
      ) : (
        <>
          <h2>Sign in to {BRAND.name}</h2>
          <p className="muted">One sign-in covers {GAMES.monopoly.name}, {GAMES.cards.name} and {GAMES.poker.name}. You’ll go back to {where} as soon as you’re in.</p>
          {!signInOpen && <button className="btn primary big" onClick={openSignIn}>Sign in</button>}
        </>
      )}
    </div>
  );
}
