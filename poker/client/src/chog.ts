// "Your Chog": the signed-in player's own Chog avatar, shared by the header
// chip and the picker. Everyone else's arrives in the views (`chog` on seats,
// chat lines, standings), already confirmed by the server.
import { useSyncExternalStore } from 'react';
import type { ChogBadge } from '../../shared/types';
import { api, type MyChogs } from './api';

/** The hub serves every Chog's thumbnail (128px webp) at /chogs/<id>.webp. */
export function chogArtUrl(hubUrl: string, chogToken: number): string {
  return `${hubUrl.replace(/\/+$/, '')}/chogs/${chogToken}.webp`;
}

interface State { loaded: boolean; data: MyChogs | null }
let state: State = { loaded: false, data: null };
const subs = new Set<() => void>();
const set = (s: State) => { state = s; for (const f of subs) f(); };

export function useMyChogs(): State {
  return useSyncExternalStore(
    f => { subs.add(f); return () => { subs.delete(f); }; },
    () => state,
  );
}

/** The Chog the signed-in player shows, as the server last said. */
export function myChog(s: State): ChogBadge | null {
  const d = s.data;
  if (!d || d.pick === null || !d.reachable) return null;
  return d.chogs.find(c => c.chogToken === d.pick) ?? null;
}

export async function loadMyChogs(refresh = false): Promise<MyChogs | null> {
  try {
    const data = await api.myChogs(refresh);
    set({ loaded: true, data });
    return data;
  } catch {
    set({ loaded: true, data: null });
    return null;
  }
}

export async function pickMyChog(chogToken: number | null): Promise<void> {
  const r = await api.pickChog(chogToken);
  if (state.data) set({ loaded: true, data: { ...state.data, pick: r.pick } });
  else await loadMyChogs();
}

export function forgetMyChogs(): void {
  set({ loaded: false, data: null });
}
