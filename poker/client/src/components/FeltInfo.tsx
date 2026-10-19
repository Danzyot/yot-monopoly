import { useEffect, useState } from 'react';
import type { TableView } from '../../../shared/types';
import { chips, clock } from '../format';

// Faint event context painted in the middle of the felt, PokerNow style:
// where you are in the tournament without leaving the table.
export default function FeltInfo({ view }: { view: TableView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const t = view.tourney;
  const blinds = `${chips(view.blinds.sb)}/${chips(view.blinds.bb)}${view.blinds.ante ? ` (${chips(view.blinds.ante)})` : ''}`;

  // Cash tables: the hand and the stakes — plus the level and its clock when
  // the host set the blinds to rise, which players need for the same reason
  // tournament players do.
  if (!t) {
    const lvl = view.blindLevel ?? null;
    const lvlLeft = lvl?.endsAt ? Math.max(0, lvl.endsAt - now) : null;
    return (
      <div className="felt-info">
        {view.handNumber > 0 && <span>Hand #{view.handNumber}</span>}
        <span>
          {lvl ? `Level ${lvl.level} · ` : 'Blinds '}{blinds}
          {lvlLeft !== null && <> · {clock(lvlLeft)}</>}
        </span>
        {lvl?.next && (
          <span className="dim">Next {chips(lvl.next.sb)}/{chips(lvl.next.bb)}</span>
        )}
      </div>
    );
  }

  const elapsed = t.startedAt ? now - t.startedAt : 0;
  const levelLeft = t.levelEndsAt ? Math.max(0, t.levelEndsAt - now) : null;

  return (
    <div className="felt-info">
      <span>Hand #{view.handNumber}</span>
      <span>
        {t.onBreak ? 'Break' : `Level ${t.level}`} · {blinds}
        {levelLeft !== null && <> · {clock(levelLeft)}</>}
      </span>
      {t.nextBb !== null && (
        <span className="dim">Next {chips(t.nextSb ?? 0)}/{chips(t.nextBb)}</span>
      )}
      <span>{t.playersLeft} left of {t.totalEntries}</span>
      {(t.lateClockSeconds ?? 0) > 0 && (
        <span className="late-clock-on" title="Extra time near the end is on: every decision gets these seconds on top of the turn limit">
          +{t.lateClockSeconds}s per turn
        </span>
      )}
      {view.myRank !== null && (
        <span className="rank">
          Your rank {view.myRank}/{t.playersLeft} ({view.myRank} of {t.totalEntries})
        </span>
      )}
      {t.startedAt && <span className="dim">Elapsed {clock(elapsed)}</span>}
    </div>
  );
}
