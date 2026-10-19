// Clocks and table controls in the game HUD: the current player's turn
// countdown, the game-length clock, the debt deadline, the pause banner and
// the host's pause button. All countdowns read the server clock (`skew`) and
// stand still while the game is paused (they count from the pause instead).
import { useEffect, useState } from 'react';
import type { GameView, RoomView } from '../../../shared/types.ts';
import { call } from '../net.ts';
import { useAuth } from '../auth.tsx';
import { toastError } from '../toast.tsx';
import { useSceneBusy } from '../three/sequence.ts';

/** Below this many seconds a countdown turns urgent. */
const URGENT_S = 10;

/** Server "now" that re-renders every `ms` while `on`. */
function useServerNow(skew: number, on: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now + skew;
}

/** Seconds left until a server-clock deadline, frozen at the pause while paused. */
function secondsLeft(game: GameView, deadline: number, serverNow: number): number {
  const at = game.paused ? game.paused.at : serverNow;
  return Math.max(0, Math.ceil((deadline - at) / 1000));
}

export function clockText(s: number): string {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Ring + seconds for the current player's turn step. Everyone sees it. The
 * server starts a step's clock once the move before it has played out
 * (Game.holdTurnClock), so its deadline can sit more than a full turn away
 * while the dice still roll: until the scene is over the clock shows the full
 * turn, standing still, then counts down from the real deadline, never
 * showing more than a full turn.
 */
export function TurnClock({ game, me, skew }: { game: GameView; me: string; skew: number }) {
  const deadline = game.turnEndsAt;
  const now = useServerNow(skew, deadline !== null && !game.paused);
  const sceneBusy = useSceneBusy();
  if (deadline === null || game.phase === 'over') return null;
  const total = Math.max(1, game.rules.turnSeconds);
  const left = sceneBusy && !game.paused ? total : Math.min(total, secondsLeft(game, deadline, now));
  const cur = game.players.find(p => p.id === game.current);
  if (!cur) return null;
  const frac = Math.min(1, left / total);
  const urgent = left <= URGENT_S;
  const R = 13, C = 2 * Math.PI * R;
  return (
    <div className={`turn-clock ${urgent ? 'urgent' : ''} ${cur.id === me ? 'mine' : ''}`} role="timer"
      aria-label={`${cur.id === me ? 'Your' : `${cur.name}'s`} turn: ${left} seconds left`}>
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden>
        <circle cx="16" cy="16" r={R} className="turn-clock-track" />
        <circle cx="16" cy="16" r={R} className="turn-clock-arc" style={{ stroke: urgent ? undefined : cur.color }}
          strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 16 16)" />
      </svg>
      <span className="turn-clock-text">
        <b style={{ color: urgent ? undefined : cur.color }}>{cur.id === me ? 'Your turn' : cur.name}</b>
        <span className="mono">{left}s</span>
      </span>
    </div>
  );
}

/** "Pay within 2:31" for someone who owes money (debt deadline). */
export function DebtClock({ game, id, skew }: { game: GameView; id: string; skew: number }) {
  const deadline = game.debtEndsAt?.[id];
  const now = useServerNow(skew, deadline !== undefined && !game.paused, 500);
  if (deadline === undefined) return null;
  const left = secondsLeft(game, deadline, now);
  return <span className={`debt-clock mono ${left <= URGENT_S ? 'urgent' : ''}`} title="After this the bank settles for you: it mortgages and sells what it must, or declares you bankrupt">⏱ {clockText(left)}</span>;
}

/** Remaining game time (game-length rule) for the top bar. */
export function TimeLeft({ game, skew }: { game: GameView; skew: number }) {
  const now = useServerNow(skew, game.endsAt !== null && !game.paused && !game.timeUp, 1000);
  if (game.endsAt === null || game.phase === 'over') return null;
  if (game.timeUp) return <span className="pill time-left urgent" title="Time is up: the game ends when this turn is over">⏰ last turn</span>;
  const left = secondsLeft(game, game.endsAt, now);
  return <span className={`pill time-left mono ${left <= 60 ? 'urgent' : ''}`} title="Time left in this game">⏳ {clockText(left)}</span>;
}

/** The host's (or an operator's) pause / resume button. */
export function PauseButton({ room, game, me }: { room: RoomView; game: GameView; me: string }) {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  if (game.phase === 'over' || (room.hostId !== me && !profile?.isAdmin)) return null;
  const paused = !!game.paused;
  const toggle = () => {
    setBusy(true);
    call('room:pause', { paused: !paused }).catch(toastError).finally(() => setBusy(false));
  };
  return (
    <button className="btn tiny" disabled={busy} onClick={toggle} title={paused ? 'Resume the game' : 'Pause every clock (chat keeps working)'}>
      {paused ? '▶️' : '⏸️'}<span className="hide-sm"> {paused ? 'Resume' : 'Pause'}</span>
    </button>
  );
}

/** Across the table while paused. Chat stays usable, so it never blocks clicks. */
export function PausedBanner({ game }: { game: GameView }) {
  if (!game.paused || game.phase === 'over') return null;
  return (
    <div className="paused-banner" role="status">
      <b>⏸️ Paused</b>
      <span>by {game.paused.by} — every clock is stopped</span>
    </div>
  );
}
