// The lobby is tournaments and nothing else, so both the home page and the
// dashboard show them the same way: what is playing now, what is coming up,
// and what has just finished.
import type { LobbyTournament } from '../../shared/types';

export interface TourneyGroups {
  live: LobbyTournament[];
  upcoming: LobbyTournament[];
  finished: LobbyTournament[];
}

export function groupTournaments(list: LobbyTournament[]): TourneyGroups {
  const live = list.filter(t => t.state === 'running' || t.state === 'break' || t.state === 'paused');
  // Soonest first; an event with no start time waits for its host, so it
  // goes after the ones with a time on them.
  const upcoming = list
    .filter(t => t.state === 'registering')
    .sort((a, b) => (a.scheduledStart ?? Infinity) - (b.scheduledStart ?? Infinity) || b.createdAt - a.createdAt);
  const finished = list.filter(t => t.state === 'finished');
  return { live, upcoming, finished };
}

/** "12 / 45" with a cap, "12 players" without one (the default). */
export function fieldLabel(t: Pick<LobbyTournament, 'players' | 'maxPlayers'>): string {
  if (t.maxPlayers) return `${t.players} / ${t.maxPlayers}`;
  return `${t.players} player${t.players === 1 ? '' : 's'}`;
}

/** When a registering event starts, in the viewer's own time. */
export function startLabel(ts: number | null): string {
  if (!ts) return 'Starts when the host is ready';
  return `Starts ${new Date(ts).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })}`;
}
