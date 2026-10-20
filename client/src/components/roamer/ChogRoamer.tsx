import { Suspense, lazy, useEffect, useState } from 'react';
import { HIDDEN_KEY } from './storage.ts';

// The little Chog that runs about the home page. This file is all the page
// carries: the Chog itself (its code, styles and sprite sheet) is fetched once
// the page has loaded and the browser is idle, and never if the visitor sent
// it away ("Hide the Chog").
const Roamer = lazy(() => import('./Roamer.tsx'));

function hidden(): boolean {
  try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
}

export default function ChogRoamer() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (hidden()) return;
    let idle = 0, timer = 0;
    const go = () => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => setReady(true), { timeout: 4000 });
      else timer = window.setTimeout(() => setReady(true), 1500);
    };
    // After the page's own load (its pictures and fonts), so the Chog never competes with them.
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
    return () => {
      window.removeEventListener('load', go);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle);
      clearTimeout(timer);
    };
  }, []);
  return ready ? <Suspense fallback={null}><Roamer /></Suspense> : null;
}
