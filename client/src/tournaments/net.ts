// Tournaments over the shared socket (../net.ts): every event is `tourney:*`.
import { useEffect, useState } from 'react';
import { call, getSocket, onEveryConnect } from '../net.ts';
import { loadChogTokenPref } from '../chogTokenPref.ts';
import type { TournamentMe, TournamentSummary, TournamentView } from '../../../shared/tournaments.ts';

export const tourneyCall = call;

/** Register, asking to sit down as the Chog picked before (the server checks the wallet when seating). */
export function register(id: string) {
  const chogToken = loadChogTokenPref();
  return call('tourney:register', { id, ...(chogToken ? { chogToken } : {}) });
}

/** Every listed tournament, kept up to date, and what this viewer may do (host or not). */
export function useTournamentList(): { list: TournamentSummary[] | null; me: TournamentMe | null } {
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [me, setMe] = useState<TournamentMe | null>(null);
  useEffect(() => {
    const s = getSocket();
    s.on('tourney:list', setList);
    const off = onEveryConnect(() => {
      call<{ tournaments: TournamentSummary[]; me: TournamentMe }>('tourney:list', { subscribe: true })
        .then(r => { setList(r.tournaments); setMe(r.me); })
        .catch(() => setList([]));
    });
    return () => { off(); s.off('tourney:list', setList); };
  }, []);
  return { list, me };
}

/** One tournament, live. `skew` is the server clock minus ours, for countdowns. */
export function useTournament(id: string) {
  const [view, setView] = useState<TournamentView | null>(null);
  const [me, setMe] = useState<TournamentMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  useEffect(() => {
    const s = getSocket();
    const onState = (v: TournamentView) => {
      if (v.id !== id) return;
      setView(v);
      setSkew(v.now - Date.now());
    };
    s.on('tourney:state', onState);
    const off = onEveryConnect(() => {
      call<{ tournament: TournamentView; me: TournamentMe }>('tourney:sub', { id })
        .then(r => { onState(r.tournament); setMe(r.me); setError(null); })
        .catch(e => setError(e.message));
    });
    return () => {
      off();
      s.off('tourney:state', onState);
      if (s.connected) s.emit('tourney:unsub', { id });
    };
  }, [id]);
  return { view, me, error, skew };
}
