// "Play now" in the home hero: one tap into the quickest game, Cards. The
// server (cards:quickJoin, server/src/quickJoin.ts) seats you at the open
// public lobby nearest to filling up, or opens a table with bots when there is
// none. Each game's own page has more ways in.
// Signed out, the sign-in dialog comes first and the tap carries on after it,
// even across Discord's round trip (the pending pick waits in sessionStorage).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { call } from '../net.ts';
import { chogPref } from '../cards/net.ts';
import { toastError } from '../toast.tsx';
import { GAMES } from '../../../shared/brand.ts';
import '../styles/home-alive.css';

type QuickGame = 'monopoly' | 'cards';

const PENDING_KEY = 'quickplay:pending';
/** A sign-in that takes longer than this (or is abandoned) does not throw anyone into a game later. */
const PENDING_MS = 10 * 60_000;

const isGame = (v: unknown): v is QuickGame => v === 'monopoly' || v === 'cards';

function setPending(g: QuickGame | null) {
  try {
    if (g) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ game: g, at: Date.now() }));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch { /* no storage: the sign-in still works, the tap is just not carried over */ }
}

function takePending(): QuickGame | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const p = raw ? JSON.parse(raw) as { game?: unknown; at?: unknown } : null;
    return p && isGame(p.game) && typeof p.at === 'number' && Date.now() - p.at < PENDING_MS ? p.game : null;
  } catch { return null; }
}

const hasPending = () => {
  try { return !!sessionStorage.getItem(PENDING_KEY); } catch { return false; }
};

export default function QuickPlay() {
  const nav = useNavigate();
  const { profile, ready, openSignIn, signInOpen } = useAuth();
  // The quickest game to drop into; the three games each have their own page for more.
  const game: QuickGame = 'cards';
  const [busy, setBusy] = useState(false);

  const play = useCallback(async (g: QuickGame) => {
    setBusy(true);
    try {
      const r = g === 'cards'
        ? await call<{ code: string }>('cards:quickJoin', chogPref())
        : await call<{ code: string }>('rooms:quickJoin');
      nav(g === 'cards' ? `/cards/r/${r.code}` : `/r/${r.code}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  }, [nav]);

  const go = () => {
    if (busy) return;
    if (!profile) {
      setPending(game);
      openSignIn();
      return;
    }
    void play(game);
  };

  // Signed in (here, or back from Discord): carry on with the tap that asked for it.
  useEffect(() => {
    if (!ready || !profile || !hasPending()) return;
    const g = takePending();
    if (g) void play(g);
  }, [ready, profile, play]);

  // The sign-in dialog closed without signing in: forget the tap.
  const wasOpen = useRef(signInOpen);
  useEffect(() => {
    if (wasOpen.current && !signInOpen && !profile) setPending(null);
    wasOpen.current = signInOpen;
  }, [signInOpen, profile]);

  return (
    <div className="qp">
      <button type="button" className="btn primary hero-cta qp-go" onClick={go} disabled={busy} aria-busy={busy}>
        {busy ? 'Finding a seat…' : 'Play now'}
      </button>
      <p className="qp-hint">Drops you into a quick game of {GAMES.cards.name}: the next table to fill, or one with bots.</p>
    </div>
  );
}
