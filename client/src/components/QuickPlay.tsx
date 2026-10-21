// "Play now" in the home hero: one tap into a game. Pick Monopoly, Cards or
// Poker (remembered on this device). For Monopoly and Cards the server
// (rooms:quickJoin / cards:quickJoin, server/src/quickJoin.ts) seats you at the
// open public lobby nearest to filling up, or opens a table with bots when there
// is none. Poker is tournaments only: you go to the soonest one taking
// registrations (on poker's own site, signed in), or to /poker when none is.
// Signed out, the sign-in dialog comes first and the tap carries on after it,
// even across Discord's round trip (the pending pick waits in sessionStorage).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.tsx';
import { call } from '../net.ts';
import { chogPref } from '../cards/net.ts';
import { toastError } from '../toast.tsx';
import { GAMES } from '../../../shared/brand.ts';
import { POKER_BASE, pokerHref, withToken } from '../pokerLink.ts';
import { getToken } from '../api.ts';
import '../styles/home-alive.css';

type QuickGame = 'monopoly' | 'cards' | 'poker';
const CHOICES: { id: QuickGame; icon: string }[] = [{ id: 'monopoly', icon: '🎲' }, { id: 'cards', icon: '🃏' }, { id: 'poker', icon: '♠️' }];

const PICK_KEY = 'quickplay:game';
const PENDING_KEY = 'quickplay:pending';
/** A sign-in that takes longer than this (or is abandoned) does not throw anyone into a game later. */
const PENDING_MS = 10 * 60_000;

const isGame = (v: unknown): v is QuickGame => v === 'monopoly' || v === 'cards' || v === 'poker';

/** Poker's soonest tournament taking registrations, or null (none, or poker unreachable). */
async function nextPokerTournament(): Promise<string | null> {
  try {
    const r = await fetch(`${POKER_BASE}/api/lobby`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const { tournaments = [] } = await r.json() as { tournaments?: { id: string; state: string; scheduledStart: number | null; createdAt: number }[] };
    const open = tournaments.filter(t => t.state === 'registering')
      .sort((a, b) => (a.scheduledStart ?? Infinity) - (b.scheduledStart ?? Infinity) || b.createdAt - a.createdAt);
    return open[0]?.id ?? null;
  } catch { return null; }
}

function loadPick(): QuickGame {
  try {
    const v = localStorage.getItem(PICK_KEY);
    return isGame(v) ? v : 'monopoly';
  } catch { return 'monopoly'; }
}

function savePick(g: QuickGame) {
  try { localStorage.setItem(PICK_KEY, g); } catch { /* private mode: just not remembered */ }
}

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
  const [game, setGame] = useState<QuickGame>(loadPick);
  const [busy, setBusy] = useState(false);

  const play = useCallback(async (g: QuickGame) => {
    setBusy(true);
    if (g === 'poker') {
      const id = await nextPokerTournament();
      const token = getToken();
      if (!id) { nav(GAMES.poker.path); return; }
      const url = pokerHref(`/t/${id}`);
      location.assign(token ? withToken(url, token) : url);
      return;
    }
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

  const pick = (g: QuickGame) => { setGame(g); savePick(g); };

  return (
    <div className="qp">
      <div className="qp-pick" role="group" aria-label="Game to play">
        {CHOICES.map(c => (
          <button key={c.id} type="button" aria-pressed={game === c.id}
            className={game === c.id ? 'on' : ''} onClick={() => pick(c.id)}>
            <span aria-hidden>{c.icon}</span> {GAMES[c.id].name}
          </button>
        ))}
      </div>
      <button type="button" className="btn primary hero-cta qp-go" onClick={go} disabled={busy} aria-busy={busy}>
        {busy ? 'Finding a seat…' : 'Play now'}
      </button>
      <p className="qp-hint">{game === 'poker' ? 'Takes you to the next tournament taking sign-ups.' : 'Sits you at the next table to fill, or starts one with bots.'}</p>
    </div>
  );
}
