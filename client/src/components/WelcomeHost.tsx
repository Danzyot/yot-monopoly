// When the welcome tour (WelcomeTour.tsx) opens: once for a new player's first
// signed-in visit on this device, and whenever WELCOME_EVENT fires (the
// footer's "Replay the welcome tour"). Small and in the first download; the
// tour itself, with its 3D preview, loads only when it opens.
import { Suspense, lazy, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth.tsx';

const WelcomeTour = lazy(() => import('./WelcomeTour.tsx'));

/** Opens the tour from anywhere (the footer's replay link). */
export const WELCOME_EVENT = 'yot:welcome';
const SEEN_KEY = 'yot:welcome-seen';

/** Accounts that have had the tour on this device. */
export function welcomeSeen(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown[]).includes(id); } catch { return true; }
}

export function markWelcomeSeen(id: string): void {
  try {
    const list = (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as unknown[]).filter(x => typeof x === 'string' && x !== id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...list.slice(-19), id]));
  } catch { /* private mode: it may show again next visit */ }
}

/**
 * Mounted once in App: opens the tour for a new player's first signed-in visit
 * on this device (not on a game screen or the sign-in hand-off), and whenever
 * WELCOME_EVENT fires.
 */
export default function WelcomeHost() {
  const { ready, profile, newPlayer } = useAuth();
  const path = useLocation().pathname;
  const [open, setOpen] = useState(false);
  const busyPage = path.startsWith('/r/') || path.startsWith('/cards/r/') || path === '/sso' || path.startsWith('/admin');

  useEffect(() => {
    if (!ready || !profile || !newPlayer || busyPage || welcomeSeen(profile.id)) return;
    markWelcomeSeen(profile.id);
    setOpen(true);
  }, [ready, profile, newPlayer, busyPage]);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(WELCOME_EVENT, show);
    return () => window.removeEventListener(WELCOME_EVENT, show);
  }, []);

  if (!open || !profile) return null;
  return <Suspense fallback={null}><WelcomeTour onClose={() => setOpen(false)} /></Suspense>;
}
