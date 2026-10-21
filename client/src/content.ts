// Operator content overrides (space names, card text, look names, currency,
// characters, mini-games). Fetched once before the first render and merged
// into the shared catalogues (shared/content.ts), so the board textures, deeds,
// lobby and HUD all resolve the new words like built-in ones. The dashboard's
// Content tab pushes its saves through setLiveContent.
import { useSyncExternalStore } from 'react';
import { api } from './api.ts';
import { applyContentOverrides } from '../../shared/content.ts';
import { currentContent, type ContentOverrides } from '../../shared/contentOverrides.ts';

const subs = new Set<() => void>();

export function setLiveContent(o: ContentOverrides): void {
  applyContentOverrides(o);
  subs.forEach(f => f());
}

/** Load the server's overrides; gives up after `ms` so a slow server never blocks the page. */
export async function bootContent(ms = 2500): Promise<void> {
  const timeout = new Promise<null>(r => setTimeout(() => r(null), ms));
  // index.html asks for them as the page arrives; without that (an old page) ask now.
  const early = (window as { __yotContent?: Promise<{ overrides?: ContentOverrides } | null> }).__yotContent;
  try {
    const r = await Promise.race([early ?? api<{ overrides: ContentOverrides }>('/api/content'), timeout]);
    if (r?.overrides) setLiveContent(r.overrides);
  } catch { /* offline or an old server: the built-in names stand */ }
}

/** The live overrides; re-renders when they change. */
export function useContent(): ContentOverrides {
  return useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, currentContent);
}
