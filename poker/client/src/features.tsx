// The client's view of which parts of the site are switched on.
//
// One fetch, shared: the toggles arrive with /api/config, which every page
// already needs. Components ask `useFeature('replay')` and render nothing
// when it is off — the server refuses the action either way, so this is only
// about not showing a button that cannot work.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Features {
  music: boolean;
  handLog: boolean;
  replay: boolean;
  chat: boolean;
  leaderboard: boolean;
  rabbitHunting: boolean;
}

// Until the config lands, assume everything is off. Showing a control for a
// second and then snatching it away is worse than showing it a moment late.
const ALL_OFF: Features = {
  music: false, handLog: false, replay: false,
  chat: false, leaderboard: false, rabbitHunting: false,
};

// `null` means "not answered yet", which is a different thing from "off".
// Routes that redirect on a switch have to be able to tell them apart, or a
// shared link bounces to the home page before the answer ever arrives.
const Ctx = createContext<Features | null>(null);

export function FeatureProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<Features | null>(null);
  useEffect(() => {
    let stale = false;
    const pull = () => {
      api.config()
        .then(c => { if (!stale && c.features) setFeatures(c.features); })
        .catch(() => {});
    };
    pull();
    // An operator flipping a switch mid-event should reach players when they
    // come back to the tab, without a reload.
    const onFocus = () => { if (document.visibilityState === 'visible') pull(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => { stale = true; document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  return <Ctx.Provider value={features}>{children}</Ctx.Provider>;
}

export function useFeatures(): Features {
  return useContext(Ctx) ?? ALL_OFF;
}

export function useFeature(name: keyof Features): boolean {
  return (useContext(Ctx) ?? ALL_OFF)[name];
}

// Three-state: on, off, or not known yet. Only worth reaching for where the
// difference changes what you do — a redirect, rather than a hidden button.
export function useFeatureState(name: keyof Features): boolean | null {
  const f = useContext(Ctx);
  return f ? f[name] : null;
}
