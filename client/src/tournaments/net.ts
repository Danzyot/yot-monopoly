// Tournaments over the shared socket (../net.ts): every event is `tourney:*`.
import { useEffect, useState } from 'react';
import { call, getSocket, onEveryConnect } from '../net.ts';
import { loadChogTokenPref } from '../chogTokenPref.ts';
import type { TournamentMe, TournamentSummary, TournamentView } from '../../../shared/tournaments.ts';
import type { ScheduledEvent, TournamentScheduleView } from '../../../shared/tournamentSchedules.ts';

export const tourneyCall = call;

/** Register, asking to sit down as the Chog picked before (the server checks the wallet when seating). */
export function register(id: string) {
  const chogToken = loadChogTokenPref();
  return call('tourney:register', { id, ...(chogToken ? { chogToken } : {}) });
}

/** Every listed tournament and the scheduled ones still to come, kept up to date, and what this viewer may do. */
export function useTournamentList(): { list: TournamentSummary[] | null; scheduled: ScheduledEvent[]; me: TournamentMe | null } {
  const [list, setList] = useState<TournamentSummary[] | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledEvent[]>([]);
  const [me, setMe] = useState<TournamentMe | null>(null);
  useEffect(() => {
    const s = getSocket();
    s.on('tourney:list', setList);
    s.on('tourney:scheduled', setScheduled);
    const off = onEveryConnect(() => {
      call<{ tournaments: TournamentSummary[]; scheduled?: ScheduledEvent[]; me: TournamentMe }>('tourney:list', { subscribe: true })
        .then(r => { setList(r.tournaments); setScheduled(r.scheduled ?? []); setMe(r.me); })
        .catch(() => setList([]));
    });
    return () => { off(); s.off('tourney:list', setList); s.off('tourney:scheduled', setScheduled); };
  }, []);
  return { list, scheduled, me };
}

/** Operators: every recurring schedule, kept up to date. Pass false to skip (not an operator). */
export function useSchedules(enabled: boolean): { schedules: TournamentScheduleView[] | null; error: string | null } {
  const [schedules, setSchedules] = useState<TournamentScheduleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const s = getSocket();
    s.on('tourney:schedules', setSchedules);
    const off = onEveryConnect(() => {
      call<{ schedules: TournamentScheduleView[] }>('tourney:sched:list', { subscribe: true })
        .then(r => { setSchedules(r.schedules); setError(null); })
        .catch(e => setError(e.message));
    });
    return () => { off(); s.off('tourney:schedules', setSchedules); };
  }, [enabled]);
  return { schedules, error };
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
