import { useEffect, useState } from 'react';
import type { ActionType, LegalActions } from '../../../shared/types';
import { chips } from '../format';

interface Props {
  legal: LegalActions;
  bigBlind: number;
  onAction: (type: ActionType, amount?: number) => void;
}

export default function ActionBar({ legal, bigBlind, onAction }: Props) {
  const [raiseTo, setRaiseTo] = useState(legal.minRaiseTo);
  const [showRaise, setShowRaise] = useState(false);
  // These buttons appear in the same strip of screen the pre-select row was
  // occupying a moment ago, so a tap already on its way down lands on
  // whichever button now sits there — Raise, and for a short stack whose
  // minimum raise is its whole stack, All-in. A player reported exactly that:
  // pressed Fold now, ended up all-in. The buttons ignore anything that
  // arrives in the first fraction of a second after a turn begins; a
  // deliberate tap is never that fast, and the clock is twenty seconds.
  const [armed, setArmed] = useState(false);

  // Reset slider whenever a new decision arrives.
  useEffect(() => {
    setRaiseTo(legal.minRaiseTo);
    setShowRaise(false);
    setArmed(false);
    const t = setTimeout(() => setArmed(true), 350);
    return () => clearTimeout(t);
  }, [legal.seat, legal.minRaiseTo, legal.toCall]);

  const clamp = (v: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(v)));
  // A "pot" raise = call, then raise by the pot as it stands after the call.
  // As a raise-TO (street total): my current bet + the call + fraction of
  // (pot + call). Using toCall in place of my street bet overstates the raise
  // whenever I'm behind the current bet — the usual case facing a bet.
  const potAfterCall = legal.pot + legal.toCall;
  const callTotal = (legal.myBet ?? 0) + legal.toCall;
  const quick = [
    { label: 'Min', value: legal.minRaiseTo },
    { label: '¼ pot', value: callTotal + Math.round(potAfterCall * 0.25) },
    { label: '½ pot', value: callTotal + Math.round(potAfterCall * 0.5) },
    { label: '¾ pot', value: callTotal + Math.round(potAfterCall * 0.75) },
    { label: 'Pot', value: callTotal + potAfterCall },
    { label: 'All-in', value: legal.maxRaiseTo },
  ];

  const raiseWord = legal.toCall > 0 ? 'Raise to' : 'Bet';
  // % of my total chips (stack + already committed) this bet represents.
  const stackPct = legal.maxRaiseTo > 0 ? Math.round((raiseTo / legal.maxRaiseTo) * 100) : 0;

  return (
    <div className={`action-dock${armed ? '' : ' settling'}`}>
      {showRaise && legal.canRaise && (
        <div className="raise-panel">
          <div className="quick-bets">
            {quick.map(q => (
              <button key={q.label} className="btn btn-sm" onClick={() => setRaiseTo(clamp(q.value))}>
                {q.label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={Math.max(1, Math.floor(bigBlind / 2))}
            value={raiseTo}
            onChange={e => setRaiseTo(clamp(Number(e.target.value)))}
          />
          <input
            className="input raise-custom"
            type="number"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            value={raiseTo}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setRaiseTo(Math.min(legal.maxRaiseTo, Math.max(0, Math.round(v))));
            }}
            onBlur={() => setRaiseTo(clamp(raiseTo))}
          />
          <span className="stack-pct" title="Share of your chips">{stackPct}%</span>
        </div>
      )}
      <div className="action-buttons">
        {legal.canFold && (
          <button className="btn btn-danger" onClick={() => onAction('fold')}>Fold</button>
        )}
        {legal.canCheck ? (
          <button className="btn" onClick={() => onAction('check')}>Check</button>
        ) : (
          <button className="btn btn-success" onClick={() => onAction('call')}>
            Call {chips(legal.toCall)}
          </button>
        )}
        {legal.canRaise && !showRaise && (
          <button className="btn btn-primary" onClick={() => setShowRaise(true)}>
            {raiseWord}…
          </button>
        )}
        {legal.canRaise && showRaise && (
          <button
            className="btn btn-primary"
            onClick={() => onAction(raiseTo >= legal.maxRaiseTo ? 'allin' : (legal.toCall > 0 ? 'raise' : 'bet'), clamp(raiseTo))}
          >
            {raiseTo >= legal.maxRaiseTo ? 'All-in' : raiseWord} {chips(clamp(raiseTo))}
          </button>
        )}
      </div>
    </div>
  );
}
