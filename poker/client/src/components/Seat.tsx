import { useEffect, useState } from 'react';
import type { SeatView } from '../../../shared/types';
import Avatar from './Avatar';
import CardView from './CardView';

interface Props {
  seat: SeatView;
  x: number; // percent within felt
  y: number;
  isWinner: boolean;
  canSit: boolean;
  hideEmpty: boolean; // viewer is seated — don't render empty seats at all
  isSelf: boolean;
  myHandName: string | null;
  onSit: () => void;
  onBack: () => void; // "I'm back" from away state
  actionDeadline: number | null;
  actionStarted: number | null;
  // How to render stacks/bets: raw chips or big blinds.
  fmt: (n: number) => string;
}

export default function Seat({
  seat, x, y, isWinner, canSit, hideEmpty, isSelf, myHandName,
  onSit, onBack, actionDeadline, actionStarted, fmt,
}: Props) {
  const style = { left: `${x}%`, top: `${y}%` };

  if (!seat.player) {
    if (hideEmpty) return null;
    return (
      <div className="seat" style={style}>
        {canSit ? (
          <button className="seat-empty" onClick={onSit}>SIT HERE</button>
        ) : (
          <div className="seat-empty" style={{ opacity: 0.4 }}>EMPTY</div>
        )}
      </div>
    );
  }

  const away = seat.sittingOut || seat.offline;
  const cls = [
    'seat',
    seat.folded ? 'folded' : '',
    seat.isTurn ? 'turn' : '',
    seat.allIn ? 'allin' : '',
    isWinner ? 'winner' : '',
    away ? 'away' : '',
    // Your own seat, so the stylesheet can light your two cards.
    isSelf ? 'me' : '',
  ].filter(Boolean).join(' ');

  // Per-player all-in flame color (stable hash of the player id).
  const FIRE = ['#ff4d3d', '#ff9d2e', '#37d67a', '#3da5ff', '#b16dff', '#ff5ca8'];
  let fireColor = FIRE[0];
  if (seat.allIn) {
    let h = 0;
    for (const ch of seat.player.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    fireColor = FIRE[h % FIRE.length];
  }

  return (
    <div className={cls} data-hero={isSelf ? '1' : undefined} style={{ ...style, ['--fire' as string]: fireColor }}>
      {/* Real animated flames behind an all-in seat, glowing in the
          player's own fire color. */}
      {seat.allIn && !seat.folded && (
        <img className="allin-flames" src="/reactions/1f525.webp" alt="" draggable={false} />
      )}
      {isWinner && (
        <div className={`win-pop${seat.wonSplit ? ' split' : ''}`}>
          {seat.wonSplit ? 'SPLIT' : 'WIN'}
        </div>
      )}
      {/* Own cards stay visible after folding (greyed) — you should always be
          able to see what you let go of. */}
      {seat.cards && (!seat.folded || isSelf) && (
        <div className={`seat-cards${seat.isTurn ? ' can-bob' : ''}${seat.folded ? ' mucked' : ''}`}>
          {seat.cards.map((c, i) => <CardView key={i} card={c} small />)}
        </div>
      )}
      {/* live hand strength for the viewer, PokerNow-style tag under the cards */}
      {isSelf && myHandName && !seat.folded && (
        <div className="hand-badge">{myHandName}</div>
      )}
      {/* After folding you still see what you had — "Folded · Two Pair" is the
          information players actually want, not just "Folded". */}
      {isSelf && seat.folded && (
        <div className="hand-badge muck-badge">
          Folded{myHandName ? ` · ${myHandName}` : ''}
        </div>
      )}
      <div className="seat-box">
        {/* The countdown shows on offline/away players too — everyone at the
            table can see how long the wait is before the auto-fold. */}
        {seat.isTurn && <TimerRing deadline={actionDeadline} started={actionStarted} />}
        {/* The tag's first word is what happened — SB, BB, Check, Fold, Call,
            All-in, "Raise 150", "Bet 400" — so it becomes a class and the
            stylesheet can give each its own colour. */}
        {seat.lastAction && (
          <span className={`seat-action-tag t-${seat.lastAction.split(' ')[0].toLowerCase()}`}>
            {seat.lastAction}
          </span>
        )}
        <span className="seat-name">
          <Avatar value={seat.player.avatar} size={18} />
          {/* The name needs its own element to ellipsize: a bare text node
              inside a flex row just gets chopped mid-letter. */}
          <span className="sn-text">{seat.player.name}</span>
        </span>
        <span className="seat-stack">
          {seat.allIn ? 'ALL-IN' : fmt(seat.stack)}
        </span>
        {seat.offline ? (
          <span className="seat-sub offline-label">offline{seat.missedTurns > 0 ? ` (${seat.missedTurns})` : ''}</span>
        ) : seat.sittingOut ? (
          <span className="seat-sub">away{seat.missedTurns > 0 ? ` (${seat.missedTurns})` : ''}</span>
        ) : null}
        {seat.kickAt && seat.offline && <KickBar kickAt={seat.kickAt} />}
        {isWinner && seat.won ? (
          <span className="seat-sub" style={{ color: 'var(--green)' }}>+{fmt(seat.won)}</span>
        ) : null}
      </div>
      {/* The away player's way back. This used to be hidden unless the server
          also considered them online — which hid it from exactly the people
          who needed it, since being marked away usually comes with a
          connection the server has written off. Anyone who can click it is
          plainly at their screen, so clicking it IS the proof. */}
      {isSelf && seat.sittingOut && (
        <button className="btn btn-success btn-sm back-btn" onClick={onBack}>
          I'm back
        </button>
      )}
    </div>
  );
}

// Countdown until an offline player is removed (cash games).
function KickBar({ kickAt }: { kickAt: number }) {
  const TOTAL = 120_000;
  const [frac, setFrac] = useState(1);
  useEffect(() => {
    const tick = () => setFrac(Math.max(0, Math.min(1, (kickAt - Date.now()) / TOTAL)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [kickAt]);
  return (
    <div className="kick-bar">
      <div className="kick-bar-fill" style={{ width: `${frac * 100}%` }} />
    </div>
  );
}

function TimerRing({ deadline, started }: { deadline: number | null; started: number | null }) {
  const [frac, setFrac] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [urgent, setUrgent] = useState(false);

  useEffect(() => {
    if (!deadline || !started) return;
    const tick = () => {
      const total = deadline - started;
      const left = deadline - Date.now();
      setFrac(Math.max(0, Math.min(1, left / total)));
      setSeconds(Math.max(0, Math.ceil(left / 1000)));
      setUrgent(left < 5_000); // final five seconds: red ring + card bob
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [deadline, started]);

  // The stylesheet drives the card bob via `.seat:has(.timer-ring.urgent)`.
  if (!deadline || !started) return null;
  const R = 48;
  const C = 2 * Math.PI * R;
  return (
    <div className={`timer-ring${urgent ? ' urgent' : ''}`}>
      <svg viewBox="0 0 104 104">
        <circle className="track" cx="52" cy="52" r={R} />
        <circle
          className="prog" cx="52" cy="52" r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <span className="timer-seconds">{seconds}</span>
    </div>
  );
}
