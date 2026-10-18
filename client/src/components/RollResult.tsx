// The middle beat of every roll: once the dice settle, the score pops up big
// in the middle of the screen ("4 + 3 = 7", a DOUBLES! badge), holds long
// enough to read, then shrinks down into the action bar, where the dice
// readout takes over. Only then does the piece walk (three/sequence.ts).
import { useLayoutEffect, useRef, useState } from 'react';
import type { GameView, SpeedFace } from '../../../shared/types.ts';
import { markRoll, useRollStage } from '../three/sequence.ts';

/**
 * The dice on the table belong to this turn: the current player has rolled
 * and the turn has not moved on. Before the roll (and before a doubles
 * re-roll) there is nothing to show.
 */
export function rolledThisTurn(game: GameView): boolean {
  if (!game.dice || game.phase === 'roll') return false;
  return game.rollTurn === undefined || game.rollTurn === game.turnNumber;
}

/** The dice readout may show: this turn's roll, once its result has played. */
export function useDiceShown(game: GameView): boolean {
  const beat = useRollStage(game.rollSeq);
  return beat === 'done' && rolledThisTurn(game);
}

const faceText = (f: SpeedFace) => (f === 'mr' ? '🎩' : f === 'bus' ? '🚌' : String(f));

export function RollResult({ game, me, target = '.actionbar' }: {
  game: GameView; me?: string;
  /** Where the score flies to when it is done (the dice readout's home). */
  target?: string;
}) {
  // The HUD tells the sequencer about a throw too, so the beats run even
  // while the board is still loading.
  const mounted = useRef(false);
  markRoll(game.rollSeq, !mounted.current);
  mounted.current = true;
  const beat = useRollStage(game.rollSeq);
  const box = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null);

  // Measure where to fly as the fly starts (the action bar moves between layouts).
  useLayoutEffect(() => {
    if (beat !== 'fly') { setFly(null); return; }
    const el = box.current;
    const to = document.querySelector(target)?.getBoundingClientRect();
    if (!el || !to) { setFly({ x: 0, y: window.innerHeight * 0.35 }); return; }
    const from = el.getBoundingClientRect();
    setFly({ x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2) });
  }, [beat, target]);

  if ((beat !== 'result' && beat !== 'fly') || !game.dice) return null;
  const [a, b] = game.dice;
  const s = game.speed ?? null;
  const roller = game.players.find(p => p.id === (game.rollBy ?? game.current));
  const triples = s !== null && a === b && s === a;
  const doubles = a === b && !triples;
  const total = a + b + (typeof s === 'number' ? s : 0);
  const thirdDoubles = doubles && game.doublesCount >= 3;
  const badge = triples ? 'TRIPLES!' : thirdDoubles ? 'THIRD DOUBLES — JAIL!' : doubles ? 'DOUBLES!' : null;
  const who = roller ? (roller.id === me ? 'You rolled' : `${roller.name} rolled`) : 'Rolled';
  const style = fly ? { transform: `translate(${fly.x}px, ${fly.y}px) scale(0.22)`, opacity: 0 } : undefined;

  return (
    <div className="roll-result-layer" aria-live="polite">
      <div ref={box} className={`roll-result ${beat} ${badge ? 'dbl' : ''}`} style={style} key={game.rollSeq}
        role="status" aria-label={`${who} ${a} and ${b}${s !== null ? ` and ${faceText(s)}` : ''}, ${total}${badge ? `, ${badge}` : ''}`}>
        <span className="rr-who" style={{ color: roller?.color }}>{who}</span>
        <span className="rr-sum">
          <i className="rr-die">{a}</i>
          <span className="rr-op">+</span>
          <i className="rr-die">{b}</i>
          {s !== null && <><span className="rr-op">+</span><i className="rr-die speed">{faceText(s)}</i></>}
          {s !== 'bus' && !triples && <><span className="rr-op">=</span><b className="rr-total">{total}</b></>}
        </span>
        {badge && <span className="rr-badge">{badge}</span>}
        {s === 'bus' && <span className="rr-note">Bus: move by one die or both</span>}
        {s === 'mr' && <span className="rr-note">Mr. Monopoly moves on after this</span>}
      </div>
    </div>
  );
}
