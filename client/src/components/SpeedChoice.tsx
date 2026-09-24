// Speed Die in the HUD: the dice readout (with the third die) and the choice
// the current player makes after rolling the Bus or triples.
import { useEffect, useState } from 'react';
import { isOwnable } from '../../../shared/board.ts';
import { resolveTheme } from '../../../shared/themes.ts';
import type { GameView, SpeedFace } from '../../../shared/types.ts';
import { act } from '../net.ts';
import { toastError } from '../toast.tsx';

export function speedLabel(f: SpeedFace): string {
  return f === 'mr' ? '🎩 Mr. Monopoly' : f === 'bus' ? '🚌 Bus' : String(f);
}

/** "🎲 3 + 4 + 2 = 9" — the third die only when it was rolled. */
export function DiceRead({ game }: { game: GameView }) {
  if (!game.dice) return null;
  const [a, b] = game.dice;
  const s = game.speed;
  const triples = s !== null && a === b && s === a;
  const total = a + b + (typeof s === 'number' ? s : 0);
  return (
    <span className="dice-read">
      🎲 {a} + {b}{s !== null && <> + <span className="speed-face">{speedLabel(s)}</span></>}
      {s === 'bus' || triples ? null : <> = <b>{total}</b></>}
      {triples && <b className="accent"> triples!</b>}
    </span>
  );
}

/** Phase 'choose': Bus (a die or the sum) or triples (any space). */
export function ChooseBar({ game, me, selected }: { game: GameView; me: string; selected: number | null }) {
  const theme = resolveTheme(game.themeId, game.mapId);
  const c = game.choice;
  const cur = game.players.find(p => p.id === game.current);
  const [busy, setBusy] = useState(false);
  // Triples: best guess first (priciest unowned deed), and a tile clicked on the board wins.
  const suggested = (() => {
    const free = theme.spaces.map((s, i) => ({ s, i })).filter(({ s, i }) => isOwnable(s) && !game.owned[i]);
    return free.sort((x, y) => (y.s.price ?? 0) - (x.s.price ?? 0))[0]?.i ?? 0;
  })();
  const [target, setTarget] = useState(suggested);
  useEffect(() => { if (selected !== null) setTarget(selected); }, [selected]);

  if (!c || !cur) return null;
  const choose = (value: number) => {
    setBusy(true);
    act({ type: 'choose', value }).catch(toastError).finally(() => setBusy(false));
  };
  if (game.current !== me) {
    return (
      <div className="actionbar">
        <DiceRead game={game} />
        <span className="muted"><b style={{ color: cur.color }}>{cur.name}</b> {c.kind === 'bus' ? 'is taking the bus…' : 'rolled triples and is picking a space…'}</span>
      </div>
    );
  }
  if (c.kind === 'bus') {
    const [a, b] = game.dice ?? [0, 0];
    const label = (n: number) => (n === a + b ? `Both: ${n}` : `One die: ${n}`);
    return (
      <div className="actionbar mine">
        <DiceRead game={game} />
        <span>🚌 Bus — move by one die or both:</span>
        {c.options.map(n => (
          <button key={n} className={`btn ${n === Math.max(...c.options) ? 'primary' : ''}`} disabled={busy} onClick={() => choose(n)}>{label(n)}</button>
        ))}
      </div>
    );
  }
  return (
    <div className="actionbar mine">
      <DiceRead game={game} />
      <span>🎉 Triples! Move to any space:</span>
      <select value={target} onChange={e => setTarget(Number(e.target.value))} aria-label="Destination">
        {theme.spaces.map((s, i) => (
          <option key={i} value={i}>{s.name}{isOwnable(s) ? (game.owned[i] ? ' (owned)' : ` — ${theme.currency}${s.price}`) : ''}</option>
        ))}
      </select>
      <button className="btn primary" disabled={busy} onClick={() => choose(target)}>Go</button>
      <span className="small muted">or click a tile on the board</span>
    </div>
  );
}
